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
Vaultio is an all-in-one hiring platform for early-stage startups. Post once and we auto-distribute to LinkedIn, Wellfound, F6S, and our talent pool. AI ranks applicants by fit, auto-assessments validate them before you interview, and a built-in scheduler + video interview removes Zoom hunting. Outcome: 15–20 qualified applicants in 48 hours. Founders go from ~5–8 hours per hire to ~30 minutes.

PITCH TEMPLATE (use this exact structure, fill in [Name], [Role], [Platform]):
---
Hey [Name],

Saw you're hiring for [Role] on [Platform].

Most founders spend 5–8 hours per hire posting on multiple sites, tracking applicants, scheduling interviews.

Vaultio cuts that to 30 minutes.

Here's how:

• Post once → auto-distributed to LinkedIn + Wellfound + F6S + our pool (saves 3 hours)
• AI ranks applicants by fit, auto-assessment validates before you interview (saves 2 hours)
• Built-in scheduler + video interview, no Zoom hunting (saves 1 hour)

Outcome: 15–20 qualified applicants in 48 hours.

Running a pilot: first 5 companies this week get free setup. No card required today.

10-min call to post your job live?

Emmanuel
Founder, Vaultio.tech
---

SUBJECT LINES — make them hard NOT to open. Personalized, curiosity-driven, under 60 chars. Examples:
- "[Name], 30 min to hire your next [Role]?"
- "Cut [Company]'s hiring from 8 hrs → 30 min"
- "Saw the [Role] role — quick idea for [Company]"
Avoid spammy words (FREE, !!!, ALL CAPS).

How to work:
1. PRIMARY discovery: call \`apollo_search_startups\` first — it returns structured seed–Series A companies (1–50 employees) with domain, stage, size, and industry directly from Apollo. Use \`search_startups\` (Wellfound/F6S/YC/LinkedIn via Firecrawl) only as a fallback or to verify they are actively hiring.
2. For job-context enrichment (the specific role + platform), call \`scrape_company\` on a job posting URL.
3. Filter ruthlessly: seed–Series A, 1–50 people.
4. Present results as a numbered list: company, what they do (1 line), stage/size, roles, source URL.
5. BEFORE any pitch, call \`apollo_find_contacts\` on the company domain as the PRIMARY source for CEO/Founder/CTO/COO emails. If Apollo returns no email, fall back to \`find_executive_contacts\` (Firecrawl scrape of team/about pages). Required step.
6. Call \`draft_pitch\` to fill the template with [Name], [Role], [Platform] specific to that company. Show draft + recipient for approval unless the user said "send it".
7. On approval, call \`send_pitch\`. The HTML rendering automatically embeds the Vaultio logo header — pass plain-text body only.
8. NEVER call \`send_pitch\` without a recipient email.

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
              "Send a pitch email via Resend. From: nuel@founder.vaultio.tech (Nuel, Founder of Vaultio). Reply-To: nuel@vaultio.tech so replies go to Nuel's inbox. Only call after the user approves the draft (or explicitly says send).",
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
              const resendKey = process.env.RESEND_API_KEY;
              const lovableKey = process.env.LOVABLE_API_KEY;
              if (!resendKey || !lovableKey) {
                return { error: "Email service not configured." };
              }
              try {
                const paragraphs = body
                  .split(/\n\n+/)
                  .map(
                    (p) =>
                      `<p style="margin:0 0 14px;line-height:1.6;color:#1a1a1a;font-size:15px;">${p
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/\n/g, "<br/>")}</p>`,
                  )
                  .join("");
                const logoUrl = "https://seed-to-vault.lovable.app/vaultio-logo.png";
                const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:24px 32px 8px;">
          <img src="${logoUrl}" alt="Vaultio" width="56" height="56" style="display:block;border:0;border-radius:12px;" />
        </td></tr>
        <tr><td style="padding:8px 32px 28px;">
          ${paragraphs}
        </td></tr>
        <tr><td style="padding:0 32px 24px;border-top:1px solid #eef0f3;">
          <p style="margin:16px 0 0;font-size:12px;color:#7b8290;line-height:1.5;">
            Vaultio · Hiring infrastructure for early-stage startups<br/>
            <a href="https://vaultio.tech" style="color:#2563eb;text-decoration:none;">vaultio.tech</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
                const res = await fetch(
                  "https://connector-gateway.lovable.dev/resend/emails",
                  {
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
                  },
                );
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  return {
                    error: `Resend ${res.status}: ${JSON.stringify(data)}`,
                  };
                }
                return {
                  sent: true,
                  to,
                  subject,
                  companyName,
                  replyTo: "nuel@vaultio.tech",
                  resendId: data?.id,
                };
              } catch (e) {
                return { error: (e as Error).message };
              }
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
