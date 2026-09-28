import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { emailActionTokens } from "./email-action-tokens";
import { events } from "./events";
import { locale } from "./locale";
import { participants } from "./participants";
import { registrations } from "./registrations";

/**
 * One sitting of a family on one address (§519): the public form sent several times in a row from
 * one browser, for several people, with one email at the end — «Înscriere de familie: 3 persoane la
 * …» — instead of one per submission. The owner, 2026-09-27: "niciun email instant: unul singur,
 * după ce apeși «Gata» sau după fereastra din Termene".
 *
 * What the row is: the server's half of the sitting, the browser's half being a sealed cookie on
 * the form's own path (`registrations/family-sitting.ts`). It holds ids and instants, never a name:
 *
 * - `registration_id` is the address's registration the sitting's one link is scoped to (the token
 *   table's rule: a registration purpose names a registration) — the first one the sitting created,
 *   or the one the address already held when the sitting began;
 * - `registration_ids` are the registrations the sitting created, each waiting for the address's
 *   confirmation; the one press confirms them all;
 * - `held_outbox_ids` are the sitting's messages, which the next form merges and a «Da, încă o
 *   persoană» holds until that form or `held_until` (§NNN: a form's own email is never held): the
 *   verification email and the family links while the sitting names one person, the family
 *   message from the second person on;
 * - `held_until` is the club's sitting window («Termene») from the last submission or «Da»;
 *   `released_at` the press of «Nu mai înscriu pe nimeni»; `confirmed_at` the press of the family
 *   email's button;
 * - `action_token_id` is the token the family message carries, written by the renderer at send
 *   time (§12.8, §14.5), as `pending_family_entries.action_token_id` is for one person;
 * - `expires_at` is when the last thing the sitting's link could still act on lapses — the rows'
 *   email links and the kept forms — after which the maintenance job deletes the row.
 */
export const familySittings = pgTable(
  "family_sittings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    registrationIds: jsonb("registration_ids").notNull().$type<string[]>().default([]),
    heldOutboxIds: jsonb("held_outbox_ids").notNull().$type<string[]>().default([]),
    actionTokenId: uuid("action_token_id").references(() => emailActionTokens.id, { onDelete: "set null" }),
    // The language of the first form of the sitting: the family message's.
    locale: locale("locale").notNull(),
    heldUntil: timestamp("held_until", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The family page finds its sitting by the token it read or spent.
    uniqueIndex("family_sittings_action_token_unique").on(t.actionTokenId),
    // The purge's scan.
    index("family_sittings_expires_at_idx").on(t.expiresAt),
  ],
);

export type FamilySitting = typeof familySittings.$inferSelect;

/**
 * Another person's registration, typed into the public form on an address that is registered at
 * the event already, waiting for the address to confirm it from its inbox (§446, amending §389).
 *
 * The owner, 2026-09-26: "înscrierea altei persoane trebuie să fie mai simplă: în mail să îți
 * afișez înscrierile și să zic «confirm că înscriu altă persoană»". Until then the second
 * submission created nothing and the email opened the form again, so a parent typed everything
 * twice. Now the second submission is *kept* here, when the posted person is a different person
 * (`domain/family.ts`, `isDifferentPerson`), and the email carries one button that creates the
 * registration from these fields.
 *
 * What the row is not: a registration. It holds no place, counts in no capacity and no limit, and
 * appears on no list. The place is taken — under the event's lock and the club's limit per address
 * — only when the confirmation is pressed, through the ordinary allocator (`submitRegistration`).
 *
 * - `fields` is the form as posted and validated, without the address (the participant's), the
 *   anti-bot fields, and — for another adult — the consents only that adult can give (§421): what
 *   `submitRegistration` reads again, under the same schema, when the confirmation is pressed.
 * - `registration_id` is the registration the address already holds here, which the emailed token
 *   is scoped to (the token table's rule: a registration purpose names a registration).
 * - `action_token_id` is the token the email carries, written by the renderer when it mints it at
 *   send time (§12.8, §14.5): the secret is never stored, here or anywhere, only its hash in the
 *   token's own row. A resend of the message mints a new one and moves the pointer.
 * - `expires_at` is the club's email-link window ("Termene", §377) from the submission; the
 *   maintenance job deletes the row, its personal data with it, once it has passed
 *   (`purgeLapsedFamilyEntries`). A confirmed entry is deleted in the same transaction that creates
 *   the registration.
 */
export const pendingFamilyEntries = pgTable(
  "pending_family_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    actionTokenId: uuid("action_token_id").references(() => emailActionTokens.id, { onDelete: "set null" }),
    /*
      The sitting the form was sent in (§519), when it was: then the family message's one button
      confirms it with the others, and a second form for the same person in the same sitting
      replaces it rather than adding one more. Null for a form sent on its own, as before.
    */
    sittingId: uuid("sitting_id").references(() => familySittings.id, { onDelete: "set null" }),
    // The language of the form that was filled in: the registration's, once it is created.
    locale: locale("locale").notNull(),
    fields: jsonb("fields").notNull().$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The confirmation finds its entry by the token it spent.
    uniqueIndex("pending_family_entries_action_token_unique").on(t.actionTokenId),
    // The purge's scan.
    index("pending_family_entries_expires_at_idx").on(t.expiresAt),
    // A sitting's kept forms, read by the family message and its page.
    index("pending_family_entries_sitting_idx").on(t.sittingId),
  ],
);

export type PendingFamilyEntry = typeof pendingFamilyEntries.$inferSelect;
