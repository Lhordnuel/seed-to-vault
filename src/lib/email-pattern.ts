export type EmailPattern =
  | "{f}.{l}"
  | "{f}{l}"
  | "{fi}{l}"
  | "{f}"
  | "{fi}.{l}"
  | "{f}_{l}"
  | "{fi}_{l}"
  | "{l}.{f}"
  | "{l}{fi}"
  | "{f}-{l}"
  | "{fi}-{l}";

export type SitePerson = { name: string; title: string };

const PATTERN_BUILDERS: Record<EmailPattern, (first: string, last: string) => string> = {
  "{f}.{l}": (first, last) => `${first}.${last}`,
  "{f}{l}": (first, last) => `${first}${last}`,
  "{fi}{l}": (first, last) => `${first[0]}${last}`,
  "{f}": (first) => first,
  "{fi}.{l}": (first, last) => `${first[0]}.${last}`,
  "{f}_{l}": (first, last) => `${first}_${last}`,
  "{fi}_{l}": (first, last) => `${first[0]}_${last}`,
  "{l}.{f}": (first, last) => `${last}.${first}`,
  "{l}{fi}": (first, last) => `${last}${first[0]}`,
  "{f}-{l}": (first, last) => `${first}-${last}`,
  "{fi}-{l}": (first, last) => `${first[0]}-${last}`,
};

export function isEmailPattern(value: string): value is EmailPattern {
  return Object.prototype.hasOwnProperty.call(PATTERN_BUILDERS, value);
}

const ROLE_LOCALS = new Set([
  "admin",
  "careers",
  "contact",
  "hello",
  "info",
  "jobs",
  "marketing",
  "media",
  "no-reply",
  "noreply",
  "office",
  "press",
  "recruiting",
  "sales",
  "support",
  "team",
]);

const DECISION_MAKER_TITLE =
  /\b(?:chief executive officer|chief technology officer|chief product officer|chief marketing officer|chief operating officer|head of engineering|head of product|head of marketing|vp engineering|vp product|vp marketing|engineering manager|ceo|cto|coo|founder|co-founder|cofounder)\b/i;
const NON_PERSON_LINES = new Set([
  "about us",
  "contact us",
  "leadership team",
  "meet our team",
  "our people",
  "our team",
  "team",
]);
const NON_PERSON_WORDS = /\b(?:about|company|contact|executive|founders?|leadership|management|meet|our|people|team)\b/i;

