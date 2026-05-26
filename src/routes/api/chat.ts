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

const SOURCE_DOMAINS: Record<string, string> = {
  wellfound: "wellfound.com",
  f6s: "f6s.com",
  yc: "workatastartup.com",
  linkedin: "linkedin.com/jobs",
};

const SYSTEM_PROMPT = `You are Vaultio Scout, an AI sales-development agent for Nuel at Vaultio.

Your job: find early-stage startups (seed to Series A, 1–50 employees) that are ACTIVELY HIRING, draft personalized pitches, and send them via email.

Sender identity: emails are sent FROM nuel@founder.vaultio.tech (Nuel, Founder of Vaultio). Replies route to nuel@vaultio.tech so Nuel replies from his personal inbox and the convo continues there. Write pitches in first person AS Nuel the founder — warm, direct, no marketing fluff.

VAULTIO (default pitch context — the user can override this in their messages):
Vaultio is a secrets and credentials management platform built for fast-moving early-stage startups. It replaces messy .env files and shared 1Password vaults with a developer-friendly vault that syncs secrets across local dev, CI, and production. Devs get instant access on day one, founders get audit logs and SOC2-ready access controls without buying enterprise-priced HashiCorp Vault.

How to work:
1. When the user asks for leads, call \`search_startups\` against the appropriate source(s) (wellfound, f6s, yc, linkedin).
2. For promising hits, call \`scrape_company\` to enrich (stage, size, hiring focus).
3. Filter ruthlessly: only return companies that are clearly seed–Series A and look like 1–50 people.
4. Present results as a numbered list with: company name, what they do (1 line), stage/size, roles they're hiring, source URL.
5. BEFORE drafting any pitch, AUTOMATICALLY call \`find_executive_contacts\` with the company's primary domain to extract CEO / Founder / CTO / COO emails from their team, about, and contact pages. Do this without asking — it's a required step.
6. Then call \`draft_pitch\` to compose subject + body, addressing the highest-ranking exec you found (CEO/Founder first, then CTO, then COO). Show the draft + the recipient email to the user for approval unless they explicitly said "send it".
7. When the user approves (or says "send"), call \`send_pitch\` with the recipient email, subject, and body. Emails go out via Resend from Vaultio with reply-to set to nuel@vaultio.tech — any reply lands directly in Nuel's inbox and the conversation continues from there.
8. NEVER call \`send_pitch\` without a recipient email. If \`find_executive_contacts\` returned nothing usable, tell the user and ask for an email.

Be concise. Use markdown. Never invent companies, URLs, or email addresses — only report what tools returned or what the user provided.`;

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
                const html = body
                  .split(/\n\n+/)
                  .map(
                    (p) =>
                      `<p style="margin:0 0 12px;line-height:1.5;">${p
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/\n/g, "<br/>")}</p>`,
                  )
                  .join("");
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
