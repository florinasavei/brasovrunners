import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { locale } from "./locale";

/**
 * «Vin!» (§811, «Vin!» part 1; the owner, 2026-10-18: «how do I mark myself as "Going"?»).
 *
 * A person's answer «I am coming» to a turn-up event the club ticked (`events.rsvp_enabled`): an address,
 * optionally a name to show, and — once the person has used the link emailed to them, or answered as somebody
 * the platform already knows — the moment it was confirmed. **Not a registration**: it holds no place, signs
 * no declaration and creates no participant; the allocator, the registrations' states and the capacity formula
 * never meet it. The model is the interest box (`registration_interests`, §146) — one row per event and
 * canonical identity (the versioned canonicalizer, AGENTS.md §10.4; the form never says whether an address is
 * already here) — with two differences: the row stays until the event is over, and it can be public.
 *
 * **A public name is a disclosure** (§143, §396): `show_name` is the person's own tick «Vreau să apar cu
 * numele», and the name shows only for a confirmed row whose `privacy_notice_version` is that of a notice that
 * described «Vin!» or a later one (`modules/rsvp/domain/public-name.ts`). Everyone else is only counted.
 *
 * Rows are deleted 30 days after the event's end, 7 days after they were made when never confirmed, and at an
 * event's cancellation (`jobs/retention.ts`); "all the data of a person" lists and erases them
 * (`registrations/person-data.ts`). No audit rows: nothing here is something the staff did.
 */
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // As typed, minus whitespace: where the message goes.
    deliveryEmail: text("delivery_email").notNull(),
    // The identity the UNIQUE constraint below is on.
    canonicalEmail: text("canonical_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    // The name to show, when the person ticked `show_name`; at most 80 characters, checked below.
    displayName: text("display_name"),
    // «Vreau să apar cu numele»: the person's own tick, kept as given.
    showName: boolean("show_name").notNull().default(false),
    // The language of the page the answer was given on: the language of the message.
    locale: locale("locale").notNull(),
    // The privacy notice in force when the answer was given — what the person was told.
    privacyNoticeVersion: integer("privacy_notice_version").notNull(),
    // Null until the emailed link is used, or until a verified identity answered.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // Set when the row was made by the «Vii?» email (§818) for a newsletter subscriber, before any press: the page of its two
    // links then offers the optional name and says «Bine, nu te numărăm» for «Nu vin». Null for an answer typed on the page.
    askedAt: timestamp("asked_at", { withTimezone: true }),
    // Whom the question was sent as (§823): `SUBSCRIBER` (a newsletter subscriber of the topic) or `ANSWERER` (an earlier answerer). Null for an
    // answer typed on the page. A «Vin» pressed in a subscriber's question is an earlier answer only while that address still receives the topic.
    askedBasis: text("asked_basis"),
    // «Sunt membru» on a «Vin!» answer (§NNN, amending §812 and §796): `DECLARED` is the person's own tick on the page, in the remembered browser or on
    // the link's page — a claim the club does not check, said «declarat» in the backoffice; `ACCOUNT` is an answer given from the members' zone by
    // an account whose role is at least a member (`canOpenMembersZone`'s rule), set on the server from that role and never from a posted box. Null is
    // «not said» (§650), never «not a member». A text with a CHECK, like `asked_basis`: a new kind is a CHECK edit, not an `ALTER TYPE`. The mark
    // beside a shown name and the count «N vin · M membri» read it only for a row whose `privacy_notice_version` is that of a notice that describes
    // it (`rsvp/domain/public-member.ts`, the §421 rule); the version is recorded when the tick is given or changed, as the name's is (§827).
    clubMember: text("club_member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("event_rsvps_event_canonical_email_unique").on(t.eventId, t.canonicalEmail),
    check("event_rsvps_display_name_length", sql`${t.displayName} IS NULL OR char_length(${t.displayName}) <= 80`),
    check("event_rsvps_asked_basis_known", sql`${t.askedBasis} IS NULL OR ${t.askedBasis} IN ('SUBSCRIBER', 'ANSWERER')`),
    check("event_rsvps_club_member_known", sql`${t.clubMember} IS NULL OR ${t.clubMember} IN ('DECLARED', 'ACCOUNT')`),
    // The retention sweep's and the person's-data reads: by identity, across events.
    index("event_rsvps_canonical_email_idx").on(t.canonicalEmail),
  ],
);

export type EventRsvp = typeof eventRsvps.$inferSelect;

/** The two links of the message: «Da, vin» confirms the answer; «Nu vin / Nu mai vin» takes it back. */
export const eventRsvpTokenPurpose = pgEnum("event_rsvp_token_purpose", ["RSVP_CONFIRM", "RSVP_WITHDRAW"]);

/**
 * (The third link of the «Vii?» question an earlier answerer receives, «Nu mă mai întreba la seria aceasta», is NOT in this table: it must
 * outlive the answer row — «Nu vin» deletes that row, and a link that went with it would break the promise that a person may object at any
 * time. It is `rsvp_refuse_tokens`, below, §823.)
 *
 * The «Vin!» links (§811) — the same secret and the same stored hash as every email action link (AGENTS.md
 * §12.8, §13.2; `action-tokens/domain/token-secret.ts`), in a table of their own because they belong to an
 * answer, which is not a participant (the newsletter's `newsletter_tokens` is the precedent, §445).
 *
 * Minted by the renderer when the message is sent, never when it is queued (§14.5: the secret is in the
 * email alone). `RSVP_CONFIRM` lives 48 hours; `RSVP_WITHDRAW` until the event's start. Only the SHA-256 is
 * stored, and the CHECK refuses anything else. A newer link of the same purpose supersedes the older. Gone with
 * the answer.
 */
