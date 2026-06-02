/**
 * Lusha API client. Used as a fallback to Apollo for executive contact enrichment.
 * Docs: https://www.lusha.com/docs/
 */

const LUSHA_BASE = "https://api.lusha.com";

function key() {
  const k = process.env.LUSHA_API_KEY;
  if (!k) throw new Error("LUSHA_API_KEY is not configured.");
  return k;
}

async function lushaFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${LUSHA_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      api_key: key(),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `Lusha ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return data as Record<string, unknown>;
}

export type LushaContact = {
  name?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  emails?: { address: string; type?: string }[];
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
};

/**
 * Search company employees by domain and (optional) job titles.
 * Returns enriched contacts including business emails when credits allow.
 */
export async function lushaCompanyEmployees(opts: {
  domain: string;
  titles?: string[];
  seniority?: string[];
  limit?: number;
}): Promise<LushaContact[]> {
  const clean = opts.domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  // Step 1: prospecting search to get contact IDs
  const filters: Record<string, unknown> = {
    companies: { include: { domains: [clean] } },
  };
  if (opts.titles?.length) {
    filters.contacts = {
      include: { jobTitles: opts.titles },
    };
  }
  if (opts.seniority?.length) {
    filters.contacts = {
      ...(filters.contacts as object | undefined),
      include: {
        ...((filters.contacts as { include?: object } | undefined)?.include ?? {}),
        seniority: opts.seniority,
      },
    };
  }

  const search = await lushaFetch("/prospecting/contact/search", {
    method: "POST",
    body: JSON.stringify({
      pages: { page: 0, size: Math.min(opts.limit ?? 10, 40) },
      filters,
    }),
  });

  const data = (search.data ?? []) as Array<Record<string, unknown>>;
  if (!data.length) return [];

  const contactIds = data
    .map((d) => d.contactId ?? d.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, opts.limit ?? 10);
  if (!contactIds.length) return [];

  // Step 2: enrich to reveal emails/phones (consumes credits)
  const requestId =
    (search.requestId as string | undefined) ??
    (search.metadata as { requestId?: string } | undefined)?.requestId;

  const enrichBody: Record<string, unknown> = { contactIds };
  if (requestId) enrichBody.requestId = requestId;

  let enrichData: Record<string, unknown>;
  try {
    enrichData = await lushaFetch("/prospecting/contact/enrich", {
      method: "POST",
      body: JSON.stringify(enrichBody),
    });
  } catch (e) {
    // Fall back to whatever info we got from search
    return data.map(normalize);
  }

  const contacts = (enrichData.contacts ?? enrichData.data ?? []) as Array<
    Record<string, unknown>
  >;
  return contacts.map(normalize);
}

function normalize(c: Record<string, unknown>): LushaContact {
  const data = (c.data ?? c) as Record<string, unknown>;
  const name =
    (data.name as string | undefined) ||
    [data.firstName, data.lastName].filter(Boolean).join(" ").trim() ||
    undefined;
  const emailsRaw = (data.emailAddresses ?? data.emails ?? []) as Array<
    Record<string, unknown> | string
  >;
  const emails = emailsRaw
    .map((e) => {
      if (typeof e === "string") return { address: e };
      const address = (e.email ?? e.address) as string | undefined;
      if (!address) return null;
      return { address, type: e.type as string | undefined };
    })
    .filter((e): e is { address: string; type?: string } => !!e);
  const primary =
    emails.find((e) => (e.type ?? "").toLowerCase().includes("work")) ?? emails[0];
  return {
    name,
    firstName: data.firstName as string | undefined,
    lastName: data.lastName as string | undefined,
    title: (data.jobTitle ?? data.title) as string | undefined,
    email: primary?.address,
    emails,
    linkedinUrl: (data.linkedinUrl ?? (data.social as { linkedin?: string } | undefined)?.linkedin) as
      | string
      | undefined,
    companyName: (data.companyName ?? (data.company as { name?: string } | undefined)?.name) as
      | string
      | undefined,
    companyDomain: ((data.company as { domain?: string } | undefined)?.domain ?? data.companyDomain) as
      | string
      | undefined,
  };
}

/**
 * Enrich a single person by name + company domain.
 */
export async function lushaPersonEnrich(opts: {
  firstName: string;
  lastName: string;
  domain?: string;
  companyName?: string;
  linkedinUrl?: string;
}): Promise<LushaContact | null> {
  const body: Record<string, unknown> = {
    contacts: [
      {
        contactId: "1",
        fullName: `${opts.firstName} ${opts.lastName}`.trim(),
        firstName: opts.firstName,
        lastName: opts.lastName,
        companies: [
          {
            name: opts.companyName,
            domain: opts.domain
              ? opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
              : undefined,
            isCurrent: true,
          },
        ],
        linkedinUrl: opts.linkedinUrl,
      },
    ],
  };

  try {
    const res = await lushaFetch("/v2/person", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const contacts = (res.contacts ?? {}) as Record<string, Record<string, unknown>>;
    const first = Object.values(contacts)[0];
    if (!first) return null;
    return normalize(first);
  } catch {
    return null;
  }
}
