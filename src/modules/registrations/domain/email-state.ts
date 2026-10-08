import { isRejectionCause, type RejectionCause } from "@/modules/notifications/domain/rejection-cause";

/**
 * The registration's one email state (§NNN; amending §663, §76/§83): whether the participant's own mail
 * reaches them, read from the refusals the provider reported and what came after each
 * (`notifications/delivery-facts.ts`). One state per registration, chosen in SQL
 * (`registrations/email-state.ts`), so the list, the page, the desk, the filter and the export can
 * never disagree:
 *
 * - `unreachable` — the address refuses the club's mail: a refusal with nothing delivered to the address
 *   since, or a complaint (never cleared). It may be a family member's message at the same event: one
 *   address (§543), one fact.
 * - `not-sent` — the club's Mailgun account was refused when this message was to leave (2026-10-01 and
 *   02): it never left, and nothing has left in its place. Not the address's fault — and the person
 *   really has not got it.
 * - `missing` — the address works again (a later message was delivered), but this message — the QR
 *   confirmation, say — has not been delivered or sent again since.
 * - `retried` — this message was sent again after its refusal and no delivery is known yet: by Mailgun,
 *   the delivery may still come; by Gmail, it never will (Gmail reports none).
 *
 * Null when the participant's own mail has no open refusal. The club's own messages (the archive copy,
 * the confirmation notice, the club's copies) are never part of it: a club mailbox that bounces is the
 * club's problem, not the runner's.
 */
export const EMAIL_STATE_KINDS = ["unreachable", "not-sent", "missing", "retried"] as const;
export type EmailStateKind = (typeof EMAIL_STATE_KINDS)[number];

/** The kinds that ask somebody to act: call, or send it again. `retried` waits for the delivery. */
export const EMAIL_STATE_NEEDS_ACTION: readonly EmailStateKind[] = ["unreachable", "not-sent", "missing"];

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
  /** When a later message reached the address (`missing`). */
  laterDeliveredAt: Date | null;
  /** When the same message last left again, and by which road (`retried`). */
  retriedAt: Date | null;
  retriedVia: "mailgun" | "gmail" | null;
};

/** The desk's projection (§67, `AGENTS.md` §15.11): what did not arrive and why — no provider text, no address. */
export type DeskEmailState = Pick<RegistrationEmailState, "kind" | "messageType" | "at" | "sent" | "status" | "cause" | "own">;

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

/**
 * The subquery's one JSON object (`registrations/email-state.ts`). node-postgres and PGlite hand `json`
 * back parsed; a driver that does not hands back its text. Instants travel as epoch milliseconds, so no
 * driver's timestamp text has to be parsed.
 */
function rawOf(value: unknown): Record<string, unknown> | null {
  const raw = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

export function deskEmailStateOf(value: unknown): DeskEmailState | null {
  const row = rawOf(value);
  if (!row) return null;
  const status = row.status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED";
  return {
    kind: kindOf(row.kind),
    messageType: String(row.messageType),
    at: instant(row.at) ?? new Date(0),
    sent: row.sent !== false,
    status,
    cause: isRejectionCause(row.cause) ? row.cause : status === "COMPLAINED" ? "complaint" : "other",
    own: row.own !== false,
  };
}

export function emailStateOf(value: unknown): RegistrationEmailState | null {
  const row = rawOf(value);
  const desk = deskEmailStateOf(row);
  if (!row || !desk) return null;
  return {
    ...desk,
    laterDeliveredAt: instant(row.laterDeliveredAt),
    retriedAt: instant(row.retriedAt),
    retriedVia: row.retriedVia === "gmail" ? "gmail" : row.retriedVia === "mailgun" ? "mailgun" : null,
  };
}

export function emailStateDetailOf(value: unknown): RegistrationEmailStateDetail | null {
  const row = rawOf(value);
  const state = emailStateOf(row);
  if (!row || !state) return null;
  return { ...state, code: textOf(row.code), detail: textOf(row.detail) };
}
