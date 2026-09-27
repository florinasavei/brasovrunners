-- expand: data only (§NNN) — the newsletter stops offering «Coduri de reducere» (DISCOUNTS): discount codes are for the club's members. No column, type or constraint changes; the enum value stays, because a value is never removed and an old newsletter_sends row may name it. The code serving while this runs may still write DISCOUNTS into a new subscription, which the new code reads without harm and drops at the subscriber's next save.
--
-- A subscriber whose only topic was DISCOUNTS is deleted, with its links by cascade: nothing else
-- was asked for, and newsletter_subscribers_topics_not_empty refuses an empty list — the same
-- rule as "unsubscribing from everything deletes the row" (§445). Everyone else keeps every other
-- topic they chose, DISCOUNTS removed.
DELETE FROM "newsletter_subscribers" WHERE "topics" <@ ARRAY['DISCOUNTS']::"newsletter_topic"[];
--> statement-breakpoint
UPDATE "newsletter_subscribers" SET "topics" = array_remove("topics", 'DISCOUNTS'::"newsletter_topic"), "updated_at" = now() WHERE 'DISCOUNTS'::"newsletter_topic" = ANY("topics");
