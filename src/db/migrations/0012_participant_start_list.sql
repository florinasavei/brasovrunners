/*
  The public start list, built switched off (BR-REQ-039-01, DECISIONS.md §32).

  Publishing the names of the people who entered a race is a disclosure of their personal data,
  and the club's privacy notice is sample text nobody has approved. So the column that turns it
  on defaults to HIDDEN for every row that exists and every row created after this, and the
  participant's own refusal has a column of its own.

  Additive only: two columns with defaults and one CHECK that every existing row already
  satisfies, because HIDDEN satisfies it unconditionally.
*/
CREATE TYPE "public"."participant_list_visibility" AS ENUM('HIDDEN', 'NAMES');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "participant_list_visibility" "participant_list_visibility" DEFAULT 'HIDDEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "list_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_participant_list_internal_only" CHECK ("events"."participant_list_visibility" = 'HIDDEN' OR "events"."registration_mode" = 'INTERNAL');
