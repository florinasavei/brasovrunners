CREATE TABLE "faq_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_ro" text NOT NULL,
	"question_en" text NOT NULL,
	"category_ro" text,
	"category_en" text,
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
	CONSTRAINT "faq_questions_questions_present" CHECK (length(btrim("faq_questions"."question_ro")) > 0 AND length(btrim("faq_questions"."question_en")) > 0),
	CONSTRAINT "faq_questions_category_pair" CHECK (("faq_questions"."category_ro" IS NULL) = ("faq_questions"."category_en" IS NULL)),
	CONSTRAINT "faq_questions_position_positive" CHECK ("faq_questions"."position" >= 1),
	CONSTRAINT "faq_questions_version_positive" CHECK ("faq_questions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "faq_questions" ADD CONSTRAINT "faq_questions_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_questions" ADD CONSTRAINT "faq_questions_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faq_questions_visible_position_idx" ON "faq_questions" USING btree ("visible","position");