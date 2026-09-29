CREATE TABLE "member_discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_name" text NOT NULL,
	"code" text NOT NULL,
	"description_ro" text,
	"description_en" text,
	"link" text,
	"valid_until" date,
	"position" integer NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_by_staff_user_id" uuid,
	"updated_by_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_discount_codes_partner_present" CHECK (length(btrim("member_discount_codes"."partner_name")) > 0),
	CONSTRAINT "member_discount_codes_code_present" CHECK (length(btrim("member_discount_codes"."code")) > 0),
	CONSTRAINT "member_discount_codes_link_https" CHECK ("member_discount_codes"."link" IS NULL OR "member_discount_codes"."link" LIKE 'https://%'),
	CONSTRAINT "member_discount_codes_position_positive" CHECK ("member_discount_codes"."position" >= 1),
	CONSTRAINT "member_discount_codes_version_positive" CHECK ("member_discount_codes"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "members_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_discount_codes" ADD CONSTRAINT "member_discount_codes_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_discount_codes" ADD CONSTRAINT "member_discount_codes_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_discount_codes_hidden_position_idx" ON "member_discount_codes" USING btree ("hidden","position");