CREATE TABLE public.scout_automation_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  search_query text NOT NULL DEFAULT 'software engineering',
  daily_cycle_date date,
  daily_cycle_count integer NOT NULL DEFAULT 0 CHECK (daily_cycle_count BETWEEN 0 AND 3),
  cycle_lock_token uuid,
  cycle_lock_until timestamptz,
  last_cycle_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.scout_automation_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.scout_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_token uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  companies_reviewed integer NOT NULL DEFAULT 0,
  drafts_created integer NOT NULL DEFAULT 0,
  summary text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE public.scout_automation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('initial', 'reply', 'follow_up')),
  source_inbound_id uuid,
  parent_sent_id uuid,
  contact_id uuid REFERENCES public.sourced_contacts(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  source_urls text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'rejected', 'failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX scout_automation_outbox_status_created_idx
  ON public.scout_automation_outbox (status, created_at DESC);
CREATE INDEX scout_automation_outbox_recipient_idx
  ON public.scout_automation_outbox (lower(recipient_email), created_at DESC);

CREATE TABLE public.scout_automation_sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid UNIQUE REFERENCES public.scout_automation_outbox(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.sourced_contacts(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  company_name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  resend_id text UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('initial', 'reply', 'follow_up')),
  parent_sent_id uuid REFERENCES public.scout_automation_sent_emails(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outbox_id IS NOT NULL OR source_type = 'initial')
);

CREATE INDEX scout_automation_sent_recipient_idx
  ON public.scout_automation_sent_emails (lower(recipient_email), sent_at DESC);

CREATE TABLE public.scout_automation_inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_id text NOT NULL UNIQUE,
  sender_email text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'drafted', 'ignored')),
  sent_email_id uuid REFERENCES public.scout_automation_sent_emails(id) ON DELETE SET NULL,
  outbox_id uuid REFERENCES public.scout_automation_outbox(id) ON DELETE SET NULL
);

CREATE INDEX scout_automation_inbound_status_received_idx
  ON public.scout_automation_inbound_emails (status, received_at DESC);

ALTER TABLE public.scout_automation_outbox
  ADD CONSTRAINT scout_automation_outbox_source_inbound_fk
  FOREIGN KEY (source_inbound_id)
  REFERENCES public.scout_automation_inbound_emails(id)
  ON DELETE SET NULL;

ALTER TABLE public.scout_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_automation_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_automation_sent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_automation_inbound_emails ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.scout_automation_settings TO service_role;
GRANT ALL ON public.scout_automation_runs TO service_role;
GRANT ALL ON public.scout_automation_outbox TO service_role;
GRANT ALL ON public.scout_automation_sent_emails TO service_role;
GRANT ALL ON public.scout_automation_inbound_emails TO service_role;

CREATE POLICY "Trusted backend can manage automation settings"
  ON public.scout_automation_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Trusted backend can manage automation runs"
  ON public.scout_automation_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Trusted backend can manage automation outbox"
  ON public.scout_automation_outbox FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Trusted backend can manage automation sent emails"
  ON public.scout_automation_sent_emails FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Trusted backend can manage automation inbound emails"
  ON public.scout_automation_inbound_emails FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.claim_scout_automation_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claimed public.scout_automation_settings%ROWTYPE;
  current_settings public.scout_automation_settings%ROWTYPE;
BEGIN
  UPDATE public.scout_automation_settings
  SET daily_cycle_date = (now() AT TIME ZONE 'UTC')::date,
      daily_cycle_count = CASE
        WHEN daily_cycle_date IS DISTINCT FROM (now() AT TIME ZONE 'UTC')::date THEN 1
        ELSE daily_cycle_count + 1
      END,
      cycle_lock_token = gen_random_uuid(),
      cycle_lock_until = now() + interval '30 minutes',
      last_cycle_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE id = 1
    AND enabled
    AND (cycle_lock_until IS NULL OR cycle_lock_until < now())
    AND (
      daily_cycle_date IS DISTINCT FROM (now() AT TIME ZONE 'UTC')::date
      OR daily_cycle_count < 3
    )
  RETURNING * INTO claimed;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'claimed',
      'token', claimed.cycle_lock_token,
      'search_query', claimed.search_query,
      'cycles_used', claimed.daily_cycle_count
    );
  END IF;

  SELECT * INTO current_settings FROM public.scout_automation_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'status', CASE
      WHEN NOT current_settings.enabled THEN 'disabled'
      WHEN current_settings.cycle_lock_until > now() THEN 'locked'
      ELSE 'daily_limit'
    END,
    'cycles_used', CASE
      WHEN current_settings.daily_cycle_date = (now() AT TIME ZONE 'UTC')::date
        THEN current_settings.daily_cycle_count
      ELSE 0
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_scout_automation_cycle(
  p_lock_token uuid,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.scout_automation_settings
  SET cycle_lock_token = NULL,
      cycle_lock_until = NULL,
      last_error = p_error,
      updated_at = now()
  WHERE id = 1 AND cycle_lock_token = p_lock_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scout_automation_cycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_scout_automation_cycle(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scout_automation_cycle() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_scout_automation_cycle(uuid, text) TO service_role;
