import type { EmailMessageType } from "@/db/schema/email-outbox";
import { registrationStatus, type RegistrationStatus } from "@/db/schema/registrations";
import { typesCoveredBy } from "@/modules/notifications/domain/content-cover";
import { isRejectionCause, rejectionCause, type RejectionCause } from "@/modules/notifications/domain/rejection-cause";
import { deriveAllowedResendMessageType } from "./resend";

/**
 * The registration's one email state (§NNN; amending §663, §76/§83): whether the participant's own mail
 * reaches them, read from the refusals the provider reported and what came after each
 * (`notifications/delivery-facts.ts`). One state per registration, chosen in SQL
 * (`registrations/email-state.ts`), so the list, the page, the desk, the filter and the export can
 * never disagree:
 *
 * - `unreachable` — the address refuses the club's mail: a refusal with nothing delivered to the address
 *   since, or a complaint (never cleared) — whatever message it was, and whatever the registration has
 *   become since: it is about the address, and it is the call list.
 * - `not-sent` — the club's Mailgun account was refused when this message was to leave (2026-10-01 and
 *   02): it never left, and nothing has left in its place. Not the address's fault — and the person
 *   really has not got it.
 * - `missing` — the address works again (a later message was delivered), but this message — the QR
 *   confirmation, say — has not been delivered or sent again since, nor any message that carries it.
 * - `retried` — this message, or one that carries it, was sent again after its refusal and no delivery
 *   is known yet: by Mailgun, the delivery may still come; by Gmail, it never will (Gmail reports none).
 *
 * `not-sent`, `missing` and `retried` are open only while the registration the refused message was for
 * **still needs it** (`stillNeededMessageTypes`): what the page can send again for its status now, and
 * what that carries. A verification refused before the address was confirmed, a declaration link after
 * the signing, a waiting-list email after the list, a notice that informed and asked nothing: none of
 * them is anybody's to act on, and they stay in the registration's history alone.
 *
 * A family member's refusal at the same event (one address, §543) is read by the same rule, against its
 * own registration's status, so one refusal has one state on every registration it shows on.
 *
 * Null when the participant's own mail has no open refusal. The club's own messages (the archive copy,
 * the confirmation notice, the club's copies) are never part of it: a club mailbox that bounces is the
 * club's problem, not the runner's.
 */
export const EMAIL_STATE_KINDS = ["unreachable", "not-sent", "missing", "retried"] as const;
export type EmailStateKind = (typeof EMAIL_STATE_KINDS)[number];

/** The kinds that ask somebody to act: call, or send it again. `retried` waits for the delivery. */
export const EMAIL_STATE_NEEDS_ACTION: readonly EmailStateKind[] = ["unreachable", "not-sent", "missing"];

/**
 * Whether a state asks somebody to act — what today's chip, the page's red line, «Ce îi spui», the filter
 * and the export's «Email bounced» speak for (§NNN). `retried` is shown nowhere until the next change draws
 * it: it waits for a delivery, and a refusal sent again before this release never gets one.
 */
export function needsEmailAction(state: { kind: EmailStateKind } | null | undefined): boolean {
  return state !== null && state !== undefined && EMAIL_STATE_NEEDS_ACTION.includes(state.kind);
}

/**
 * Where the event stands for the press that would send a message again: «Trimite reminderul» exists only
 * while the event is ahead (`canResendReminder`, §81), and a cancelled event's links lead nowhere, so only
 * where the registration stands is sent again (§331, `resendRegistrationEmail`).
 */
export const EVENT_MOMENTS = ["ahead", "past", "cancelled"] as const;
export type EventMoment = (typeof EVENT_MOMENTS)[number];

/**
 * The messages a registration in this status still needs (§NNN): the one the page sends again for it
 * (`deriveAllowedResendMessageType` — «Retrimite QR» on a confirmed registration) and what that carries
 * (`typesCoveredBy`: the confirmation carries the race number's QR and the signed declaration), and on a
 * confirmed registration of an event still ahead the reminder (`«Trimite reminderul»`) and what it
 * carries. A refusal of any other type has nothing left to send: no press could clear it, so it asks
 * nobody to act. The SQL (`registrations/email-state.ts`) reads the same list, built from this function.
 */
export function stillNeededMessageTypes(status: RegistrationStatus, moment: EventMoment): EmailMessageType[] {
  const resendable = deriveAllowedResendMessageType(status);
  if (!resendable) return [];
  if (moment === "cancelled" && resendable !== "REGISTRATION_STATE_NOTICE") return [];
  const needed = new Set(typesCoveredBy(resendable));
  if (moment === "ahead" && status === "CONFIRMED") for (const type of typesCoveredBy("EVENT_REMINDER")) needed.add(type);
  return [...needed];
}

/** Every (moment, status, type) the SQL reads as still needed, as `moment:status:type`. */
export const STILL_NEEDED_KEYS: readonly string[] = EVENT_MOMENTS.flatMap((moment) =>
  registrationStatus.enumValues.flatMap((status) => stillNeededMessageTypes(status, moment).map((type) => `${moment}:${status}:${type}`)),
);

