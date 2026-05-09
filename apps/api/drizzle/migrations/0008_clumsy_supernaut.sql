CREATE TABLE "function_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"invocation_id" text NOT NULL,
	"function_name" varchar(128) NOT NULL,
	"status" varchar(8) NOT NULL,
	"duration_ms" varchar(12) NOT NULL,
	"touched_tables" jsonb NOT NULL,
	"user_logs_json" jsonb NOT NULL,
	"err_code" text,
	"err_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "function_logs" ADD CONSTRAINT "function_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "function_logs" ADD CONSTRAINT "function_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "function_logs_project_created_idx" ON "function_logs" USING btree ("project_id","created_at");