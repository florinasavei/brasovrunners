-- The registration audit (§NNN). Expand only: the index below allows more than it did, and the
-- UPDATE clears a column the code already treats as released.
--
-- 1. Every "register another person" link stays live for its window (§389): the partial unique
--    index no longer holds one active link per registration for that one purpose. The old code
--    still supersedes before it inserts, so it never meets the looser index; the new code, which
--    does not, waits for this migration before it is built (scripts/wait-for-migration.mjs).
DROP INDEX "email_action_tokens_one_active_per_registration_purpose";--> statement-breakpoint
CREATE UNIQUE INDEX "email_action_tokens_one_active_per_registration_purpose" ON "email_action_tokens" USING btree ("registration_id","purpose") WHERE "used_at" IS NULL AND "invalidated_at" IS NULL AND "registration_id" IS NOT NULL AND "purpose" <> 'REGISTER_ANOTHER_PERSON';--> statement-breakpoint
-- 2. A registration that is over holds no provisional race number (§214, §220). The
--    lapsed-declaration sweep forgot to release it until this release; the rows it left set could
--    have a settled number given to somebody else and collide with it on re-allocation at the desk.
UPDATE "registrations" SET "provisional_bib_number" = NULL WHERE "status" IN ('EXPIRED', 'CANCELLED') AND "provisional_bib_number" IS NOT NULL;
