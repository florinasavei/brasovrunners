CREATE TABLE "faq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_ro" text NOT NULL,
	"question_en" text NOT NULL,
	"answer_ro_json" jsonb NOT NULL,
	"answer_en_json" jsonb NOT NULL,
	"answer_ro" text NOT NULL,
	"answer_en" text NOT NULL,
	"position" integer NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"created_by_staff_user_id" uuid,
	"updated_by_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faq_items_questions_present" CHECK (length(btrim("faq_items"."question_ro")) > 0 AND length(btrim("faq_items"."question_en")) > 0),
	CONSTRAINT "faq_items_position_positive" CHECK ("faq_items"."position" >= 1),
	CONSTRAINT "faq_items_version_positive" CHECK ("faq_items"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faq_items_visible_position_idx" ON "faq_items" USING btree ("visible","position");