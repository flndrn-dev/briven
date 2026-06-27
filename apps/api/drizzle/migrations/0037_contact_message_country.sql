-- 0037_contact_message_country — extra fields on public /contact intake.
-- The redesigned /contact page submits a free-text "subject" line and a
-- locked "country" auto-detected from the visitor's IP (self-hosted geo-IP
-- lookup, no third-party call). Both are hints for the operator and are
-- nullable: the topic-only flow and older clients submit without them.
-- Country is NEVER a gate — it's display + triage context only.

ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "country" text;
