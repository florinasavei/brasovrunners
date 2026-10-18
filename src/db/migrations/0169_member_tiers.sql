CREATE TABLE "member_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ro" text,
	"description_en" text,
	"glyph" text DEFAULT 'star' NOT NULL,
	"position" integer NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_tiers_name_ro_present" CHECK (length(btrim("member_tiers"."name_ro")) > 0),
	CONSTRAINT "member_tiers_name_en_present" CHECK (length(btrim("member_tiers"."name_en")) > 0),
	CONSTRAINT "member_tiers_name_ro_short" CHECK (char_length("member_tiers"."name_ro") <= 40),
	CONSTRAINT "member_tiers_name_en_short" CHECK (char_length("member_tiers"."name_en") <= 40),
	CONSTRAINT "member_tiers_description_ro_short" CHECK ("member_tiers"."description_ro" IS NULL OR char_length("member_tiers"."description_ro") <= 400),
	CONSTRAINT "member_tiers_description_en_short" CHECK ("member_tiers"."description_en" IS NULL OR char_length("member_tiers"."description_en") <= 400),
	CONSTRAINT "member_tiers_position_positive" CHECK ("member_tiers"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "member_discount_codes" ADD COLUMN "tier_ids" uuid[];--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "member_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "member_tiers" ADD CONSTRAINT "member_tiers_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_tiers_position_idx" ON "member_tiers" USING btree ("position");--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_member_tier_id_member_tiers_id_fk" FOREIGN KEY ("member_tier_id") REFERENCES "public"."member_tiers"("id") ON DELETE set null ON UPDATE no action;