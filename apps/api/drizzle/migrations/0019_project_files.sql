-- 0019_project_files — metadata for S3-compatible object storage.
-- The actual object bytes live in MinIO under `projects/<projectId>/<fileId>`.
-- The storage service is the only path that mints presigned PUT/GET URLs
-- against that prefix, so the unique index on object_key catches any
-- code path that tries to register two rows for the same object.

CREATE TABLE IF NOT EXISTS "project_files" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "name" text NOT NULL,
  "object_key" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" text NOT NULL,
  "checksum_sha256" text,
  "uploaded_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "project_files_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_files_uploaded_by_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL
);

-- Per-project list query: hot path is "list non-deleted files for a project".
CREATE INDEX IF NOT EXISTS "project_files_project_idx"
  ON "project_files" USING btree ("project_id")
  WHERE "deleted_at" IS NULL;

-- Object keys are unique across the whole bucket.
CREATE UNIQUE INDEX IF NOT EXISTS "project_files_object_key_idx"
  ON "project_files" USING btree ("object_key");
