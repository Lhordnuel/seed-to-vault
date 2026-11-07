import { firecrawlMap, firecrawlScrape } from "@/lib/firecrawl.server";
import { hunterVerifyEmail } from "@/lib/hunter.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildEmailCandidate,
  extractPublishedEmails,
  inferEmailPattern,
  isEmailPattern,
  patternForPublishedEmail,
  type EmailPattern,
} from "@/lib/email-pattern";

type VerificationStatus = "valid" | "catchall" | "invalid" | "unknown";
type VerificationProvider = "zerobounce" | "reoon" | "hunter";

type VerificationResult = {
  status: VerificationStatus;
  provider: VerificationProvider;
};

type VerificationOutcome = {
  result?: VerificationResult;
  attempted: VerificationProvider[];
  inconclusive: VerificationProvider[];
  failed: VerificationProvider[];
};

type SourcingResult = {
  domain: string;
  firstName: string;
  lastName: string;
  email?: string;
  candidateEmail?: string;
  emailStatus: VerificationStatus | "guess";
  emailPattern?: string;
  patternSource: "published_address" | "hunter_domain_search" | "default";
  verificationProvider?: VerificationProvider;
  sourceUrl?: string;
  sendable: boolean;
  notice?: string;
};

const PAGE_LIMIT = 5;

function normalizeDomain(value: string): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  const domain = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !domain.includes(".") ||
    domain.endsWith(".local") ||
    domain.endsWith(".internal") ||
    domain === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)
  ) {
    throw new Error("A public company domain is required.");
  }
  return domain;
}

function responseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeVerdict(value: unknown): VerificationStatus {
  const status = String(value ?? "").toLowerCase().replace(/[-\s]/g, "_");
  if (status === "valid" || status === "deliverable" || status === "safe") return "valid";
  if (status === "catch_all" || status === "catchall" || status === "accept_all") {
    return "catchall";
  }
  if (
    status === "invalid" ||
    status === "undeliverable" ||
    status === "spamtrap" ||
    status === "do_not_mail" ||
    status === "disposable" ||
    status === "abuse" ||
    status === "role_account"
  ) {
    return "invalid";
  }
  return "unknown";
}

async function verifyWithZeroBounce(email: string): Promise<VerificationResult> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) throw new Error("ZEROBOUNCE_API_KEY is not configured.");

  const body = new URLSearchParams({ api_key: apiKey, email });
  const response = await fetch("https://api.zerobounce.net/v2/validate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  const data = responseObject(await response.json().catch(() => null));
  if (!response.ok) throw new Error(`ZeroBounce returned HTTP ${response.status}.`);
  if (data.error) throw new Error("ZeroBounce could not validate the candidate email.");
  return { status: normalizeVerdict(data.status), provider: "zerobounce" };
}

async function verifyWithReoon(email: string): Promise<VerificationResult> {
  const apiKey = process.env.REOON_API_KEY;
  if (!apiKey) throw new Error("REOON_API_KEY is not configured.");

  const url = new URL("https://emailverifier.reoon.com/api/v1/verify");
  url.searchParams.set("email", email);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("mode", "quick");
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  const data = responseObject(await response.json().catch(() => null));
  if (!response.ok) throw new Error(`Reoon returned HTTP ${response.status}.`);
  return { status: normalizeVerdict(data.status), provider: "reoon" };
}

async function verifyCandidate(email: string): Promise<VerificationOutcome> {
  const providers: Array<{
    name: VerificationProvider;
    configured: boolean;
    verify: () => Promise<VerificationResult>;
  }> = [
    {
      name: "zerobounce",
      configured: !!process.env.ZEROBOUNCE_API_KEY,
      verify: () => verifyWithZeroBounce(email),
    },
    {
      name: "reoon",
      configured: !!process.env.REOON_API_KEY,
      verify: () => verifyWithReoon(email),
    },
    {
      name: "hunter",
      configured: !!(process.env.HUNTER_API_KEY || process.env.HUNTER_API_KEY_2),
      verify: () => hunterVerifyEmail(email),
    },
  ];

  const outcome: VerificationOutcome = {
    attempted: [],
    inconclusive: [],
    failed: [],
  };
  for (const provider of providers) {
    if (!provider.configured) continue;
    outcome.attempted.push(provider.name);
    try {
      const result = await provider.verify();
      if (result.status !== "unknown") {
        outcome.result = result;
        return outcome;
      }
      outcome.inconclusive.push(provider.name);
    } catch {
      outcome.failed.push(provider.name);
    }
  }
  return outcome;
}

