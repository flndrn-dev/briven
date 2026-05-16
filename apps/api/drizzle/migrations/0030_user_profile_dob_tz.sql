-- 0030_user_profile_dob_tz — add date_of_birth, country_of_birth, and
-- timezone to users so the Profile & Billing details form on the
-- dashboard can collect the full KYC block. country_of_birth is
-- ISO 3166-1 alpha-2 (separate from address_country / residency).
-- timezone is an IANA zone name (e.g. 'Europe/Brussels'); used to
-- render timestamps + schedule weekly digests at the user's local time.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "date_of_birth" date,
  ADD COLUMN IF NOT EXISTS "country_of_birth" text,
  ADD COLUMN IF NOT EXISTS "timezone" text;
