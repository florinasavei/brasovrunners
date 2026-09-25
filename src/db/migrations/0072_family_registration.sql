ALTER TYPE "public"."email_action_token_purpose" ADD VALUE 'REGISTER_ANOTHER_PERSON';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'REGISTER_ANOTHER_PERSON';--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "name_key" text;--> statement-breakpoint
-- The key of every row written before the column (§389): an approximation in SQL of `foldName`
-- (case, whitespace, Romanian and common Latin diacritics, the apostrophe's shape). The service
-- never reads this column to decide anything — it folds the names themselves under the event's
-- lock — so an approximation costs nothing; and `registrations_event_participant_unique` still
-- holds one row per address per event, so no two rows can meet in the index created below.
UPDATE "registrations" SET "name_key" = btrim(regexp_replace(lower(translate("registered_name", 'ĂÂÎȘŞȚŢăâîșşțţÁÀÄÉÈËÍÌÏÓÒÖŐÚÙÜŰÇÑáàäéèëíìïóòöőúùüűçñ’‘`´', 'AAISSTTaaisstt' || 'AAAEEEIIIOOOOUUUUCN' || 'aaaeeeiiioooouuuucn' || '''''''''')), '\s+', ' ', 'g')) WHERE "name_key" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_participant_name_unique" ON "registrations" USING btree ("event_id","participant_id","name_key");