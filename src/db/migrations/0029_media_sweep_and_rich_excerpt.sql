ALTER TABLE "event_translations" ADD COLUMN "excerpt_json" jsonb;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "last_referenced_at" timestamp with time zone DEFAULT now() NOT NULL;