function scrapePageUrl(value: string, domain: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      (host !== domain && !host.endsWith(`.${domain}`)) ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

async function findPublishedAddresses(domain: string) {
  const homepage = `https://${domain}`;
  const pages = new Set([homepage]);
  const failures: string[] = [];
  try {
    const map = responseObject(await firecrawlMap(homepage, { search: "team about contact people" }));
    const data = responseObject(map.data);
    const links = Array.isArray(map.links) ? map.links : Array.isArray(data.links) ? data.links : [];
    for (const link of links) {
      if (typeof link !== "string" || !/(team|about|contact|leadership|people|founders?)/i.test(link)) {
        continue;
      }
      const safeUrl = scrapePageUrl(link, domain);
      if (safeUrl) pages.add(safeUrl);
      if (pages.size >= PAGE_LIMIT) break;
    }
  } catch {
    failures.push("Could not map company team/about/contact pages.");
  }

  const addresses = new Map<string, string>();
  await Promise.all(
    [...pages].map(async (url) => {
      try {
        const result = responseObject(await firecrawlScrape(url, ["markdown", "html"]));
        const data = responseObject(result.data);
        const content = [data.markdown, data.html, result.markdown, result.html]
          .filter((part): part is string => typeof part === "string")
          .join("\n");
        for (const email of extractPublishedEmails(content, domain)) {
          if (!addresses.has(email)) addresses.set(email, url);
        }
      } catch {
        failures.push(`Could not read ${url}.`);
      }
    }),
  );
  return { addresses, failures };
}

export async function findVerifiedWorkEmail(input: {
  domain: string;
  firstName: string;
  lastName: string;
  companyName?: string;
}): Promise<SourcingResult> {
  const domain = normalizeDomain(input.domain);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new Error("A person's first and last name are required.");

  const { addresses: published, failures: siteFailures } = await findPublishedAddresses(domain);
  const { data: cached, error: cacheError } = await supabaseAdmin
    .from("scouted_companies")
    .select("email_pattern,email_pattern_source")
    .eq("domain", domain)
    .maybeSingle();
  if (cacheError) throw new Error(`Could not read the company's email pattern: ${cacheError.message}`);

  let pattern: EmailPattern | undefined;
  let patternSource: SourcingResult["patternSource"] = "default";
  let sourceUrl: string | undefined;
  let candidateEmail: string | undefined;

  for (const [email, url] of published) {
    const matchedPattern = patternForPublishedEmail(email, firstName, lastName);
    if (matchedPattern) {
      pattern = matchedPattern;
      patternSource = "published_address";
      sourceUrl = url;
      candidateEmail = email;
      break;
    }
  }

  if (
    !candidateEmail &&
    cached?.email_pattern &&
    isEmailPattern(cached.email_pattern) &&
    (cached.email_pattern_source === "published_address" ||
      cached.email_pattern_source === "hunter_domain_search")
  ) {
    pattern = cached.email_pattern;
    patternSource = cached.email_pattern_source;
  }

  const sourceNotices = [...siteFailures];
  if (!pattern) pattern = inferEmailPattern([...published.keys()]);
  if (pattern && patternSource === "default") patternSource = "published_address";

  if (!candidateEmail) {
    pattern ??= "{f}.{l}";
    candidateEmail = buildEmailCandidate(firstName, lastName, domain, pattern);
  }
  if (!candidateEmail) throw new Error("Could not build a candidate work email.");

  if (pattern && patternSource !== "default") {
    const now = new Date().toISOString();
    const patternRecord = {
      email_pattern: pattern,
      email_pattern_source: patternSource,
      email_pattern_updated_at: now,
    };
    if (cached) {
      const { error } = await supabaseAdmin
        .from("scouted_companies")
        .update(patternRecord)
        .eq("domain", domain);
      if (error) throw new Error(`Could not save the company's email pattern: ${error.message}`);
    } else if (input.companyName?.trim()) {
      const { error } = await supabaseAdmin.from("scouted_companies").insert({
        ...patternRecord,
        name: input.companyName.trim(),
        domain,
      });
      if (error) throw new Error(`Could not save the company's email pattern: ${error.message}`);
    }
  }

  const verification = await verifyCandidate(candidateEmail);
  if (!verification.result) {
    const emailStatus = verification.attempted.length === 0 ? "guess" : "unknown";
    const verifierNotice =
      verification.attempted.length === 0
        ? "No email verifier is configured."
        : verification.failed.length
          ? `Configured verifiers failed: ${verification.failed.join(", ")}.`
          : `Configured verifiers returned inconclusive results: ${verification.inconclusive.join(", ")}.`;
    return {
      domain,
      firstName,
      lastName,
      candidateEmail,
      emailStatus,
      emailPattern: pattern,
      patternSource,
      sourceUrl,
      sendable: false,
      notice: [
        ...sourceNotices,
        verifierNotice,
        "Keep this candidate unverified; do not present it as a sourced email or use it for outreach.",
      ].join(" "),
    };
  }

  const result: SourcingResult = {
    domain,
    firstName,
    lastName,
    candidateEmail,
    emailStatus: verification.result.status,
    emailPattern: pattern,
    patternSource,
    verificationProvider: verification.result.provider,
    sourceUrl,
    sendable: verification.result.status === "valid",
  };
  if (verification.result.status === "valid") result.email = candidateEmail;
  else if (verification.result.status === "catchall") {
    result.notice = [
      ...sourceNotices,
      "The domain accepts all addresses; this mailbox could not be verified.",
    ].join(" ");
  } else if (verification.result.status === "invalid") {
    result.notice = [...sourceNotices, "The candidate address did not pass verification."].join(" ");
  } else {
    result.notice = [
      ...sourceNotices,
      "Email verification was inconclusive; do not use this candidate for outreach.",
    ].join(" ");
  }
  if (verification.result.status === "valid" && sourceNotices.length) {
    result.notice = sourceNotices.join(" ");
  }
  return result;
}
