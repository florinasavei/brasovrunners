ALTER TYPE "public"."email_message_type" ADD VALUE 'DOOR_SHUT';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'DOOR_SHUT_DEADLINES_MOVED';--> statement-breakpoint
CREATE TABLE "door_shut_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text NOT NULL,
	"stopped_minutes" integer,
	"links_moved_at" timestamp with time zone,
	"events_moved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"moved_count" integer DEFAULT 0 NOT NULL,
	"outside_count" integer DEFAULT 0 NOT NULL,
	"opened_notice_at" timestamp with time zone,
	"closed_notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_shut_windows_source_known" CHECK ("door_shut_windows"."source" in ('name', 'pings')),
	CONSTRAINT "door_shut_windows_ends_after_start" CHECK ("door_shut_windows"."ended_at" is null or "door_shut_windows"."ended_at" >= "door_shut_windows"."started_at"),
	CONSTRAINT "door_shut_windows_counts_non_negative" CHECK ("door_shut_windows"."moved_count" >= 0 and "door_shut_windows"."outside_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "door_shut_windows_one_open" ON "door_shut_windows" USING btree (("ended_at" is null)) WHERE "door_shut_windows"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "door_shut_windows_started_at_idx" ON "door_shut_windows" USING btree ("started_at");