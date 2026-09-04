CREATE TYPE "public"."staff_role" AS ENUM('AUTHOR', 'EDITOR', 'ADMIN');--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_subject" text,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"preferred_locale" "locale" DEFAULT 'ro' NOT NULL,
	"role" "staff_role" NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_signed_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_auth_subject_unique" UNIQUE("auth_subject"),
	CONSTRAINT "staff_users_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_users_email_is_lowercase" CHECK ("staff_users"."email" = lower("staff_users"."email")),
	CONSTRAINT "staff_users_signed_in_has_subject" CHECK (("staff_users"."auth_subject" IS NULL) = ("staff_users"."first_signed_in_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "event_translations" ADD COLUMN "author_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_translations" ADD COLUMN "reviewed_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "race_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "created_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "updated_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_author_staff_user_id_staff_users_id_fk" FOREIGN KEY ("author_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_reviewed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("reviewed_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_only_one_featured" ON "events" USING btree ("featured") WHERE "events"."featured";--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_version_positive" CHECK ("event_translations"."version" >= 1);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_race_start_within_event" CHECK ("events"."race_starts_at" IS NULL
          OR ("events"."race_starts_at" >= "events"."starts_at"
              AND ("events"."ends_at" IS NULL OR "events"."race_starts_at" <= "events"."ends_at")));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_map_url_is_https" CHECK ("events"."map_url" IS NULL OR "events"."map_url" LIKE 'https://%');