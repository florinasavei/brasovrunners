-- «Confirmă pentru tombolă»: a volunteer the organizers confirmed for the event's raffle alone, not as a volunteer — when, by
-- which staff account (SET NULL), and, for a minor, that the parent or guardian agreed and how (by telephone, in person, in
-- writing). Expand only: four nullable columns, the account's foreign key and two CHECKs — nothing of a confirmation without its
-- moment, and the parent's agreement as its tick and one of the three ways together, or neither (IS TRUE and IS NOT NULL, since
-- a CHECK passes on NULL). Nothing is backfilled: every volunteer from before reads not confirmed for the raffle, which changes
-- nothing of who takes part.
ALTER TABLE "event_volunteers" ADD COLUMN "raffle_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "raffle_confirmed_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "raffle_guardian_agreed" boolean;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "raffle_guardian_way" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_raffle_confirmed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("raffle_confirmed_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_raffle_confirmation_whole" CHECK ("event_volunteers"."raffle_confirmed_at" IS NOT NULL OR ("event_volunteers"."raffle_confirmed_by_staff_user_id" IS NULL AND "event_volunteers"."raffle_guardian_agreed" IS NULL AND "event_volunteers"."raffle_guardian_way" IS NULL));--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_raffle_guardian_whole" CHECK (("event_volunteers"."raffle_guardian_agreed" IS NULL AND "event_volunteers"."raffle_guardian_way" IS NULL) OR ("event_volunteers"."raffle_guardian_agreed" IS TRUE AND "event_volunteers"."raffle_guardian_way" IS NOT NULL AND "event_volunteers"."raffle_guardian_way" IN ('PHONE', 'IN_PERSON', 'WRITING')));