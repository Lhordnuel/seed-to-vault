import { createFileRoute } from "@tanstack/react-router";
import { hasValidAccessSession } from "@/lib/access-session.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Tables } from "@/integrations/supabase/types";
import { apolloFindExecutives, isUsableApolloEmail } from "@/lib/apollo.server";
import { z } from "zod";

const PAGE_SIZE = 100;
const OptOutRequest = z.object({ contactId: z.string().uuid() });
const CONTACT_FIELDS =
  "id, company_id, full_name, title, email, email_status, linkedin_url, do_not_contact, lawful_basis, commercialization_eligible, first_sourced_at, last_sourced_at";
type ContactSource = Pick<
  Tables<"contact_sources">,
  "contact_id" | "provider" | "source_url" | "observed_at"
>;

async function searchSavedContacts(companyName: string, page: number) {
  const pattern = `%${companyName.replace(/[\\%_]/g, "\\$&")}%`;
  const { data: companies, error: companyError } = await supabaseAdmin
    .from("scouted_companies")
    .select("id")
    .ilike("name", pattern)
    .limit(1000);
  if (companyError) throw new Error(companyError.message);

  const companyIds = (companies ?? []).map((company) => company.id);
  if (!companyIds.length) return { contacts: [], total: 0, hasMore: false, page };

  const from = page * PAGE_SIZE;
  const {
    data: contacts,
    error: contactsError,
    count,
  } = await supabaseAdmin
    .from("sourced_contacts")
    .select(CONTACT_FIELDS, { count: "exact" })
    .in("company_id", companyIds)
    .order("last_sourced_at", { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (contactsError) throw new Error(contactsError.message);

  const ids = (contacts ?? []).map((contact) => contact.id);
  const [companiesResult, sourcesResult] = await Promise.all([
    supabaseAdmin
      .from("scouted_companies")
      .select("id, name, domain, linkedin_url, stage, employee_count, industry")
      .in("id", companyIds),
    ids.length
      ? supabaseAdmin
          .from("contact_sources")
          .select("contact_id, provider, source_url, observed_at")
          .in("contact_id", ids)
          .order("observed_at", { ascending: false })
      : Promise.resolve({ data: [] as ContactSource[], error: null }),
  ]);
  if (companiesResult.error || sourcesResult.error) {
    throw new Error(companiesResult.error?.message ?? sourcesResult.error?.message);
  }

  const companyById = new Map(
    (companiesResult.data ?? []).map((company) => [company.id, company]),
  );
  const sourcesByContact = new Map<string, ContactSource[]>();
  for (const source of sourcesResult.data ?? []) {
    const existing = sourcesByContact.get(source.contact_id) ?? [];
    existing.push(source);
    sourcesByContact.set(source.contact_id, existing);
  }

  return {
    contacts: (contacts ?? []).slice(0, PAGE_SIZE).map((contact) => ({
      ...contact,
      company: companyById.get(contact.company_id) ?? null,
      sources: sourcesByContact.get(contact.id) ?? [],
      isExternal: false,
    })),
    total: count ?? 0,
    hasMore: (contacts?.length ?? 0) > PAGE_SIZE,
    page,
  };
}

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

        const companyName = new URL(request.url).searchParams.get("q")?.trim() ?? "";
        if (companyName.length > 200) {
          return Response.json(
            { error: "Company name must be 200 characters or fewer." },
            { status: 400 },
          );
        }
        if (companyName) {
          try {
            const savedResults = await searchSavedContacts(companyName, page);
            if (savedResults.total > 0) {
              return Response.json(
                { ...savedResults, searchSource: "database" },
                { headers: { "Cache-Control": "no-store" } },
              );
            }

            const people = await apolloFindExecutives({
              organizationName: companyName,
              mode: "executive",
              perPage: 25,
            });
            const observedAt = new Date().toISOString();
            const externalContacts = people.flatMap((person, index) => {
              const fullName =
                person.name ?? [person.first_name, person.last_name].filter(Boolean).join(" ");
              if (!fullName) return [];
              return [
                {
                  id: `apollo:${person.id ?? index}`,
                  company_id: "",
                  full_name: fullName,
                  title: person.title ?? null,
                  email: isUsableApolloEmail(person.email) ? person.email : null,
                  email_status: person.email_status ?? "unknown",
                  linkedin_url: person.linkedin_url ?? null,
                  do_not_contact: false,
                  lawful_basis: null,
                  commercialization_eligible: false,
                  first_sourced_at: observedAt,
                  last_sourced_at: observedAt,
                  company: {
                    name: person.organization?.name ?? companyName,
                    domain: person.organization?.primary_domain ?? "",
                    linkedin_url: null,
                    stage: null,
                    employee_count: null,
                    industry: null,
                  },
                  sources: [
                    {
                      provider: "apollo",
                      source_url: person.linkedin_url ?? null,
                      observed_at: observedAt,
                    },
                  ],
                  isExternal: true,
                },
              ];
            });
            return Response.json(
              {
                contacts: externalContacts,
                hasMore: false,
                page: 0,
                total: externalContacts.length,
                searchSource: "apollo",
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          } catch (error) {
            console.error("[contacts] company search failed", (error as Error).message);
            return Response.json(
              { error: (error as Error).message || "Could not search contacts." },
              { status: 502 },
            );
          }
        }

        const from = page * PAGE_SIZE;
        const {
          data: contacts,
          error: contactsError,
          count: contactsResultCount,
        } = await supabaseAdmin
          .from("sourced_contacts")
          .select(
            CONTACT_FIELDS,
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
            : Promise.resolve({ data: [] as ContactSource[], error: null }),
        ]);

        if (companiesResult.error || sourcesResult.error) {
          console.error(
            "[contacts] failed to load company or source details",
            companiesResult.error?.message ?? sourcesResult.error?.message,
          );
          return Response.json(
            { error: "Could not load contact source details." },
            { status: 500 },
          );
        }

        const companies = new Map(
          (companiesResult.data ?? []).map((company) => [company.id, company]),
        );
        const sources = new Map<string, ContactSource[]>();
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
              isExternal: false,
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
        const update = supabaseAdmin.from("sourced_contacts").update({
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
