const HUNTER_BASE = "https://api.hunter.io/v2";

function keys(): string[] {
  const ks = [process.env.HUNTER_API_KEY, process.env.HUNTER_API_KEY_2]
    .filter((k): k is string => !!k && k.trim() !== "");
  if (ks.length === 0) throw new Error("HUNTER_API_KEY is not configured.");
  return ks;
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

// Status codes that indicate this key is exhausted/blocked — try the next key.
const FALLBACK_STATUSES = new Set([401, 402, 403, 429, 451]);

async function get(path: string, params: Record<string, string | number | undefined>) {
  const allKeys = keys();
  let lastErr: { status: number; body: unknown } | null = null;

  for (let i = 0; i < allKeys.length; i++) {
    const url = new URL(`${HUNTER_BASE}${path}`);
    url.searchParams.set("api_key", allKeys[i]);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString());
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }

    if (res.ok) return data as Record<string, unknown>;

    lastErr = { status: res.status, body: data };
    // Only fall back to next key on quota/auth-style errors; otherwise fail fast.
    if (!FALLBACK_STATUSES.has(res.status) || i === allKeys.length - 1) break;
  }

  const body = lastErr?.body;
  throw new Error(
    `Hunter ${path} ${lastErr?.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
  );
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
