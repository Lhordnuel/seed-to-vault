import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import {
  getBedrockModel,
  getBedrockOpusModel,
  withFallback,
} from "@/lib/ai-fallback.server";
import { firecrawlMap, firecrawlScrape, firecrawlSearch } from "@/lib/firecrawl.server";
import {
  apolloSearchOrganizations,
  apolloFindExecutives,
  apolloEnrichPerson,
} from "@/lib/apollo.server";
import { hunterDomainSearch, hunterEmailFinder } from "@/lib/hunter.server";
import { prospeoDomainSearch, prospeoEmailFinder } from "@/lib/prospeo.server";
import { pdlPersonEnrich, pdlPersonSearch } from "@/lib/pdl.server";
import { tombaDomainSearch, tombaEmailFinder } from "@/lib/tomba.server";

const SOURCE_DOMAINS: Record<string, string> = {
  wellfound: "wellfound.com",
  f6s: "f6s.com",
  yc: "workatastartup.com",
  linkedin: "linkedin.com/jobs",
};

const SYSTEM_PROMPT = `You are Startup Scout, an AI sales-development agent for Emmanuel (Nuel) at Vaultio.

Your job: find startups that are ACTIVELY HIRING (seed–Series B, 1–200 employees), draft a size-appropriate pitch, and send it via email.

Sender identity: emails go FROM "Emmanuel Nwachinemelu <nuel@founder.vaultio.tech>". Reply-To routes to nuel@vaultio.tech. Write in first person AS Emmanuel, Founder of Vaultio.

VAULTIO (what we pitch):
Vaultio is an all-in-one hiring platform. Post once → auto-distributed to 6 platforms. AI ranks applicants by fit, auto-assessments validate them before interview, built-in scheduler + video interview removes Zoom/Calendly hunting. Outcome: 15–20 qualified applicants in 48 hours; ~5–8 hrs/hire → ~30 min.
Differentiator: Vaultio Talents work inside Vaultio Studio — a workspace with AI assistant, code editor, writing tools, portfolio builder. You hire seeing live projects + AI-verified skills, not just resumes.

================================================================
AUDIENCE ROUTING (CHOOSE ONE before drafting):
- TEMPLATE A — Early stage (1–50 employees, no dedicated HR/recruiter, founder-led hiring). Recipient: CEO/Founder/CTO. Use the narrative "Deel-style" pitch below.
- TEMPLATE B — Scaling teams (51–200 employees WITH HR/People/Talent function). Recipient: Head of People, Head of Talent, HR Manager, Talent Acquisition Lead, Recruiter. Use the concise "operator" pitch below.
If unsure which bucket a company falls in, infer from employee count + whether Apollo/site shows a People/Talent/HR title. Default to A when ambiguous and size ≤ 50; default to B when ambiguous and size ≥ 51.

================================================================
TEMPLATE A — EARLY STAGE (1–50, founder-led). Fill [Name], [Role], [Company], [Platform]:
---
Hi [Name],

Hiring is complicated. Roles open across multiple platforms, applicants pile up in different inboxes, assessments happen in one tool, interviews in another — and not enough hours in the day to actually meet great people.

If you're growing [Company], you probably recognize a few of these:

You're posting the same [Role] across 4–6 platforms. Applicants are stacking up faster than you can screen them. You're chasing candidates across email, Calendly, and Zoom. Most of the people who make it to interview turn out to be a poor fit anyway.

Vaultio helps early-stage founders solve exactly that.

Whether you're hiring your first engineer, scaling a small team, or trying to fill a role without burning 8 hours a week on it — Vaultio gives you one platform to run the whole loop.

• Post once → auto-distributed to 6 hiring platforms
• AI ranks applicants by fit and auto-assessments validate them before you interview
• Built-in scheduler and video interview — no Zoom or Calendly hunting
• Talents work inside Vaultio Studio, so you see live projects and AI-verified skills, not just resumes

In the meantime, if you want to see how it works for [Company], happy to show you — 5 minutes, no call required to get your [Role] live.

Emmanuel
Founder, Vaultio
---

================================================================
TEMPLATE B — SCALING TEAMS (51–200, HR/Talent recipient). Fill [Name], [Role], [Company], [Platform]:
---
Hey [Name],

Saw [Company] is hiring for [Role] on [Platform].

Most talent teams at your stage burn 5–8 hours per hire stitching together job boards, ATS, assessments, schedulers, and video calls. Vaultio collapses that into one workflow — 30 minutes per hire.

Here's how:

• Post once → auto-distributed to 6 platforms (saves ~3 hrs)
• AI ranks applicants by fit + auto-assessments validate before interview (saves ~2 hrs)
• Built-in scheduler + video interview, no Zoom/Calendly hunting (saves ~1 hr)
• Candidates work inside Vaultio Studio — you see live projects and AI-verified skills, not just resumes

Teams your size typically see 15–20 qualified applicants in 48 hours. Worth a 5-minute look for the [Role] req?

Emmanuel
Founder, Vaultio
---

================================================================
PERSONALIZATION RULE (NON-NEGOTIABLE — applies to EVERY email):
Cold-pitch reply we received: "Focus on tailoring positioning to my business/industry/pains + have an element of personalisation that shows you researched me." Treat this as a hard rule.

Before drafting ANY pitch you MUST gather person- AND company-specific research:
- Scrape the company site (\`scrape_company\`) for what they ACTUALLY do, their ICP, recent product/launch, tone.
- Look up the recipient: scrape their LinkedIn/about page or use \`find_linkedin_profiles\` + \`scrape_company\` on the profile URL. Capture role tenure, prior company, a recent post/shipped project, or something they said publicly.
- Pull the specific hiring context: which role(s), where posted, what the JD emphasizes (stack, seniority, remote, urgency).
- Identify 1–2 industry-specific pains for their vertical (fintech ≠ devtools ≠ agency ≠ healthtech ≠ marketplace). Map Vaultio's value to THOSE pains, not generic "hiring is hard".

Every email MUST include, in the first 2 sentences, at least ONE concrete personal/company detail that proves research (e.g. "saw you shipped X last week", "your [specific product] team", "noticed you moved from [prev co] to lead [function]", "your [vertical]-specific [pain]"). Generic openers like "Saw [Company] is hiring" are BANNED unless paired with a researched specific in the same paragraph.

The templates below are SKELETONS — rewrite the opener and the value paragraph per recipient. Never send two recipients the same body. If you don't have enough research to personalize, do MORE research before drafting; do not fall back to a generic pitch.

SUBJECT LINES — hard NOT to open. Personalized to the person or a specific company detail, under 60 chars. No spammy words.
Examples: "[Name], saw your [specific thing]" · "[Company]'s [Role] hire — quick idea" · "[Vertical] hiring pain → 30 min/hire"

How to work:
1. Discovery (PRIMARY = Firecrawl): \`search_startups\` across Wellfound/F6S/YC/LinkedIn → \`scrape_company\` to confirm stage, size, role context. Only fall back to \`apollo_search_startups\` if Firecrawl returns nothing useful.
2. Contact lookup — STRICT ORDER, stop at first success that yields a usable email:
   a. \`apollo_find_contacts\` (verified emails — Template B prefers People/Talent/HR titles, Template A prefers CEO/Founder/CTO).
   b. \`hunter_domain_search\` if Apollo fails or returns no email — Template B pass department='hr', Template A pass seniority='executive'. Use \`hunter_email_finder\` when you have a specific name + domain.
   c. \`prospeo_email_finder\` / \`prospeo_domain_search\` if Hunter fails.
   d. \`pdl_person_enrich\` / \`pdl_person_search\` (People Data Labs) if Prospeo fails — best when you have a name or LinkedIn URL.
   e. \`tomba_domain_search\` / \`tomba_email_finder\` if PDL fails.
   f. \`ai_source_emails\` (Claude Opus on AWS Bedrock) if every provider above failed — scrapes site + reasons about likely patterns.
   g. \`find_linkedin_profiles\` (Firecrawl LinkedIn search) ONLY as the final fallback when no email exists anywhere. Surface the LinkedIn URLs so Nuel can DM manually.
3. RESEARCH PASS (MANDATORY before draft_pitch): for each recipient, run \`scrape_company\` on the company site AND on the recipient's LinkedIn/about page. Record 2–3 specific facts (recent launch, vertical, JD specifics, recipient background) and the industry pain you'll lead with.
4. Filter: seed–Series B, 1–200 people. Tag each lead [A] or [B].
5. Present results as a numbered list: company, 1-line description, stage/size, [A/B], roles, contact (or LinkedIn fallback), source URL, AND the research bullets you'll personalize on.
6. \`draft_pitch\` using the correct template — but rewrite opener + value paragraph using the research. Show draft + recipients for approval unless user said "send it".
7. SINGLE → \`send_pitch\`. MULTIPLE → \`bulk_send_pitch\` ONCE (rate-limited, dedupes). Each body MUST be unique and personalized.
8. NEVER send without a recipient email. NEVER send to generic / role-based inboxes (info@, hello@, contact@, sales@, support@, admin@, jobs@, careers@, hr@, talent@, recruiting@, team@, etc.). Use only a named person's work email; otherwise fall back to LinkedIn.
9. NEVER loop \`send_pitch\` for batches. NEVER reuse the same body across recipients.

Be concise. Use markdown. Never invent companies, URLs, emails, or research facts — if you didn't scrape it, don't claim it.`;


