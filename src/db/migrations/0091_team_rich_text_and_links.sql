ALTER TABLE "team_members" ADD COLUMN "bio_ro_json" jsonb;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "bio_en_json" jsonb;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "links" jsonb;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_links_is_a_short_array_of_https_links" CHECK ("team_members"."links" IS NULL OR CASE WHEN jsonb_typeof("team_members"."links") = 'array' THEN jsonb_array_length("team_members"."links") <= 6 AND NOT jsonb_path_exists("team_members"."links", '$[*] ? (!(@.url.type() == "string" && @.url starts with "https://"))') ELSE false END);
