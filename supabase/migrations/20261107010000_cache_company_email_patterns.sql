ALTER TABLE public.scouted_companies
  ADD COLUMN IF NOT EXISTS email_pattern text,
  ADD COLUMN IF NOT EXISTS email_pattern_source text,
  ADD COLUMN IF NOT EXISTS email_pattern_updated_at timestamptz;

ALTER TABLE public.scouted_companies
  ADD CONSTRAINT scouted_companies_email_pattern_source_check
  CHECK (
    email_pattern_source IS NULL
    OR email_pattern_source IN ('published_address', 'hunter_domain_search')
  );

ALTER TABLE public.scouted_companies
  ADD CONSTRAINT scouted_companies_email_pattern_check
  CHECK (
    email_pattern IS NULL
    OR email_pattern IN (
      '{f}.{l}',
      '{f}{l}',
      '{fi}{l}',
      '{f}',
      '{fi}.{l}',
      '{f}_{l}',
      '{fi}_{l}',
      '{l}.{f}',
      '{l}{fi}',
      '{f}-{l}',
      '{fi}-{l}'
    )
  );
