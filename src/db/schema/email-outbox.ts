import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { locale } from "./locale";
import { participants } from "./participants";
import { registrations } from "./registrations";
import { staffUsers } from "./staff-users";

/** The ten message types of AGENTS.md §16.3. No message may be sent that is not one of them. */
export const emailMessageType = pgEnum("email_message_type", [
  "VERIFY_REGISTRATION_EMAIL",
  "COMPLETE_DECLARATION",
  "WAITLIST_JOINED",
  "WAITLIST_SPOT_OFFER",
  "REGISTRATION_CONFIRMED",
  "REGISTRATION_CANCELLED",
  "WAITLIST_OFFER_EXPIRED",
  "REGISTRATION_MANAGE_LINK",
  "PROFILE_MANAGE_LINK",
  "REGISTRATION_STATE_NOTICE",
  /** The reminder lead before the start — the event's or the club's, two days unset (§377) — to every confirmed participant, once (`DECISIONS.md` §81). */
  "EVENT_REMINDER",
  /** After the race, by hand, once per event, to everyone who was checked in (§82). */
  "EVENT_THANKS",
  /** Right after signing: the signed declaration as a PDF, the participant's own copy (§95). */
  "DECLARATION_SIGNED",
  // The club's archive copy of the same PDF (§99): to `DECLARATIONS_ARCHIVE_TO`, no token.
  "DECLARATION_ARCHIVE",
  // A race number given or changed by hand after confirmation (§105): the runner is told.
  "BIB_ASSIGNED",
  // A colleague added on Echipa (§141): who added them, as what, and where to sign in. No token.
  "STAFF_INVITATION",
  // "Registration is open" to an address left on the event's page before the window (§146):
  // no participant, no token; the action is the ordinary registration page.
  "REGISTRATION_OPENED",
  // "Somebody has confirmed" to the club's own mailboxes (§245): who, for which event, and
  // their number. No token and no link a participant could act on — the club signs in.
  "CLUB_CONFIRMATION_NOTICE",
  // "Detalii actualizate" (§331): the organizer ticked "Anunță participanții" on a save that
  // moved the place, the start or the programme, or wrote a note. One per active registration,
  // in its own language; the changed facts are read at send time. No token.
  "EVENT_UPDATE_NOTICE",
  // "{event} a fost anulat" (§331): the event was cancelled in the editor, with the reason the
  // organizer typed. One per active registration; the registration itself is left as it was.
  "EVENT_CANCELLED",
  // "Trimite un mesaj participanților" (§364): a message the organizer writes per send — bad
  // weather, a changed start, anything — in Romanian and English, to the registrants of one event
  // they choose (confirmed, waiting, owing the declaration, or all three). The words travel in the
  // payload; the registrant's language reads first. No token, no attachment.
  "ORGANIZER_MESSAGE",
  // The optional self-declaration signed on a group run's page (§393): the signer's copy, with the
  // PDF. No registration and no participant behind it — the declaration's own row, by id in the
  // payload. No token: there is nothing to manage.
  "GROUP_RUN_DECLARATION_SIGNED",
  // The club's archive copy of the same declaration (§393, as §99 for the race's): to the
  // declarations mailbox, the identity document masked (§320). Its own type, as §99 decided for
  // the race's archive copy: "the club's copy" is a type the emails page lists by name.
  "GROUP_RUN_DECLARATION_ARCHIVE",
  // "Ești deja înscris(ă) — vrei să înscrii pe altcineva cu aceeași adresă?" (§389): the public
  // form was sent again for an event, with an address that already holds a registration there and
  // a different runner's name. Nothing is created; this goes to the address, with a single-use
  // link to the form for the other person (the address fixed) — or, at the club's limit of
  // registrations per address, the sentence that says so and no link.
  "REGISTER_ANOTHER_PERSON",
]);

export type EmailMessageType = (typeof emailMessageType.enumValues)[number];

