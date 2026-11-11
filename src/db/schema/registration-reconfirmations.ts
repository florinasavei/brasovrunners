import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { registrations } from "./registrations";

/**
 * «Cere reconfirmarea» (the decision «Cere reconfirmarea»; the owner's «…dar e opțional», as the decision reads it: the
 * club sees who pressed «Vin»): one row per registration asked, per send of «Trimite un mesaj participanților» that ticked the box.
 *
 * - **Written by the send.** In the send's own transaction, one row for each recipient whose registration was confirmed,
 *   owed its declaration or waiting (`RECONFIRM_STATUSES`) — test registrations too, as every send writes to them
 *   (AGENTS.md §12.6); every count the club is given leaves them out.
 * - **Answered by the person.** «Da, vin la cursă» on the registration's own manage page — pressed by the page itself
 *   when the email's «Vin» opens it — sets `reconfirmed_at` on every open ask of that registration, once: a second press
 *   keeps the first moment.
 * - **Read by nothing that decides.** No state, place, hold, deadline, allocator or capacity term reads it; answering is
 *   optional, and «N-au răspuns» is information for the organizers, never a state. Only the backoffice and the person's
 *   own manage page read it —
 *   `tests/unit/registrations/reconfirmation-never-leaves.test.ts` keeps it off every public page and sponsors' file.
 * - **Deleted with the registration.** `ON DELETE CASCADE` from the registration and from its event: an erase, the
 *   retention sweep and an event's delete take the asks with the row.
 *
 * A table, not columns on `registrations`: a second send's ask would overwrite the first's numbers. Not derived from the
 * outbox either: its sent rows are swept (`jobs/retention.ts`).
 */
export const registrationReconfirmations = pgTable(
  "registration_reconfirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The send's own id (`sendId` in its audit row's metadata and in its outbox keys). */
    sendId: uuid("send_id").notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull(),
    reconfirmedAt: timestamp("reconfirmed_at", { withTimezone: true }),
  },
  (t) => [
    unique("registration_reconfirmations_registration_send_unique").on(t.registrationId, t.sendId),
    // «Mesaje trimise»' three numbers, one grouped read per event's history.
    index("registration_reconfirmations_event_send_idx").on(t.eventId, t.sendId),
  ],
);

export type RegistrationReconfirmation = typeof registrationReconfirmations.$inferSelect;
