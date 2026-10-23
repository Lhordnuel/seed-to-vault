import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const CONTACT_SOURCE_PROVIDERS = [
  "apollo",
  "firecrawl",
  "fullenrich",
  "hunter",
  "linkedin",
  "lusha",
  "pdl",
  "prospeo",
  "tomba",
  "wellfound",
  "f6s",
  "yc",
] as const;
export type ContactSourceProvider = (typeof CONTACT_SOURCE_PROVIDERS)[number];

export type SourcedContactInput = {
  fullName: string;
  provider?: ContactSourceProvider;
  title?: string;
  email?: string;
  emailStatus?: "unknown" | "valid" | "catchall" | "invalid";
  linkedinUrl?: string;
  sourceUrl?: string;
  externalRecordId?: string;
};

export type SourcedCompanyInput = {
  name: string;
  domain: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  stage?: string;
  employeeCount?: number;
  industry?: string;
};

function normalizeDomain(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  const domain = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  if (!domain || domain.includes(" ")) {
    throw new Error("A valid company domain is required to save sourced contacts.");
  }
  return domain;
}

export async function isContactOptedOut(email: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("sourced_contacts")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .eq("do_not_contact", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not check contact opt-out status: ${error.message}`);
  return !!data;
}

export async function saveSourcedContacts(input: {
  company: SourcedCompanyInput;
  provider?: ContactSourceProvider;
  contacts: SourcedContactInput[];
}) {
  const domain = normalizeDomain(input.company.domain);
  const now = new Date().toISOString();
  const { data: company, error: companyError } = await supabaseAdmin
    .from("scouted_companies")
    .upsert(
      {
        name: input.company.name.trim(),
        domain,
        website_url: input.company.websiteUrl,
        linkedin_url: input.company.linkedinUrl,
        stage: input.company.stage,
        employee_count: input.company.employeeCount,
        industry: input.company.industry,
        updated_at: now,
      },
      { onConflict: "domain" },
    )
    .select("id")
    .single();

  if (companyError) throw new Error(`Could not save company: ${companyError.message}`);

  let saved = 0;
  const failures: string[] = [];
  const sourceFailures: string[] = [];
  for (const contact of input.contacts) {
    try {
      const fullName = contact.fullName.trim();
      const email = contact.email?.trim().toLowerCase() || null;
      const linkedinUrl = contact.linkedinUrl?.trim() || null;
      if (!email && !linkedinUrl) {
        throw new Error("A contact must include an email address or LinkedIn URL.");
      }
      const provider = contact.provider ?? input.provider;
      if (!provider) {
        throw new Error("A source provider is required to save a contact.");
      }

      let existing: {
        id: string;
        email_status: string;
        email: string | null;
        linkedin_url: string | null;
      } | null = null;
      if (linkedinUrl) {
        const { data, error } = await supabaseAdmin
          .from("sourced_contacts")
          .select("id, email_status, email, linkedin_url")
          .eq("company_id", company.id)
          .eq("linkedin_url", linkedinUrl)
          .maybeSingle();
        if (error) throw new Error(error.message);
        existing = data;
      }
      if (!existing && email) {
        const { data, error } = await supabaseAdmin
          .from("sourced_contacts")
          .select("id, email_status, email, linkedin_url")
          .eq("company_id", company.id)
          .eq("email", email)
          .maybeSingle();
        if (error) throw new Error(error.message);
        existing = data;
      }

      const record = {
        company_id: company.id,
        full_name: fullName,
        title: contact.title,
        email: email ?? existing?.email ?? null,
        email_status:
          contact.emailStatus ??
          (email
            ? existing?.email === email
              ? existing.email_status
              : "unknown"
            : (existing?.email_status ?? "unknown")),
        linkedin_url: linkedinUrl ?? existing?.linkedin_url ?? null,
        last_sourced_at: now,
        updated_at: now,
      };
      const write = existing
        ? await supabaseAdmin
            .from("sourced_contacts")
            .update(record)
            .eq("id", existing.id)
            .select("id")
            .single()
        : await supabaseAdmin.from("sourced_contacts").insert(record).select("id").single();
      if (write.error) throw new Error(write.error.message);
      saved += 1;

      const { error: sourceError } = await supabaseAdmin.from("contact_sources").insert({
        contact_id: write.data.id,
        provider,
        source_url: contact.sourceUrl,
        external_record_id: contact.externalRecordId,
        metadata: { email_status: contact.emailStatus ?? "unknown" },
        observed_at: now,
      });
      if (sourceError) {
        sourceFailures.push(`${fullName}: ${sourceError.message}`);
      }
    } catch (e) {
      failures.push(`${contact.fullName}: ${(e as Error).message}`);
    }
  }

  return { companyId: company.id, saved, failures, sourceFailures };
}
