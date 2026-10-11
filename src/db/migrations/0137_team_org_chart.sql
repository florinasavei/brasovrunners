CREATE TABLE "team_page_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_ro" text NOT NULL,
	"title_en" text NOT NULL,
	"body_ro_json" jsonb,
	"body_en_json" jsonb,
	"body_ro" text,
	"body_en" text,
	"position" integer NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"created_by_staff_user_id" uuid,
	"updated_by_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_page_boxes_title_ro_present" CHECK (length(btrim("team_page_boxes"."title_ro")) > 0),
	CONSTRAINT "team_page_boxes_title_en_present" CHECK (length(btrim("team_page_boxes"."title_en")) > 0),
	CONSTRAINT "team_page_boxes_position_positive" CHECK ("team_page_boxes"."position" >= 1),
	CONSTRAINT "team_page_boxes_version_positive" CHECK ("team_page_boxes"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "subtitle_ro" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "subtitle_en" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "responsibilities_ro" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "responsibilities_en" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "reports_to_id" uuid;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "placement" text DEFAULT 'below' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_page_boxes" ADD CONSTRAINT "team_page_boxes_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_page_boxes" ADD CONSTRAINT "team_page_boxes_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_page_boxes_visible_position_idx" ON "team_page_boxes" USING btree ("visible","position");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_reports_to_id_team_members_id_fk" FOREIGN KEY ("reports_to_id") REFERENCES "public"."team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_reports_to_not_self" CHECK ("team_members"."reports_to_id" IS NULL OR "team_members"."reports_to_id" <> "team_members"."id");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_placement_known" CHECK ("team_members"."placement" IN ('below', 'beside'));