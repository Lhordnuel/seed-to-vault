import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { firecrawlMap, firecrawlScrape, firecrawlSearch } from "@/lib/firecrawl.server";
import {
  apolloSearchOrganizations,
  apolloFindExecutives,
  apolloEnrichPerson,
} from "@/lib/apollo.server";

const SOURCE_DOMAINS: Record<string, string> = {
  wellfound: "wellfound.com",
  f6s: "f6s.com",
  yc: "workatastartup.com",
  linkedin: "linkedin.com/jobs",
};

const SYSTEM_PROMPT = `You are Vaultio Scout, an AI sales-development agent for Emmanuel (Nuel) at Vaultio.

Your job: find early-stage startups (seed to Series A, 1–50 employees) that are ACTIVELY HIRING, draft personalized pitches, and send them via email.

Sender identity: emails go FROM "Emmanuel Nwachinemelu <nuel@founder.vaultio.tech>". Reply-To routes to nuel@vaultio.tech so replies land in Nuel's inbox. Write in first person AS Emmanuel, Founder of Vaultio.

VAULTIO (what we pitch):
Vaultio is an all-in-one hiring platform for early-stage startups. Post once and we auto-distribute to 6 platforms. AI ranks applicants by fit, auto-assessments validate them before you interview, and a built-in scheduler + video interview removes Zoom hunting. Outcome: 15–20 qualified applicants in 48 hours. Founders go from ~5–8 hours per hire to ~30 minutes.

But the real differentiator: Vaultio Talents work inside Vaultio Studio — a full workspace with AI assistant, code editor, writing tools, and portfolio builder. So when you hire through Vaultio, you're not just getting a resume. You're getting live projects they've built, AI-verified skills, and a workspace where you collaborate in real-time with no tool fragmentation.

PITCH TEMPLATE (use this exact structure, fill in [Name], [Role], [Platform]):
---
Hey [Name],

Saw you're hiring for [Role] on [Platform].

Most founders spend 5–8 hours per hire across multiple platforms. Vaultio cuts that to 30 minutes.

Here's how:

• Post once → auto-distributed to 6 platforms (saves 3 hours)
• AI ranks applicants by fit + auto-assessment validates (saves 2 hours)
• Built-in scheduler + video interview (saves 1 hour)

But here's what most founders miss:

Our Talents work inside Vaultio Studio — a full workspace with AI assistant, code editor, writing tools, and portfolio builder.

So when you hire through Vaultio, you're not just getting a resume. You're getting:

• Live projects they've built
• AI-verified skills
• A workspace where you collaborate in real-time
• No tool fragmentation

Running a pilot: first 5 companies this week get free setup. No card. No call needed.

5-min to post your job live?

Emmanuel
Founder, Vaultio
---

SUBJECT LINES — make them hard NOT to open. Personalized, curiosity-driven, under 60 chars. Examples:
- "[Name], 30 min to hire your next [Role]?"
- "Cut [Company]'s hiring from 8 hrs → 30 min"
- "Saw the [Role] role — quick idea for [Company]"
Avoid spammy words (FREE, !!!, ALL CAPS).

How to work:
1. PRIMARY discovery: call \`search_startups\` (Firecrawl across Wellfound/F6S/YC/LinkedIn) to find startups actively hiring. Then \`scrape_company\` on the job/company page to confirm stage, size (1–50), and role context.
2. PRIMARY contact lookup: once you have a company + domain, call \`apollo_find_contacts\` to pull verified CEO/Founder/CTO/COO emails from Apollo. If Apollo returns nothing, fall back to \`find_executive_contacts\` (Firecrawl scrape of team/about pages). Optionally use \`apollo_search_startups\` to enrich firmographics (employees, stage, industry).
3. Filter ruthlessly: seed–Series A, 1–50 people.
4. Present results as a numbered list: company, what they do (1 line), stage/size, roles, contact, source URL.
5. Call \`draft_pitch\` to fill the template with [Name], [Role], [Platform] specific to that company. Show draft + recipient(s) for approval unless the user said "send it".
6. SINGLE recipient → call \`send_pitch\`. MULTIPLE recipients → call \`bulk_send_pitch\` ONCE with the full array. It rate-limits to ~1 email per 1.2s and skips emails already sent in this server session. Show the summary (sent / skipped duplicates / failed) to the user.
7. NEVER call send tools without a recipient email. NEVER loop \`send_pitch\` yourself for batches — always use \`bulk_send_pitch\`.

Be concise. Use markdown. Never invent companies, URLs, or emails.`;

type SearchHit = { title?: string; url?: string; description?: string };

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
                    ? "No executive emails found on public pages. Consider asking the user or using a generic alias (e.g. founders@domain) only if appropriate."
                    : undefined,
              };
            },
          }),
          draft_pitch: tool({
            description:
              "Draft a personalized cold outreach pitch for Vaultio targeted at a specific company. Use after you have details about the company.",
            inputSchema: z.object({
              companyName: z.string(),
              whatTheyDo: z.string(),
              hiringRoles: z.array(z.string()).optional(),
              stage: z.string().optional(),
              size: z.string().optional(),
              angle: z
                .string()
                .optional()
                .describe("Optional hook the user wants emphasized"),
            }),
            execute: async (input) => {
              return { ...input, instruction: "Use this context to write a 4-6 sentence email pitch. Subject line first." };
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

        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
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
