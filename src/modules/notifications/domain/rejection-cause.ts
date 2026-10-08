import { isAccountRefusalError } from "@/infrastructure/email/mailgun-adapter";

/**
 * Why a message was refused, in the few words staff act on (§NNN; amending §76/§83, §663, and §622's
 * reading of the rows it left behind). Until now every permanent refusal was stored `BOUNCED` and
 * worded «adresa nu există sau căsuța e plină» — a full mailbox, Mailgun's own suppression after an
 * earlier bounce, a receiving server's policy, eight hours of deferrals, and the club's own Mailgun
 * account being refused at the send all alike. Each of them asks for something different, and two of
 * them say nothing about the address at all.
 *
 * - `no-such-address` — the receiving server says the mailbox or the domain does not exist (5.1.x);
 * - `mailbox-full` — over quota (x.2.2, 552);
 * - `suppressed` — Mailgun did not try: the address bounced before, on this sending domain (605);
 * - `unsubscribed` — Mailgun did not try: the address is on its unsubscribe list (606);
 * - `complaint-suppressed` — Mailgun did not try: the person once marked the club's mail as spam (607);
 * - `blocked` — the receiving server refused it for policy or reputation (5.7.x, espblock, a block list);
 * - `gave-up` — Mailgun gave up after hours of deferrals (old, greylisted), the address not refused;
 * - `complaint` — the person marked this message as spam;
 * - `account` — the club's Mailgun account was refused at the send: the message never left;
 * - `other` — refused for good, the cause not recorded (a bare `bounce` with no code says no more).
 *
 * Stored on the row (`rejection_cause`) when the refusal is written — the webhook's event and the send's
 * answer are the only moments the provider's words are at hand — and never recomputed from `last_error`,
 * which is redacted and cut. Migration `0131` filled it for the rows written before, from the shapes they
 * have (a reason token, or a stored send-time answer), by the same rule as `rejectionCause` reads those
 * shapes: `tests/integration/notifications/rejection-backfill.test.ts` holds the two together.
 */
export const REJECTION_CAUSES = [
  "no-such-address",
  "mailbox-full",
  "suppressed",
  "unsubscribed",
  "complaint-suppressed",
  "blocked",
  "gave-up",
  "complaint",
  "account",
  "other",
] as const;

export type RejectionCause = (typeof REJECTION_CAUSES)[number];

export function isRejectionCause(value: unknown): value is RejectionCause {
  return typeof value === "string" && (REJECTION_CAUSES as readonly string[]).includes(value);
}

/**
 * The causes that are about the address — the person's mailbox, or Mailgun's lists for it. `account` is
 * the club's, and says nothing about whether the address works.
 */
export function isAddressCause(cause: RejectionCause): boolean {
  return cause !== "account";
}

export type RejectionFacts = {
  status: "BOUNCED" | "COMPLAINED";
  /** Whether the message ever left (`sent_at`): a refusal at the send never did. */
  sent: boolean;
  /** Mailgun's one-word reason from the webhook (`bounce`, `suppress-bounce`, `old` …), or the refusal stored at the send. */
  reason: string | null;
  /** The receiving server's codes (`provider_code`): «550 5.1.1», or Mailgun's own «605». */
  code?: string | null;
  /** The receiving server's words (`provider_detail`), redacted. */
  detail?: string | null;
};

