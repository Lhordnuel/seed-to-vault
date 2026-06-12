// Prospeo API — person search + enrichment.
// Docs: https://prospeo.io/api
const BASE = "https://api.prospeo.io";

function keys(): { k: string; label: string }[] {
  const out: { k: string; label: string }[] = [];
  const k1 = process.env.PROSPEO_API_KEY;
  if (k1) out.push({ k: k1, label: "primary" });
  const k2 = process.env.PROSPEO_API_KEY_2;
  if (k2) out.push({ k: k2, label: "fallback" });
  if (!out.length) throw new Error("PROSPEO_API_KEY is not configured.");
  return out;
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

const FALLBACK_STATUSES = new Set([401, 402, 403, 408, 429, 451, 500, 502, 503, 504]);

async function post(path: string, body: Record<string, unknown>) {
  const ks = keys();
  let lastErr: Error | null = null;
  for (let i = 0; i < ks.length; i++) {
    const { k, label } = ks[i];
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-KEY": k },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    const summary = summarizeProspeoResponse(data, text);
    console.log(`[prospeo] ${path} ${res.status} (${label})`, JSON.stringify({ body: redactLargeBody(body), summary }));
    if (!res.ok) {
      const err = new Error(`Prospeo ${path} ${res.status} (${label}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
      if (i < ks.length - 1 && FALLBACK_STATUSES.has(res.status)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
    return data as Record<string, unknown>;
  }
  throw lastErr ?? new Error("Prospeo request failed");
}

function redactLargeBody(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return raw.length > 2500 ? `${raw.slice(0, 2500)}…` : body;
}

function summarizeProspeoResponse(data: unknown, raw: string) {
  if (!data || typeof data !== "object") return { raw: raw.slice(0, 200) };
  const d = data as Record<string, unknown>;
  return {
    error: d.error,
    message: d.message ?? d.code,
    results: Array.isArray(d.results) ? d.results.length : undefined,
    data: Array.isArray(d.data) ? d.data.length : undefined,
    hasPerson: !!d.person,
    hasEmail: !!extractEmail(data),
    pagination: d.pagination,
  };
}

function extractEmail(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const direct = obj.email;
  if (typeof direct === "string" && direct.includes("@")) return direct;
  if (direct && typeof direct === "object") {
    const nested = direct as Record<string, unknown>;
    for (const key of ["email", "value", "address"] as const) {
      if (typeof nested[key] === "string" && String(nested[key]).includes("@")) return nested[key] as string;
    }
  }
  for (const key of ["person", "response", "data", "result"] as const) {
    const next = obj[key];
    if (next && next !== input) {
      const found = extractEmail(next);
      if (found) return found;
    }
  }
  return undefined;
}

function getObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function fullName(first?: unknown, last?: unknown, fallback?: unknown) {
  const parts = [first, last].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return parts.join(" ") || (typeof fallback === "string" ? fallback : undefined);
}

function normalizeProspeoPerson(input: unknown, domain?: string) {
  const wrapper = getObject(input);
  const p = getObject(wrapper.person ?? wrapper.response ?? wrapper.data ?? wrapper);
  const company = getObject(p.company ?? wrapper.company);
  return {
    id: (p.person_id ?? p.id ?? wrapper.person_id ?? wrapper.id) as string | undefined,
    name: fullName(p.first_name, p.last_name, p.full_name ?? p.name),
    firstName: p.first_name as string | undefined,
    lastName: p.last_name as string | undefined,
    title: (p.job_title ?? p.title ?? p.headline) as string | undefined,
    email: extractEmail(wrapper) ?? extractEmail(p),
    emailStatus: getObject(wrapper.email).status as string | undefined,
    linkedin: (p.linkedin_url ?? p.linkedin) as string | undefined,
    company: (company.name ?? p.company_name) as string | undefined,
    domain: cleanDomain(((company.website ?? p.company_website ?? domain) as string | undefined) ?? ""),
  };
}

function isWorkEmail(email?: string) {
  if (!email || email.includes("*") || /masked|hidden|redacted/i.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Find a person's email by first/last name + company domain. */
export async function prospeoEmailFinder(opts: {
  firstName: string;
  lastName: string;
  domain?: string;
  company?: string;
  linkedinUrl?: string;
  personId?: string;
}) {
  const data: Record<string, unknown> = {
    first_name: opts.firstName,
    last_name: opts.lastName,
  };
  if (opts.domain) data.company_website = cleanDomain(opts.domain);
  if (opts.company) data.company_name = opts.company;
  if (opts.linkedinUrl) data.linkedin_url = opts.linkedinUrl;
  if (opts.personId) data.person_id = opts.personId;
  const response = await post("/enrich-person", {
    only_verified_email: true,
    enrich_mobile: false,
    data,
  });
  const contact = normalizeProspeoPerson(response, opts.domain);
  return {
    email: isWorkEmail(contact.email) ? contact.email : undefined,
    verified: contact.emailStatus ? contact.emailStatus === "VERIFIED" && isWorkEmail(contact.email) : isWorkEmail(contact.email),
    firstName: opts.firstName,
    lastName: opts.lastName,
    domain: opts.domain,
    title: contact.title,
    linkedin: contact.linkedin,
  };
}

/** Get all emails associated with a domain. */
export async function prospeoDomainSearch(opts: { domain: string; limit?: number }) {
  const domain = cleanDomain(opts.domain);
  const limit = Math.min(opts.limit ?? 20, 25);
  const search = await post("/search-person", {
    page: 1,
    filters: {
      company: {
        websites: { include: [domain] },
      },
      person_contact_details: {
        email: ["VERIFIED"],
        hide_people_with_details_already_revealed: false,
      },
      max_person_per_company: limit,
    },
  });
  const results = Array.isArray(search.results) ? search.results.slice(0, limit) : [];
  const searchedContacts = results.map((r) => normalizeProspeoPerson(r, domain));
  const enriched = await Promise.all(
    searchedContacts.map(async (p, index) => {
      if (isWorkEmail(p.email)) return p;
      try {
        const data: Record<string, unknown> = {
          identifier: p.id ?? `${domain}-${index}`,
          company_website: domain,
        };
        if (p.id) data.person_id = p.id;
        if (p.firstName) data.first_name = p.firstName;
        if (p.lastName) data.last_name = p.lastName;
        if (!p.firstName && !p.lastName && p.name) data.full_name = p.name;
        if (p.linkedin) data.linkedin_url = p.linkedin;
        const response = await post("/enrich-person", {
          only_verified_email: true,
          enrich_mobile: false,
          data,
        });
        return { ...p, ...normalizeProspeoPerson(response, domain) };
      } catch (e) {
        return { ...p, enrichError: (e as Error).message };
      }
    }),
  );
  const withEmail = enriched.filter((p) => isWorkEmail(p.email));
  return {
    domain,
    contacts: enriched,
    emails: withEmail.map((p) => ({
      value: p.email,
      first_name: p.firstName,
      last_name: p.lastName,
      position: p.title,
      linkedin: p.linkedin,
    })),
    primaryContact: withEmail[0] ?? enriched[0] ?? null,
    note:
      withEmail.length === 0
        ? "Prospeo searched the company and attempted person enrichment but returned no revealed work emails. Check the [prospeo] logs for the exact API response, then fall back to PDL or Tomba."
        : undefined,
  };
}
