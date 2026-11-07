import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hasValidAccessSession } from "@/lib/access-session.server";
import { isContactEligibleToSend, isNamedWorkEmail } from "@/lib/automation-policy";
import { runScoutAutomationCycle } from "@/lib/automation.server";
import { sendResendEmail } from "@/lib/resend.server";

const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("configure"),
    enabled: z.boolean(),
    searchQuery: z.string().trim().min(5).max(240),
  }),
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("approve"), draftId: z.string().uuid() }),
  z.object({ action: z.literal("reject"), draftId: z.string().uuid() }),
  z.object({
    action: z.literal("edit"),
    draftId: z.string().uuid(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(8000),
  }),
  z.object({
    action: z.literal("review-contact"),
    contactId: z.string().uuid(),
    lawfulBasis: z.enum(["consent", "legitimate_interest", "contract", "other"]),
  }),
]);

type LawfulBasis = Extract<
  z.infer<typeof RequestSchema>,
  { action: "review-contact" }
>["lawfulBasis"];

function emailHtml(body: string) {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;line-height:1.6">${paragraph.replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">${paragraphs}</body></html>`;
}

async function reviewContact(contactId: string, lawfulBasis: LawfulBasis) {
  const { data: contact, error: lookupError } = await supabaseAdmin
    .from("sourced_contacts")
    .select("id,email,email_status,do_not_contact,opted_out_at")
    .eq("id", contactId)
    .maybeSingle();
  if (lookupError) throw new Error(`Could not load contact: ${lookupError.message}`);
  if (!contact) return Response.json({ error: "Contact not found." }, { status: 404 });
  if (contact.do_not_contact || contact.opted_out_at) {
    return Response.json(
      { error: "This contact has opted out and cannot be made eligible." },
      { status: 409 },
    );
  }
  if (!contact.email || contact.email_status !== "valid") {
    return Response.json(
      { error: "A verified named work email is required before review." },
      { status: 409 },
    );
  }

  const reviewedAt = new Date().toISOString();
  const { data: reviewed, error } = await supabaseAdmin
    .from("sourced_contacts")
    .update({
      lawful_basis: lawfulBasis,
      commercialization_eligible: true,
      commercialization_reviewed_at: reviewedAt,
      updated_at: reviewedAt,
    })
    .eq("id", contactId)
    .eq("do_not_contact", false)
    .is("opted_out_at", null)
    .eq("email_status", "valid")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not save commercialization review: ${error.message}`);
  if (!reviewed) {
    return Response.json(
      { error: "Contact preferences changed. Refresh and review the contact again." },
      { status: 409 },
    );
  }
  return Response.json({ ok: true, reviewedAt });
}

