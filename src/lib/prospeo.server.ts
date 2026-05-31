// Prospeo API — email finder & verifier.
// Docs: https://prospeo.io/api
const BASE = "https://api.prospeo.io";

function key() {
  const k = process.env.PROSPEO_API_KEY;
  if (!k) throw new Error("PROSPEO_API_KEY is not configured.");
  return k;
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KEY": key(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Prospeo ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
}

/** Find a person's email by first/last name + company domain. */
export async function prospeoEmailFinder(opts: {
  firstName: string;
  lastName: string;
  domain?: string;
  company?: string;
}) {
  const payload: Record<string, unknown> = {
    first_name: opts.firstName,
    last_name: opts.lastName,
  };
  if (opts.domain) payload.domain = cleanDomain(opts.domain);
  if (opts.company) payload.company = opts.company;
  const data = await post("/email-finder", payload);
  const r = (data.response ?? data) as Record<string, unknown>;
  return {
    email: r.email as string | undefined,
    verified: r.email_verified ?? r.verified,
    firstName: opts.firstName,
    lastName: opts.lastName,
    domain: opts.domain,
  };
}

/** Get all emails associated with a domain. */
export async function prospeoDomainSearch(opts: { domain: string; limit?: number }) {
  const data = await post("/domain-search", {
    company: cleanDomain(opts.domain),
    limit: Math.min(opts.limit ?? 20, 100),
  });
  const r = (data.response ?? data) as Record<string, unknown>;
  return {
    domain: cleanDomain(opts.domain),
    emails: (r.email_list ?? r.emails ?? []) as unknown[],
  };
}
