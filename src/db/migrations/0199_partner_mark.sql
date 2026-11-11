-- «De la parteneri»: one nullable `partner_name` on registrations, on the internal list's lines and on invitations — the name of
-- the partner or sponsor through whom a person came, none meaning not. Expand only: three columns, each with the CHECK the schema
-- states (none, or a trimmed name of 1 to 120 characters). Nothing is backfilled; no row reads differently until staff write a name.
ALTER TABLE "event_invitations" ADD COLUMN "partner_name" text;--> statement-breakpoint
ALTER TABLE "event_reserve_entries" ADD COLUMN "partner_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "partner_name" text;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_partner_name_length" CHECK ("event_invitations"."partner_name" IS NULL OR (char_length("event_invitations"."partner_name") BETWEEN 1 AND 120 AND "event_invitations"."partner_name" = btrim("event_invitations"."partner_name")));--> statement-breakpoint
ALTER TABLE "event_reserve_entries" ADD CONSTRAINT "event_reserve_entries_partner_name_length" CHECK ("event_reserve_entries"."partner_name" IS NULL OR (char_length("event_reserve_entries"."partner_name") BETWEEN 1 AND 120 AND "event_reserve_entries"."partner_name" = btrim("event_reserve_entries"."partner_name")));--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_partner_name_length" CHECK ("registrations"."partner_name" IS NULL OR (char_length("registrations"."partner_name") BETWEEN 1 AND 120 AND "registrations"."partner_name" = btrim("registrations"."partner_name")));