export const eventRsvpTokens = pgTable(
  "event_rsvp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rsvpId: uuid("rsvp_id")
      .notNull()
      .references(() => eventRsvps.id, { onDelete: "cascade" }),
    purpose: eventRsvpTokenPurpose("purpose").notNull(),
    // SHA-256 of the base64url secret, hex encoded. Never the secret.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set once, by the single-use consume statement.
    usedAt: timestamp("used_at", { withTimezone: true }),
    // Set when a newer link of the same purpose supersedes this one.
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("event_rsvp_tokens_hash_is_sha256_hex", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("event_rsvp_tokens_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
    // One live link per answer and purpose: a newer message supersedes the older.
    uniqueIndex("event_rsvp_tokens_one_active_per_purpose")
      .on(t.rsvpId, t.purpose)
      .where(sql`"used_at" IS NULL AND "invalidated_at" IS NULL`),
  ],
);

export type EventRsvpToken = typeof eventRsvpTokens.$inferSelect;

/**
 * «Vii?» (§818; the owner, 2026-10-18: «I need this "Going" to be via email or something … super easy») — the mark that an
 * event's day-before question went out. **One row per event, UNIQUE on the event: that is the "once"**, as `newsletter_sends`' UNIQUE
 * event is the new-event alert's. An event with nobody to ask still gets its row (`recipients` 0): it was looked at, and a
 * subscriber who joins tomorrow is not asked about today's event. No address and nothing personal is kept here — the messages
 * themselves are `email_outbox` rows, swept like every message; the row goes with the event's other rows, thirty days after its
 * end (`jobs/retention.ts`), or with the event.
 */
export const eventRsvpAsks = pgTable("event_rsvp_asks", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id, { onDelete: "cascade" }),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  // How many messages the step queued: the confirmed subscribers of the event's topics, less those who had answered already.
  recipients: integer("recipients").notNull().default(0),
});

export type EventRsvpAsk = typeof eventRsvpAsks.$inferSelect;

/**
 * «Nu mă mai întreba la seria aceasta» (§823): a person's refusal of the day-before question for a SERIES of events — the one press of
 * the link an earlier answerer's question carries (`rsvp_refuse_tokens`). **By canonical address and series, not by event**: the club's
 * «Vin!» answers are asked again at every date of a weekly run, so a refusal for one date would be asked again next week.
 * `series_key` is the key the listing groups by (`events/domain/series.ts#seriesKey`: the type and the default-language title, as
 * §523's declarations record it), so renaming a date takes it out of the series on purpose. UNIQUE on (address, series): the press
 * is idempotent. The address is the versioned canonical form (AGENTS.md §10.4); nothing else is kept — no name, no event, no
 * message. It is read by the question's queue and send (never asking a refuser, as an answerer OR as a subscriber of the topic),
 * listed and erased with "all the data of a person" (`registrations/person-data.ts`), and swept once no event of the series is left
 * (`jobs/retention.ts`: the row lives while the series does, and a series is gone when its last date's rows are).
 */
export const rsvpAskRefusals = pgTable(
  "rsvp_ask_refusals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalEmail: text("canonical_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    seriesKey: text("series_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("rsvp_ask_refusals_email_series_unique").on(t.canonicalEmail, t.seriesKey)],
);

export type RsvpAskRefusal = typeof rsvpAskRefusals.$inferSelect;

/**
 * The link «Nu mă mai întreba la seria aceasta» (§823) of the question an earlier answerer receives. **A table of its own, with no key to
 * the answer**: the question made an answer row, and «Nu vin» in the same email deletes it — a link that went with the row would have been
 * dead after the person's first press, and the notice promises the objection «oricând». So the token carries what the refusal needs
 * (the address's canonical form, its canonicalizer's version, the series key, the event and the language for the page) and nothing else.
 * Hashed at rest like every link (AGENTS.md §12.8; the same secret and SHA-256), single use (one UPDATE, one winner), a GET never writes. It
 * lives **until sixty days after the event's start**, never until the start itself: a person reading the email after the run may still
 * object. No newer link supersedes an older one (last week's email keeps its button; the press is idempotent). Swept once expired or
 * spent (`jobs/retention.ts`), erased with the person's data, and gone with the event.
 */
export const rsvpRefuseTokens = pgTable(
  "rsvp_refuse_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    locale: locale("locale").notNull(),
    canonicalEmail: text("canonical_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    seriesKey: text("series_key").notNull(),
    // SHA-256 of the base64url secret, hex encoded. Never the secret.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set once, by the single-use consume statement.
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rsvp_refuse_tokens_hash_is_sha256_hex", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("rsvp_refuse_tokens_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
    // The person's-data reads and the erase: by identity.
    index("rsvp_refuse_tokens_canonical_email_idx").on(t.canonicalEmail),
  ],
);

export type RsvpRefuseToken = typeof rsvpRefuseTokens.$inferSelect;
