-- org_invitations — pending invites to a team org. Mirrors the
-- project_invitations table shape but scoped to an org id and
-- carrying an org role (owner/admin/developer/viewer) instead of
-- a project-member role.

CREATE TABLE IF NOT EXISTS "org_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'developer',
  "token_hash" text NOT NULL,
  "invited_by" text REFERENCES "users"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One pending invite per (org, email) at a time. A second invite to the
-- same address replaces the prior one (handled at the service layer with
-- an INSERT … ON CONFLICT … DO UPDATE).
CREATE UNIQUE INDEX IF NOT EXISTS "org_invitations_org_email_idx"
  ON "org_invitations" USING btree ("org_id", "email");

CREATE UNIQUE INDEX IF NOT EXISTS "org_invitations_token_idx"
  ON "org_invitations" USING btree ("token_hash");
