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
import { locale } from "./events";
import { participants } from "./participants";

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
    // No foreign key until `registrations` exists; see the same note on email_action_tokens.
    registrationId: uuid("registration_id"),

    messageType: emailMessageType("message_type").notNull(),
    locale: locale("locale").notNull(),

    // The delivery address as the participant typed it. Identity comparisons use the
    // canonical form (AGENTS.md §10.4); mail is delivered here.
    recipientEmail: text("recipient_email").notNull(),

    payloadJson: jsonb("payload_json").notNull(),

    idempotencyKey: text("idempotency_key").notNull().unique(),

    // Populated when a staff member asked for this message (§12.11). No foreign key until
    // `staff_users` exists.
    requestedByStaffUserId: uuid("requested_by_staff_user_id"),
    isManualResend: boolean("is_manual_resend").notNull().default(false),

    status: emailOutboxStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    providerMessageId: text("provider_message_id"),
    // Sanitized (§16.1): a short provider reason, never a body, a secret, or a token.
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    check("email_outbox_attempt_count_non_negative", sql`${t.attemptCount} >= 0`),

    // `sent_at` is the answer to "when did this leave"; a row that claims a time without the
    // status, or the status without a time, would make the backoffice history a guess.
    check(
      "email_outbox_sent_at_matches_status",
      sql`(${t.status} = 'SENT') = (${t.sentAt} IS NOT NULL)`,
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
