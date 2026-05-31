// Tomba.io — domain search & email finder.
// Docs: https://developer.tomba.io
const BASE = "https://api.tomba.io/v1";

function keys() {
  const k = process.env.TOMBA_API_KEY;
  const s = process.env.TOMBA_SECRET_KEY;
  if (!k || !s) throw new Error("TOMBA_API_KEY / TOMBA_SECRET_KEY not configured.");
  return { k, s };
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

async function get(path: string, params: Record<string, string | number | undefined>) {
  const { k, s } = keys();
  const url = new URL(`${BASE}${path}`);
  for (const [pk, pv] of Object.entries(params)) {
    if (pv !== undefined && pv !== "") url.searchParams.set(pk, String(pv));
  }
  const res = await fetch(url.toString(), {
    headers: { "X-Tomba-Key": k, "X-Tomba-Secret": s },
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Tomba ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
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
