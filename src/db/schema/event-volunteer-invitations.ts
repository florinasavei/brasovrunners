import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { eventVolunteers } from "./event-volunteers";
import { events } from "./events";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * An invitation to volunteer at one event (§NNN, amending §754 and §768; the owner, 2026-10-19: «invite only volunteer»), the
 * table behind «Cine se poate oferi» → «Doar cu invitație de la club».
 *
 * An Administrator or an Organizer writes addresses, one per line, and the platform emails each one a personal link to the volunteers'
 * page — the registrations' invitation (§647, `event_invitations`) with a volunteer's door instead of a registration's. It copies that
 * invitation's discipline and drops what a volunteer's has no use for: **an invitation holds nothing and counts nothing** — no place of
 * a race, no «needed» seat of a role — because a volunteer's offer is not yet a role given.
 *
 * **The link.** `token_hash` is the SHA-256 of the secret (`action-tokens/domain/token-secret.ts`); the secret exists in the email alone
 * (AGENTS.md §12.8, §14.5). It is minted when the email is rendered — never when the press queues it, so the outbox's payload names the
 * invitation by its id and nothing else — and minting a new one replaces the old: «Retrimite» is a new email, and the earlier link is
 * dead. Null until the first email has been rendered. A GET of the link reads this row and changes nothing; the sign-up spends it.
 *
 * **The state is three stamps and a deadline, never a status column.** Open: none of `used_at`, `withdrawn_at` is set and
 * `expires_at` is ahead. `expires_at` is the event's end at the send (a year ahead for a date still to be announced); the page asks
 * the event again, so a cancelled or finished event closes its invitations whatever this says. Used: `used_at` and the sign-up it
 * became (`volunteer_id`, set null if that row goes). The invited address is kept as typed (where the email goes) and by its identity
 * (`canonicalizeEmail`, §10.4); the sign-up through the link is locked to it.
 *
 * Personal data (an address, and the club's line to it): deleted with the event's volunteers, thirty days after the event
 * (`jobs/retention.ts`, step `volunteers`), or when the event goes; found on
 * the person's data screen and in its export (`registrations/person-data.ts`), and erased by an Administrator from that screen, for one
 * address, with the rest of what the club holds about it (`eraseVolunteerInvitationsOfPerson`).
 */
export const eventVolunteerInvitations = pgTable(
  "event_volunteer_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The address as typed — where the email goes. */
    deliveryEmail: text("delivery_email").notNull(),
    /** The identity (`canonicalizeEmail`, §10.4): what «already invited» and «already offered» compare, and what the sign-up is locked to. */
    canonicalEmail: text("canonical_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    /** The email's language, chosen at the send by the person who sends («Limba invitației»); both halves go out either way (§96). */
    locale: locale("locale").notNull().default("ro"),
    /** The SHA-256 of the link's secret, or null while no email has been rendered. A newer email replaces it. */
    tokenHash: text("token_hash").unique("event_volunteer_invitations_token_hash_unique"),
    /**
     * The club's own line to the person, optional (at most 500 characters), in both languages or neither (§354: the email has a Romanian
     * half and an English half, §96, and each half reads its own language's words — never the other's). The two are written together.
     */
    messageRo: text("message_ro"),
    messageEn: text("message_en"),
    invitedByStaffUserId: uuid("invited_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** When the first email was queued. */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** When «Retrimite» last queued another, or null. */
    resentAt: timestamp("resent_at", { withTimezone: true }),
    /** The sign-up that spent the link, and the moment. Both null while open. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    volunteerId: uuid("volunteer_id").references(() => eventVolunteers.id, { onDelete: "set null" }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByStaffUserId: uuid("withdrawn_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /**
     * The event's end at the send — a record of what the club saw, never the rule: whether a link still works is asked of the event as it
     * stands now (`volunteerEventAhead`), so a race moved later keeps its links alive and one called off closes them (§NNN).
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    // One invitation per address per event: a second send for the same person is «Retrimite», never a second row.
    unique("event_volunteer_invitations_event_canonical_email_unique").on(t.eventId, t.canonicalEmail),
    // The retention sweep and the person lookup.
    index("event_volunteer_invitations_canonical_email_idx").on(t.canonicalEmail),
    // The set-null cascade of `volunteer_id` needs it.
    index("event_volunteer_invitations_volunteer_idx")
      .on(t.volunteerId)
      .where(sql`${t.volunteerId} IS NOT NULL`),
    check("event_volunteer_invitations_message_length", sql`${t.messageRo} IS NULL OR char_length(${t.messageRo}) BETWEEN 1 AND 500`),
    check("event_volunteer_invitations_message_en_length", sql`${t.messageEn} IS NULL OR char_length(${t.messageEn}) BETWEEN 1 AND 500`),
    // Both languages or neither (§354): a line in one language only is a cross-language fallback waiting to happen.
    check("event_volunteer_invitations_message_both_languages", sql`(${t.messageRo} IS NULL) = (${t.messageEn} IS NULL)`),
    // A sign-up is spent at a moment; the row it became may be gone since (set null), but a sign-up without a moment is nothing.
    check("event_volunteer_invitations_used_has_moment", sql`${t.volunteerId} IS NULL OR ${t.usedAt} IS NOT NULL`),
  ],
);

export type EventVolunteerInvitation = typeof eventVolunteerInvitations.$inferSelect;
