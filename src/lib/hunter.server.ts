const HUNTER_BASE = "https://api.hunter.io/v2";

function key() {
  const k = process.env.HUNTER_API_KEY;
  if (!k) throw new Error("HUNTER_API_KEY is not configured.");
  return k;
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

async function get(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${HUNTER_BASE}${path}`);
  url.searchParams.set("api_key", key());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Hunter ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
}

export type HunterEmail = {
  value: string;
  type?: string;
  confidence?: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  seniority?: string;
  department?: string;
  linkedin?: string | null;
};

/**
 * Find all emails associated with a domain. Optionally narrow by seniority/department/role.
 */
export async function hunterDomainSearch(opts: {
  domain: string;
  limit?: number;
  seniority?: string; // junior, senior, executive
  department?: string; // executive, it, finance, hr, ...
  type?: "personal" | "generic";
}) {
  const data = await get("/domain-search", {
    domain: cleanDomain(opts.domain),
    limit: Math.min(opts.limit ?? 20, 100),
    seniority: opts.seniority,
    department: opts.department,
    type: opts.type,
  });
  const d = (data.data ?? {}) as Record<string, unknown>;
  const emails = (d.emails ?? []) as HunterEmail[];
  return {
    domain: cleanDomain(opts.domain),
    organization: d.organization as string | undefined,
    pattern: d.pattern as string | undefined,
    emails,
  };
}

/**
 * Find a specific person's email at a company.
 */
export async function hunterEmailFinder(opts: {
  domain: string;
  firstName: string;
  lastName: string;
}) {
  const data = await get("/email-finder", {
    domain: cleanDomain(opts.domain),
    first_name: opts.firstName,
    last_name: opts.lastName,
  });
  const d = (data.data ?? {}) as Record<string, unknown>;
  return {
    email: d.email as string | undefined,
    score: d.score as number | undefined,
    firstName: opts.firstName,
    lastName: opts.lastName,
    position: d.position as string | undefined,
    sources: (d.sources ?? []) as unknown[],
  };
}
