# Startup Scout

Startup Scout is an AI-powered research and outreach workspace for Vaultio.tech. It helps identify early-stage companies that are hiring, research relevant roles and decision-makers, qualify potential customers, and draft personalized outreach.

**Live app:** [vaultio.site](https://vaultio.site)

## What it does

- Finds companies and hiring signals using Apollo and public web search, including Wellfound, F6S, YC's Work at a Startup, and LinkedIn job pages.
- Researches companies, roles, and hiring contacts, with optional contact and email enrichment providers.
- Saves scouted companies, sourced contacts, and source-provider history in your Supabase project; review records in the Contact database.
- Applies Vaultio's ideal-customer criteria, ranks companies by verified hiring signals, and lets you select companies and contacts before drafting.
- Drafts role-specific pitches for review; outreach is sent only after a separate, explicit approval.
- Keeps chat threads in the browser's local storage. Threads are local to the browser and are not synced between devices. Contact records and delivery events are stored in Supabase.

Search results depend on the connected data providers and publicly available information. LinkedIn and other job sites may limit access or change their pages, so coverage can vary.

## Scouting workflow and ICP

The ICP is Seed through Series B companies with 15-80 employees, remote or distributed hiring, and at least one live opening in software/engineering, AI/ML, data, product, or marketing. The app excludes HR tech, recruiting and staffing firms, agencies, outsourcing shops, and companies whose only relevant openings are design, analyst, or sales roles. Junior, entry-level, graduate, and internship roles do not qualify.

Geography is prioritized in this order: United States, Europe, Africa, then Latin America. Results rank by hiring evidence rather than company prominence: three or more eligible engineering openings rank first, followed by a founding or senior engineering role posted more than 14 days ago, then other eligible roles. The UI presents ranked company cards first; select companies to reveal named contact options, then select contacts to request individualized drafts. Nothing is sent until you explicitly approve sending in a separate message.

## Development

You need Node.js and npm.

```sh
git clone <repository-url>
cd <repository-directory>
npm install
npm run dev
```

The development server prints its local URL when it starts. To check the production build and lint the project, run:

```sh
npm run build
npm run lint
```

For Cloudflare Workers Builds, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. The Wrangler configuration deploys the generated `.output/server` bundle and `.output/public` assets; deploying the raw TanStack source entry directly does not work.

## Configuration

Set server-side credentials in your local environment or deployment environment. Never commit API keys or passwords.
Copy `.env.example` to `.env` and fill in the values from the Supabase project you own. The server role key must remain server-side; never add it to a `VITE_` variable or browser code.

| Variable                                                | Purpose                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SUPABASE_PROJECT_ID`                                   | Supabase project reference.                                                                        |
| `SUPABASE_URL`                                          | URL for the Supabase project you control.                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`                             | Server-only key for storing sourced records and email events. Never expose it to the browser.      |
| `SUPABASE_PUBLISHABLE_KEY`                              | Public key used by server-side auth middleware.                                                    |
| `VITE_SUPABASE_PROJECT_ID`                              | Project reference used by browser-side auth storage.                                               |
| `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional browser-side Supabase settings; use only the public key here, never the service-role key. |
| `BEDROCK_API_KEY`                                       | Required for the AI chat and research tools.                                                       |
| `APP_ACCESS_PASSWORD`                                   | Required to unlock the password-protected app.                                                     |
| `APOLLO_API_KEY`                                        | Company discovery and contact lookup.                                                              |
| `FIRECRAWL_API_KEY`                                     | Public web search and page scraping.                                                               |
| `RESEND_API_KEY` and `LOVABLE_API_KEY`                  | Required to send outreach emails.                                                                  |
| `CC_NUEL_ENABLED`                                       | Optional; controls the default CC to `nuel@vaultio.tech` when sending. Defaults to `true`.         |
| `RESEND_WEBHOOK_SECRET`                                 | Required to verify Resend delivery webhook signatures.                                             |

Additional enrichment integrations are available through `FULLENRICH_API_KEY`, `LUSHA_API_KEY`, `HUNTER_API_KEY`, `PROSPEO_API_KEY`, `PEOPLE_DATA_LABS_API_KEY`, and `TOMBA_API_KEY` plus `TOMBA_SECRET_KEY`. These are optional; configure only the providers you intend to use. Bedrock model and region overrides are available through `BEDROCK_MODEL_ID`, `BEDROCK_OPUS_MODEL_ID`, and `BEDROCK_REGION`.

Apply the SQL files in `supabase/migrations/` to your Supabase project in filename order (or run the new scouting migration in the Supabase SQL Editor). The scouting schema keeps companies, contacts, and source observations in separate tables; it also records opt-outs and links email delivery events to contacts. Contacts are not marked eligible for commercialization automatically; a lawful basis and a separate review are required. Only the trusted server role can access these tables. Use provider data only in accordance with the provider's terms and applicable privacy requirements.

The app access password now creates a signed, `HttpOnly` session cookie. Configure `APP_ACCESS_PASSWORD` before opening the app; protected chat, contact, and delivery endpoints reject requests without a valid session.

## Tech stack

- React and TanStack Start with Vite
- AI SDK for streaming chat and tool use
- AWS Bedrock for the AI model
- Apollo, Firecrawl, and optional enrichment providers for company and contact research
- Resend for approved email delivery
