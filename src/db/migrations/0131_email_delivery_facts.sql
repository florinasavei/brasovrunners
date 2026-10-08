ALTER TABLE "email_outbox" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "rejection_cause" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "provider_code" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "provider_detail" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "later_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "retried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "retried_via" text;--> statement-breakpoint
CREATE INDEX "email_outbox_provider_message_id_idx" ON "email_outbox" USING btree ("provider_message_id") WHERE "email_outbox"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "email_outbox_participant_idx" ON "email_outbox" USING btree ("participant_id");--> statement-breakpoint
-- The backfill of the refusals written before the cause was stored (§NNN), once. They have two shapes only: Mailgun's one-word reason from the webhook, or the answer stored at the send ("mailgun NNN: …", "gmail: …"). The same rule as `rejectionCause` (notifications/domain/rejection-cause.ts) reads those shapes, and `isAccountRefusalError` (infrastructure/email/mailgun-adapter.ts) the account's: a refusal at the send is the club's account unless it is the one 400 that names the address or the recipient and not the sender, after the probation's pause and the spent allowance are ruled out. tests/integration/notifications/rejection-backfill.test.ts runs this statement against the TypeScript on the same rows. No delivery or rejection instant is invented: none was recorded before this release.
UPDATE "email_outbox" SET "rejection_cause" = CASE
  WHEN "status" = 'COMPLAINED' THEN 'complained'
  WHEN lower(trim(coalesce("last_error", ''))) = 'suppress-bounce' THEN 'suppressed'
  WHEN lower(trim(coalesce("last_error", ''))) = 'suppress-unsubscribe' THEN 'unsubscribed'
  WHEN lower(trim(coalesce("last_error", ''))) = 'suppress-complaint' THEN 'complaint-suppressed'
  WHEN coalesce("last_error", '') ~ '^mailgun [0-9]{3}:' THEN CASE
    WHEN "sent_at" IS NULL AND NOT (
      substring("last_error" from '^mailgun ([0-9]{3}):') = '400'
      AND NOT (replace(coalesce(substring("last_error" from '^mailgun [0-9]{3}:\s?(.*)$'), ''), '<address>', ' ') ~* 'not allowed to send'
        AND replace(coalesce(substring("last_error" from '^mailgun [0-9]{3}:\s?(.*)$'), ''), '<address>', ' ') ~* '(temporarily|account (is )?disabled|probation|too fast|rate limit)')
      AND replace(coalesce(substring("last_error" from '^mailgun [0-9]{3}:\s?(.*)$'), ''), '<address>', ' ') !~* '(limit exceeded|exceeded your|sending limit|daily limit|quota)'
      AND replace(coalesce(substring("last_error" from '^mailgun [0-9]{3}:\s?(.*)$'), ''), '<address>', ' ') ~* '(address|recipient)'
      AND replace(coalesce(substring("last_error" from '^mailgun [0-9]{3}:\s?(.*)$'), ''), '<address>', ' ') !~* '(''?from''?\s+parameter|sender)'
    ) THEN 'account'
    WHEN "last_error" ~* 'not a valid address' THEN 'no-such-address'
    ELSE 'other'
  END
  WHEN coalesce("last_error", '') ~ '^gmail:' THEN CASE WHEN "last_error" ~ '\m5\.1\.[0-9]{1,3}\M' THEN 'no-such-address' ELSE 'other' END
  WHEN lower(trim(coalesce("last_error", ''))) IN ('old', 'greylisted') THEN 'gave-up'
  WHEN lower(trim(coalesce("last_error", ''))) IN ('espblock', 'blacklisted') THEN 'blocked'
  WHEN lower(trim(coalesce("last_error", ''))) = 'hardfail' THEN 'no-such-address'
  WHEN lower(trim(coalesce("last_error", ''))) = 'bounce' THEN 'refused'
  ELSE 'other'
