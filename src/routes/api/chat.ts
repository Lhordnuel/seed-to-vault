import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  generateText,
  hasToolCall,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getMetaAIModel } from "@/lib/meta-ai.server";
import { sendResendEmail } from "@/lib/resend.server";

import { firecrawlMap, firecrawlScrape, firecrawlSearch } from "@/lib/firecrawl.server";
import {
  apolloSearchOrganizations,
  apolloFindExecutives,
  apolloEnrichPerson,
  apolloBulkEnrichPeople,
  isUsableApolloEmail,
} from "@/lib/apollo.server";
import { lushaCompanyEmployees, lushaPersonEnrich } from "@/lib/lusha.server";
import { fullenrichBulkEnrich, fullenrichPersonEnrich } from "@/lib/fullenrich.server";
import { hunterDomainSearch, hunterEmailFinder } from "@/lib/hunter.server";
import { prospeoDomainSearch, prospeoEmailFinder } from "@/lib/prospeo.server";
import { pdlPersonEnrich, pdlPersonSearch } from "@/lib/pdl.server";
import { tombaDomainSearch, tombaEmailFinder } from "@/lib/tomba.server";
import {
  CONTACT_SOURCE_PROVIDERS,
  isContactOptedOut,
  saveSourcedContacts,
} from "@/lib/sourced-records.server";
import { hasValidAccessSession } from "@/lib/access-session.server";
import { rankScoutingCompanies } from "@/lib/scouting-rank";

