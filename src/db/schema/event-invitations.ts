import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { locale } from "./locale";
import { participants } from "./participants";
import { registrations } from "./registrations";
import { staffUsers } from "./staff-users";

/**
 * A personal invitation to one event (§NNN; the owner, 2026-10-02: «vreau să trimit „invitații
 * speciale” pe email pentru membrii BVR, un fel de adaugă manual» — «Dar vreau și pentru non-membrii»).
 *
 * An Administrator names a person — a member of the club picked from the members' zone, or a name and
 * an address typed — and the platform emails them one link that opens the registration form prefilled
 * and stands for the address's confirmation. Until the deadline the invitation **holds a place**:
 * `registrations/repository.ts#countOccupied` counts a live invitation that is not «În afara locurilor»
 * in its own bucket (`invitationHolds`, `AGENTS.md` §10.6), so the public count drops at the send and the
 * place cannot be given to anybody else. It is the club's choice, like a family's reservation (§543):
 * never released for somebody waiting before its deadline, only at the deadline or a withdrawal.
 *
 * **The state is three stamps and the deadline, never a status column.** Live: none of `accepted_at`,
 * `withdrawn_at`, `expired_at` is set and `expires_at` is ahead. Past `expires_at` an invitation holds
 * nothing whatever the sweep has done (the count compares `expires_at` itself, §10.6: a deadline is
 * evaluated on every read); the maintenance sweep then writes `expired_at` — the stamp the backoffice,
 * the audit and the partial unique index read. Accepted: `accepted_at` and the registration it became.
 *
 * `participant_id` is the address's identity (`participants`, the canonical address, §10.4), written at
 * the send — it is what the invitation's one action link is scoped to (`email_action_tokens.invitation_id`,
 * purpose `ACCEPT_INVITATION`), and what the registration is created on at the acceptance. The name and
 * the address are kept here as the Administrator typed them, for the email and the backoffice; the
 * retention job deletes an invitation that ended unaccepted (`jobs/retention.ts`, step `invitations`),
 * and an accepted one goes with its registration.
 */
export const eventInvitations = pgTable(
  "event_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    /** The name the Administrator typed or the member's account carries: the email greets it, the form starts with it. */
    name: text("name").notNull(),
    /** The address as typed — where the email goes. */
    email: text("email").notNull(),
    /** The identity (`canonicalizeEmail`, §10.4): what «already invited» and «already registered» compare. */
    canonicalEmail: text("canonical_email").notNull(),
    /**
     * The email's language: a member's account's own; else, for an address the club knows, its
     * participant's (the language that person registered in); else the «Limba invitației» the
     * Administrator chose at the send (Romanian by default).
     */
    locale: locale("locale").notNull().default("ro"),
    /** A member picked from the members' zone (§524): the form presets «Sunt membru». Null for a typed address. */
    memberStaffUserId: uuid("member_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    invitedByStaffUserId: uuid("invited_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the first email was queued: the send's instant. */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** Until when the place is kept: min(now + the days chosen, the start) — never capped by the registration close. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** «În afara locurilor» at the send (§643): the invitation holds no counted place, and its registration is outside too. */
    outsideCapacity: boolean("outside_capacity").notNull().default(false),
    /** This invitation's send raised the capacity by one (§642's confirmed supplementary place). */
    supplementaryRaise: boolean("supplementary_raise").notNull().default(false),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedRegistrationId: uuid("accepted_registration_id").references(() => registrations.id, { onDelete: "cascade" }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByStaffUserId: uuid("withdrawn_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** Written by the maintenance sweep once `expires_at` passed unaccepted. */
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    resendCount: integer("resend_count").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    /*
      One live invitation per address per event: a second send for the same person is refused by name,
      and this makes it structural. An ended one (accepted, withdrawn, stamped expired) leaves room for
      a new invitation; one past its deadline the sweep has not stamped yet is stamped by the send's own
      sweep, under the event lock, before the insert.
    */
    uniqueIndex("event_invitations_live_address_unique")
      .on(t.eventId, t.canonicalEmail)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.withdrawnAt} IS NULL AND ${t.expiredAt} IS NULL`),
    // The count and the sweep read an event's open invitations.
    index("event_invitations_event_expires_idx").on(t.eventId, t.expiresAt),
    // The retention sweep and the erasure find a person's invitations.
    index("event_invitations_participant_idx").on(t.participantId),
    // The registration's cascade (`accepted_registration_id … on delete cascade`) needs it.
    index("event_invitations_accepted_registration_idx").on(t.acceptedRegistrationId),
  ],
);

export type EventInvitation = typeof eventInvitations.$inferSelect;
