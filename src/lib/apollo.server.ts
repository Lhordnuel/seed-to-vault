const APOLLO_BASE = "https://api.apollo.io/api/v1";

function key() {
  const k = process.env.APOLLO_API_KEY;
  if (!k) throw new Error("APOLLO_API_KEY is not configured.");
  return k;
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${APOLLO_BASE}${path}`, {
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
  linkedin_url?: string;
  organization?: { name?: string; primary_domain?: string };
};

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
  perPage?: number;
}) {
  const body: Record<string, unknown> = {
    page: 1,
    per_page: Math.min(opts.perPage ?? 10, 25),
    person_titles: [
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
    ],
  };
  if (opts.domain) {
    const clean = opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    body.q_organization_domains_list = [clean];
  }
  if (opts.organizationName) body.q_organization_name = opts.organizationName;

  const data = await post("/mixed_people/search", body);
  const people = (data.people ?? data.contacts ?? []) as ApolloPerson[];
  return people;
}

/**
 * Enrich/reveal a single person's email by Apollo person id or by name+domain.
 * Uses people/match which can return email when credits are available.
 */
export async function apolloEnrichPerson(opts: {
  firstName?: string;
  lastName?: string;
  domain?: string;
  organizationName?: string;
  linkedinUrl?: string;
  revealPersonalEmails?: boolean;
}) {
  const body: Record<string, unknown> = {
    reveal_personal_emails: opts.revealPersonalEmails ?? false,
  };
  if (opts.firstName) body.first_name = opts.firstName;
  if (opts.lastName) body.last_name = opts.lastName;
  if (opts.domain) body.domain = opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (opts.organizationName) body.organization_name = opts.organizationName;
  if (opts.linkedinUrl) body.linkedin_url = opts.linkedinUrl;

  const data = await post("/people/match", body);
  return (data.person ?? null) as ApolloPerson | null;
}
