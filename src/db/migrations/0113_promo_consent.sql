ALTER TABLE "registrations" ADD COLUMN "promo_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "promo_consent_at" timestamp with time zone;