-- 0036_contact_messages — public /contact form intake.
-- The /contact marketing page writes one row per submission from an
-- unauthenticated visitor. The sender's email is collected + stored
-- here so an operator can reply privately — it is never rendered back
-- to the website. Triaged out-of-band; `handled_at` is stamped once an
-- operator has actioned the message. Lands on the control DB (Postgres).

CREATE TABLE IF NOT EXISTS "contact_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  -- Collected so the operator can reply privately. NEVER echoed back to
  -- the website in any state.
  "email" text NOT NULL,
  -- Routing hint chosen by the sender. Values: general | support | sales
  -- | security | privacy | other.
  "topic" text NOT NULL,
  "message" text NOT NULL,
  -- Abuse signals — hashed IP + raw user-agent, both nullable when the
  -- request arrives without them.
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Stamped once an operator has actioned the message.
  "handled_at" timestamp with time zone
);

-- Triage queue: operator reviews newest-first.
CREATE INDEX IF NOT EXISTS "contact_messages_created_idx"
  ON "contact_messages" USING btree ("created_at" DESC);