async function rejectDraft(draftId: string) {
  const { data, error } = await supabaseAdmin
    .from("scout_automation_outbox")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not reject draft: ${error.message}`);
  if (!data)
    return Response.json({ error: "Draft is no longer awaiting review." }, { status: 409 });
  return Response.json({ ok: true });
}

async function approveDraft(draftId: string) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from("scout_automation_outbox")
    .select(
      "id,source_type,parent_sent_id,contact_id,company_name,recipient_name,recipient_email,subject,body,status",
    )
    .eq("id", draftId)
    .maybeSingle();
  if (draftError) throw new Error(`Could not load draft: ${draftError.message}`);
  if (!draft || draft.status !== "pending") {
    return Response.json({ error: "Draft is no longer awaiting review." }, { status: 409 });
  }
  if (!draft.contact_id) {
    return Response.json(
      { error: "This draft is not linked to a reviewed contact." },
      { status: 409 },
    );
  }
  const { data: contact, error: contactError } = await supabaseAdmin
    .from("sourced_contacts")
    .select(
      "company_id,email,email_status,do_not_contact,opted_out_at,commercialization_eligible,commercialization_reviewed_at,lawful_basis",
    )
    .eq("id", draft.contact_id)
    .maybeSingle();
  if (contactError)
    throw new Error(`Could not verify contact eligibility: ${contactError.message}`);
  if (
    !contact ||
    !isContactEligibleToSend({
      email: contact.email,
      emailStatus: contact.email_status,
      doNotContact: contact.do_not_contact,
      optedOutAt: contact.opted_out_at,
      commercializationEligible: contact.commercialization_eligible,
      reviewedAt: contact.commercialization_reviewed_at,
      lawfulBasis: contact.lawful_basis,
      recipientEmail: draft.recipient_email,
    })
  ) {
    return Response.json(
      { error: "Review this contact's lawful basis and eligibility before approving the send." },
      { status: 409 },
    );
  }
  const { data: company, error: companyError } = await supabaseAdmin
    .from("scouted_companies")
    .select("domain")
    .eq("id", contact.company_id)
    .maybeSingle();
  if (companyError) throw new Error(`Could not verify recipient company: ${companyError.message}`);
  if (!company || !isNamedWorkEmail(draft.recipient_email, company.domain)) {
    return Response.json(
      { error: "Only a named work email on the sourced company domain can be sent." },
      { status: 409 },
    );
  }
  const { data: blockedEvent, error: eventError } = await supabaseAdmin
    .from("email_delivery_events")
    .select("id")
    .eq("email", draft.recipient_email.toLowerCase())
    .in("type", ["email.bounced", "email.complained"])
    .limit(1)
    .maybeSingle();
  if (eventError) throw new Error(`Could not check delivery restrictions: ${eventError.message}`);
  if (blockedEvent) {
    return Response.json(
      {
        error:
          "This recipient has a bounce or complaint history and cannot be sent automation email.",
      },
      { status: 409 },
    );
  }
  if (draft.source_type === "initial") {
    const { data: priorSend, error: sentError } = await supabaseAdmin
      .from("scout_automation_sent_emails")
      .select("id")
      .eq("recipient_email", draft.recipient_email.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (sentError) throw new Error(`Could not check previous sends: ${sentError.message}`);
    if (priorSend) {
      return Response.json(
        { error: "This recipient already has an automation send record." },
        { status: 409 },
      );
    }
  }

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("scout_automation_outbox")
    .update({ status: "sending", updated_at: new Date().toISOString(), last_error: null })
    .eq("id", draftId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(`Could not reserve draft for sending: ${claimError.message}`);
  if (!claimed)
    return Response.json({ error: "Draft was approved in another request." }, { status: 409 });

  let resendId: string;
  try {
    resendId = await sendResendEmail(
      {
        from: "Emmanuel Nwachinemelu <nuel@nf.vaultio.site>",
        to: [draft.recipient_email],
        reply_to: "nuel@vaultio.tech",
        subject: draft.subject,
        text: draft.body,
        html: emailHtml(draft.body),
      },
      `scout-outbox-${draft.id}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resend rejected the email.";
    await supabaseAdmin
      .from("scout_automation_outbox")
      .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
      .eq("id", draft.id)
      .eq("status", "sending");
    return Response.json({ error: message }, { status: 502 });
  }

  const { error: recordError } = await supabaseAdmin.from("scout_automation_sent_emails").insert({
    outbox_id: draft.id,
    contact_id: draft.contact_id,
    recipient_email: draft.recipient_email.toLowerCase(),
    recipient_name: draft.recipient_name,
    company_name: draft.company_name,
    subject: draft.subject,
    body: draft.body,
    resend_id: resendId,
    source_type: draft.source_type,
    parent_sent_id: draft.parent_sent_id,
  });
  if (recordError) {
    console.error(
      "[automation] Resend accepted email but sent-record persistence failed",
      recordError.message,
    );
    await supabaseAdmin
      .from("scout_automation_outbox")
      .update({
        last_error: `Email was accepted by Resend (${resendId}), but its sent record could not be saved.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("status", "sending");
    return Response.json(
      {
        error:
          "Email was accepted by Resend, but recording the send failed. Do not retry this draft.",
      },
      { status: 502 },
    );
  }

  const { error: sentUpdateError } = await supabaseAdmin
    .from("scout_automation_outbox")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
    .eq("status", "sending");
  if (sentUpdateError) {
    console.error(
      "[automation] sent email record exists but outbox update failed",
      sentUpdateError.message,
    );
    return Response.json(
      { error: "Email was sent and recorded, but the outbox status needs reconciliation." },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, resendId });
}

export const Route = createFileRoute("/api/automation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!hasValidAccessSession(request)) return new Response("Unauthorized", { status: 401 });
        const [settings, runs, drafts, inbound] = await Promise.all([
          supabaseAdmin
            .from("scout_automation_settings")
            .select(
              "enabled,search_query,daily_cycle_date,daily_cycle_count,last_cycle_at,last_error",
            )
            .eq("id", 1)
            .single(),
          supabaseAdmin
            .from("scout_automation_runs")
            .select(
              "id,status,companies_reviewed,drafts_created,summary,error,started_at,completed_at",
            )
            .order("started_at", { ascending: false })
            .limit(20),
          supabaseAdmin
            .from("scout_automation_outbox")
            .select(
              "id,source_type,contact_id,company_name,recipient_name,recipient_email,subject,body,source_urls,status,last_error,created_at",
            )
            .in("status", ["pending", "failed", "sending"])
            .order("created_at", { ascending: false })
            .limit(50),
          supabaseAdmin
            .from("scout_automation_inbound_emails")
            .select("id,subject,sender_email,body,received_at,status")
            .order("received_at", { ascending: false })
            .limit(20),
        ]);
        const error = settings.error ?? runs.error ?? drafts.error ?? inbound.error;
        if (error) {
          console.error("[automation] failed to load dashboard", error.message);
          return Response.json({ error: "Could not load automation status." }, { status: 500 });
        }
        const contactIds = [
          ...new Set(
            (drafts.data ?? []).flatMap((draft) => (draft.contact_id ? [draft.contact_id] : [])),
          ),
        ];
        const contacts = contactIds.length
          ? await supabaseAdmin
              .from("sourced_contacts")
              .select(
                "id,email,email_status,do_not_contact,opted_out_at,commercialization_eligible,commercialization_reviewed_at,lawful_basis",
              )
              .in("id", contactIds)
          : { data: [], error: null };
        if (contacts.error) {
          console.error("[automation] failed to load contact eligibility", contacts.error.message);
          return Response.json({ error: "Could not load contact eligibility." }, { status: 500 });
        }
        const contactsById = new Map((contacts.data ?? []).map((contact) => [contact.id, contact]));
        const outboxIds = (drafts.data ?? []).map((draft) => draft.id);
        const sentRows = outboxIds.length
          ? await supabaseAdmin
              .from("scout_automation_sent_emails")
              .select("outbox_id")
              .in("outbox_id", outboxIds)
          : { data: [], error: null };
        if (sentRows.error) {
          console.error("[automation] failed to load recorded sends", sentRows.error.message);
          return Response.json({ error: "Could not load send statuses." }, { status: 500 });
        }
        const recordedSends = new Set(
          (sentRows.data ?? []).flatMap((row) => (row.outbox_id ? [row.outbox_id] : [])),
        );
        return Response.json(
          {
            settings: settings.data,
            runs: runs.data ?? [],
            drafts: (drafts.data ?? []).map((draft) => {
              const contact = draft.contact_id ? contactsById.get(draft.contact_id) : undefined;
              return {
                ...draft,
                status: recordedSends.has(draft.id) ? "sent" : draft.status,
                eligible: contact
                  ? isContactEligibleToSend({
                      email: contact.email,
                      emailStatus: contact.email_status,
                      doNotContact: contact.do_not_contact,
                      optedOutAt: contact.opted_out_at,
                      commercializationEligible: contact.commercialization_eligible,
                      reviewedAt: contact.commercialization_reviewed_at,
                      lawfulBasis: contact.lawful_basis,
                      recipientEmail: draft.recipient_email,
                    })
                  : false,
              };
            }),
            inbound: inbound.data ?? [],
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        if (!hasValidAccessSession(request)) return new Response("Unauthorized", { status: 401 });
        const raw = await request.json().catch(() => null);
        const parsed = RequestSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid automation request." }, { status: 400 });
        }
        try {
          switch (parsed.data.action) {
            case "configure": {
              const { error } = await supabaseAdmin
                .from("scout_automation_settings")
                .update({
                  enabled: parsed.data.enabled,
                  search_query: parsed.data.searchQuery,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", 1);
              if (error) throw new Error(`Could not save automation settings: ${error.message}`);
              return Response.json({ ok: true });
            }
            case "run": {
              const result = await runScoutAutomationCycle();
              const status =
                result.status === "daily_limit" ? 429 : result.status === "locked" ? 409 : 200;
              return Response.json(result, { status });
            }
            case "approve":
              return await approveDraft(parsed.data.draftId);
            case "reject":
              return await rejectDraft(parsed.data.draftId);
            case "edit": {
              const { data, error } = await supabaseAdmin
                .from("scout_automation_outbox")
                .update({
                  subject: parsed.data.subject,
                  body: parsed.data.body,
                  updated_at: new Date().toISOString(),
                  last_error: null,
                })
                .eq("id", parsed.data.draftId)
                .eq("status", "pending")
                .select("id")
                .maybeSingle();
              if (error) throw new Error(`Could not edit draft: ${error.message}`);
              if (!data)
                return Response.json({ error: "Draft is no longer editable." }, { status: 409 });
              return Response.json({ ok: true });
            }
            case "review-contact":
              return await reviewContact(parsed.data.contactId, parsed.data.lawfulBasis);
          }
          return Response.json({ error: "Unsupported automation request." }, { status: 400 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Automation request failed.";
          console.error("[automation] request failed", message);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
