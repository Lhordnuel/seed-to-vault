// Tomba.io — domain search & email finder.
// Docs: https://developer.tomba.io
const BASE = "https://api.tomba.io/v1";

type KeyPair = { k: string; s: string; label: string };

function keyPairs(): KeyPair[] {
  const pairs: KeyPair[] = [];
  const k1 = process.env.TOMBA_API_KEY;
  const s1 = process.env.TOMBA_SECRET_KEY;
  if (k1 && s1) pairs.push({ k: k1, s: s1, label: "primary" });
  const k2 = process.env.TOMBA_API_KEY_2;
  const s2 = process.env.TOMBA_SECRET_KEY_2;
  if (k2 && s2) pairs.push({ k: k2, s: s2, label: "fallback" });
  if (!pairs.length) throw new Error("TOMBA_API_KEY / TOMBA_SECRET_KEY not configured.");
  return pairs;
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

// Status codes worth retrying on the fallback key (quota / auth / rate limit).
const FALLBACK_STATUSES = new Set([401, 402, 403, 408, 429, 451, 500, 502, 503, 504]);

async function get(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${BASE}${path}`);
  for (const [pk, pv] of Object.entries(params)) {
    if (pv !== undefined && pv !== "") url.searchParams.set(pk, String(pv));
  }
  const pairs = keyPairs();
  let lastErr: Error | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const { k, s, label } = pairs[i];
    try {
      const res = await fetch(url.toString(), {
        headers: { "X-Tomba-Key": k, "X-Tomba-Secret": s },
      });
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text; }
      if (!res.ok) {
        const err = new Error(`Tomba ${path} ${res.status} (${label}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
        if (i < pairs.length - 1 && FALLBACK_STATUSES.has(res.status)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      return data as Record<string, unknown>;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i >= pairs.length - 1) throw lastErr;
    }
  }
  throw lastErr ?? new Error("Tomba request failed");
}

export async function tombaDomainSearch(opts: {
  domain: string;
  limit?: number;
  department?: string;
  seniority?: string;
}) {
  const data = await get("/domain-search", {
    domain: cleanDomain(opts.domain),
    limit: Math.min(opts.limit ?? 20, 100),
    department: opts.department,
    seniority: opts.seniority,
  });
  const d = (data.data ?? {}) as Record<string, unknown>;
  const emails = (d.emails ?? []) as Array<Record<string, unknown>>;
  return {
    domain: cleanDomain(opts.domain),
    organization: d.organization,
    emails: emails.map((e) => ({
      email: e.email,
      first_name: e.first_name,
      last_name: e.last_name,
      position: e.position,
      department: e.department,
      seniority: e.seniority,
      linkedin: e.linkedin,
    })),
  };
}

export async function tombaEmailFinder(opts: {
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
    email: d.email,
    score: d.score,
    firstName: opts.firstName,
    lastName: opts.lastName,
    domain: cleanDomain(opts.domain),
  };
}
