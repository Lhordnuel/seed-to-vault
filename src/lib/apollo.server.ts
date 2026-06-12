const APOLLO_BASE = "https://api.apollo.io/api/v1";

export type ApolloContactMode = "hiring" | "vc" | "executive";

const APOLLO_EXECUTIVE_TITLES = [
  "ceo",
  "chief executive officer",
  "founder",
  "co-founder",
  "cofounder",
  "cto",
  "chief technology officer",
  "coo",
  "chief operating officer",
  "head of engineering",
  "vp engineering",
];

const APOLLO_HIRING_TITLES = [
  "head of people",
  "head of talent",
  "talent acquisition",
  "talent acquisition manager",
  "recruiter",
  "technical recruiter",
  "hr manager",
  "people operations",
  "chief people officer",
  ...APOLLO_EXECUTIVE_TITLES,
];

const APOLLO_VC_TITLES = [
  "general partner",
  "partner",
  "managing partner",
  "principal",
  "investor",
  "venture partner",
  "scout",
  "associate",
  "investment associate",
];

function contactTitles(mode: ApolloContactMode, titles?: string[]) {
  if (titles?.length) return titles;
  if (mode === "vc") return APOLLO_VC_TITLES;
  if (mode === "hiring") return APOLLO_HIRING_TITLES;
  return APOLLO_EXECUTIVE_TITLES;
}

function key() {
  const k = process.env.APOLLO_API_KEY;
  if (!k) throw new Error("APOLLO_API_KEY is not configured.");
  return k;
}

async function post(
  path: string,
  body: Record<string, unknown>,
  query: Record<string, string | number | boolean | undefined> = {},
) {
  const url = new URL(`${APOLLO_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "x-api-key": key(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Apollo ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
}

export type ApolloOrg = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  estimated_num_employees?: number;
  industry?: string;
  short_description?: string;
  linkedin_url?: string;
  latest_funding_stage?: string;
  total_funding?: number;
};

export type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  organization?: { name?: string; primary_domain?: string };
};

/** Apollo returns placeholder emails when not unlocked. Detect & treat as missing. */
export function isUsableApolloEmail(email?: string | null): email is string {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.includes("email_not_unlocked")) return false;
  if (e.includes("domain.com") && e.startsWith("email_not_unlocked")) return false;
  if (e === "not_unlocked@domain.com") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Search startups using Apollo's organization mixed search.
 * Filters: company size 1-50, funding stage seed -> series a.
 */
export async function apolloSearchOrganizations(opts: {
  keywords?: string;
  locations?: string[];
  industries?: string[];
  page?: number;
  perPage?: number;
}) {
  const body: Record<string, unknown> = {
    page: opts.page ?? 1,
    per_page: Math.min(opts.perPage ?? 25, 100),
    organization_num_employees_ranges: ["1,10", "11,20", "21,50"],
    // Apollo funding stage tags
    organization_latest_funding_stage_cd: [
      "Seed",
      "Series A",
      "Pre-Seed",
    ],
  };
  if (opts.keywords) body.q_organization_keyword_tags = [opts.keywords];
  if (opts.locations?.length) body.organization_locations = opts.locations;
  if (opts.industries?.length) body.organization_industry_tag_ids = opts.industries;

  const data = await post("/mixed_companies/search", body);
  const orgs = (data.organizations ?? data.accounts ?? []) as ApolloOrg[];
  return orgs;
}

/**
 * Find executive contacts at a company by domain.
 * Returns people with verified or guessed emails when available.
 */
export async function apolloFindExecutives(opts: {
  domain?: string;
  organizationName?: string;
  mode?: ApolloContactMode;
  titles?: string[];
  perPage?: number;
}) {
  const titles = contactTitles(opts.mode ?? "hiring", opts.titles);
  const perPage = Math.min(opts.perPage ?? 10, 25);
  const clean = opts.domain
    ? opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : undefined;

  const baseBody = (): Record<string, unknown> => {
    const b: Record<string, unknown> = { page: 1, per_page: perPage };
    if (clean) {
      // Apollo accepts both keys depending on endpoint version — send both.
      b.q_organization_domains_list = [clean];
      b.q_organization_domains = clean;
    }
    if (opts.organizationName) b.q_organization_name = opts.organizationName;
    return b;
  };

  // Try 1: with title filter
  const body1 = baseBody();
  body1.person_titles = titles;
  let data = await post("/mixed_people/search", body1);
  let people = (data.people ?? data.contacts ?? []) as ApolloPerson[];

  // Try 2: drop the title filter (Apollo title matching is strict — many
  // companies have non-standard titles like "Talent Lead", "VP People Ops")
  if (people.length === 0) {
    data = await post("/mixed_people/search", baseBody());
    people = (data.people ?? data.contacts ?? []) as ApolloPerson[];
  }

  // Try 3: org name only (some companies use parked domains in Apollo)
  if (people.length === 0 && opts.organizationName && clean) {
    const body3 = { page: 1, per_page: perPage, q_organization_name: opts.organizationName };
    data = await post("/mixed_people/search", body3);
    people = (data.people ?? data.contacts ?? []) as ApolloPerson[];
  }
  return people;
}

/**
 * Enrich/reveal a single person's email by Apollo person id or by name+domain.
 * Uses people/match which can return email when credits are available.
 */
export async function apolloEnrichPerson(opts: {
  id?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
  organizationName?: string;
  linkedinUrl?: string;
  revealPersonalEmails?: boolean;
}) {
  const body: Record<string, unknown> = {};
  if (opts.id) body.id = opts.id;
  if (opts.firstName) body.first_name = opts.firstName;
  if (opts.lastName) body.last_name = opts.lastName;
  if (opts.domain) body.domain = opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (opts.organizationName) body.organization_name = opts.organizationName;
  if (opts.linkedinUrl) body.linkedin_url = opts.linkedinUrl;
  const data = await post("/people/match", body, {
    reveal_personal_emails: opts.revealPersonalEmails ?? false,
    reveal_phone_number: false,
  });
  return (data.person ?? null) as ApolloPerson | null;
}

/**
 * Reveal/enrich up to 10 Apollo people in one request. Apollo consumes credits
 * per successfully enriched record, not per candidate returned by search.
 */
export async function apolloBulkEnrichPeople(
  people: ApolloPerson[],
  opts: { domain?: string; organizationName?: string; revealPersonalEmails?: boolean } = {},
) {
  const details = people.slice(0, 10).map((p) => ({
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    name: p.name,
    domain: opts.domain?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0],
    organization_name: opts.organizationName,
    linkedin_url: p.linkedin_url,
  }));

  const data = await post(
    "/people/bulk_match",
    { details },
    {
      reveal_personal_emails: opts.revealPersonalEmails ?? true,
      reveal_phone_number: false,
    },
  );
  return {
    matches: (data.matches ?? []) as ApolloPerson[],
    creditsConsumed: data.credits_consumed as number | undefined,
    missingRecords: data.missing_records as number | undefined,
  };
}
