/**
 * FullEnrich API client. Primary contact-enrichment provider.
 * Docs: https://docs.fullenrich.com
 *
 * Flow: POST /contact/enrich/bulk to kick off enrichment, then poll
 * GET /contact/enrich/bulk/{enrichment_id} until status === "FINISHED".
 */

const FE_BASE = "https://app.fullenrich.com/api/v1";

function key(): string {
  const k = (process.env.FULLENRICH_API_KEY ?? "").trim();
  if (!k) throw new Error("FULLENRICH_API_KEY is not configured.");
  return k;
}

async function feFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${FE_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${key()}`,
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
      `FullEnrich ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return data as Record<string, unknown>;
}

export type FullEnrichContact = {
  name?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  emails?: { address: string; qualification?: string }[];
  phone?: string;
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
};

export type FullEnrichInput = {
  firstName: string;
  lastName: string;
  domain?: string;
  companyName?: string;
  linkedinUrl?: string;
  title?: string;
};

function cleanDomain(d?: string) {
  if (!d) return undefined;
  return d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function normalize(row: Record<string, unknown>): FullEnrichContact {
  const contact = (row.contact ?? row) as Record<string, unknown>;
  const emailsRaw = (contact.emails ?? []) as Array<Record<string, unknown>>;
  const emails = emailsRaw
    .map((e) => {
      const address = (e.email ?? e.address) as string | undefined;
      if (!address) return null;
      return {
        address,
        qualification: (e.qualification ?? e.status) as string | undefined,
      };
    })
    .filter((e): e is { address: string; qualification?: string } => !!e);
  // Prefer VALID over CATCHALL/UNKNOWN
  const ranked = [...emails].sort((a, b) => {
    const score = (q?: string) => {
      const v = (q ?? "").toUpperCase();
      if (v === "VALID") return 3;
      if (v === "CATCHALL") return 2;
      if (v === "UNKNOWN") return 1;
      return 0;
    };
    return score(b.qualification) - score(a.qualification);
  });
  const phonesRaw = (contact.phones ?? []) as Array<Record<string, unknown> | string>;
  const phone =
    typeof phonesRaw[0] === "string"
      ? (phonesRaw[0] as string)
      : ((phonesRaw[0] as { number?: string } | undefined)?.number as string | undefined);

  const firstName = (contact.firstname ?? contact.firstName) as string | undefined;
  const lastName = (contact.lastname ?? contact.lastName) as string | undefined;
  const name =
    (contact.full_name as string | undefined) ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    undefined;

  return {
    name,
    firstName,
    lastName,
    title: (contact.title ?? contact.job_title) as string | undefined,
    email: ranked[0]?.address,
    emails: ranked,
    phone,
    linkedinUrl: (contact.linkedin_url ?? contact.linkedinUrl) as string | undefined,
    companyName: (contact.company_name ?? contact.companyName) as string | undefined,
    companyDomain: (contact.domain ?? contact.companyDomain) as string | undefined,
  };
}

/**
 * Bulk-enrich contacts. Polls until FINISHED or timeout.
 */
export async function fullenrichBulkEnrich(
  inputs: FullEnrichInput[],
  opts: { timeoutMs?: number; pollMs?: number; name?: string } = {},
): Promise<FullEnrichContact[]> {
  if (!inputs.length) return [];
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollMs = opts.pollMs ?? 4_000;

  const datas = inputs.map((c, i) => ({
    firstname: c.firstName,
    lastname: c.lastName,
    company_name: c.companyName,
    domain: cleanDomain(c.domain),
    linkedin_url: c.linkedinUrl,
    enrich_fields: ["contact.emails", "contact.phones"],
    custom: { idx: String(i) },
  }));

  const start = await feFetch("/contact/enrich/bulk", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name ?? `vaultio-${Date.now()}`,
      datas,
    }),
  });

  const enrichmentId =
    (start.enrichment_id as string | undefined) ??
    (start.id as string | undefined) ??
    ((start.data as { enrichment_id?: string } | undefined)?.enrichment_id);

  if (!enrichmentId) {
    throw new Error(`FullEnrich: missing enrichment_id in response: ${JSON.stringify(start)}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const poll = await feFetch(`/contact/enrich/bulk/${enrichmentId}`);
    const status = String(poll.status ?? "").toUpperCase();
    if (status === "FINISHED" || status === "DONE" || status === "COMPLETED") {
      const rows = (poll.datas ?? poll.data ?? poll.contacts ?? []) as Array<
        Record<string, unknown>
      >;
      return rows.map(normalize);
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`FullEnrich enrichment failed: ${JSON.stringify(poll)}`);
    }
  }
  // Timed out — return whatever partial data the API has
  try {
    const poll = await feFetch(`/contact/enrich/bulk/${enrichmentId}`);
    const rows = (poll.datas ?? poll.data ?? poll.contacts ?? []) as Array<
      Record<string, unknown>
    >;
    return rows.map(normalize);
  } catch {
    return [];
  }
}

/**
 * Enrich a single person by name + (domain or linkedinUrl).
 */
export async function fullenrichPersonEnrich(
  input: FullEnrichInput,
): Promise<FullEnrichContact | null> {
  const results = await fullenrichBulkEnrich([input], { timeoutMs: 60_000 });
  return results[0] ?? null;
}
