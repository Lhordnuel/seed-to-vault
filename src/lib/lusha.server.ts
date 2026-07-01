/**
 * Lusha API client. Used as a fallback to Apollo for executive contact enrichment.
 * Supports dual API keys with automatic fallback on errors OR empty results
 * (quota-exhausted Lusha keys often return 200 with an empty list).
 * Docs: https://www.lusha.com/docs/
 */

const LUSHA_BASE = "https://api.lusha.com";

function keys(): string[] {
  const all = [process.env.LUSHA_API_KEY, process.env.LUSHA_API_KEY_2]
    .map((k) => (k ?? "").trim())
    .filter((k) => k.length > 0);
  if (!all.length) throw new Error("LUSHA_API_KEY is not configured.");
  return all;
}

async function lushaFetchWithKey(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | string }> {
  const res = await fetch(`${LUSHA_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      api_key: apiKey,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: Record<string, unknown> | string;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
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
 *
 * Rotation: tries LUSHA_API_KEY first; on error OR empty results, retries with LUSHA_API_KEY_2.
 */
export async function lushaCompanyEmployees(opts: {
  domain: string;
  titles?: string[];
  seniority?: string[];
  limit?: number;
}): Promise<LushaContact[]> {
  const allKeys = keys();
  let lastErr: unknown = null;

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i];
    const keyLabel = i === 0 ? "LUSHA_API_KEY" : `LUSHA_API_KEY_${i + 1}`;
    try {
      const results = await runCompanyEmployees(key, opts);
      if (results.length > 0) {
        console.log(`[lusha] ${keyLabel} returned ${results.length} contact(s)`);
        return results;
      }
      console.log(`[lusha] ${keyLabel} returned 0 contacts — rotating to next key if available`);
    } catch (e) {
      lastErr = e;
      console.log(`[lusha] ${keyLabel} error:`, e instanceof Error ? e.message : String(e));
    }
  }

  if (lastErr) {
    // All keys failed — surface the last error so caller can log/handle.
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
  return [];
}

async function runCompanyEmployees(
  apiKey: string,
  opts: { domain: string; titles?: string[]; seniority?: string[]; limit?: number },
): Promise<LushaContact[]> {
  const clean = opts.domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  const filters: Record<string, unknown> = {
    companies: { include: { domains: [clean] } },
  };
  if (opts.titles?.length) {
    filters.contacts = { include: { jobTitles: opts.titles } };
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

  const searchRes = await lushaFetchWithKey(apiKey, "/prospecting/contact/search", {
    method: "POST",
    body: JSON.stringify({
      pages: { page: 0, size: Math.min(opts.limit ?? 10, 40) },
      filters,
    }),
  });
  if (!searchRes.ok) {
    throw new Error(
      `Lusha search ${searchRes.status}: ${
        typeof searchRes.data === "string" ? searchRes.data : JSON.stringify(searchRes.data)
      }`,
    );
  }
  const search = searchRes.data as Record<string, unknown>;
  const data = (search.data ?? []) as Array<Record<string, unknown>>;
  if (!data.length) return [];

  const contactIds = data
    .map((d) => d.contactId ?? d.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, opts.limit ?? 10);
  if (!contactIds.length) return [];

  const requestId =
    (search.requestId as string | undefined) ??
    (search.metadata as { requestId?: string } | undefined)?.requestId;
  const enrichBody: Record<string, unknown> = { contactIds };
  if (requestId) enrichBody.requestId = requestId;

  const enrichRes = await lushaFetchWithKey(apiKey, "/prospecting/contact/enrich", {
    method: "POST",
    body: JSON.stringify(enrichBody),
  });
  if (!enrichRes.ok) {
    // Enrich failed — return raw search data so we don't lose the hit
    return data.map(normalize);
  }
  const enrichData = enrichRes.data as Record<string, unknown>;
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
 * Rotates keys on error OR when no contact is returned.
 */
export async function lushaPersonEnrich(opts: {
  firstName: string;
  lastName: string;
  domain?: string;
  companyName?: string;
  linkedinUrl?: string;
}): Promise<LushaContact | null> {
  const allKeys = keys();
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

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i];
    const keyLabel = i === 0 ? "LUSHA_API_KEY" : `LUSHA_API_KEY_${i + 1}`;
    try {
      const r = await lushaFetchWithKey(key, "/v2/person", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        console.log(`[lusha] ${keyLabel} person ${r.status} — rotating`);
        continue;
      }
      const res = r.data as Record<string, unknown>;
      const contacts = (res.contacts ?? {}) as Record<string, Record<string, unknown>>;
      const first = Object.values(contacts)[0];
      if (!first) {
        console.log(`[lusha] ${keyLabel} person returned no contact — rotating`);
        continue;
      }
      const normalized = normalize(first);
      if (!normalized.email) {
        console.log(`[lusha] ${keyLabel} person had no email — rotating`);
        continue;
      }
      return normalized;
    } catch (e) {
      console.log(`[lusha] ${keyLabel} person error:`, e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}
