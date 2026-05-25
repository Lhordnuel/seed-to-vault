
## What we're building

An AI-powered chat agent that helps you find startups (seed–Series A, 1–50 employees) that are actively hiring on Wellfound, F6S, YC Jobs, and LinkedIn, then drafts a personalized Vaultio pitch for each one.

Since you skipped the clarifying questions, I'm making these defaults — flag any you want changed:

- **Vaultio pitch**: agent will use a placeholder description ("Vaultio — secure secrets/vault management for fast-moving startups"). You'll be able to edit the pitch template in the UI.
- **Conversation shape**: threaded (sidebar of past searches), each thread has its own URL.
- **Storage**: Lovable Cloud database (so leads persist across devices and you can revisit them).
- **Data source**: Firecrawl (web search + scraping). Official APIs don't exist for Wellfound/F6S/LinkedIn job listings, so the agent will search and scrape public listing pages. LinkedIn aggressively blocks scrapers — coverage there will be best-effort via Google search results rather than direct scraping.

## How it works

1. You ask the agent something like *"Find AI startups in NYC hiring backend engineers"*.
2. Agent uses tools to search Wellfound, F6S, YC Jobs (Work at a Startup), and LinkedIn via Firecrawl.
3. For each hit, it scrapes the company page to extract: name, stage, size, funding, hiring roles, website.
4. Filters to seed–Series A and 1–50 employees.
5. Saves leads to a database table, displays them as cards in chat.
6. For any lead, you can click "Draft pitch" and the agent generates a personalized Vaultio outreach message.

## Stack

- **Frontend**: TanStack Start, AI Elements chat UI (Conversation, Message, PromptInput, Tool, Shimmer), threaded routes at `/$threadId`.
- **Backend**: TanStack server route `/api/chat` using AI SDK `streamText` with tools.
- **AI**: Lovable AI Gateway, default model `google/gemini-3-flash-preview`.
- **Data**: Firecrawl connector (search + scrape) for sourcing; AI for extraction and pitch drafting.
- **DB**: Lovable Cloud tables — `threads`, `messages`, `leads` (scoped to authenticated user with RLS).
- **Auth**: required so leads persist per user.

## Agent tools

- `search_startups(query, source)` — Firecrawl search across wellfound.com, f6s.com, workatastartup.com, linkedin.com/jobs.
- `scrape_company(url)` — Firecrawl scrape + AI structured extraction (name, stage, size, funding, roles).
- `save_lead(...)` — insert into `leads` table.
- `list_leads(filters)` — query saved leads.
- `draft_pitch(leadId)` — generate personalized Vaultio outreach.

## Pages

- `/login` — auth.
- `/` — redirect to most recent or new thread.
- `/$threadId` — threaded chat with sidebar (thread list + new thread + leads view).
- `/settings` — edit Vaultio pitch template and ICP filters.

## What I'll need from you after build

- Connect the **Firecrawl** connector (one click in Connectors panel).
- Paste a real Vaultio description so pitches don't use the placeholder.

## Caveats

- LinkedIn scraping is unreliable by design; expect partial results from that source.
- Wellfound/F6S also rate-limit; the agent will be polite and may need retries.
- This is a research/outreach assistant, not a guaranteed lead database — quality depends on what's publicly listed.
