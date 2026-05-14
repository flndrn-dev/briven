-- 0023_abuse_reports — dedicated table; replaces the audit-log overload
-- that services/abuse.ts used pre-cleanup. audit_logs still receives
-- one row per state transition for the security audit perspective,
-- but the dashboard's abuse-triage list now reads this table directly.
-- Historical abuse rows in audit_logs are preserved for forensics;
-- a one-off backfill into abuse_reports can be done later if needed.

CREATE TABLE IF NOT EXISTS "abuse_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "target_url" text NOT NULL,
  "reason" text NOT NULL,
  "severity" text NOT NULL,
  "reporter_contact" text,
  "source_ip_hash" text,
  "source_user_agent" text,
  "status" text DEFAULT 'open' NOT NULL,
  "resolution" text,
  "project_id" text,
  "triaged_at" timestamp with time zone,
  "triaged_by" text,
  "triage_notes" text,
  "resolved_at" timestamp with time zone,
  "resolved_by" text,
  "resolve_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "abuse_reports_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL,
  CONSTRAINT "abuse_reports_triaged_by_fk"
    FOREIGN KEY ("triaged_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "abuse_reports_resolved_by_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "abuse_reports_status_idx"
  ON "abuse_reports" USING btree ("status", "created_at");

CREATE INDEX IF NOT EXISTS "abuse_reports_severity_idx"
  ON "abuse_reports" USING btree ("severity", "created_at");

CREATE INDEX IF NOT EXISTS "abuse_reports_project_idx"
  ON "abuse_reports" USING btree ("project_id")
  WHERE "project_id" IS NOT NULL;
