import { isAccountRefusalError } from "@/infrastructure/email/mailgun-adapter";

/**
 * Why a message was refused, in the few words staff act on (§NNN; amending §76/§83, §663, and §622's
 * reading of the rows it left behind). Until now every permanent refusal was stored `BOUNCED` and
 * worded «adresa nu există sau căsuța e plină» — a full mailbox, Mailgun's own suppression after an
 * earlier bounce, a receiving server's policy, eight hours of deferrals, and the club's own Mailgun
 * account being refused at the send all alike. Each of them asks for something different, and two of
 * them say nothing about the address at all.
 *
 * - `no-such-address` — the receiving server says the mailbox or the domain does not exist (5.1.x;
 *   Mailgun's `hardfail`; Yahoo's «doesn't have a yahoo.com account»);
 * - `mailbox-full` — over quota (x.2.2; a bare 552, or one whose words say so);
 * - `blocked` — the receiving server refused it for policy or reputation (5.7.x, espblock, a block list):
 *   about the club's sending, not the address;
 * - `gave-up` — Mailgun gave up after hours of deferrals (old, greylisted), the address not refused;
 * - `refused` — refused for good, a plain `bounce` whose cause was not recorded: permanent, and never read
 *   as «no such address», which it may not be;
 * - `suppressed` — Mailgun did not try: the address bounced before, on this sending domain (605);
 * - `unsubscribed` — Mailgun did not try: the address is on its unsubscribe list (606);
 * - `complained` — the person marked this message as spam;
 * - `complaint-suppressed` — Mailgun did not try: the person once marked the club's mail as spam (607);
 * - `account` — the club's Mailgun account was refused at the send: the message never left;
 * - `other` — anything else (Mailgun's `generic`, a refusal no rule reads).
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
  "blocked",
  "gave-up",
  "refused",
  "suppressed",
  "unsubscribed",
  "complained",
  "complaint-suppressed",
  "account",
  "other",
] as const;

export type RejectionCause = (typeof REJECTION_CAUSES)[number];

export function isRejectionCause(value: unknown): value is RejectionCause {
  return typeof value === "string" && (REJECTION_CAUSES as readonly string[]).includes(value);
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

/**
 * An enhanced status (RFC 3463) standing alone in a text — never three parts of a dotted quad: a policy text
 * that quotes «10.5.1.20» or Yahoo's reference «4.16.55.1» names an address or a ticket, not «5.1.20». So
 * no word character or dot before it, and no word character or «.digit» after it (a sentence's full stop
 * after it is fine). One pattern for every reader: the webhook's scan of the server's words
 * (`mailgun-event.ts`), the cause, and the code a refusal at the send is stored with (`outbox.ts`).
 */
const ENHANCED_STATUS = /(?<![\w.])([245])\.(\d{1,3})\.(\d{1,3})(?!\w|\.\d)/;

