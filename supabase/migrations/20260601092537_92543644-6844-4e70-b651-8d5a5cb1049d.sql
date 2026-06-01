CREATE TABLE public.email_delivery_events (
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

GRANT ALL ON public.email_delivery_events TO service_role;

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX email_delivery_events_resend_id_idx ON public.email_delivery_events (resend_id);
CREATE INDEX email_delivery_events_email_idx ON public.email_delivery_events (lower(email));
CREATE INDEX email_delivery_events_event_at_idx ON public.email_delivery_events (event_at DESC);