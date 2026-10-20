CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  email text NOT NULL,
  subject text,
  resend_id text,
  event_at timestamptz NOT NULL DEFAULT now(),
  bounce_reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.email_delivery_events TO service_role;

CREATE TABLE public.scouted_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL UNIQUE,
  website_url text,
  linkedin_url text,
  stage text,
  employee_count integer CHECK (employee_count IS NULL OR employee_count >= 0),
  industry text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sourced_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.scouted_companies(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  title text,
  email text,
  email_status text NOT NULL DEFAULT 'unknown'
    CHECK (email_status IN ('unknown', 'valid', 'catchall', 'invalid')),
  linkedin_url text,
  do_not_contact boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  retention_review_at timestamptz,
  lawful_basis text
    CHECK (lawful_basis IN ('consent', 'legitimate_interest', 'contract', 'other')),
  commercialization_eligible boolean NOT NULL DEFAULT false,
  commercialization_reviewed_at timestamptz,
  first_sourced_at timestamptz NOT NULL DEFAULT now(),
  last_sourced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NULL OR email = lower(email)),
  CHECK (email IS NOT NULL OR linkedin_url IS NOT NULL),
  CHECK (opted_out_at IS NULL OR do_not_contact),
  CHECK (
    NOT commercialization_eligible
    OR (
      lawful_basis IS NOT NULL
      AND commercialization_reviewed_at IS NOT NULL
      AND NOT do_not_contact
      AND opted_out_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX sourced_contacts_company_email_uidx
  ON public.sourced_contacts (company_id, email);
CREATE UNIQUE INDEX sourced_contacts_company_linkedin_uidx
  ON public.sourced_contacts (company_id, linkedin_url);
CREATE INDEX sourced_contacts_email_idx
  ON public.sourced_contacts (email)
  WHERE email IS NOT NULL;

CREATE TABLE public.contact_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.sourced_contacts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN (
    'apollo', 'firecrawl', 'fullenrich', 'hunter', 'linkedin', 'lusha',
    'pdl', 'prospeo', 'tomba', 'wellfound', 'f6s', 'yc'
  )),
  source_url text,
  external_record_id text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX contact_sources_contact_observed_idx
  ON public.contact_sources (contact_id, observed_at DESC);

ALTER TABLE public.email_delivery_events
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.sourced_contacts(id) ON DELETE SET NULL;

CREATE INDEX email_delivery_events_contact_id_idx
  ON public.email_delivery_events (contact_id);

ALTER TABLE public.scouted_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourced_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_sources ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.scouted_companies TO service_role;
GRANT ALL ON public.sourced_contacts TO service_role;
GRANT ALL ON public.contact_sources TO service_role;

CREATE POLICY "Trusted backend can manage scouted companies"
  ON public.scouted_companies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Trusted backend can manage sourced contacts"
  ON public.sourced_contacts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Trusted backend can manage contact sources"
  ON public.contact_sources
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
