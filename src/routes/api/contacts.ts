import { createFileRoute } from "@tanstack/react-router";
import { hasValidAccessSession } from "@/lib/access-session.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

const PAGE_SIZE = 100;
const OptOutRequest = z.object({ contactId: z.string().uuid() });

export const Route = createFileRoute("/api/contacts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!hasValidAccessSession(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const pageValue = new URL(request.url).searchParams.get("page") ?? "0";
        const page = Number(pageValue);
        if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
          return Response.json({ error: "Invalid page." }, { status: 400 });
        }

        const from = page * PAGE_SIZE;
        const {
          data: contacts,
          error: contactsError,
          count: contactsResultCount,
        } = await supabaseAdmin
          .from("sourced_contacts")
          .select(
            "id, company_id, full_name, title, email, email_status, linkedin_url, do_not_contact, lawful_basis, commercialization_eligible, first_sourced_at, last_sourced_at",
            { count: "exact" },
          )
          .order("last_sourced_at", { ascending: false })
          .range(from, from + PAGE_SIZE);
        if (contactsError) {
          console.error("[contacts] failed to load records", contactsError.message);
          return Response.json({ error: "Could not load saved contacts." }, { status: 500 });
        }

        const ids = (contacts ?? []).map((contact) => contact.id);
        const companyIds = [...new Set((contacts ?? []).map((contact) => contact.company_id))];
        const [companiesResult, sourcesResult] = await Promise.all([
          companyIds.length
            ? supabaseAdmin
                .from("scouted_companies")
                .select("id, name, domain, linkedin_url, stage, employee_count, industry")
                .in("id", companyIds)
            : Promise.resolve({ data: [], error: null }),
          ids.length
            ? supabaseAdmin
                .from("contact_sources")
                .select("contact_id, provider, source_url, observed_at")
                .in("contact_id", ids)
                .order("observed_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (companiesResult.error || sourcesResult.error) {
          console.error(
            "[contacts] failed to load company or source details",
            companiesResult.error?.message ?? sourcesResult.error?.message,
          );
          return Response.json({ error: "Could not load contact source details." }, { status: 500 });
        }

        const companies = new Map((companiesResult.data ?? []).map((company) => [company.id, company]));
        const sources = new Map<string, NonNullable<typeof sourcesResult.data>>();
        for (const source of sourcesResult.data ?? []) {
          const existing = sources.get(source.contact_id) ?? [];
          existing.push(source);
          sources.set(source.contact_id, existing);
        }

        return Response.json(
          {
            contacts: (contacts ?? []).slice(0, PAGE_SIZE).map((contact) => ({
              ...contact,
              company: companies.get(contact.company_id) ?? null,
              sources: sources.get(contact.id) ?? [],
            })),
            hasMore: (contacts?.length ?? 0) > PAGE_SIZE,
            total: contactsResultCount ?? 0,
            page,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      PATCH: async ({ request }) => {
        if (!hasValidAccessSession(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const parsed = OptOutRequest.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "A valid contact ID is required." }, { status: 400 });
        }

        const { data: contact, error: lookupError } = await supabaseAdmin
          .from("sourced_contacts")
          .select("email")
          .eq("id", parsed.data.contactId)
          .maybeSingle();
        if (lookupError) {
          console.error("[contacts] failed to find opt-out contact", lookupError.message);
          return Response.json({ error: "Could not load the contact." }, { status: 500 });
        }
        if (!contact) {
          return Response.json({ error: "Could not find that contact." }, { status: 404 });
        }

        const optedOutAt = new Date().toISOString();
        const update = supabaseAdmin
          .from("sourced_contacts")
          .update({
            do_not_contact: true,
            opted_out_at: optedOutAt,
            commercialization_eligible: false,
            updated_at: optedOutAt,
          });
        const { error: updateError } = contact.email
          ? await update.eq("email", contact.email)
          : await update.eq("id", parsed.data.contactId);
        if (updateError) {
          console.error("[contacts] failed to save opt-out", updateError.message);
          return Response.json({ error: "Could not save the opt-out." }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