/**
 * The press that clears a refusal (§NNN), on the registration the refused message was for: «Retrimite QR»
 * (the confirmation, which carries the race number and the signed declaration too), «Trimite reminderul»,
 * or the page's resend for any other status — never a press that sends something else. Null when no
 * press would.
 */
export type EmailPress = "confirmation" | "reminder" | "resend";

export function pressThatClears(messageType: string, status: RegistrationStatus | null): EmailPress | null {
  if (status === null) return null;
  const type = messageType as EmailMessageType;
  const resendable = deriveAllowedResendMessageType(status);
  if (resendable && typesCoveredBy(resendable).includes(type)) return resendable === "REGISTRATION_CONFIRMED" ? "confirmation" : "resend";
  if (status === "CONFIRMED" && typesCoveredBy("EVENT_REMINDER").includes(type)) return "reminder";
  return null;
}

export type RegistrationEmailState = {
  kind: EmailStateKind;
  /** The refused message's type: what did not arrive. */
  messageType: string;
  /** When it was refused (`rejected_at`), or — for a row refused before that was stored — when it left, else was queued. */
  at: Date;
  /** Whether the refused message ever left (`sent_at`); a refusal at the send never did. */
  sent: boolean;
  status: "BOUNCED" | "COMPLAINED";
  cause: RejectionCause;
  /** False when the refusal is another registration's at the same event, on the same address (a family, §543). */
  own: boolean;
  /** The press that clears it, on the registration it was for (`pressThatClears`); null when none would. */
  press: EmailPress | null;
  /** When a later message reached the address (`missing`). */
  laterDeliveredAt: Date | null;
  /** When the same message last left again, and by which road (`retried`). */
  retriedAt: Date | null;
  retriedVia: "mailgun" | "gmail" | null;
};

/**
 * The desk's projection (§67, `AGENTS.md` §15.11): what did not arrive, why and when — the instants of what
 * came after it included, which are not words — and no provider text, no address.
 */
export type DeskEmailState = Pick<
  RegistrationEmailState,
  "kind" | "messageType" | "at" | "sent" | "status" | "cause" | "own" | "press" | "laterDeliveredAt" | "retriedAt" | "retriedVia"
>;

/** The registration page's: the state, with the provider's code and words in small print — never on a list. */
export type RegistrationEmailStateDetail = RegistrationEmailState & {
  code: string | null;
  /** The receiving server's words, redacted; for a refusal at the send, the stored answer. */
  detail: string | null;
};

const instant = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = new Date(typeof value === "number" ? value : Number(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const kindOf = (value: unknown): EmailStateKind => ((EMAIL_STATE_KINDS as readonly unknown[]).includes(value) ? (value as EmailStateKind) : "unreachable");
const textOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const statusOf = (value: unknown): RegistrationStatus | null =>
  (registrationStatus.enumValues as readonly unknown[]).includes(value) ? (value as RegistrationStatus) : null;

/**
 * The subquery's one JSON object (`registrations/email-state.ts`). node-postgres and PGlite hand `json`
 * back parsed; a driver that does not hands back its text. Instants travel as epoch milliseconds, so no
 * driver's timestamp text has to be parsed.
 */
function rawOf(value: unknown): Record<string, unknown> | null {
  const raw = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

/**
 * The cause stored with the refusal; for a row written without one (an older deployment's, between the
 * migration and the build after it), the same `rejectionCause` read from the stored answer it carried
 * (`unclassified`), which is dropped here and goes no further.
 */
function causeOf(row: Record<string, unknown>, status: "BOUNCED" | "COMPLAINED", sent: boolean): RejectionCause {
  if (isRejectionCause(row.cause)) return row.cause;
  return rejectionCause({ status, sent, reason: textOf(row.unclassified) });
}

export function deskEmailStateOf(value: unknown): DeskEmailState | null {
  const row = rawOf(value);
  if (!row) return null;
  const status = row.status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED";
  const sent = row.sent !== false;
  const messageType = String(row.messageType);
  return {
    kind: kindOf(row.kind),
    messageType,
    at: instant(row.at) ?? new Date(0),
    sent,
    status,
    cause: causeOf(row, status, sent),
    own: row.own !== false,
    press: pressThatClears(messageType, statusOf(row.registrationStatus)),
    laterDeliveredAt: instant(row.laterDeliveredAt),
    retriedAt: instant(row.retriedAt),
    retriedVia: row.retriedVia === "gmail" ? "gmail" : row.retriedVia === "mailgun" ? "mailgun" : null,
  };
}

/** The list's and the export's: the same object as the desk's — no provider text on either. */
export function emailStateOf(value: unknown): RegistrationEmailState | null {
  return deskEmailStateOf(value);
}

export function emailStateDetailOf(value: unknown): RegistrationEmailStateDetail | null {
  const row = rawOf(value);
  const state = emailStateOf(row);
  if (!row || !state) return null;
  return { ...state, code: textOf(row.code), detail: textOf(row.detail) };
}