/** AGENTS.md §12.11. `PROCESSING` is a claimed row: a worker holds it and has not finished. */
export const emailOutboxStatus = pgEnum("email_outbox_status", [
  "PENDING",
  "PROCESSING",
  "SENT",
  "FAILED",
  "BOUNCED",
  "COMPLAINED",
]);

export type EmailOutboxStatus = (typeof emailOutboxStatus.enumValues)[number];

/**
 * The transactional outbox (AGENTS.md §12.11, §16.1; BR-REQ-080-02).
 *
 * The rule this table exists to enforce: the intention to send an email is committed in the
 * same transaction as the change that caused it, and the provider is called afterwards, from
 * a separate transaction. Mailgun is not part of the registration transaction, so a Mailgun
 * outage cannot roll back a registration and a rolled-back registration cannot leave a
 * participant holding a confirmation email for something that never happened.
 *
 * `payload_json` holds what the template needs, not the rendered message. Rendered bodies and
 * action links are produced at send time and never stored, because §14.5 forbids persisting a
 * message body or an action token where logs and backups can reach it.
 *
 * `idempotency_key` is the caller's statement of "this exact trigger, once". A deliberate
 * resend is a *different* trigger and gets its own key (§12.11), which is why retry lives in
 * `attempt_count` and never in a second row.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "cascade",
    }),
    registrationId: uuid("registration_id").references(() => registrations.id, {
      onDelete: "cascade",
    }),

    messageType: emailMessageType("message_type").notNull(),
    locale: locale("locale").notNull(),

    // The delivery address as the participant typed it. Identity comparisons use the
    // canonical form (AGENTS.md §10.4); mail is delivered here.
    recipientEmail: text("recipient_email").notNull(),

    payloadJson: jsonb("payload_json").notNull(),

    idempotencyKey: text("idempotency_key").notNull().unique(),

    // Populated when a staff member asked for this message (§12.11).
    requestedByStaffUserId: uuid("requested_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    isManualResend: boolean("is_manual_resend").notNull().default(false),

    status: emailOutboxStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    providerMessageId: text("provider_message_id"),
    /**
     * Which road the message left by (§NNN): `mailgun`, or `gmail` — the club's own account over
     * SMTP. Written with `sent_at`; null on a row not sent yet and on every row sent before the
     * column existed, and a null is read as Mailgun, which is what carried all of those. It is
     * what the Mailgun allowance is counted from (`volume.ts`) and what Gmail's own daily cap is
     * counted from (`email-transport.ts`), so the two counts can never both claim one message.
     */
    transport: text("transport", { enum: ["mailgun", "gmail"] }),
    // Sanitized (§16.1): a short provider reason, never a body, a secret, or a token.
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    check("email_outbox_attempt_count_non_negative", sql`${t.attemptCount} >= 0`),

    /**
     * `sent_at` is the answer to "when did this leave", and it is set at most once, by
     * `processOutboxBatch` — never cleared afterward, the same discipline
     * `event_translations.published_at` follows. A row cannot claim SENT without a time,
     * and cannot claim it while still pending or exhausted (`PENDING`/`PROCESSING`/`FAILED`
     * never sent anything). `BOUNCED`/`COMPLAINED` are the one case that goes either way
     * (AGENTS.md §16.5): a message the provider rejected outright never has one, and a
     * message a webhook reports as bounced *after* delivery keeps the one it already had.
     */
    check(
      "email_outbox_sent_at_matches_status",
      sql`(${t.status} <> 'SENT' OR ${t.sentAt} IS NOT NULL)
          AND (${t.status} NOT IN ('PENDING', 'PROCESSING', 'FAILED') OR ${t.sentAt} IS NULL)`,
    ),

    // AGENTS.md §12.11 names both indexes: the worker's claim query and the per-registration
    // delivery history the backoffice shows (BR-REQ-037-01).
    index("email_outbox_status_next_attempt_created_idx").on(
      t.status,
      t.nextAttemptAt,
      t.createdAt,
    ),
    index("email_outbox_registration_created_idx").on(t.registrationId, t.createdAt),
  ],
);
