// Prospeo API — email finder & verifier.
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
