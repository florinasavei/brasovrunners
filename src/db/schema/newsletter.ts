import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * The club's newsletter (§445; the owner, 2026-09-26: "the registration needs to be on the contact
 * page, a button for a pop-up and people can opt in on what to receive"). §80 named what a
 * newsletter is before one existed — "a message type, a consent, an unsubscribe link and a
 * privacy-notice paragraph, not a button" — and these three tables are the consent and the link.
 *
 * **The topics** a subscriber picks. `ALL` is "everything the club sends", today's topics and any
 * added later; the rest are one subject each. The order here is the order the pop-up lists them.
 * A value is added by a migration (expand only) and never removed.
 */
export const newsletterTopic = pgEnum("newsletter_topic", [
  // «Toate noutățile»: every topic, today's and any added later.
  "ALL",
  // The club's own big days: its races, the anniversary cross. A new race is announced here.
  "BIG_EVENTS",
  // Discount codes from the club's partners.
  "DISCOUNTS",
  // Shoe and gear testing sessions (the `GEAR_TEST` event type).
  "GEAR_TESTING",
  // Special editions, partnerships and other organizers' events (§168, §344, `EXTERNAL`).
  "SPECIAL_EVENTS",
  // The weekly group runs: a new series announced once, never date by date (§111, §113).
  "WEEKLY_RUNS",
  // Calls for volunteers at the club's races.
  "VOLUNTEERING",
  // Results and photo albums after an event (§66).
  "RESULTS_PHOTOS",
]);

export type NewsletterTopic = (typeof newsletterTopic.enumValues)[number];

/**
 * One address that asked for the newsletter — nobody's registration, no participant row.
 *
 * The same identity rule as everywhere (AGENTS.md §10.4): the UNIQUE constraint is on the
 * canonical address, so `Ana.Pop+x@gmail.com` and `ana.pop@gmail.com` are one subscriber and the
 * pop-up cannot be used to ask whether an address is already on the list.
 *
 * **Double opt-in.** A row is written unconfirmed (`confirmed_at` null) and nothing is ever sent to
 * it but the one confirmation message; it becomes a subscriber only when the link in that message
 * is followed and the button pressed. An unconfirmed row is deleted by the retention sweep once
 * its link can no longer work (`jobs/retention.ts`), so an address somebody else typed is not kept.
 *
 * **Withdrawal deletes.** Unsubscribing from everything removes the row — and its links, by
 * cascade — rather than blanking it: nothing is kept about a person who said no (AGENTS.md: erase
 * deletes). What stays is what the outbox keeps of any message (§16.1).
 *
 * `privacy_notice_version` is the notice in force when the address was left: the consent's record
 * (GDPR art. 7(1)), the way a registration records its own.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // As typed, minus whitespace: where the messages go.
    deliveryEmail: text("delivery_email").notNull(),
    canonicalEmail: text("canonical_email").notNull().unique(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    // The language of the page the address was left on; the subscriber's messages read in it first.
    locale: locale("locale").notNull(),
    topics: newsletterTopic("topics").array().notNull(),
    privacyNoticeVersion: integer("privacy_notice_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Null until the confirmation link is used: an unconfirmed address is written to once, never again.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    // At least one topic: a subscriber who wants nothing is not a subscriber, and is deleted instead.
    check("newsletter_subscribers_topics_not_empty", sql`cardinality(${t.topics}) >= 1`),
    index("newsletter_subscribers_confirmed_idx").on(t.confirmedAt),
  ],
);

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;

/**
 * What a newsletter link is for. `CONFIRM` is the double opt-in's single-use link; `MANAGE` opens
 * the subscriber's own page — the topics and "unsubscribe from everything" — from every message.
 */
export const newsletterTokenPurpose = pgEnum("newsletter_token_purpose", ["CONFIRM", "MANAGE"]);

/**
 * The newsletter's links, on the rule of `email_action_tokens` (AGENTS.md §12.8, §13.2): only the
 * SHA-256 of the secret is stored, and a CHECK refuses anything else; the secret is minted when the
 * message is rendered and exists only in that message (§14.5). A table of its own because those
 * tokens belong to a participant, and a subscriber is not one.
 *
 * - `CONFIRM` is single use and superseded: a new confirmation message kills the previous link
 *   (the partial unique index below), and pressing the button spends it.
 * - `MANAGE` is read by the page's GET and spent by either button's POST (AGENTS.md §12.8: single
 *   use). Saving the topics mints its successor in the same transaction and the page moves to it,
 *   so the person can keep choosing on one visit; every message carries a fresh link of its own,
 *   so a link from last spring still works until it is used. Unsubscribing deletes the subscriber
 *   and every link with it.
 */
export const newsletterTokens = pgTable(
  "newsletter_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => newsletterSubscribers.id, { onDelete: "cascade" }),
    purpose: newsletterTokenPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("newsletter_tokens_hash_is_sha256_hex", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("newsletter_tokens_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
    // One live confirmation link per subscriber: a second message supersedes the first.
    uniqueIndex("newsletter_tokens_one_active_confirm")
      .on(t.subscriberId)
      .where(sql`"purpose" = 'CONFIRM' AND "used_at" IS NULL AND "invalidated_at" IS NULL`),
    index("newsletter_tokens_subscriber_purpose_expiry_idx").on(t.subscriberId, t.purpose, t.expiresAt),
  ],
);

/**
 * `MESSAGE` is a newsletter an organizer wrote on `/admin/newsletter`; `EVENT_ALERT` is the platform's
 * own "a new event is on the calendar", queued by the maintenance job once per event.
 */
export const newsletterSendKind = pgEnum("newsletter_send_kind", ["MESSAGE", "EVENT_ALERT"]);

/**
 * One send: its words (the club's publication, nobody's personal data — kept here once rather than
 * in every outbox row), the topics it went to, how many subscribers it reached and who pressed Send.
 *
 * The id of a `MESSAGE` is minted when the composer is drawn, so a second press of the same form
 * finds this row and queues nothing (§364's rule). An `EVENT_ALERT` names its event, once — the
 * UNIQUE index is what makes "once per event" a fact rather than a habit; an event erased outright
 * leaves the row with no event, which still says the alert went.
 */
export const newsletterSends = pgTable(
  "newsletter_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: newsletterSendKind("kind").notNull(),
    topics: newsletterTopic("topics").array().notNull(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    // `{ ro, en }` — both, always (bilingual always); null on an alert, whose words are the event's.
    subject: jsonb("subject"),
    body: jsonb("body"),
    recipients: integer("recipients").notNull().default(0),
    sentByStaffUserId: uuid("sent_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("newsletter_sends_one_alert_per_event").on(t.eventId),
    check("newsletter_sends_recipients_non_negative", sql`${t.recipients} >= 0`),
    index("newsletter_sends_created_idx").on(t.createdAt),
  ],
);

export type NewsletterSend = typeof newsletterSends.$inferSelect;