// CC configuration — toggle CC'ing nuel@vaultio.tech per environment or per call.
// Env var CC_NUEL_ENABLED ("true"/"false", default "true") controls the default.
// Each email tool also accepts a per-call `ccNuel` boolean to override per campaign.
const CC_NUEL_ADDRESS = "nuel@vaultio.tech";
function ccNuelDefault(): boolean {
  const v = (process.env.CC_NUEL_ENABLED ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "no" && v !== "off";
}
function resolveCcList(ccNuel: boolean | undefined, extra?: string[]): string[] {
  const enabled = ccNuel ?? ccNuelDefault();
  const list = extra ? [...extra] : [];
  if (enabled && !list.some((e) => e.toLowerCase() === CC_NUEL_ADDRESS)) {
    list.push(CC_NUEL_ADDRESS);
  }
  return list;
}

const SOURCE_DOMAINS: Record<string, string> = {
  wellfound: "wellfound.com",
  f6s: "f6s.com",
  yc: "workatastartup.com",
  linkedin: "linkedin.com/jobs",
};

const WORKFLOW_PHASE_SCHEMA = z.enum(["discover", "contacts", "draft", "send"]);
type WorkflowPhase = z.infer<typeof WORKFLOW_PHASE_SCHEMA>;

const SYSTEM_PROMPT = `You are Startup Scout, an AI sales-development agent for Emmanuel (Nuel) at Vaultio.

Your job: scout and rank startups against the ICP below, then let Nuel choose companies and named contacts before drafting any outreach.

Sender identity: emails go FROM "Emmanuel Nwachinemelu <nuel@nf.vaultio.site>". Reply-To routes to nuel@vaultio.tech. Write in first person AS Emmanuel, Founder of Vaultio.

VAULTIO (what we pitch):
Vaultio is verification infrastructure for hiring — not a recruiter or job board. We verify a person's actual skill before a hiring team spends time interviewing them.
How: we generate a unique assessment from that candidate's own CV plus your job req, so they're tested against their own claims — no generic question bank, nothing they can pre-game. You get scored proof of ability, ranked, before the first call.
Who uses it: startups screening applicants. It's infrastructure they run their hiring on, not another tool to manage.
The feeling we sell: confidence and speed — you stop guessing, you stop burning interview hours, and you move on the right person in days instead of weeks. 20-minute setup, works from a phone, nothing to install.


================================================================
ICP — IDEAL CUSTOMER PROFILE (use this to qualify every company):

- Stage: Seed through Series B, inclusive.
- Team size: 15–80 employees, inclusive.
- Hiring: at least one verifiable live opening for software/engineering, AI/ML, data, product, or marketing.
- Hiring model: remote or distributed team hiring.
- Company location priority: United States first, then Europe, then Africa, then Latin America. Remote roles should be open to distributed teams.
- Exclude HR technology, recruiting or staffing firms, agencies, outsourcing shops, and companies whose only relevant openings are design, analyst, or sales roles.
- Ignore junior, entry-level, graduate, and internship roles as qualifying signals. A single junior opening is not a reason to include a company.

Rank by hiring evidence, not by company fame, funding, or employee count:
1. Highest priority: at least three eligible live engineering openings.
2. Next: a founding, senior, staff, principal, or lead engineering opening posted more than 14 days ago.
3. Then: other qualifying live roles. Use geography only as a tie-breaker within the same hiring-signal rank.
- Count only non-junior live roles whose title and source URL are verified. Do not invent posting dates; if the date is unavailable, do not claim the role has been open for more than 14 days.
- Verify and include every eligible live opening found for each company so the three-engineering-role signal is counted accurately. Do not infer additional openings from snippets.
- Show the role title, posting age when verified, and its source link. Explicitly say when a fit field or signal could not be verified.


================================================================
AUDIENCE ROUTING: Always set audience="hiring" when sending. There are NO role-based templates (R1–R4 retired, Template A/B retired, long "Vaultio for Startups" pitch retired). Every pitch is written FRESH from the recipient's LinkedIn + a real live role at their company. Lead with the hiring pain, name one live role, pitch Vaultio as the solution.

================================================================
PRE-DRAFT SCAN (MANDATORY before every pitch):
Scrape the recipient's LinkedIn (use \`scrape_company\` on the profile URL, or \`find_linkedin_profiles\` first) AND the company careers/jobs page, then capture:
  • One specific personal signal — a recent post, hiring update, team growth note, product launch, or funding announcement
  • One LIVE role they're hiring for (exact title + location/remote scope) from LinkedIn jobs, careers page, or a public JD
  • Their tone — formal or casual

If you don't have BOTH a personal signal AND a real live role, do more research. Do not draft from generic assumptions.

================================================================
SELF-CHECK BEFORE YOU DRAFT (run these questions mentally on every single pitch — rewrite until all are YES):
  1. If I received this partnership email, would I actually reply? If it feels like a pitch blast, rewrite.
  2. Does this read AI-generated? Kill symmetrical phrasing, em-dash-heavy filler, buzzwords, "leverage/streamline/empower", and any sentence that could be sent to 100 people.
  3. Does this person NEED it? Tie it to a real cost they're paying right now (hours, bad hires, clients waiting).
  4. Could they survive without it? Show what stays broken if they do nothing.
  5. Does it sell confidence? They should feel certainty and proof, not risk.
  6. Is it mobile friendly? Short paragraphs (1–3 lines), no walls of text, no bullets, no buttons, scannable in 15 seconds on a phone.
  Sell a FEELING (relief, certainty), a SOLUTION (verified skill before the interview), and EASE + SPEED (20 minutes, no lift on their side).

================================================================
PITCH FRAMEWORK (use this shape EVERY time — no fixed template, write it fresh per recipient):

  Hi <FirstName>,

  [Open with the screening pain, tied to a specific live role/context you researched: AI-polished CVs that look perfect on paper, then hours of interviews to find out the person can't actually do the work. Make it feel like you're describing THEIR week, not a market trend.]

  [Vaultio fix — Vaultio verifies a candidate's skill BEFORE anyone gets on a call. We generate a unique assessment from that candidate's own CV plus their job req, so people are tested against their own claims. They walk into interviews already knowing who can do the work.]

  [Ease + speed line — it runs on their existing flow, nothing to install, 20-minute setup, and they see scored candidates on the first role. Include the pilot when it fits: "I'm onboarding a handful of <segment> teams personally — free credits, no contract."]

  Worth a brief call this week?

  Emmanuel

EXAMPLE (shape only — NEVER reuse this wording):
---
Hi Alexis,

Your Senior Backend role has been open a while, and I'd guess the shortlist all reads the same — polished CVs, right keywords, and you still can't tell who can actually ship until someone's already spent an hour on a call with them.

Vaultio verifies that before the call. We build an assessment from each candidate's own CV and your job req, so they're tested against their own claims — you see scored proof of who can do the work, then interview only those people.

Nothing to install, 20 minutes to set up on one role. I'm onboarding a few seed-stage teams personally right now — free credits, no contract.

Worth a brief call this week?

Emmanuel
---

HARD RULES (enforce in EVERY draft):
- Lead with the AI-polished-CV / wasted-interview-hours pain BEFORE naming Vaultio, grounded in their live role and context. "Saw you're hiring" alone is BANNED.
- Position Vaultio as VERIFICATION INFRASTRUCTURE: we verify talent's skill before they hop on an interview. Never "recruiter", "job board", or "another tool".
- The assessment must be described as generated from the candidate's own CV + the job req (tested against their own claims), never a generic question bank.
- Always convey ease + speed: 20-minute setup, no install, no work on their side, results on the first role.
- Include the pilot offer (free credits, no contract) when it fits the recipient's segment.
- CTA must be: "Worth a brief call this week?"
- Sign off "Emmanuel" — do NOT use the old "No call." line or "— Nuel".
- Mobile-first: 4 short paragraphs max, each 1–3 lines, plain language, no bullet lists, no buttons, no headers.
- Leave crypto / USDT / payment-rail specifics OUT unless the recipient asks.
- Never pitch without a verified live role.


CHANNEL / TONE ADJUSTMENTS:
- Subject lines (email): simple and personal — "Quick idea for your [Role] hire" · "[Company] hiring — one thought" · "[Name], saw your [specific thing]".
- LinkedIn DM: cut the opener preamble, jump straight to pain → Vaultio fix → pilot → "Worth a brief call this week?"
- Formal/corporate recipient (enterprise, bank, consulting background): keep tone crisp, no slang.



================================================================
ROLE-FAMILY VARIANTS (auto-select based on the live role's title):
Every pitch is still written FRESH per recipient, but the hard-deliverables + pain-language MUST match the role family below. Detect the family from the exact job title on the JD/careers page. If a title spans two families (e.g. "Product Marketing Manager, RevOps"), pick the dominant one and mention the secondary in the deliverables line. If none fit, fall back to GENERIC.

- REVOPS / SALES OPS  (titles: RevOps, Revenue Operations, Sales Ops, GTM Ops, Deal Desk)
  Hard deliverables to name: CRM architecture (HubSpot/Salesforce parent-child, custom objects), pipeline hygiene + forecasting, quote-to-cash / CPQ, territory + comp plans, GTM stack integration (Outreach/Gong/Clay).
  Pain angle: "looks great on paper, can't actually rebuild a broken pipeline in HubSpot."
  Vaultio fix framing: assessments that make candidates ACTUALLY model a pipeline / fix a broken CRM / write the SQL, not answer trivia.

- MARKETING OPS  (titles: Marketing Ops, MOps, Lifecycle Ops, Growth Ops)
  Hard deliverables: Marketo/HubSpot workflows, lead scoring + routing, attribution modelling, MQL→SQL handoff, campaign analytics.
  Pain angle: candidates who "know Marketo" but can't debug a broken routing rule or build a working scoring model.
  Vaultio fix framing: role-specific tests where they actually build the workflow / debug the routing.

- PRODUCT MARKETING  (titles: PMM, Product Marketing Manager, Director of Product Marketing)
  Hard deliverables: positioning + messaging for a specific ICP, launch narrative, sales enablement (decks/battlecards), competitive intel, pricing/packaging input.
  Pain angle: portfolios full of "positioning frameworks" but can't write a launch narrative for YOUR product in a day.
  Vaultio fix framing: assessments where candidates write actual positioning + a launch memo for a real product brief — you read the output, not the résumé.

- GROWTH / PERFORMANCE MARKETING  (titles: Growth Marketer, Head of Growth, Performance Marketing, Paid Acquisition)
  Hard deliverables: paid channels (Meta/Google/LinkedIn) with real CAC targets, lifecycle + retention loops, experimentation velocity, analytics (GA4/Amplitude).
  Pain angle: "scaled paid at [big co]" ≠ can build a working CAC-payback model from scratch at your stage.
  Vaultio fix framing: candidates run a scored growth exercise on your real funnel.

- CONTENT / SEO  (titles: Content Lead, SEO Lead, Head of Content)
  Hard deliverables: editorial strategy, technical SEO fundamentals, distribution, ghostwriting for founder voice.
  Pain angle: writers who send Notion docs of "strategy" but can't ship a publish-ready piece in your voice.
  Vaultio fix framing: timed writing + SEO brief exercise scored on the actual output.

- BACKEND / INFRA / PLATFORM  (titles: Backend Engineer, Backend Software Engineer, API Engineer, Platform Engineer, Infrastructure Engineer, DevOps Engineer, SRE, Site Reliability Engineer, Staff Backend Engineer)
  Hard deliverables: design APIs at scale, data model + query optimization, distributed systems, concurrency, observability, infra-as-code, CI/CD, security/performance trade-offs.
  Pain angle: LeetCode-strong candidates who can't design a schema that won't fall over at real load or debug a production incident under pressure.
  Vaultio fix framing: role-specific system-design + coding tasks on real API/data-model problems, scored on production thinking.

- FULL-STACK / GENERAL SOFTWARE  (titles: Software Engineer, Full-Stack Engineer, Full Stack Engineer, Software Developer, Full-Stack Developer, Web Engineer, Generalist Engineer)
  Hard deliverables: ship end-to-end features across the stack, connect frontend to backend, own a product surface, work inside an existing codebase.
  Pain angle: candidates who can answer framework trivia but can't ship a full feature from DB query to UI in a real codebase.
  Vaultio fix framing: end-to-end feature exercise using the company's actual stack, scored on shipped output.

- FRONTEND / PRODUCT UI  (titles: Frontend Engineer, Frontend Developer, UI Engineer, React Engineer, Vue Engineer, Senior Frontend Engineer, Frontend Software Engineer)
  Hard deliverables: complex UI interactions, performance, accessibility, state management, design-system adoption, component architecture, async data handling.
  Pain angle: portfolios full of pretty mockups that fall apart when wired to real data, loading states, and edge cases.
  Vaultio fix framing: frontend task on a real product surface from the company's app, scored on craft, performance, and robustness.

- ML / AI / DATA ENGINEERING  (titles: ML Engineer, Machine Learning Engineer, AI Engineer, Data Engineer, MLOps Engineer, Applied Scientist, Data Scientist, Applied ML Engineer)
  Hard deliverables: model serving pipelines, feature engineering, data pipelines, evaluation metrics, LLM/AI product integration, MLOps, cost/latency trade-offs.
  Pain angle: candidates with Kaggle medals or research papers who can't productionize a model, reason about latency/cost, or ship an AI feature behind a real API.
  Vaultio fix framing: scored ML/data task on a real company dataset or product use case, evaluated on production-readiness and business impact.

- MOBILE  (titles: iOS Engineer, Android Engineer, Mobile Engineer, React Native Engineer, Flutter Engineer, Mobile Software Engineer, Senior Mobile Engineer)
  Hard deliverables: ship native features, handle platform constraints, offline/sync, app performance, release cycles, mobile architecture patterns.
  Pain angle: candidates who know Swift/Kotlin syntax but can't reason through a real mobile architecture or ship a feature end-to-end in a live app.
  Vaultio fix framing: mobile feature exercise tied to the company's app, scored on architecture, UX, and shipping discipline.

- EMBEDDED / HARDWARE / LOW-LEVEL  (titles: Embedded Engineer, Firmware Engineer, Hardware Engineer, Systems Engineer, Low-Level Engineer, Embedded Software Engineer)
  Hard deliverables: bare-metal/RTOS firmware, hardware bring-up, C/C++ systems, real-time constraints, power/performance trade-offs, device-driver work.
  Pain angle: candidates who list Arduino/Raspberry Pi projects but can't debug a real timing issue or ship production firmware.
  Vaultio fix framing: role-specific embedded task on real hardware constraints, scored on systems thinking and debugging.

- PRODUCT MANAGEMENT  (titles: PM, Sr PM, Group PM, CPO, Head of Product)
  Hard deliverables: discovery + spec writing, prioritisation under constraints, data literacy (SQL/analytics), stakeholder management for the specific domain.
  Pain angle: PMs who "led at [big co]" but can't write a crisp PRD or make a real trade-off call under scope pressure.
  Vaultio fix framing: candidates run a scored product exercise on a real problem from your roadmap.

- DESIGN  (titles: Product Designer, Sr Designer, Design Lead, Head of Design)
  Hard deliverables: end-to-end flows for the specific product surface, interaction craft, systems thinking, cross-functional shipping.
  Pain angle: beautiful portfolios that fall apart when asked to design a real flow in your product under a deadline.
  Vaultio fix framing: timed design exercise on a real flow from your product, scored on craft + reasoning.

- SALES / AE / SDR  (titles: AE, Account Executive, SDR, BDR, Head of Sales)
  Hard deliverables: outbound motion for your specific ACV + ICP, discovery + demo skills, pipeline management, MEDDIC/command of the message.
  Pain angle: reps who quota-crushed at [big co] but can't run cold outbound into YOUR ICP.
  Vaultio fix framing: live/async discovery + cold-outreach exercise scored on your actual ICP.

- CUSTOMER SUCCESS / SUPPORT  (titles: CSM, CX Lead, Head of CS, Support Lead)
  Hard deliverables: onboarding + retention playbooks, technical depth for your product, expansion motion, tooling (Zendesk/Intercom/Gainsight).
  Pain angle: CSMs who "reduced churn" on a slide but can't run a real save-call for your product.
  Vaultio fix framing: scored role-play on a real churn scenario from your book.

- DATA / ANALYTICS  (titles: Data Analyst, Analytics Engineer, Data Scientist, Head of Data)
  Hard deliverables: SQL depth, modelling (dbt), warehouse (Snowflake/BigQuery), stakeholder-facing insight work.
  Pain angle: "senior data" candidates who can't write a working dbt model or a clean funnel query against your schema.
  Vaultio fix framing: timed SQL + modelling exercise on a sanitized slice of your warehouse.

- FINANCE / STRATEGY  (titles: Finance Lead, FP&A, CFO, Strategy/BizOps)
  Hard deliverables: 3-statement + operating model, board reporting, unit economics for your model, systems (NetSuite/Rippling).
  Pain angle: candidates from big-co finance who can't build an operating model for a Series A startup in a day.
  Vaultio fix framing: scored modelling exercise on a stripped-down version of your P&L.

- GENERIC (fallback only when no family fits)
  Hard deliverables: pull the top 2–3 responsibilities directly from the JD.
  Pain angle: "look qualified on paper but can't actually ship the specific work in this role."
  Vaultio fix framing: role-specific assessments so they only talk to candidates who've done that exact work.

Auto-selection rule: BEFORE calling \`draft_pitch\`, state one line — "Role family: <FAMILY> (title: <exact title>)" — then pull deliverables + pain from that family and weave them into the FRESH per-recipient body. Never send two recipients the same body even within the same family.



================================================================
PERSONALIZATION RULE (NON-NEGOTIABLE — applies to EVERY email):
Cold-pitch reply we received: "Focus on tailoring positioning to my business/industry/pains + have an element of personalisation that shows you researched me." Treat this as a hard rule.

Before drafting ANY pitch you MUST gather person- AND company-specific research:
- Scrape company site + recipient LinkedIn (\`scrape_company\` + \`find_linkedin_profiles\`).
- Scrape the company site (\`scrape_company\`) for what they ACTUALLY do, their ICP, recent product/launch, tone.
- Look up the recipient: scrape their LinkedIn/about page or use \`find_linkedin_profiles\` + \`scrape_company\` on the profile URL. Capture role tenure, prior company, a recent post/shipped project, or something they said publicly.
- Pull the specific hiring context: which role(s), where posted, what the JD emphasizes (stack, seniority, remote, urgency).
- Identify 1–2 industry-specific pains for their vertical (fintech ≠ devtools ≠ healthtech ≠ marketplace). Map Vaultio's value to THOSE pains, not generic "hiring is hard".

Every email MUST include, in the first 2 sentences, at least ONE concrete personal/company detail that proves research. Generic openers like "Saw [Company] is hiring" are BANNED unless paired with a researched specific in the same paragraph.

The PITCH FRAMEWORK above is the SHAPE — write the body fresh per recipient using the scanned personal signal and live role. Never send two recipients the same body. If you don't have enough research to personalize, do MORE research before drafting; do not fall back to a generic pitch.

SUBJECT LINES — hard NOT to open. Personalized to the person or a specific company detail, under 60 chars. No spammy words.
Examples: "[Name], saw your [specific thing]" · "[Company]'s [Role] hire — quick idea" · "[Vertical] hiring pain → role-specific tests"

How to work — user-controlled stages:
1. DISCOVER: search Apollo and public job sources, verify company stage, size, remote/distributed hiring, geography, and live eligible roles. Exclude poor fits. Call \`present_ranked_companies\` with verified evidence and stop. Do not search for contacts, enrich people, save contacts, or draft/send outreach in this stage. Ask Nuel to choose companies using the selection cards.
2. CONTACTS: only after Nuel selects companies using the selection cards, find relevant named decision-makers at those selected companies. Prioritize the hiring manager for a selected opening (engineering leader for engineering roles, product leader for product roles, marketing leader for marketing roles), then CTO/technical co-founder or the relevant function's executive. Call \`present_contact_options\` with each contact's actual source provider and source URL when known. Do not present or save inferred email guesses. This automatically saves the presented sourced contacts to Supabase before showing them; report any save failures shown in the tool result, then stop and wait for contact selection. Do not draft or send yet.
3. DRAFT: only after Nuel selects named contacts, research each selected person and company, then draft individualized messages. Show drafts for review. Never send during discovery, contact selection, or draft creation. Send only after a separate, explicit send instruction.
4. During the CONTACTS stage, use this lookup order and stop once there are enough sourced options to show:
   a. \`fullenrich_enrich_person\` (or \`fullenrich_bulk_enrich\` for multiple) — PRIMARY enrichment when you have a name + (domain OR LinkedIn URL). Best email accuracy; returns VALID/CATCHALL qualification. Always try this FIRST once you have a name.
   b. \`apollo_find_contacts\` — use when you have a domain but NO names yet. Discovers people by title; runs Bulk People Enrichment with reveal_personal_emails=true. NOTE: Apollo masks emails as 'email_not_unlocked@domain.com' when reveal credits are exhausted — the tool filters these out. If Apollo discovers names but no usable email, feed those names into \`fullenrich_bulk_enrich\`.
   c. \`apollo_search_startups\` for discovery only (not contact emails).
   d. \`lusha_find_contacts\` / \`lusha_enrich_person\` — fallback when FullEnrich + Apollo both fail.
   e. \`hunter_domain_search\` if Lusha fails. Use \`hunter_email_finder\` when you have a selected person's name + domain.
   f. \`prospeo_email_finder\` / \`prospeo_domain_search\` if Hunter fails.
   g. \`pdl_person_enrich\` / \`pdl_person_search\` (People Data Labs) if Prospeo fails — best when you have a name or LinkedIn URL.
   h. \`tomba_domain_search\` / \`tomba_email_finder\` if PDL fails.
   i. \`ai_source_emails\` (Meta Model API) if every provider above failed — scrapes site + reasons about likely patterns.
   j. \`find_linkedin_profiles\` (Firecrawl LinkedIn search) ONLY as the final fallback when no email exists anywhere. Surface the LinkedIn URLs so Nuel can DM manually.
5. RESEARCH PASS (MANDATORY before draft_pitch): after contact selection, for each recipient, run \`scrape_company\` on the company site AND on the recipient's LinkedIn/about page. Record 2–3 specific facts and the industry pain you'll lead with.
6. \`draft_pitch\` using the PITCH FRAMEWORK + the correct ROLE-FAMILY VARIANT. Draft only for contacts Nuel selected. Show drafts and wait for explicit approval before any send.

8. SINGLE → \`send_pitch\` (audience="hiring"). MULTIPLE → \`bulk_send_pitch\` ONCE (rate-limited, dedupes). Each body MUST be unique and personalized. These tools are available only after explicit approval in a separate message.

9. NEVER send without a recipient email. NEVER send to generic / role-based inboxes (info@, hello@, contact@, sales@, support@, admin@, jobs@, careers@, hr@, talent@, recruiting@, team@, etc.). Use only a named person's work email; otherwise fall back to LinkedIn.

10. NEVER loop \`send_pitch\` for batches. NEVER reuse the same body across recipients.

11. ANTI-REUSE ENFORCEMENT (server-side): the send tools reject any email whose subject, opening sentence, or 5-word body shingles overlap too much with a previously sent email this session. Keep the CORE Vaultio positioning consistent but vary per recipient: (a) different subject hook, (b) different opening sentence built from a different researched fact, (c) different body structure. If a send is rejected for reuse, rewrite those three elements and retry.

================================================================
GENERIC EMAILS (free-form, non-pitch):
When Nuel asks you to send a one-off email that isn't a hiring pitch (e.g. follow-up, intro reply, personal note, application, thank-you), use \`draft_generic_email\` FIRST to show him the full draft (to, subject, body, optional cc/replyTo). NEVER call \`send_generic_email\` until Nuel explicitly approves in a follow-up message with words like "send it", "approve", "yes send", "ship it", or "go ahead". If he asks for edits, re-draft and ask again. Generic emails skip the anti-reuse / generic-inbox / pitch-template checks and render in a clean plain-text layout. Default to cc'ing hello@vaultio.tech unless Nuel says otherwise.

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
const BODY_REUSE_LIMIT = 0.6; // jaccard over 5-word shingles
const OPENER_REUSE_LIMIT = 0.75; // jaccard over first-sentence tokens
const sentSubjectTokens: Set<string>[] = [];
const sentBodyShingles: Set<string>[] = [];
const sentOpenerTokens: Set<string>[] = [];

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s: string) {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((t) => t.length > 2),
  );
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
      return {
        ok: false,
        reason: `Subject too similar to a previously sent email (jaccard ≥ ${SUBJECT_REUSE_LIMIT}). Rewrite the subject with a different personalized hook.`,
      };
    }
  }
  for (const prev of sentOpenerTokens) {
    if (jaccard(oTok, prev) >= OPENER_REUSE_LIMIT) {
      return {
        ok: false,
        reason: `Opening sentence too similar to a previously sent email. Rewrite the first sentence around a different recipient-specific fact.`,
      };
    }
  }
  for (const prev of sentBodyShingles) {
    if (jaccard(bSh, prev) >= BODY_REUSE_LIMIT) {
      return {
        ok: false,
        reason: `Body too similar to a previously sent email (5-word shingle overlap ≥ ${BODY_REUSE_LIMIT}). Vary structure: reorder paragraphs, swap bullets for prose (or vice versa), change the value-prop framing for this vertical.`,
      };
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
  const local = email
    .toLowerCase()
    .trim()
    .split("@")[0]
    ?.replace(/[^a-z0-9]/g, "");
  if (!local) return true;
  return (
    GENERIC_EMAIL_LOCAL_PARTS.has(local) ||
    /^(no)?reply|donotreply|notifications?|newsletter|updates?|security|privacy|legal|abuse$/.test(
      local,
    )
  );
}

async function sendPitchEmail(opts: {
  to: string;
  subject: string;
  body: string;
  companyName?: string;
  audience?: "hiring" | "vc";
  ccNuel?: boolean;
}): Promise<{
  sent: boolean;
  to: string;
  subject: string;
  companyName?: string;
  replyTo?: string;
  resendId?: string;
  cc?: string[];
  error?: string;
}> {
  const { to, subject, body, companyName, audience = "hiring", ccNuel } = opts;
  if (isGenericEmail(to)) {
    return {
      sent: false,
      to,
      subject,
      error: "Blocked: generic/role-based inbox. Use a named person's work email instead.",
    };
  }
  try {
    if (await isContactOptedOut(to)) {
      return { sent: false, to, subject, error: "Blocked: this contact has opted out." };
    }
  } catch (e) {
    return { sent: false, to, subject, error: (e as Error).message };
  }
  const reuse = checkReuse(subject, body);
  if (!reuse.ok) {
    return { sent: false, to, subject, error: reuse.reason };
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { sent: false, to, subject, error: "Email service not configured." };
  }
  try {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Single clean plain-text layout for BOTH hiring and VC.
    // Looks like a normal personal email — no card chrome, no CTA button, no footer logo.
    // Lists ("- item") are rendered as a proper <ul>; paragraphs preserve line breaks.
    const blockArr = body.split(/\n\n+/).map((block) => {
      const lines = block
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const isList = lines.length > 1 && lines.every((l) => /^[-•*]\s+/.test(l));
      if (isList) {
        const items = lines
          .map(
            (l) =>
              `<li style="margin:0 0 6px;line-height:1.6;color:#111111;font-size:15px;">${esc(
                l.replace(/^[-•*]\s+/, ""),
              )}</li>`,
          )
          .join("");
        return `<ul style="margin:0 0 16px;padding-left:22px;">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px;line-height:1.6;color:#111111;font-size:15px;">${esc(
        block,
      ).replace(/\n/g, "<br/>")}</p>`;
    });
    const blocks = blockArr.join("");
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td align="left">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:32px 28px 24px;">
          ${blocks}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
    // audience kept in the signature for callsite back-compat; design is unified now.
    void audience;

    const ccList = resolveCcList(ccNuel);
    const resendId = await sendResendEmail({
      from: "Emmanuel Nwachinemelu <nuel@nf.vaultio.site>",
      to: [to],
      ...(ccList.length ? { cc: ccList } : {}),
      reply_to: "nuel@vaultio.tech",
      subject,
      text: body,
      html,
    });
    sentEmailsThisSession.add(to.toLowerCase().trim());
    recordSent(subject, body);
    return {
      sent: true,
      to,
      subject,
      companyName,
      replyTo: "nuel@vaultio.tech",
      resendId,
      cc: ccList,
    };
  } catch (e) {
    return { sent: false, to, subject, error: (e as Error).message };
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!hasValidAccessSession(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json()) as {
          messages?: unknown;
          workflowPhase?: unknown;
        };
        if (!Array.isArray(body.messages)) {
          return new Response("Chat messages are required.", { status: 400 });
        }
        const phaseResult = WORKFLOW_PHASE_SCHEMA.safeParse(body.workflowPhase ?? "discover");
        if (!phaseResult.success) {
          return new Response("Invalid scouting workflow phase.", { status: 400 });
        }
        const messages = body.messages as UIMessage[];
        const workflowPhase = phaseResult.data;

        const model = getMetaAIModel();
        if (!model) {
          return new Response("Meta Model API is not configured. Set the MODEL_API_KEY secret.", {
            status: 500,
          });
        }

        const tools = {
          apollo_search_startups: tool({
            description:
              "Structured company discovery. Searches Seed through Series B companies and returns organizations with 15-80 employees. Search regions in this priority order: United States, Europe, Africa, then Latin America. This tool does not verify live roles; research job listings before presenting companies.",
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
              "Contact discovery for a company the user has selected. Returns named hiring decision-makers with email and LinkedIn details where available. Do not call until after the user has selected companies from the ranked results.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. 'acme.com'"),
              companyName: z.string().optional(),
              mode: z.enum(["hiring", "executive"]).default("hiring"),
              titles: z.array(z.string()).optional(),
              reveal: z
                .boolean()
                .default(true)
                .describe("Attempt to reveal/enrich emails (uses Apollo credits)"),
            }),
            execute: async ({ domain, companyName, mode, titles, reveal }) => {
              try {
                const people = await apolloFindExecutives({
                  domain,
                  organizationName: companyName,
                  mode,
                  titles,
                  perPage: 10,
                });
                let creditSummary: {
                  creditsConsumed?: number;
                  missingRecords?: number;
                  bulkRevealError?: string;
                } = {};
                let revealedPeople = people;
                if (reveal && people.length) {
                  try {
                    const bulk = await apolloBulkEnrichPeople(people, {
                      domain,
                      organizationName: companyName,
                      revealPersonalEmails: true,
                    });
                    creditSummary = {
                      creditsConsumed: bulk.creditsConsumed,
                      missingRecords: bulk.missingRecords,
                    };
                    revealedPeople = people.map((p, i) => {
                      const matchedById = p.id
                        ? bulk.matches.find((m) => m.id === p.id)
                        : undefined;
                      return { ...p, ...(matchedById ?? bulk.matches[i] ?? {}) };
                    });
                  } catch (e) {
                    creditSummary = { bulkRevealError: (e as Error).message };
                  }
                }
                const enriched = await Promise.all(
                  revealedPeople.map(async (p) => {
                    let email = isUsableApolloEmail(p.email) ? p.email : undefined;
                    if (reveal && !email && p.first_name && p.last_name) {
                      try {
                        const m = await apolloEnrichPerson({
                          id: p.id,
                          firstName: p.first_name,
                          lastName: p.last_name,
                          domain,
                          organizationName: companyName,
                          linkedinUrl: p.linkedin_url,
                          revealPersonalEmails: true,
                        });
                        const candidate = m?.email;
                        if (isUsableApolloEmail(candidate)) email = candidate;
                      } catch {
                        /* skip */
                      }
                    }
                    return {
                      name: p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" "),
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
                  mode,
                  searchedTitles: titles,
                  apolloReveal: creditSummary,
                  contacts: enriched,
                  primaryContact: withEmail[0] ?? enriched[0] ?? null,
                  note:
                    withEmail.length === 0
                      ? "Apollo spent/attempted reveal enrichment but returned no usable emails (likely no credits, plan lacks email reveal/API enrichment, or Apollo only had masked data). Fall back to lusha_find_contacts, then hunter_domain_search."
                      : undefined,
                };
              } catch (e) {
                return { error: (e as Error).message, contacts: [] };
              }
            },
          }),
          fullenrich_enrich_person: tool({
            description:
              "PRIMARY contact enrichment via FullEnrich. Given a person's first/last name plus EITHER company domain OR LinkedIn URL (both preferred), returns their work email and phone. Best email accuracy of all providers — try this FIRST whenever you have a name. Polls the bulk job until FINISHED (up to ~60s).",
            inputSchema: z.object({
              firstName: z.string(),
              lastName: z.string(),
              domain: z.string().optional().describe("Company domain, e.g. 'acme.com'"),
              companyName: z.string().optional(),
              linkedinUrl: z.string().optional(),
              title: z.string().optional(),
            }),
            execute: async ({ firstName, lastName, domain, companyName, linkedinUrl, title }) => {
              try {
                const contact = await fullenrichPersonEnrich({
                  firstName,
                  lastName,
                  domain,
                  companyName,
                  linkedinUrl,
                  title,
                });
                return { contact, found: !!contact?.email };
              } catch (e) {
                return { error: (e as Error).message, contact: null };
              }
            },
          }),
          fullenrich_bulk_enrich: tool({
            description:
              "PRIMARY bulk contact enrichment via FullEnrich. Pass an array of {firstName,lastName,domain?,linkedinUrl?,companyName?,title?} and receive back enriched contacts with emails (qualified VALID/CATCHALL/UNKNOWN) and phones. Use after Apollo discovery surfaces names but masks emails, or after find_linkedin_profiles returns named LinkedIn URLs. Polls until FINISHED.",
            inputSchema: z.object({
              contacts: z
                .array(
                  z.object({
                    firstName: z.string(),
                    lastName: z.string(),
                    domain: z.string().optional(),
                    companyName: z.string().optional(),
                    linkedinUrl: z.string().optional(),
                    title: z.string().optional(),
                  }),
                )
                .min(1)
                .max(25),
            }),
            execute: async ({ contacts }) => {
              try {
                const results = await fullenrichBulkEnrich(contacts);
                const withEmail = results.filter((c) => c.email);
                return {
                  count: results.length,
                  withEmailCount: withEmail.length,
                  contacts: results,
                  primaryContact: withEmail[0] ?? results[0] ?? null,
                  note:
                    withEmail.length === 0
                      ? "FullEnrich returned no emails for these inputs. Fall back to apollo_find_contacts (for domain discovery) or lusha_find_contacts."
                      : undefined,
                };
              } catch (e) {
                return { error: (e as Error).message, contacts: [] };
              }
            },
          }),
          lusha_find_contacts: tool({
            description:
              "Lusha contact lookup for a company the user selected. Use as a fallback when Apollo has no usable email. Pass titles relevant to the selected opening, such as an engineering, product, or marketing leader. Do not call before company selection.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. 'acme.com'"),
              titles: z
                .array(z.string())
                .optional()
                .describe(
                  "Job titles relevant to selected eligible openings, such as Head of Engineering, CTO, Head of Product, or Head of Marketing",
                ),
              seniority: z
                .array(z.string())
                .optional()
                .describe("Lusha seniority filters, e.g. ['c_suite','vp','director']"),
              limit: z.number().int().min(1).max(25).default(10),
            }),
            execute: async ({ domain, titles, seniority, limit }) => {
              try {
                const contacts = await lushaCompanyEmployees({
                  domain,
                  titles,
                  seniority,
                  limit,
                });
                const withEmail = contacts.filter((c) => c.email);
                return {
                  domain,
                  contacts,
                  primaryContact: withEmail[0] ?? contacts[0] ?? null,
                  note:
                    withEmail.length === 0
                      ? "Lusha returned no emails (likely out of credits or no match). Fall back to hunter_domain_search."
                      : undefined,
                };
              } catch (e) {
                return { error: (e as Error).message, contacts: [] };
              }
            },
          }),
          lusha_enrich_person: tool({
            description:
              "Lusha single-person enrichment by name + company domain (or LinkedIn URL). Use when you have a specific named person from Firecrawl/LinkedIn and need their work email.",
            inputSchema: z.object({
              firstName: z.string(),
              lastName: z.string(),
              domain: z.string().optional(),
              companyName: z.string().optional(),
              linkedinUrl: z.string().optional(),
            }),
            execute: async ({ firstName, lastName, domain, companyName, linkedinUrl }) => {
              try {
                const contact = await lushaPersonEnrich({
                  firstName,
                  lastName,
                  domain,
                  companyName,
                  linkedinUrl,
                });
                return { contact, found: !!contact?.email };
              } catch (e) {
                return { error: (e as Error).message, contact: null };
              }
            },
          }),
          search_startups: tool({
            description:
              "Search a public job source for companies and live openings matching the ICP (non-junior software/engineering, AI/ML, data, product, or marketing roles). Verify the specific job page and company before qualifying a result.",
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
          present_ranked_companies: tool({
            description:
              "Present the verified discovery results as selectable company cards. Call once after researching companies and their live job listings, then stop and wait for the user's company selection. Include only product startups (not HR tech, recruiting/staffing, agencies, or outsourcing) at Seed-Series B with 15-80 employees, remote/distributed hiring, an eligible non-junior role, and a location in the supported priority regions. Include every verified qualifying role with its direct job URL and a posting date only when verified.",
            inputSchema: z.object({
              companies: z
                .array(
                  z.object({
                    name: z.string().min(1),
                    domain: z.string().optional(),
                    website: z.string().url().optional(),
                    stage: z.string().min(1),
                    employeeCount: z.number().int().min(0),
                    location: z.string().min(1),
                    workMode: z
                      .enum(["remote", "distributed"])
                      .describe("Verified remote/distributed hiring arrangement"),
                    businessType: z
                      .enum([
                        "product_company",
                        "hr_tech",
                        "recruiting_staffing",
                        "agency",
                        "outsourcing",
                      ])
                      .describe(
                        "Use product_company for an eligible startup; classify excluded company types accurately.",
                      ),
                    industry: z.string().optional(),
                    description: z.string().optional(),
                    jobs: z
                      .array(
                        z.object({
                          title: z.string().min(1),
                          url: z.string().url(),
                          location: z.string().optional(),
                          postedAt: z.string().optional(),
                        }),
                      )
                      .min(1),
                  }),
                )
                .max(30),
            }),
            execute: async ({ companies }) => {
              const rankedCompanies = rankScoutingCompanies(companies);
              return {
                count: rankedCompanies.length,
                excludedCount: companies.length - rankedCompanies.length,
                companies: rankedCompanies.slice(0, 20),
              };
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
                const md: string = data?.data?.markdown ?? data?.markdown ?? "";
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
              "Find named hiring decision-makers at a company selected by the user. Maps the company site for relevant leadership pages and returns sourced contact options. Do not call before the user selects that company.",
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
                const links: string[] = mapRes?.links ?? mapRes?.data?.links ?? [];
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
                /\b(ceo|chief executive officer|founder|co-?founder|cto|chief technology officer|coo|chief operating officer|head of engineering|vp engineering|engineering manager|head of product|vp product|chief product officer|head of marketing|vp marketing|chief marketing officer)\b/i;
              const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

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
                if (/(head of engineering|vp engineering|engineering manager)/.test(r)) return 1;
                if (/(cto|chief technology)/.test(r)) return 2;
                if (
                  /(head of product|vp product|chief product|head of marketing|vp marketing|chief marketing)/.test(
                    r,
                  )
                )
                  return 3;
                if (/(coo|chief operating)/.test(r)) return 4;
                if (/(ceo|chief executive|founder|co-?founder)/.test(r)) return 5;
                return 5;
              };

              for (const url of pickedUrls) {
                try {
                  const data = await firecrawlScrape(url);
                  const md: string = data?.data?.markdown ?? data?.markdown ?? "";
                  if (!md) continue;
                  const emails = md.match(emailRegex) ?? [];
                  for (const rawEmail of emails) {
                    const email = rawEmail.toLowerCase();
                    if (/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(email)) continue;
                    if (/(sentry|wixpress|example\.com|noreply|no-reply)/i.test(email)) continue;
                    const emailDomain = email.split("@")[1] ?? "";
                    // prefer same-domain emails but keep others as fallback
                    const idx = md.toLowerCase().indexOf(email);
                    const window = md.slice(Math.max(0, idx - 200), idx + 200);
                    const roleMatch = window.match(roleRegex);
                    const role = roleMatch?.[0];
                    const rank = rankFor(role) + (emailDomain.endsWith(rootDomain) ? 0 : 0.5);
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
              "Find named hiring decision-makers' public LinkedIn profiles at a company selected by the user. Use as a contact option, not as permission to draft or send outreach.",
            inputSchema: z.object({
              companyName: z.string().describe("Exact company name"),
              domain: z.string().optional().describe("Company domain, helps disambiguate"),
              roles: z
                .array(z.string())
                .optional()
                .describe(
                  "Roles relevant to selected openings; defaults to engineering, product, marketing leaders, and technical founders.",
                ),
              limit: z.number().min(1).max(15).default(8),
            }),
            execute: async ({ companyName, domain, roles, limit }) => {
              const targetRoles = roles?.length
                ? roles
                : [
                    "Head of Engineering",
                    "Engineering Manager",
                    "CTO",
                    "Technical Co-Founder",
                    "Head of Product",
                    "Head of Marketing",
                    "VP Engineering",
                    "VP Product",
                    "VP Marketing",
                  ];
              const rolesClause = targetRoles.map((r) => `"${r}"`).join(" OR ");
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
          present_contact_options: tool({
            description:
              "Save sourced contacts at the user-selected company to Supabase, then present them as selectable contact cards. Provide each contact's actual source provider and source URL when known. Never include inferred email guesses. Call after contact research, then stop and wait for the user to select people. Do not draft or send outreach.",
            inputSchema: z.object({
              companyName: z.string().min(1),
              domain: z.string().optional(),
              contacts: z
                .array(
                  z
                    .object({
                      name: z.string().min(1),
                      provider: z
                        .enum(CONTACT_SOURCE_PROVIDERS)
                        .describe("The actual contact provider that returned this person"),
                      title: z.string().optional(),
                      email: z
                        .string()
                        .email()
                        .optional()
                        .describe("Only a sourced email address; never an inferred guess"),
                      linkedin: z.string().url().optional(),
                      source: z.string().url().optional(),
                    })
                    .refine((contact) => contact.email || contact.linkedin, {
                      message: "A contact needs a work email or LinkedIn profile.",
                    }),
                )
                .min(1)
                .max(30),
            }),
            execute: async ({ companyName, domain, contacts }) => {
              if (!domain) {
                return {
                  companyName,
                  domain,
                  contacts,
                  saved: 0,
                  saveError: "Company domain is missing; these contacts could not be saved.",
                };
              }
              try {
                const result = await saveSourcedContacts({
                  company: { name: companyName, domain },
                  contacts: contacts.map((contact) => ({
                    fullName: contact.name,
                    provider: contact.provider,
                    title: contact.title,
                    email: contact.email,
                    linkedinUrl: contact.linkedin,
                    sourceUrl: contact.source,
                  })),
                });
                return {
                  companyName,
                  domain,
                  contacts,
                  saved: result.saved,
                  saveFailures: result.failures,
                  sourceFailures: result.sourceFailures,
                };
              } catch (e) {
                return {
                  companyName,
                  domain,
                  contacts,
                  saved: 0,
                  saveError: (e as Error).message,
                };
              }
            },
          }),
          hunter_domain_search: tool({
            description:
              "Hunter.io domain search fallback for a user-selected company. Returns known emails with role metadata. Use only after the user has selected the company and contact discovery is underway.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. 'acme.com'"),
              limit: z.number().min(1).max(100).default(20),
              seniority: z.enum(["junior", "senior", "executive"]).optional(),
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
              "Prospeo person enrichment. Given first/last name + company domain/company name or LinkedIn URL, reveals a verified work email. Use after Hunter fails.",
            inputSchema: z.object({
              firstName: z.string(),
              lastName: z.string(),
              domain: z.string().optional(),
              company: z.string().optional(),
              linkedinUrl: z.string().optional(),
              personId: z.string().optional(),
            }),
            execute: async (input) => {
              try {
                return await prospeoEmailFinder(input);
              } catch (e) {
                return { ...input, error: (e as Error).message };
              }
            },
          }),
          prospeo_domain_search: tool({
            description:
              "Prospeo company contact search — searches people at a company domain, then enriches each person to reveal verified work emails.",
            inputSchema: z.object({
              domain: z.string(),
              limit: z.number().min(1).max(100).default(20),
            }),
            execute: async (input) => {
              try {
                return await prospeoDomainSearch(input);
              } catch (e) {
                return { domain: input.domain, error: (e as Error).message, emails: [] };
              }
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
              try {
                return await pdlPersonEnrich(input);
              } catch (e) {
                return { ...input, error: (e as Error).message };
              }
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
              try {
                return await pdlPersonSearch(input);
              } catch (e) {
                return { domain: input.domain, error: (e as Error).message, people: [] };
              }
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
              try {
                return await tombaDomainSearch(input);
              } catch (e) {
                return { domain: input.domain, error: (e as Error).message, emails: [] };
              }
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
              try {
                return await tombaEmailFinder(input);
              } catch (e) {
                return { ...input, error: (e as Error).message };
              }
            },
          }),
          ai_source_emails: tool({
            description:
              "Source executive emails using Meta Model API as a reasoning step. Use ONLY when Apollo + Hunter have both failed. It scrapes team/about/contact pages and asks the model to extract any emails present and infer the most likely email pattern (e.g. first.last@domain). Returns extracted emails plus inferred-pattern guesses with confidence.",
            inputSchema: z.object({
              domain: z.string().describe("Company domain, e.g. acme.com"),
              companyName: z.string().optional(),
              targetRoles: z
                .array(z.string())
                .optional()
                .describe(
                  "Roles relevant to selected openings; defaults to engineering/product/marketing leaders and technical founders",
                ),
            }),
            execute: async ({ domain, companyName, targetRoles }) => {
              const model = getMetaAIModel();
              if (!model) {
                return {
                  error:
                    "Meta Model API is not configured. Skip ai_source_emails and go straight to find_linkedin_profiles.",
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
                const links: string[] = mapRes?.links ?? mapRes?.data?.links ?? [];
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
                  const md: string = data?.data?.markdown ?? data?.markdown ?? "";
                  if (md) chunks.push(`--- ${u} ---\n${md.slice(0, 4000)}`);
                } catch {
                  /* skip */
                }
              }
              const roles = targetRoles?.length
                ? targetRoles
                : [
                    "Head of Engineering",
                    "Engineering Manager",
                    "CTO",
                    "Technical Co-Founder",
                    "Head of Product",
                    "Head of Marketing",
                    "VP Engineering",
                    "VP Product",
                    "VP Marketing",
                  ];
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
                  model,
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
                  note: (parsed.contacts as unknown[] | undefined)?.length
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
              "Draft personalized outreach only for a contact explicitly selected by the user. Requires researched fields; do not call until the user selects a named contact and the company site plus recipient's LinkedIn/about page have been researched. Never sends email.",
            inputSchema: z.object({
              companyName: z.string(),
              recipientName: z.string().describe("Named person (no role-based inboxes)"),
              recipientRole: z.string(),
              whatTheyDo: z
                .string()
                .describe("Specific — what the company actually builds, for whom"),
              vertical: z
                .string()
                .describe("Industry/vertical, e.g. fintech, devtools, healthtech, or marketplace"),
              hiringRoles: z.array(z.string()).min(1),
              stage: z.string().optional(),
              size: z.string().optional(),
              recipientResearch: z
                .string()
                .min(20)
                .describe(
                  "Concrete fact about the recipient from their LinkedIn/about page: recent post, prior company, tenure, shipped project. Used in the opener.",
                ),
              companyResearch: z
                .string()
                .min(20)
                .describe(
                  "Concrete fact about the company from their site: recent launch, product specific, customer segment, JD detail. Used to tailor positioning.",
                ),
              industryPain: z
                .string()
                .min(10)
                .describe(
                  "Specific hiring pain for THIS vertical (not generic). E.g. 'fintech roles need compliance-vetted engineers'.",
                ),
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
              "Send a SINGLE pitch email via Resend only after the user explicitly approves a reviewed draft in a separate message. From: nuel@nf.vaultio.site. Reply-To: nuel@vaultio.tech. Pass audience='hiring' for this app's startup hiring outreach.",
            inputSchema: z.object({
              to: z.string().email().describe("Recipient email address"),
              subject: z.string().min(1).max(200),
              body: z.string().min(1).describe("Plain-text email body. Line breaks preserved."),
              companyName: z.string().optional(),
              audience: z
                .enum(["hiring", "vc"])
                .default("hiring")
                .describe(
                  "Kept for back-compat. Email design is unified — clean plain-text style for both.",
                ),
              ccNuel: z
                .boolean()
                .optional()
                .describe(
                  "Override CC of nuel@vaultio.tech. Defaults to env CC_NUEL_ENABLED (true unless set to 'false').",
                ),
            }),
            execute: async ({ to, subject, body, companyName, audience, ccNuel }) => {
              return sendPitchEmail({ to, subject, body, companyName, audience, ccNuel });
            },
          }),
          bulk_send_pitch: tool({
            description:
              "Send pitches to MULTIPLE recipients in one call. Rate-limits to ~1 email per 1.2s (Resend safe), dedupes against emails already sent in this server session, and returns a summary {sent, skippedDuplicates, failed}. Each recipient gets their own subject + body so you can personalize. Pass audience='vc' for an investor batch (clean design); default 'hiring' uses the branded layout.",
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
              audience: z
                .enum(["hiring", "vc"])
                .default("hiring")
                .describe("Kept for back-compat. Applies to every recipient in the batch."),
              ccNuel: z
                .boolean()
                .optional()
                .describe(
                  "Override CC of nuel@vaultio.tech for this whole campaign. Defaults to env CC_NUEL_ENABLED.",
                ),
            }),
            execute: async ({ recipients, delayMs, audience, ccNuel }) => {
              const sent: Array<{
                to: string;
                subject: string;
                resendId?: string;
                companyName?: string;
              }> = [];
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
                  audience,
                  ccNuel,
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
          draft_generic_email: tool({
            description:
              "Prepare a free-form (non-pitch) email draft for Nuel's review. Use for follow-ups, intros, replies, personal notes, applications, thank-yous, investor follow-ups — anything that isn't a hiring/VC cold pitch. This tool does NOT send. Always call this first, then wait for Nuel's explicit approval (e.g. 'send it') before calling send_generic_email.",
            inputSchema: z.object({
              to: z.string().email(),
              subject: z.string().min(1).max(200),
              body: z.string().min(1).describe("Plain-text body. Line breaks preserved."),
              cc: z.array(z.string().email()).optional(),
              replyTo: z.string().email().optional(),
              fromName: z
                .string()
                .optional()
                .describe("Display name override; defaults to 'Emmanuel Nwachinemelu'"),
            }),
            execute: async (input) => {
              return {
                ...input,
                status: "draft",
                instruction:
                  "Show this draft to Nuel and ask for explicit approval before calling send_generic_email. Do not send until he says 'send it' (or equivalent).",
              };
            },
          }),
          send_generic_email: tool({
            description:
              "Send a free-form email via Resend. ONLY call this after Nuel has explicitly approved the draft from draft_generic_email (e.g. 'send it', 'approve', 'yes send'). Skips pitch templates, anti-reuse, and generic-inbox checks. Renders a clean plain-text-style email. From: nuel@nf.vaultio.site. Reply-To defaults to nuel@vaultio.tech.",
            inputSchema: z.object({
              to: z.string().email(),
              subject: z.string().min(1).max(200),
              body: z.string().min(1),
              cc: z
                .array(z.string().email())
                .optional()
                .describe(
                  "Extra CC recipients. nuel@vaultio.tech is added automatically per ccNuel/env.",
                ),
              replyTo: z.string().email().optional(),
              fromName: z.string().optional(),
              ccNuel: z
                .boolean()
                .optional()
                .describe("Override CC of nuel@vaultio.tech. Defaults to env CC_NUEL_ENABLED."),
              approved: z
                .boolean()
                .describe(
                  "Must be true. Set only after Nuel explicitly approved the draft in chat.",
                ),
            }),
            execute: async ({ to, subject, body, cc, replyTo, fromName, approved, ccNuel }) => {
              if (!approved) {
                return {
                  sent: false,
                  error: "Approval required. Show the draft and wait for Nuel to say 'send it'.",
                };
              }
              try {
                if (await isContactOptedOut(to)) {
                  return {
                    sent: false,
                    to,
                    subject,
                    error: "Blocked: this contact has opted out.",
                  };
                }
              } catch (e) {
                return { sent: false, to, subject, error: (e as Error).message };
              }
              const resendKey = process.env.RESEND_API_KEY;
              if (!resendKey) {
                return { sent: false, error: "Email service not configured." };
              }
              const esc = (s: string) =>
                s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              const blocks = body
                .split(/\n\n+/)
                .map(
                  (block) =>
                    `<p style="margin:0 0 16px;line-height:1.6;color:#111;font-size:15px;">${esc(block).replace(/\n/g, "<br/>")}</p>`,
                )
                .join("");
              const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="left"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="padding:24px 24px 24px;">${blocks}</td></tr></table></td></tr></table></body></html>`;
              const ccList = resolveCcList(ccNuel, cc);
              try {
                const resendId = await sendResendEmail({
                  from: `${fromName ?? "Emmanuel Nwachinemelu"} <nuel@nf.vaultio.site>`,
                  to: [to],
                  ...(ccList.length ? { cc: ccList } : {}),
                  reply_to: replyTo ?? "nuel@vaultio.tech",
                  subject,
                  text: body,
                  html,
                });
                return { sent: true, to, cc: ccList, subject, resendId };
              } catch (e) {
                return { sent: false, to, subject, error: (e as Error).message };
              }
            },
          }),
        };

        const toolNamesByPhase: Record<WorkflowPhase, Set<string>> = {
          discover: new Set([
            "apollo_search_startups",
            "search_startups",
            "scrape_company",
            "present_ranked_companies",
          ]),
          contacts: new Set([
            "apollo_find_contacts",
            "fullenrich_enrich_person",
            "fullenrich_bulk_enrich",
            "lusha_find_contacts",
            "lusha_enrich_person",
            "scrape_company",
            "find_executive_contacts",
            "find_linkedin_profiles",
            "hunter_domain_search",
            "hunter_email_finder",
            "prospeo_email_finder",
            "prospeo_domain_search",
            "pdl_person_enrich",
            "pdl_person_search",
            "tomba_domain_search",
            "tomba_email_finder",
            "ai_source_emails",
            "present_contact_options",
          ]),
          draft: new Set([
            "fullenrich_enrich_person",
            "fullenrich_bulk_enrich",
            "lusha_enrich_person",
            "scrape_company",
            "find_linkedin_profiles",
            "hunter_email_finder",
            "prospeo_email_finder",
            "pdl_person_enrich",
            "pdl_person_search",
            "tomba_email_finder",
            "ai_source_emails",
            "draft_pitch",
            "draft_generic_email",
          ]),
          send: new Set(["send_pitch", "bulk_send_pitch", "send_generic_email"]),
        };
        const availableTools = Object.fromEntries(
          Object.entries(tools).filter(([name]) => toolNamesByPhase[workflowPhase].has(name)),
        ) as typeof tools;
        const phaseInstruction: Record<WorkflowPhase, string> = {
          discover:
            "Current stage: discover and rank companies only. Contact lookup, drafting, saving, and sending tools are unavailable.",
          contacts:
            "Current stage: find contacts only for the companies explicitly selected in the latest user message. Present options and stop. Drafting and sending tools are unavailable.",
          draft:
            "Current stage: research and draft only for the contacts explicitly selected in the latest user message. Sending tools are unavailable.",
          send: "Current stage: the user explicitly approved a previously reviewed draft. Send only the approved draft(s); do not create new drafts or contact other people.",
        };

        const result = streamText({
          model,
          system: `${SYSTEM_PROMPT}\n\n${phaseInstruction[workflowPhase]}`,
          messages: await convertToModelMessages(messages),
          tools: availableTools,
          stopWhen: [
            stepCountIs(50),
            hasToolCall("present_ranked_companies"),
            hasToolCall("present_contact_options"),
          ],
          onError: ({ error }) => {
            console.error("[chat] streamText error:", error);
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onError: (error) => {
            const e = error as {
              statusCode?: number;
              status?: number;
              message?: string;
              name?: string;
            };
            const code = e?.statusCode ?? e?.status;
            const msg = e?.message ?? String(error);
            console.error("[chat] stream failed:", code, msg);
            if (code === 403 || /forbidden|accessdenied|not authorized/i.test(msg)) {
              return `Meta Model API rejected the request (403). Check the API key and model access. Details: ${msg}`;
            }
            if (code === 429)
              return `Rate limited by the AI provider. Try again shortly. Details: ${msg}`;
            return `Chat failed: ${msg}`;
          },
        });
      },
    },
  },
});