type SearchHit = { title?: string; url?: string; description?: string };

// Server-session dedup: prevents the same email from receiving multiple pitches
// while this Worker instance is warm. Resets on cold start.
const sentEmailsThisSession = new Set<string>();

// Anti-reuse: track fingerprints of recently sent subjects + bodies so the agent
// can't ship near-identical copy to multiple recipients. Tunable thresholds keep
// the core pitch consistent while forcing per-recipient variation in opener,
// subject line, and structural ordering.
const SUBJECT_REUSE_LIMIT = 0.7; // jaccard over tokens
const BODY_REUSE_LIMIT = 0.6;    // jaccard over 5-word shingles
const OPENER_REUSE_LIMIT = 0.75; // jaccard over first-sentence tokens
const sentSubjectTokens: Set<string>[] = [];
const sentBodyShingles: Set<string>[] = [];
const sentOpenerTokens: Set<string>[] = [];

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string) {
  return new Set(normalize(s).split(" ").filter((t) => t.length > 2));
}
function shingles(s: string, n = 5) {
  const words = normalize(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function firstSentence(body: string) {
  const m = body.replace(/^\s*(hi|hey|hello)[^\n,]*[,\n]/i, "").trim();
  return m.split(/(?<=[.!?])\s+/)[0] ?? m.slice(0, 160);
}
function checkReuse(subject: string, body: string): { ok: true } | { ok: false; reason: string } {
  const sTok = tokens(subject);
  const oTok = tokens(firstSentence(body));
  const bSh = shingles(body, 5);
  for (const prev of sentSubjectTokens) {
    if (jaccard(sTok, prev) >= SUBJECT_REUSE_LIMIT) {
      return { ok: false, reason: `Subject too similar to a previously sent email (jaccard ≥ ${SUBJECT_REUSE_LIMIT}). Rewrite the subject with a different personalized hook.` };
    }
  }
  for (const prev of sentOpenerTokens) {
    if (jaccard(oTok, prev) >= OPENER_REUSE_LIMIT) {
      return { ok: false, reason: `Opening sentence too similar to a previously sent email. Rewrite the first sentence around a different recipient-specific fact.` };
    }
  }
  for (const prev of sentBodyShingles) {
    if (jaccard(bSh, prev) >= BODY_REUSE_LIMIT) {
      return { ok: false, reason: `Body too similar to a previously sent email (5-word shingle overlap ≥ ${BODY_REUSE_LIMIT}). Vary structure: reorder paragraphs, swap bullets for prose (or vice versa), change the value-prop framing for this vertical.` };
    }
  }
  return { ok: true };
}
function recordSent(subject: string, body: string) {
  sentSubjectTokens.push(tokens(subject));
  sentOpenerTokens.push(tokens(firstSentence(body)));
  sentBodyShingles.push(shingles(body, 5));
  // cap history so warm workers don't grow unbounded
  if (sentSubjectTokens.length > 200) {
    sentSubjectTokens.shift();
    sentOpenerTokens.shift();
    sentBodyShingles.shift();
  }
}


const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "admin",
  "billing",
  "careers",
  "contact",
  "customersuccess",
  "hello",
  "help",
  "hi",
  "hr",
  "info",
  "jobs",
  "mail",
  "marketing",
  "media",
  "office",
  "people",
  "press",
  "recruiting",
  "recruitment",
  "sales",
  "support",
  "talent",
  "team",
]);