/** The enhanced status in a text, as it is written there: «550 5.1.1 user unknown» → «5.1.1». */
export function enhancedStatusTextIn(text: string | null | undefined): string | null {
  const match = typeof text === "string" ? ENHANCED_STATUS.exec(text) : null;
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** The enhanced status (RFC 3463) in a text: «5.1.1» → [5, 1, 1]. */
export function enhancedStatusIn(text: string | null | undefined): [number, number, number] | null {
  const match = typeof text === "string" ? ENHANCED_STATUS.exec(text) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** The three-digit code a `provider_code` starts with: «550 5.1.1» → 550. */
function basicCodeIn(text: string | null | undefined): number | null {
  const match = typeof text === "string" ? /^\s*(\d{3})\b/.exec(text) : null;
  return match ? Number(match[1]) : null;
}

/**
 * What an enhanced status decides alone, or null when it leaves the words to decide. A class-4 code is a
 * deferral, which says nothing final about the address or the club: only its x.2.2 (a full mailbox — the
 * last deferral a final `old` carries) decides. A class-5 code decides 5.1.x (no such address; 5.1.7 and
 * 5.1.8 are the sender's, so blocked), 5.2.1 (a disabled mailbox), 5.2.2 (full) and 5.7.x (blocked):
 * Yahoo's «421 4.7.0 [TSS04] … temporarily deferred» is not a block, and its final `old` is a give-up.
 */
function causeOfEnhanced([klass, subject, detail]: [number, number, number]): RejectionCause | null {
  if (subject === 2 && detail === 2) return "mailbox-full";
  if (klass !== 5) return null;
  if (subject === 1) return detail === 7 || detail === 8 ? "blocked" : "no-such-address";
  if (subject === 2 && detail === 1) return "no-such-address";
  if (subject === 7) return "blocked";
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
    /user unknown|unknown user|no such (user|mailbox|recipient|address|domain)|does ?n[o’']t exist|not exist|does ?n[o’']t have an? [\w. -]{0,40}account|invalid (recipient|mailbox|address)|recipient not found|recipient (address )?rejected|address rejected|not a valid address|mailbox (is )?unavailable|mailbox not found|no mailbox|unrouteable|unroutable|(account|mailbox) (has been |is )?disabled|deactivated/i,
    "no-such-address",
  ],
  [/spam|blocked|block ?list|blacklist|spamhaus|policy|reputation|\bTSS\d+|dmarc|\bspf\b|dkim|not authori[sz]ed|denied|prohibited/i, "blocked"],
  [/too old|expired|greylist|timed? ?out|deferred|try again later/i, "gave-up"],
];

/**
 * The cause, by a stated precedence (§NNN): the person's complaint; Mailgun's own suppressions, by their
 * reason or their code (605, 606, 607); a refusal stored at the send (the club's account, unless it was
 * the one 400 that names the address; a Gmail refusal, which `gmail-adapter.ts` keeps only for a 5.1.x);
 * the enhanced status code (`causeOfEnhanced`: a final `old` carrying the last deferral's 4.2.2 is a full
 * mailbox, not a give-up); Mailgun's reason token (`old`, `greylisted`, `espblock`, `blacklisted`,
 * `hardfail`); the server's words; a 552 with no enhanced status, whose words said nothing; a plain
 * `bounce` — `refused`; and `other` (`generic` among them). Only `code` and `detail` are read for codes and words: a stored reason
 * is either Mailgun's token or a send-time answer, and both are read by their shape, so a row written
 * before the cause was stored reads the same here as the migration's backfill made it.
 */
export function rejectionCause(facts: RejectionFacts): RejectionCause {
  if (facts.status === "COMPLAINED") return "complained";
  const reason = (facts.reason ?? "").trim();
  const token = reason.toLowerCase();
  const basic = basicCodeIn(facts.code);
  if (token === "suppress-bounce" || basic === 605) return "suppressed";
  if (token === "suppress-unsubscribe" || basic === 606) return "unsubscribed";
  if (token === "suppress-complaint" || basic === 607) return "complaint-suppressed";

  if (MAILGUN_SEND_ANSWER.test(reason)) {
    if (!facts.sent && isAccountRefusalError(reason)) return "account";
    return /not a valid address/i.test(reason) ? "no-such-address" : "other";
  }
  if (GMAIL_ANSWER.test(reason)) return /\b5\.1\.\d{1,3}\b/.test(reason) ? "no-such-address" : "other";

  const enhanced = enhancedStatusIn(facts.code) ?? enhancedStatusIn(facts.detail);
  const byCode = enhanced ? causeOfEnhanced(enhanced) : null;
  if (byCode) return byCode;

  if (token === "old" || token === "greylisted") return "gave-up";
  if (token === "espblock" || token === "blacklisted") return "blocked";
  if (token === "hardfail") return "no-such-address";

  const words = facts.detail ?? "";
  for (const [pattern, cause] of WORDS) if (pattern.test(words)) return cause;

  // A bare 552 is a full mailbox (RFC 5321's «exceeded storage allocation»); a 552 whose enhanced status was
  // found and decided nothing is not — «552 5.3.4 Message size exceeds fixed maximum message size» is the
  // message's size, read below as the plain refusal it is.
  if (basic === 552 && !enhanced) return "mailbox-full";
  if (token === "bounce") return "refused";
  return "other";
}
