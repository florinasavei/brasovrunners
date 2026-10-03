ALTER TYPE "public"."email_message_type" ADD VALUE 'UNREACHABLE_WINDOW_OPENED';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'UNREACHABLE_WINDOW_CLOSED';--> statement-breakpoint
CREATE TABLE "unreachable_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"granted_ms" bigint DEFAULT 0 NOT NULL,
	"rows_moved" integer DEFAULT 0 NOT NULL,
	"places_outside" integer DEFAULT 0 NOT NULL,
	"links_moved_at" timestamp with time zone,
	"events_moved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"opened_announced_at" timestamp with time zone,
	"closed_announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unreachable_windows_source_known" CHECK ("unreachable_windows"."source" in ('dns', 'pings')),
	CONSTRAINT "unreachable_windows_ends_after_start" CHECK ("unreachable_windows"."ended_at" is null or "unreachable_windows"."ended_at" >= "unreachable_windows"."started_at"),
	CONSTRAINT "unreachable_windows_pings_confirmed" CHECK ("unreachable_windows"."source" = 'dns' or "unreachable_windows"."confirmed_at" is not null),
	CONSTRAINT "unreachable_windows_counts_non_negative" CHECK ("unreachable_windows"."granted_ms" >= 0 and "unreachable_windows"."rows_moved" >= 0 and "unreachable_windows"."places_outside" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unreachable_windows_one_open" ON "unreachable_windows" USING btree (("ended_at" is null)) WHERE "unreachable_windows"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "unreachable_windows_started_at_idx" ON "unreachable_windows" USING btree ("started_at");