function nameFromLine(value: string): string | undefined {
  const line = value
    .replace(/^\s*(?:#{1,6}|[-*•])\s*/, "")
    .replace(/[*_`]/g, "")
    .replace(/[|,:;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, "")
    .replace(/^(?:dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, "");
  if (!line || NON_PERSON_LINES.has(line.toLowerCase()) || NON_PERSON_WORDS.test(line)) {
    return undefined;
  }
  const match = line.match(
    /^([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,3})[.!?]?$/u,
  );
  return match?.[1];
}

export function extractSitePeople(content: string): SitePerson[] {
  const lines = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const people = new Map<string, SitePerson>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const titleMatch = DECISION_MAKER_TITLE.exec(line);
    if (!titleMatch) continue;

    const before = line.slice(0, titleMatch.index).replace(/\b(?:is|at|the)\b/gi, " ");
    const after = line.slice(titleMatch.index + titleMatch[0].length);
    const name =
      nameFromLine(before) ??
      nameFromLine(after) ??
      nameFromLine(lines[index - 1] ?? "") ??
      nameFromLine(lines[index + 1] ?? "");
    if (!name) continue;

    const key = name.toLowerCase();
    if (!people.has(key)) people.set(key, { name, title: titleMatch[0] });
  }
  return [...people.values()];
}

function cleanName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&commat;|&#64;|&#x40;/gi, "@")
    .replace(/&period;|&#46;|&#x2e;/gi, ".")
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCharCode(Number.parseInt(decimal, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function decodeObfuscatedEmails(value: string): string {
  const withDataAttributeEmails = value.replace(/<[^>]*>/g, (tag) => {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/(data-(?:user|domain|front|back))=["']([^"']+)["']/gi)) {
      attributes.set(match[1].toLowerCase(), match[2]);
    }
    const user = attributes.get("data-user") ?? attributes.get("data-front");
    const domain = attributes.get("data-domain") ?? attributes.get("data-back");
    return user && domain ? `${tag} ${user}@${domain}` : tag;
  });
  const withCloudflareEmails = withDataAttributeEmails.replace(
    /data-cfemail=["']([0-9a-f]{4,})["']/gi,
    (_match, encoded: string) => {
      const key = Number.parseInt(encoded.slice(0, 2), 16);
      let decoded = "";
      for (let index = 2; index < encoded.length; index += 2) {
        decoded += String.fromCharCode(
          Number.parseInt(encoded.slice(index, index + 2), 16) ^ key,
        );
      }
      return decoded;
    },
  );
  return decodeHtmlEntities(withCloudflareEmails)
    .replace(/\s*(?:\[at\]|\(at\)|\{at\}|<at>|\s+at\s+)\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\}|<dot>|\s+dot\s+)\s*/gi, ".");
}

export function extractPublishedEmails(content: string, domain: string): string[] {
  const rootDomain = domain.toLowerCase().replace(/^www\./, "");
  const decoded = decodeObfuscatedEmails(content);
  const matches =
    decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi) ??
    [];

  return [...new Set(matches.map((email) => email.toLowerCase().replace(/[.,;:]+$/, "")))].filter(
    (email) => {
      const [local = "", emailDomain = ""] = email.split("@");
      return (
        email.length <= 254 &&
        (emailDomain === rootDomain || emailDomain.endsWith(`.${rootDomain}`)) &&
        !ROLE_LOCALS.has(local) &&
        !/\.(?:png|jpe?g|gif|svg|webp)$/i.test(email) &&
        !/(?:example\.com|sentry|wixpress)/i.test(email)
      );
    },
  );
}

export function isWorkEmailForDomain(email: string, domain: string): boolean {
  const normalized = email.trim().toLowerCase();
  const [local = "", emailDomain = ""] = normalized.split("@");
  const rootDomain = domain.toLowerCase().replace(/^www\./, "");
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) &&
    (emailDomain === rootDomain || emailDomain.endsWith(`.${rootDomain}`)) &&
    !ROLE_LOCALS.has(local) &&
    !/(?:masked|hidden|redacted|email_not_unlocked)/i.test(normalized)
  );
}

export function patternForPublishedEmail(
  email: string,
  firstName: string,
  lastName: string,
): EmailPattern | undefined {
  const local = email.trim().toLowerCase().split("@")[0];
  const first = cleanName(firstName);
  const last = cleanName(lastName);
  if (!local || !first || !last) return undefined;

  for (const [pattern, build] of Object.entries(PATTERN_BUILDERS) as [
    EmailPattern,
    (first: string, last: string) => string,
  ][]) {
    if (build(first, last) === local) return pattern;
  }
  return undefined;
}

export function inferEmailPattern(emails: string[]): EmailPattern | undefined {
  const counts = new Map<EmailPattern, number>();
  for (const email of emails) {
    const [local = ""] = email.toLowerCase().split("@");
    if (ROLE_LOCALS.has(local)) continue;
    const match = local.match(/^([a-z]+)([._-])([a-z]+)$/);
    if (!match) continue;

    const [, first, separator, last] = match;
    if (first.length === 1 && last.length >= 2) {
      const pattern: EmailPattern =
        separator === "."
          ? "{fi}.{l}"
          : separator === "_"
            ? "{fi}_{l}"
            : "{fi}-{l}";
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    } else if (first.length >= 2 && last.length >= 2) {
      const pattern: EmailPattern =
        separator === "."
          ? "{f}.{l}"
          : separator === "_"
            ? "{f}_{l}"
            : "{f}-{l}";
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function patternFromHunter(value: string | undefined): EmailPattern | undefined {
  const patternMap: Record<string, EmailPattern> = {
    "{first}.{last}": "{f}.{l}",
    "{first}{last}": "{f}{l}",
    "{f}{last}": "{fi}{l}",
    "{first}": "{f}",
    "{f}.{last}": "{fi}.{l}",
    "{first}_{last}": "{f}_{l}",
    "{f}_{last}": "{fi}_{l}",
    "{last}.{first}": "{l}.{f}",
    "{last}{f}": "{l}{fi}",
    "{first}-{last}": "{f}-{l}",
    "{f}-{last}": "{fi}-{l}",
  };
  return value ? patternMap[value.toLowerCase().trim()] : undefined;
}

export function buildEmailCandidate(
  firstName: string,
  lastName: string,
  domain: string,
  pattern: EmailPattern,
): string | undefined {
  const first = cleanName(firstName);
  const last = cleanName(lastName);
  const cleanDomain = domain.toLowerCase().replace(/^www\./, "");
  if (!first || !last || !cleanDomain) return undefined;
  return `${PATTERN_BUILDERS[pattern](first, last)}@${cleanDomain}`;
}