END
WHERE "status" IN ('BOUNCED', 'COMPLAINED') AND "rejection_cause" IS NULL;--> statement-breakpoint
-- A refused or complained-about participant's message that was already sent again — the same type, or one that carries it (notifications/domain/content-cover.ts: the confirmation carries the race number's QR and the signed declaration, the reminder the race number's QR, and the confirmation, the reminder and the declaration request the event's details as they stood, which a refused «Detalii actualizate» was to tell), for the same registration, sent no earlier than it was queued (what a message carries is read when it is rendered, at its send, so `sent_at` is the instant it carries) — says so: the latest send, and its road (the send whose delivery may still come; the runtime's `noteSentAgain` keeps the same). So a race number refused on 1-2 October and answered by «Retrimite QR» before this release reads as sent again. Never the club's own messages (the archive copies, the confirmation notice), which carry the participant's id but are not theirs.
UPDATE "email_outbox" AS "x" SET ("retried_at", "retried_via") = (
  SELECT "r"."sent_at", coalesce("r"."transport", 'mailgun')
  FROM "email_outbox" AS "r"
  WHERE "r"."participant_id" = "x"."participant_id"
    AND "r"."registration_id" IS NOT DISTINCT FROM "x"."registration_id"
    AND ("r"."message_type" = "x"."message_type" OR ("r"."message_type"::text, "x"."message_type"::text) IN (('REGISTRATION_CONFIRMED', 'BIB_ASSIGNED'), ('REGISTRATION_CONFIRMED', 'DECLARATION_SIGNED'), ('REGISTRATION_CONFIRMED', 'EVENT_UPDATE_NOTICE'), ('EVENT_REMINDER', 'BIB_ASSIGNED'), ('EVENT_REMINDER', 'EVENT_UPDATE_NOTICE'), ('COMPLETE_DECLARATION', 'EVENT_UPDATE_NOTICE')))
    AND "r"."id" <> "x"."id"
    AND "r"."sent_at" >= "x"."created_at"
    AND "r"."sent_at" IS NOT NULL
  ORDER BY "r"."sent_at" DESC
  LIMIT 1
)
WHERE "x"."status" IN ('BOUNCED', 'COMPLAINED')
  AND "x"."participant_id" IS NOT NULL
  AND "x"."message_type" NOT IN ('DECLARATION_ARCHIVE', 'GROUP_RUN_DECLARATION_ARCHIVE', 'CLUB_CONFIRMATION_NOTICE')
  AND EXISTS (
    SELECT 1 FROM "email_outbox" AS "r"
    WHERE "r"."participant_id" = "x"."participant_id"
      AND "r"."registration_id" IS NOT DISTINCT FROM "x"."registration_id"
      AND ("r"."message_type" = "x"."message_type" OR ("r"."message_type"::text, "x"."message_type"::text) IN (('REGISTRATION_CONFIRMED', 'BIB_ASSIGNED'), ('REGISTRATION_CONFIRMED', 'DECLARATION_SIGNED'), ('REGISTRATION_CONFIRMED', 'EVENT_UPDATE_NOTICE'), ('EVENT_REMINDER', 'BIB_ASSIGNED'), ('EVENT_REMINDER', 'EVENT_UPDATE_NOTICE'), ('COMPLETE_DECLARATION', 'EVENT_UPDATE_NOTICE')))
      AND "r"."id" <> "x"."id"
      AND "r"."sent_at" >= "x"."created_at"
      AND "r"."sent_at" IS NOT NULL
  );--> statement-breakpoint
-- A refusal of the club's account is over once the same message, or one that carries it, left after it: it never said anything about the address, and what became of the later one is that row's own story.
UPDATE "email_outbox" AS "x" SET "resolved_at" = (
  SELECT min("r"."sent_at")
  FROM "email_outbox" AS "r"
  WHERE "r"."participant_id" = "x"."participant_id"
    AND "r"."registration_id" IS NOT DISTINCT FROM "x"."registration_id"
    AND ("r"."message_type" = "x"."message_type" OR ("r"."message_type"::text, "x"."message_type"::text) IN (('REGISTRATION_CONFIRMED', 'BIB_ASSIGNED'), ('REGISTRATION_CONFIRMED', 'DECLARATION_SIGNED'), ('REGISTRATION_CONFIRMED', 'EVENT_UPDATE_NOTICE'), ('EVENT_REMINDER', 'BIB_ASSIGNED'), ('EVENT_REMINDER', 'EVENT_UPDATE_NOTICE'), ('COMPLETE_DECLARATION', 'EVENT_UPDATE_NOTICE')))
    AND "r"."id" <> "x"."id"
    AND "r"."sent_at" >= "x"."created_at"
    AND "r"."sent_at" IS NOT NULL
)
WHERE "x"."rejection_cause" = 'account' AND "x"."retried_at" IS NOT NULL;
