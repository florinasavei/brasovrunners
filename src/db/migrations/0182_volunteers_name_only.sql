ALTER TABLE "event_volunteers" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ALTER COLUMN "canonical_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ALTER COLUMN "canonicalization_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_address_whole" CHECK (("event_volunteers"."email" IS NULL) = ("event_volunteers"."canonical_email" IS NULL) AND ("event_volunteers"."email" IS NULL) = ("event_volunteers"."canonicalization_version" IS NULL));--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_public_contact" CHECK ("event_volunteers"."source" = 'STAFF' OR ("event_volunteers"."email" IS NOT NULL AND "event_volunteers"."phone" IS NOT NULL));