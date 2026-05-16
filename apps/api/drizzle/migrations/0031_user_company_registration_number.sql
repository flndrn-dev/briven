-- 0031_user_company_registration_number — add company_registration_number
-- to users. EU business register number (e.g. French SIREN, German HRB,
-- Belgian KBO/BCE). Separate from VAT ID — many micro-businesses have a
-- registration number but no VAT ID.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "company_registration_number" text;
