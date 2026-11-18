-- «Eticheta pe BIB»: what an elite bib prints where the number goes — `registrations.elite_bib_label` for a registration marked
-- «Elită», `event_elite_entries.bib_label` for a line of the race's elite list. Null is the default and the rule from before: the
-- first name, the line's first word (`bib-elite.ts`). Expand only: two nullable columns and their CHECKs (1 to ELITE_NAME_MAX = 80
-- characters); nothing is backfilled, so every bib prints as it did until an Administrator types a label.
ALTER TABLE "event_elite_entries" ADD COLUMN "bib_label" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "elite_bib_label" text;--> statement-breakpoint
ALTER TABLE "event_elite_entries" ADD CONSTRAINT "event_elite_entries_bib_label_length" CHECK ("event_elite_entries"."bib_label" IS NULL OR char_length("event_elite_entries"."bib_label") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_elite_bib_label_length" CHECK ("registrations"."elite_bib_label" IS NULL OR char_length("registrations"."elite_bib_label") BETWEEN 1 AND 80);
