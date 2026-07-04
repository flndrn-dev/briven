-- 0040_user_delete_secret — store a user-chosen "delete secret" that gates
-- project deletion. Mirrors the SDK-key pattern (0034 + 0039):
--
--   * delete_secret_hash  — sha-256 hex digest, the ONLY verification
--     mechanism (leaking it leaks zero usable secrets).
--   * delete_secret_enc   — AES-256-GCM ciphertext of the plaintext,
--     encrypted at rest with the same BRIVEN_ENCRYPTION_KEY KEK that
--     protects customer env vars (services/project-env.ts). Exists solely
--     so the owner can reveal/copy the secret again through the
--     authenticated + audited reveal path; never used for verification.
--   * delete_secret_set_at — when the current secret was set.
--
-- All three NULLABLE: a user who has never set a secret has all three null.
-- IF NOT EXISTS keeps this safe if a partial run ever happened.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "delete_secret_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "delete_secret_enc" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "delete_secret_set_at" timestamptz;
