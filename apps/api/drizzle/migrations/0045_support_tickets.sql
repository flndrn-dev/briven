-- 0045_support_tickets — turn tagged /contact submissions into support tickets.
--
-- Extends the existing contact_messages intake (0036/0037) with a ticket
-- lifecycle: a submission becomes a ticket only when the sender tagged it
-- with a routing tag (#support/#billing/#technical/#self-hosting). Ticketed
-- rows get a human-facing ticket_number (e.g. SUP260629-000001, stored
-- WITHOUT the leading '#'), a topic_code (SUP/BIL/TEC/SLF), and a status
-- that starts at 'no_response'. Non-ticketed rows leave ticket_number /
-- topic_code NULL and keep the default status (never surfaced for them).
--
-- ticket_counters drives the daily, per-topic sequence: one row per
-- (topic_code, day), incremented atomically by INSERT ... ON CONFLICT DO
-- UPDATE so concurrent submissions can never collide on a number, and the
-- counter resets to 1 each new UTC day per code.
--
-- contact_message_replies is the append-only ticket thread (operator/user),
-- cascading off the parent contact_messages row.

-- Ticket columns on the existing intake table.
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'no_response' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "ticket_number" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "topic_code" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "assigned_to" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "operator_notes" text;--> statement-breakpoint

-- Nullable-unique ticket number: many non-ticket rows stay NULL (Postgres
-- allows multiple NULLs in a unique index), ticketed rows stay globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_messages_ticket_number_idx"
  ON "contact_messages" USING btree ("ticket_number");--> statement-breakpoint

-- Daily, per-topic-code sequence. PK (topic_code, day) is what the
-- ON CONFLICT increment keys on.
CREATE TABLE IF NOT EXISTS "ticket_counters" (
  "topic_code" text NOT NULL,
  "day" date NOT NULL,
  "counter" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "ticket_counters_topic_code_day_pk" PRIMARY KEY("topic_code","day")
);--> statement-breakpoint

-- Append-only ticket thread.
CREATE TABLE IF NOT EXISTS "contact_message_replies" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  -- 'operator' (admin reply) | 'user' (inbound reply).
  "author" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "contact_message_replies"
  ADD CONSTRAINT "contact_message_replies_message_id_contact_messages_id_fk"
  FOREIGN KEY ("message_id") REFERENCES "contact_messages"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "contact_message_replies_message_idx"
  ON "contact_message_replies" USING btree ("message_id");