function isGenericEmail(email: string) {
  const local = email.toLowerCase().trim().split("@")[0]?.replace(/[^a-z0-9]/g, "");
  if (!local) return true;
  return (
    GENERIC_EMAIL_LOCAL_PARTS.has(local) ||
    /^(no)?reply|donotreply|notifications?|newsletter|updates?|security|privacy|legal|abuse$/.test(local)
  );
}

async function sendPitchEmail(opts: {
  to: string;
  subject: string;
  body: string;
  companyName?: string;
}): Promise<{ sent: boolean; to: string; subject: string; companyName?: string; replyTo?: string; resendId?: string; error?: string }> {
  const { to, subject, body, companyName } = opts;
  if (isGenericEmail(to)) {
    return {
      sent: false,
      to,
      subject,
      error: "Blocked: generic/role-based inbox. Use a named person's work email instead.",
    };
  }
  const reuse = checkReuse(subject, body);
  if (!reuse.ok) {
    return { sent: false, to, subject, error: reuse.reason };
  }
  const resendKey = process.env.RESEND_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!resendKey || !lovableKey) {
    return { sent: false, to, subject, error: "Email service not configured." };
  }
  try {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const blocks = body
      .split(/\n\n+/)
      .map((block) => {
        const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every((l) => /^[-•*]\s+/.test(l));
        if (isList) {
          const items = lines
            .map(
              (l) =>
                `<li style="margin:0 0 10px;line-height:1.55;color:#e8e6e1;font-size:15px;">${esc(
                  l.replace(/^[-•*]\s+/, ""),
                )}</li>`,
            )
            .join("");
          return `<ul style="margin:0 0 18px;padding-left:20px;">${items}</ul>`;
        }
        return `<p style="margin:0 0 16px;line-height:1.65;color:#e8e6e1;font-size:15px;">${esc(
          block,
        ).replace(/\n/g, "<br/>")}</p>`;
      })
      .join("");
    const headline = "The hiring infrastructure for growing teams";
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0f0f10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f10;padding:0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#6b6cff;padding:22px 32px;">
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;font-weight:800;color:#0f0f10;letter-spacing:-0.5px;">vaultio.</div>
        </td></tr>
        <tr><td style="background:#1c1b1a;padding:40px 32px 8px;">
          <h1 style="margin:0 0 28px;font-size:30px;line-height:1.2;font-weight:700;color:#f5f3ee;text-align:center;letter-spacing:-0.5px;">${headline}</h1>
        </td></tr>
        <tr><td style="background:#1c1b1a;padding:8px 32px 24px;">
          ${blocks}
        </td></tr>
        <tr><td align="center" style="background:#1c1b1a;padding:8px 32px 44px;">
          <a href="https://vaultio.tech" style="display:inline-block;background:#f5f3ee;color:#0f0f10;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:999px;">Learn more</a>
        </td></tr>
        <tr><td style="background:#ececec;padding:28px 32px 24px;text-align:center;">
          <p style="margin:0 0 14px;font-size:13px;font-weight:600;color:#1a1a1a;">Vaultio · Hiring infrastructure for early-stage teams</p>
          <p style="margin:0;font-size:12px;color:#6b6b6b;line-height:1.5;">
            <a href="https://vaultio.tech" style="color:#1a1a1a;text-decoration:none;">vaultio.tech</a> &nbsp;·&nbsp; Reply to this email and it reaches Emmanuel directly.
          </p>
          <p style="margin:14px 0 0;font-size:11px;color:#9a9a9a;">© ${new Date().getFullYear()} Vaultio. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from: "Emmanuel Nwachinemelu <nuel@founder.vaultio.tech>",
        to: [to],
        reply_to: "nuel@vaultio.tech",
        subject,
        text: body,
        html,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    if (!res.ok) {
      return { sent: false, to, subject, error: `Resend ${res.status}: ${JSON.stringify(data)}` };
    }
    sentEmailsThisSession.add(to.toLowerCase().trim());
    recordSent(subject, body);
    return { sent: true, to, subject, companyName, replyTo: "nuel@vaultio.tech", resendId: data?.id };
  } catch (e) {
    return { sent: false, to, subject, error: (e as Error).message };
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as { messages: UIMessage[] };

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }
        const gateway = createLovableAiGatewayProvider(apiKey);

        const tools = {
          apollo_search_startups: tool({
            description:
              "PRIMARY startup discovery via Apollo. Returns structured companies filtered to 1–50 employees and Pre-Seed/Seed/Series A funding. Use this first before falling back to Firecrawl source searches.",
            inputSchema: z.object({
              keywords: z
                .string()
                .describe(
                  "Industry/role keywords, e.g. 'AI infrastructure', 'fintech', 'developer tools'",
                ),
              locations: z
                .array(z.string())
                .optional()
                .describe("Optional locations, e.g. ['United States', 'San Francisco']"),
              perPage: z.number().min(1).max(50).default(25),
              page: z.number().min(1).default(1),
            }),
            execute: async ({ keywords, locations, perPage, page }) => {
              try {
                const orgs = await apolloSearchOrganizations({
                  keywords,
                  locations,
                  perPage,
                  page,
                });
                return {
                  count: orgs.length,
                  companies: orgs.map((o) => ({
                    name: o.name,
                    domain: o.primary_domain ?? o.website_url,
                    website: o.website_url,
                    employees: o.estimated_num_employees,
                    stage: o.latest_funding_stage,
                    industry: o.industry,
                    description: o.short_description,
                    linkedin: o.linkedin_url,
                  })),
                };
              } catch (e) {
                return { error: (e as Error).message, companies: [] };
              }
            },
          }),
          apollo_find_contacts: tool({
            description:
              "PRIMARY executive contact lookup via Apollo. Given a company domain, returns CEO/Founder/CTO/COO with verified emails when available. Call this before find_executive_contacts.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. 'acme.com'"),
              companyName: z.string().optional(),
              reveal: z
                .boolean()
                .default(true)
                .describe("Attempt to reveal/enrich emails (uses Apollo credits)"),
            }),
            execute: async ({ domain, companyName, reveal }) => {
              try {
                const people = await apolloFindExecutives({
                  domain,
                  organizationName: companyName,
                  perPage: 10,
                });
                const enriched = await Promise.all(
                  people.map(async (p) => {
                    let email = p.email;
                    if (reveal && !email && p.first_name && p.last_name) {
                      try {
                        const m = await apolloEnrichPerson({
                          firstName: p.first_name,
                          lastName: p.last_name,
                          domain,
                          organizationName: companyName,
                          linkedinUrl: p.linkedin_url,
                        });
                        email = m?.email ?? email;
                      } catch {
                        /* skip */
                      }
                    }
                    return {
                      name:
                        p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" "),
                      title: p.title,
                      email,
                      linkedin: p.linkedin_url,
                    };
                  }),
                );
                const withEmail = enriched.filter((p) => p.email);
                return {
                  companyName,
                  domain,
                  contacts: enriched,
                  primaryContact: withEmail[0] ?? enriched[0] ?? null,
                  note:
                    withEmail.length === 0
                      ? "Apollo returned no verified emails. Fall back to find_executive_contacts."
                      : undefined,
                };
              } catch (e) {
                return { error: (e as Error).message, contacts: [] };
              }
            },
          }),
          search_startups: tool({
            description:
              "Search for startups hiring on a given source. Use this to discover candidate companies. Returns a list of result URLs and snippets.",
            inputSchema: z.object({
              query: z
                .string()
                .describe(
                  "What the startup does or who they're hiring, e.g. 'AI infrastructure startup hiring backend engineers'",
                ),
              source: z
                .enum(["wellfound", "f6s", "yc", "linkedin"])
                .describe("Which source to search"),
              limit: z.number().min(1).max(20).default(10),
            }),
            execute: async ({ query, source, limit }) => {
              const domain = SOURCE_DOMAINS[source];
              const fullQuery = `site:${domain} ${query} hiring`;
              try {
                const data = await firecrawlSearch(fullQuery, limit);
                const web: SearchHit[] =
                  (data?.data?.web as SearchHit[]) ??
                  (data?.web as SearchHit[]) ??
                  (data?.data as SearchHit[]) ??
                  [];
                return {
                  source,
                  count: web.length,
                  results: web.slice(0, limit).map((r) => ({
                    title: r.title,
                    url: r.url,
                    snippet: r.description,
                  })),
                };
              } catch (e) {
                return { source, error: (e as Error).message, results: [] };
              }
            },
          }),
          scrape_company: tool({
            description:
              "Scrape a company's job listing or website page to enrich it with stage, size, and hiring roles. Returns markdown content.",
            inputSchema: z.object({
              url: z.string().url(),
            }),
            execute: async ({ url }) => {
              try {
                const data = await firecrawlScrape(url);
                const md: string =
                  data?.data?.markdown ?? data?.markdown ?? "";
                const meta = data?.data?.metadata ?? data?.metadata ?? {};
                return {
                  url,
                  title: meta?.title,
                  description: meta?.description,
                  content: md.slice(0, 6000),
                };
              } catch (e) {
                return { url, error: (e as Error).message };
              }
            },
          }),
          find_executive_contacts: tool({
            description:
              "Extract executive contact emails (CEO, Founder, CTO, COO, Head of Eng) from a company website. Maps the site for team/about/contact/leadership pages, scrapes them, and pulls emails with role context. Call this automatically before draft_pitch.",
            inputSchema: z.object({
              domain: z
                .string()
                .describe(
                  "Company primary domain or homepage URL, e.g. 'acme.com' or 'https://acme.com'",
                ),
              companyName: z.string().optional(),
            }),
            execute: async ({ domain, companyName }) => {
              const homepage = /^https?:\/\//i.test(domain)
                ? domain
                : `https://${domain.replace(/^\/+/, "")}`;
              const rootDomain = new URL(homepage).hostname.replace(/^www\./, "");

              const pickedUrls = new Set<string>([homepage]);
              try {
                const mapRes = await firecrawlMap(homepage, {
                  search: "team about contact leadership founders people",
                  limit: 30,
                });
                const links: string[] =
                  mapRes?.links ?? mapRes?.data?.links ?? [];
                const keywords =
                  /(team|about|contact|leadership|people|founders?|company|who-we-are)/i;
                for (const l of links) {
                  if (typeof l === "string" && keywords.test(l)) {
                    pickedUrls.add(l);
                    if (pickedUrls.size >= 6) break;
                  }
                }
              } catch {
                // proceed with homepage only
              }

              const roleRegex =
                /\b(ceo|chief executive officer|founder|co-?founder|cto|chief technology officer|coo|chief operating officer|head of engineering|vp engineering)\b/i;
              const emailRegex =
                /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

              type Contact = {
                email: string;
                name?: string;
                role?: string;
                source: string;
                rank: number;
              };
              const contacts = new Map<string, Contact>();

              const rankFor = (role?: string) => {
                if (!role) return 5;
                const r = role.toLowerCase();
                if (/(ceo|chief executive|^founder|co-?founder)/.test(r)) return 1;
                if (/(cto|chief technology)/.test(r)) return 2;
                if (/(coo|chief operating)/.test(r)) return 3;
                if (/(head of engineering|vp engineering)/.test(r)) return 4;
                return 5;
              };

              for (const url of pickedUrls) {
                try {
                  const data = await firecrawlScrape(url);
                  const md: string =
                    data?.data?.markdown ?? data?.markdown ?? "";
                  if (!md) continue;
                  const emails = md.match(emailRegex) ?? [];
                  for (const rawEmail of emails) {
                    const email = rawEmail.toLowerCase();
                    if (/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(email)) continue;
                    if (
                      /(sentry|wixpress|example\.com|noreply|no-reply)/i.test(
                        email,
                      )
                    )
                      continue;
                    const emailDomain = email.split("@")[1] ?? "";
                    // prefer same-domain emails but keep others as fallback
                    const idx = md.toLowerCase().indexOf(email);
                    const window = md.slice(
                      Math.max(0, idx - 200),
                      idx + 200,
                    );
                    const roleMatch = window.match(roleRegex);
                    const role = roleMatch?.[0];
                    const rank =
                      rankFor(role) +
                      (emailDomain.endsWith(rootDomain) ? 0 : 0.5);
                    const existing = contacts.get(email);
                    if (!existing || rank < existing.rank) {
                      contacts.set(email, {
                        email,
                        role,
                        source: url,
                        rank,
                      });
                    }
                  }
                } catch {
                  // skip page
                }
              }

              const ranked = [...contacts.values()]
                .sort((a, b) => a.rank - b.rank)
                .slice(0, 10)
                .map(({ rank: _r, ...c }) => c);

              return {
                companyName,
                domain: rootDomain,
                pagesScanned: [...pickedUrls],
                contacts: ranked,
                primaryContact: ranked.find((c) => c.role) ?? ranked[0],
                note:
                  ranked.length === 0
                    ? "No executive emails found on public pages. Call find_linkedin_profiles next to source a LinkedIn URL for the CEO/Founder/CTO instead."
                    : undefined,
              };
            },
          }),
          find_linkedin_profiles: tool({
            description:
              "Fallback when no executive email can be found. Uses Firecrawl web search to locate LinkedIn profile URLs for a company's CEO, Founder, CTO or COO. Returns LinkedIn profile links the user can open and message directly.",
            inputSchema: z.object({
              companyName: z.string().describe("Exact company name"),
              domain: z.string().optional().describe("Company domain, helps disambiguate"),
              roles: z
                .array(z.string())
                .optional()
                .describe("Roles to target. Defaults to CEO, Founder, CTO, COO."),
              limit: z.number().min(1).max(15).default(8),
            }),
            execute: async ({ companyName, domain, roles, limit }) => {
              const targetRoles = roles?.length
                ? roles
                : ["CEO", "Founder", "Co-Founder", "CTO", "COO"];
              const rolesClause = targetRoles
                .map((r) => `"${r}"`)
                .join(" OR ");
              const query = `site:linkedin.com/in (${rolesClause}) "${companyName}"${domain ? ` ${domain}` : ""}`;
              try {
                const data = await firecrawlSearch(query, limit);
                const web: SearchHit[] =
                  (data?.data?.web as SearchHit[]) ??
                  (data?.web as SearchHit[]) ??
                  (data?.data as SearchHit[]) ??
                  [];
                const profiles = web
                  .filter((r) => r.url?.includes("linkedin.com/in/"))
                  .slice(0, limit)
                  .map((r) => {
                    const title = r.title ?? "";
                    // Title often "Name - Role - Company | LinkedIn"
                    const [namePart, rolePart] = title.split(/\s[-–|]\s/);
                    return {
                      name: namePart?.trim(),
                      headline: rolePart?.trim(),
                      url: r.url,
                      snippet: r.description,
                    };
                  });
                return {
                  companyName,
                  query,
                  count: profiles.length,
                  profiles,
                  note:
                    profiles.length === 0
                      ? "No LinkedIn profiles found via search. Tell the user no contact path was found."
                      : "Share these LinkedIn URLs with the user as the manual outreach path since no email was discovered.",
                };
              } catch (e) {
                return { companyName, error: (e as Error).message, profiles: [] };
              }
            },
          }),
          hunter_domain_search: tool({
            description:
              "Hunter.io domain search. Returns all known emails for a company domain with role/seniority/department metadata. Great for finding HR/People/Talent contacts at 51–200 companies (filter department='hr') or executives (seniority='executive'). Use as a primary lead source alongside Apollo.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. 'acme.com'"),
              limit: z.number().min(1).max(100).default(20),
              seniority: z
                .enum(["junior", "senior", "executive"])
                .optional(),
              department: z
                .enum([
                  "executive",
                  "it",
                  "finance",
                  "management",
                  "sales",
                  "legal",
                  "support",
                  "hr",
                  "marketing",
                  "communication",
                  "education",
                  "design",
                  "health",
                  "operations",
                ])
                .optional(),
              type: z.enum(["personal", "generic"]).optional(),
            }),
            execute: async (input) => {
              try {
                return await hunterDomainSearch(input);
              } catch (e) {
                return { domain: input.domain, error: (e as Error).message, emails: [] };
              }
            },
          }),
          hunter_email_finder: tool({
            description:
              "Hunter.io email finder. Given a person's first/last name and company domain, returns their most-likely email with a confidence score. Use when you already know a target person at a company.",
            inputSchema: z.object({
              domain: z.string(),
              firstName: z.string(),
              lastName: z.string(),
            }),
            execute: async (input) => {
              try {
                return await hunterEmailFinder(input);
              } catch (e) {
                return { ...input, error: (e as Error).message };
              }
            },
          }),
          prospeo_email_finder: tool({
            description:
              "Prospeo email finder. Given first/last name + company domain (or company name), returns verified work email. Use after Hunter fails.",
            inputSchema: z.object({
              firstName: z.string(),
              lastName: z.string(),
              domain: z.string().optional(),
              company: z.string().optional(),
            }),
            execute: async (input) => {
              try { return await prospeoEmailFinder(input); }
              catch (e) { return { ...input, error: (e as Error).message }; }
            },
          }),
          prospeo_domain_search: tool({
            description: "Prospeo domain search — list emails associated with a company domain.",
            inputSchema: z.object({
              domain: z.string(),
              limit: z.number().min(1).max(100).default(20),
            }),
            execute: async (input) => {
              try { return await prospeoDomainSearch(input); }
              catch (e) { return { domain: input.domain, error: (e as Error).message, emails: [] }; }
            },
          }),
          pdl_person_enrich: tool({
            description:
              "People Data Labs person enrichment. Best when you have a name + company domain OR a LinkedIn profile URL. Returns verified work email, title, LinkedIn. Use after Prospeo fails.",
            inputSchema: z.object({
              firstName: z.string().optional(),
              lastName: z.string().optional(),
              fullName: z.string().optional(),
              domain: z.string().optional(),
              company: z.string().optional(),
              profile: z.string().optional().describe("LinkedIn profile URL if known"),
              minLikelihood: z.number().min(1).max(10).optional(),
            }),
            execute: async (input) => {
              try { return await pdlPersonEnrich(input); }
              catch (e) { return { ...input, error: (e as Error).message }; }
            },
          }),
          pdl_person_search: tool({
            description:
              "People Data Labs person search — find executives/HR at a company by domain + titles.",
            inputSchema: z.object({
              domain: z.string(),
              titles: z.array(z.string()).optional(),
              size: z.number().min(1).max(100).optional(),
            }),
            execute: async (input) => {
              try { return await pdlPersonSearch(input); }
              catch (e) { return { domain: input.domain, error: (e as Error).message, people: [] }; }
            },
          }),
          tomba_domain_search: tool({
            description:
              "Tomba.io domain search. Returns emails for a company domain, with department/seniority filters. Use after PDL fails.",
            inputSchema: z.object({
              domain: z.string(),
              limit: z.number().min(1).max(100).default(20),
              department: z.string().optional(),
              seniority: z.string().optional(),
            }),
            execute: async (input) => {
              try { return await tombaDomainSearch(input); }
              catch (e) { return { domain: input.domain, error: (e as Error).message, emails: [] }; }
            },
          }),
          tomba_email_finder: tool({
            description: "Tomba.io email finder — first/last name + domain → email.",
            inputSchema: z.object({
              domain: z.string(),
              firstName: z.string(),
              lastName: z.string(),
            }),
            execute: async (input) => {
              try { return await tombaEmailFinder(input); }
              catch (e) { return { ...input, error: (e as Error).message }; }
            },
          }),
          ai_source_emails: tool({
            description:
              "Source executive emails using Claude Opus on AWS Bedrock as a reasoning step. Use ONLY when Apollo + Hunter have both failed. It scrapes team/about/contact pages and asks the model to extract any emails present and infer the most likely email pattern (e.g. first.last@domain). Returns extracted emails plus inferred-pattern guesses with confidence.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. acme.com"),
              companyName: z.string().optional(),
              targetRoles: z
                .array(z.string())
                .optional()
                .describe("Roles to target, default CEO/Founder/CTO/COO/Head of People"),
            }),
            execute: async ({ domain, companyName, targetRoles }) => {
              const opus = getBedrockOpusModel();
              if (!opus) {
                return {
                  error:
                    "Bedrock not configured (BEDROCK_API_KEY missing). Skip ai_source_emails and go straight to find_linkedin_profiles.",
                };
              }
              const homepage = /^https?:\/\//i.test(domain)
                ? domain
                : `https://${domain.replace(/^\/+/, "")}`;
              const rootDomain = new URL(homepage).hostname.replace(/^www\./, "");
              const picked = new Set<string>([homepage]);
              try {
                const mapRes = await firecrawlMap(homepage, {
                  search: "team about contact leadership founders people careers",
                  limit: 30,
                });
                const links: string[] =
                  mapRes?.links ?? mapRes?.data?.links ?? [];
                const kw =
                  /(team|about|contact|leadership|people|founders?|company|who-we-are|press)/i;
                for (const l of links) {
                  if (typeof l === "string" && kw.test(l)) {
                    picked.add(l);
                    if (picked.size >= 5) break;
                  }
                }
              } catch {
                /* homepage only */
              }
              const chunks: string[] = [];
              for (const u of picked) {
                try {
                  const data = await firecrawlScrape(u);
                  const md: string =
                    data?.data?.markdown ?? data?.markdown ?? "";
                  if (md) chunks.push(`--- ${u} ---\n${md.slice(0, 4000)}`);
                } catch {
                  /* skip */
                }
              }
              const roles =
                targetRoles?.length
                  ? targetRoles
                  : ["CEO", "Founder", "Co-Founder", "CTO", "COO", "Head of People"];
              const prompt = `You are an email-sourcing assistant. Company: ${companyName ?? rootDomain} (${rootDomain}).
Target roles: ${roles.join(", ")}.

From the scraped pages below, do TWO things:
1. EXTRACT every real email address you can find (only @${rootDomain} emails, ignore image filenames, noreply, sentry, wixpress, example.com).
2. INFER the most-likely email pattern for this company (e.g. "first.last@${rootDomain}", "f.last@${rootDomain}", "first@${rootDomain}"). Pick ONE best pattern based on any visible emails.

Then for each target role, if you spotted a real person name on the pages with that role, output the inferred email by applying the pattern. Mark each as "extracted" (literally found) or "inferred" (pattern-derived) with confidence 0-1.

Return ONLY JSON (no prose, no fences) with shape:
{ "pattern": "first.last@${rootDomain}" | null, "contacts": [{ "name"?, "role"?, "email", "source": "extracted" | "inferred", "confidence": number }] }

SCRAPED PAGES:
${chunks.join("\n\n").slice(0, 18000)}`;
              try {
                const { text } = await generateText({
                  model: opus,
                  prompt,
                  maxOutputTokens: 1200,
                });
                let parsed: { pattern?: string | null; contacts?: unknown[] } = {};
                try {
                  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
                  parsed = JSON.parse(json);
                } catch {
                  parsed = {};
                }
                return {
                  companyName,
                  domain: rootDomain,
                  pagesScanned: [...picked],
                  pattern: parsed.pattern ?? null,
                  contacts: parsed.contacts ?? [],
                  raw: parsed.contacts ? undefined : text.slice(0, 800),
                  note:
                    (parsed.contacts as unknown[] | undefined)?.length
                      ? undefined
                      : "Opus could not derive contacts. Fall back to find_linkedin_profiles.",
                };
              } catch (e) {
                return {
                  companyName,
                  domain: rootDomain,
                  error: (e as Error).message,
                  contacts: [],
                };
              }
            },
          }),
          draft_pitch: tool({
            description:
              "Draft a personalized cold outreach pitch for Vaultio targeted at a SPECIFIC person at a specific company. REQUIRES research fields — do NOT call this until you have scraped the company site AND the recipient's LinkedIn/about page.",
            inputSchema: z.object({
              companyName: z.string(),
              recipientName: z.string().describe("Named person (no role-based inboxes)"),
              recipientRole: z.string(),
              whatTheyDo: z.string().describe("Specific — what the company actually builds, for whom"),
              vertical: z.string().describe("Industry/vertical, e.g. fintech, devtools, healthtech, agency, marketplace"),
              hiringRoles: z.array(z.string()).min(1),
              stage: z.string().optional(),
              size: z.string().optional(),
              recipientResearch: z
                .string()
                .min(20)
                .describe("Concrete fact about the recipient from their LinkedIn/about page: recent post, prior company, tenure, shipped project. Used in the opener."),
              companyResearch: z
                .string()
                .min(20)
                .describe("Concrete fact about the company from their site: recent launch, product specific, customer segment, JD detail. Used to tailor positioning."),
              industryPain: z
                .string()
                .min(10)
                .describe("Specific hiring pain for THIS vertical (not generic). E.g. 'fintech roles need compliance-vetted engineers'."),
              angle: z.string().optional().describe("Optional hook to emphasize"),
            }),
            execute: async (input) => {
              return {
                ...input,
                instruction:
                  "Write a 5–7 sentence email. Subject line first (<60 chars, references recipientResearch or companyResearch). Opener (sentence 1–2) MUST cite recipientResearch or companyResearch — no generic 'Saw [Company] is hiring'. Value paragraph maps Vaultio to industryPain for this vertical. End with a soft 5-min ask. Sign as Emmanuel, Founder of Vaultio. Every email must be unique to this recipient.",
              };
            },
          }),
          send_pitch: tool({
            description:
              "Send a SINGLE pitch email via Resend. From: nuel@founder.vaultio.tech. Reply-To: nuel@vaultio.tech. Use bulk_send_pitch for multiple recipients.",
            inputSchema: z.object({
              to: z.string().email().describe("Recipient email address"),
              subject: z.string().min(1).max(200),
              body: z
                .string()
                .min(1)
                .describe("Plain-text email body. Line breaks preserved."),
              companyName: z.string().optional(),
            }),
            execute: async ({ to, subject, body, companyName }) => {
              return sendPitchEmail({ to, subject, body, companyName });
            },
          }),
          bulk_send_pitch: tool({
            description:
              "Send pitches to MULTIPLE recipients in one call. Rate-limits to ~1 email per 1.2s (Resend safe), dedupes against emails already sent in this server session, and returns a summary {sent, skippedDuplicates, failed}. Each recipient gets their own subject + body so you can personalize.",
            inputSchema: z.object({
              recipients: z
                .array(
                  z.object({
                    to: z.string().email(),
                    subject: z.string().min(1).max(200),
                    body: z.string().min(1),
                    companyName: z.string().optional(),
                  }),
                )
                .min(1)
                .max(50),
              delayMs: z
                .number()
                .min(500)
                .max(10000)
                .default(1200)
                .describe("Delay between sends in ms (default 1200)"),
            }),
            execute: async ({ recipients, delayMs }) => {
              const sent: Array<{ to: string; subject: string; resendId?: string; companyName?: string }> = [];
              const skippedDuplicates: string[] = [];
              const skippedInBatch: string[] = [];
              const failed: Array<{ to: string; error: string }> = [];
              const seenInBatch = new Set<string>();

              for (let i = 0; i < recipients.length; i++) {
                const r = recipients[i];
                const email = r.to.toLowerCase().trim();
                if (seenInBatch.has(email)) {
                  skippedInBatch.push(email);
                  continue;
                }
                seenInBatch.add(email);
                if (sentEmailsThisSession.has(email)) {
                  skippedDuplicates.push(email);
                  continue;
                }
                if (i > 0) await new Promise((res) => setTimeout(res, delayMs));
                const result = await sendPitchEmail({
                  to: r.to,
                  subject: r.subject,
                  body: r.body,
                  companyName: r.companyName,
                });
                if (result.sent) {
                  sentEmailsThisSession.add(email);
                  sent.push({
                    to: r.to,
                    subject: r.subject,
                    companyName: r.companyName,
                    resendId: result.resendId,
                  });
                } else {
                  failed.push({ to: r.to, error: result.error ?? "unknown error" });
                }
              }
              return {
                total: recipients.length,
                sentCount: sent.length,
                skippedDuplicatesCount: skippedDuplicates.length + skippedInBatch.length,
                failedCount: failed.length,
                sent,
                skippedDuplicates: [...skippedDuplicates, ...skippedInBatch],
                failed,
                rateLimitMs: delayMs,
              };
            },
          }),
        };

        const model = withFallback(
          gateway("google/gemini-3-flash-preview"),
          getBedrockModel(),
        );

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});
