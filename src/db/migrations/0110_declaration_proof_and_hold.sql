ALTER TABLE "declaration_acceptances" ADD COLUMN "text_hash" text;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "retention_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "retention_hold_reason" text;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "retention_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "retention_hold_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "text_hash" text;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "retention_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "retention_hold_reason" text;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "retention_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "retention_hold_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD CONSTRAINT "declaration_acceptances_retention_hold_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("retention_hold_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD CONSTRAINT "group_run_declarations_retention_hold_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("retention_hold_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD CONSTRAINT "declaration_acceptances_text_hash_is_sha256_hex" CHECK ("declaration_acceptances"."text_hash" IS NULL OR "declaration_acceptances"."text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD CONSTRAINT "group_run_declarations_text_hash_is_sha256_hex" CHECK ("group_run_declarations"."text_hash" IS NULL OR "group_run_declarations"."text_hash" ~ '^[0-9a-f]{64}$');