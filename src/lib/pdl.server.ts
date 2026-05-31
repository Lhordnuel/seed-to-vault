// People Data Labs — Person Enrichment & Search.
// Docs: https://docs.peopledatalabs.com/docs/quickstart-person-api
const BASE = "https://api.peopledatalabs.com/v5";

function key() {
  const k = process.env.PEOPLE_DATA_LABS_API_KEY;
  if (!k) throw new Error("PEOPLE_DATA_LABS_API_KEY is not configured.");
  return k;
}

function cleanDomain(d: string) {
  return d.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

async function get(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { "X-Api-Key": key() },
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`PDL ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
}

/** Enrich a person to get their work email by name + company domain. */
export async function pdlPersonEnrich(opts: {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  domain?: string;
  company?: string;
  profile?: string; // e.g. LinkedIn URL
  minLikelihood?: number;
}) {
  const params: Record<string, string | number | undefined> = {
    first_name: opts.firstName,
    last_name: opts.lastName,
    name: opts.fullName,
    company: opts.company ?? (opts.domain ? cleanDomain(opts.domain) : undefined),
    profile: opts.profile,
    min_likelihood: opts.minLikelihood ?? 6,
  };
  const data = await get("/person/enrich", params);
  const r = (data.data ?? {}) as Record<string, unknown>;
  const emails = (r.emails ?? []) as Array<{ address?: string; type?: string }>;
  const workEmails = (r.work_email ? [r.work_email] : []) as string[];
  return {
    fullName: r.full_name as string | undefined,
    jobTitle: r.job_title as string | undefined,
    jobCompanyName: r.job_company_name as string | undefined,
    workEmail: (workEmails[0] ?? emails.find((e) => e.type === "professional")?.address ?? emails[0]?.address) as string | undefined,
    emails: emails.map((e) => e.address).filter(Boolean) as string[],
    linkedin: r.linkedin_url as string | undefined,
    likelihood: data.likelihood as number | undefined,
  };
}

/** Search for people at a company by title (e.g. CEO, Head of People). */
export async function pdlPersonSearch(opts: {
  domain: string;
  titles?: string[];
  size?: number;
}) {
  const titles = (opts.titles ?? ["ceo", "founder", "cto", "coo", "head of people", "head of talent"])
    .map((t) => `"${t}"`)
    .join(" OR ");
  const sql = `SELECT * FROM person WHERE job_company_website='${cleanDomain(opts.domain)}' AND job_title IN (${titles})`;
  const data = await get("/person/search", {
    sql,
    size: Math.min(opts.size ?? 10, 100),
  });
  const records = (data.data ?? []) as Array<Record<string, unknown>>;
  return {
    domain: cleanDomain(opts.domain),
    total: data.total as number | undefined,
    people: records.map((r) => ({
      fullName: r.full_name,
      jobTitle: r.job_title,
      workEmail: r.work_email,
      emails: r.emails,
      linkedin: r.linkedin_url,
    })),
  };
}