/** The enhanced status (RFC 3463) in a text: «5.1.1» → [5, 1, 1]. */
export function enhancedStatusIn(text: string | null | undefined): [number, number, number] | null {
  const match = typeof text === "string" ? /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(text) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** The three-digit code a `provider_code` starts with: «550 5.1.1» → 550. */
function basicCodeIn(text: string | null | undefined): number | null {
  const match = typeof text === "string" ? /^\s*(\d{3})\b/.exec(text) : null;
  return match ? Number(match[1]) : null;
}

/** What an enhanced status decides alone, or null when its subject leaves the words to decide. */
function causeOfEnhanced([, subject, detail]: [number, number, number]): RejectionCause | null {
  if (subject === 1) return detail === 7 || detail === 8 ? "blocked" : "no-such-address"; // x.1.7/x.1.8 are the sender's
  if (subject === 2) return detail === 2 ? "mailbox-full" : detail === 1 ? "no-such-address" : null; // x.2.1: mailbox disabled
  if (subject === 4) return detail === 4 ? "no-such-address" : detail === 7 ? "gave-up" : null; // x.4.4: unroutable; x.4.7: expired
  if (subject === 6 || subject === 7) return "blocked"; // content, security and policy
  return null;
}

const MAILGUN_SEND_ANSWER = /^mailgun \d{3}:/;
const GMAIL_ANSWER = /^gmail:/;

const WORDS: ReadonlyArray<[RegExp, RejectionCause]> = [
  [/previously bounced/i, "suppressed"],
  [/unsubscribed (address|recipient)/i, "unsubscribed"],
  [/marked (your )?messages as spam|previously complained/i, "complaint-suppressed"],
  [/quota|mail ?box (is )?full|insufficient (system )?storage|exceeded (the )?storage|out of storage/i, "mailbox-full"],
  [
    /user unknown|unknown user|no such (user|mailbox|recipient|address|domain)|does ?n[o’']t exist|not exist|invalid (recipient|mailbox|address)|recipient (address )?rejected|address rejected|not a valid address|mailbox (is )?unavailable|mailbox not found|no mailbox|unrouteable|unroutable|account (has been |is )?disabled|deactivated/i,
    "no-such-address",
  ],
  [/spam|blocked|block ?list|blacklist|spamhaus|policy|reputation|\bTSS\d+|dmarc|\bspf\b|dkim|not authori[sz]ed|denied|prohibited/i, "blocked"],
  [/too old|expired|greylist|timed? ?out|deferred|try again later/i, "gave-up"],
];

/**
 * The cause, by a stated precedence (§NNN): the person's complaint; a refusal stored at the send (the
 * club's account, unless it was the one 400 that names the address); a Gmail refusal (`gmail-adapter.ts`
 * keeps only its 5.1.x as a bounce); Mailgun's own suppressions; the enhanced status code — a final `old`
 * event can carry the last deferral's 4.2.2, and that is a full mailbox, not a give-up; a 552; Mailgun's
 * reason token; the server's words; and `other`. Only `code` and `detail` are read for codes and words:
 * a stored reason is either Mailgun's token or a send-time answer, and both are read by their shape, so
 * a row written before the cause was stored reads the same here as the migration's backfill made it.
 */
export function rejectionCause(facts: RejectionFacts): RejectionCause {
  if (facts.status === "COMPLAINED") return "complaint";
  const reason = (facts.reason ?? "").trim();

  if (MAILGUN_SEND_ANSWER.test(reason)) {
    if (!facts.sent && isAccountRefusalError(reason)) return "account";
    return /not a valid address/i.test(reason) ? "no-such-address" : "other";
  }
  if (GMAIL_ANSWER.test(reason)) return /\b5\.1\.\d{1,3}\b/.test(reason) ? "no-such-address" : "other";

  const token = reason.toLowerCase();
  const basic = basicCodeIn(facts.code);
  if (token === "suppress-bounce" || basic === 605) return "suppressed";
  if (token === "suppress-unsubscribe" || basic === 606) return "unsubscribed";
  if (token === "suppress-complaint" || basic === 607) return "complaint-suppressed";

  const enhanced = enhancedStatusIn(facts.code) ?? enhancedStatusIn(facts.detail);
  const byCode = enhanced ? causeOfEnhanced(enhanced) : null;
  if (byCode) return byCode;
  if (basic === 552) return "mailbox-full";

  if (token === "espblock" || token === "blacklisted") return "blocked";
  if (token === "old" || token === "greylisted") return "gave-up";

  const words = facts.detail ?? "";
  for (const [pattern, cause] of WORDS) if (pattern.test(words)) return cause;

  if (enhanced && enhanced[1] === 4) return "gave-up";
  return "other";
}
