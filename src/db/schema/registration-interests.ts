import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { locale } from "./locale";

/**
 * "Anunță-mă când se deschid înscrierile" (`DECISIONS.md` §146).
 *
 * An address left on an event's page while its registration window is still ahead, so the
 * club can advertise a race before it takes entries and still reach the people who wanted
 * in. One row per event and canonical identity — the same versioned canonicalizer as
 * `participants` (AGENTS.md §10.4), so `Ana.Pop@` and `ana.pop@` are one row and the form
 * cannot say whether an address is already on the list (BR-REQ-031-01 criterion 3).
 *
 * The row lives only until the message is queued: the maintenance job enqueues
 * `REGISTRATION_OPENED` and deletes the row in the same transaction, and an event that is
 * cancelled, moved to another form or already started loses its rows without a message.
 * Nothing here is a participant — no name, no consent version — because nothing was
 * registered; the privacy notice describes the list in its own paragraph.
 */
export const registrationInterests = pgTable(
  "registration_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // As typed, minus whitespace: where the one message is delivered.
    deliveryEmail: text("delivery_email").notNull(),
    // The identity the UNIQUE constraint below is on.
    canonicalEmail: text("canonical_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    // The language of the page the address was left on: the message's language.
    locale: locale("locale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("registration_interests_event_canonical_email_unique").on(t.eventId, t.canonicalEmail)],
);

export type RegistrationInterest = typeof registrationInterests.$inferSelect;
