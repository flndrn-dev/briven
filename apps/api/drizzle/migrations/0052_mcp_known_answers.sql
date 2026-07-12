-- 0052_mcp_known_answers — briven_ask self-growing knowledge base (owner-approved 2026-07-12).
--
-- A platform-WIDE cache of answers the briven_ask desk produced for questions
-- no hand-curated guide matched. When briven's grounded answer-writer composes
-- a fresh answer (only from briven's own docs — never invented), it is stored
-- here keyed by a normalised topic key, so the NEXT agent anywhere gets the
-- same answer instantly instead of re-deriving it or wandering off-platform.
-- `source` is 'seed' (a briven session) or 'auto' (the writer). Read by every
-- project through its own key — the key only gates access; the knowledge is
-- shared, exactly like the curated guides. Lands on the control DB (Postgres).
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "mcp_known_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_key" text NOT NULL,
	"question" text NOT NULL,
	"answer" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_known_answers_topic_key_idx" ON "mcp_known_answers" ("topic_key");
