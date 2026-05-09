CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"polar_subscription_id" text,
	"polar_customer_id" text,
	"tier" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_owner_idx" ON "subscriptions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "subscriptions_polar_idx" ON "subscriptions" USING btree ("polar_subscription_id");