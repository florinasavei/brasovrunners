import { ALLOW_EVERY_RECIPIENT } from "@/shared/config/env-enums";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import {
  type GmailAtCap,
  gmailAdmission,
  gmailJitterCeilingMs,
  type GmailUsage,
} from "@/modules/notifications/domain/email-transport";
import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";

/**
 * Which adapter a message goes to, and what its subject says (BR-REQ-080-03; AGENTS.md §16.4).
 *
 * The rule this file protects: a real person receives email from production and from nowhere
 * else. Everything below is one decision — send or capture — plus the QA subject marking, and
 * both are pure functions so they can be read and tested without a provider, an environment,
 * or a database.
 *
 * The unsafe-combination check itself lives in `src/shared/config/env.ts`, because the
 * requirement is that *startup* fails, not that the first send fails.
 */

export type AppEnvironment = "local" | "test" | "qa" | "production";
export type EmailDeliveryMode = "capture" | "allowlist" | "live";

export type DeliveryDecision = "send" | "capture";

export { ALLOW_EVERY_RECIPIENT };

/**
 * Whether one recipient may actually be transmitted to.
 *
 * `allowlist` is what a Mailgun sandbox domain is: it reaches at most five authorized
 * addresses, so QA can exercise real delivery to the people who work on it while every other
 * address — a synthetic participant, a seeded row, a typo — is captured instead of surprising
 * a stranger with mail from a test system.
 *
 * Membership goes through the versioned canonicalizer, never a string compare. That is a rule
 * with a reason (`AGENTS.md` §10.4): `Ana.Pop+qa@gmail.com` and `anapop@gmail.com` are one
 * inbox, and an allowlist that compared raw strings would capture a message the operator had
 * explicitly authorized — or, worse the other way round, fail to notice that two spellings of
 * one address were on the list.
 *
 * An address that cannot be canonicalized is captured. There is no address to send to.
 *
 * One entry is not an address: `*` authorizes every recipient (`DECISIONS.md` §163). It is
 * what an operator sets on QA when the people testing are more than a handful — a colleague
 * being invited, a runner walking through the journey — and it is deliberately the allowlist's
 * own escape hatch rather than `live`, so the mode stays `allowlist`, the subject keeps its
 * `[QA]` mark, production's "live only here" rule is untouched, and one character undoes it.
 */
export function decideDelivery(
  mode: EmailDeliveryMode,
  recipient: string,
  allowlist: readonly string[],
): DeliveryDecision {
  if (mode === "capture") return "capture";
  if (mode === "live") return "send";

  // By inbox, not by identity: since canonicalization version 2 a dotted Gmail spelling is
  // its own participant, but it is still the allowlisted person's inbox, and that is what
  // the allowlist is about (`DECISIONS.md` §74).
  let recipientInbox: string;
  try {
    recipientInbox = canonicalizeEmail(recipient).inboxEmail;
  } catch {
    return "capture";
  }

  // Everyone, when the operator said so — after canonicalization, because an address that is
  // not one has nowhere to go, star or no star.
  if (allowlist.includes(ALLOW_EVERY_RECIPIENT)) return "send";

  return allowlist.some((entry) => {
    try {
      return canonicalizeEmail(entry).inboxEmail === recipientInbox;
    } catch {
      // A malformed allowlist entry authorizes nothing. Startup validation rejects one, so
      // reaching here means configuration changed under a running process.
      return false;
    }
  })
    ? "send"
    : "capture";
}

/** BR-REQ-080-03 criterion 2: a QA message is visibly marked. */
export const QA_SUBJECT_PREFIX = "[QA] ";

/**
 * Mark a subject for the environment that produced it.
 *
 * Only QA is marked. Production must not be, obviously; local and test are marked by the fact
 * that nothing leaves the process. QA is the one environment where a message can reach a
 * human inbox that also receives the real thing, and a club organizer looking at two identical
 * "Confirmă-ți înscrierea" emails cannot tell which system asked.
 *
 * Marking is idempotent, because a manual resend of a captured QA message would otherwise
 * accumulate prefixes.
 */
export function markSubjectForEnvironment(subject: string, appEnv: AppEnvironment): string {
  if (appEnv !== "qa") return subject;
  return subject.startsWith(QA_SUBJECT_PREFIX) ? subject : `${QA_SUBJECT_PREFIX}${subject}`;
}

export type EmailSender = {
  send(message: OutgoingEmail): Promise<SendResult>;
};

/**
 * The single object the outbox worker talks to.
 *
 * It owns the two decisions above and delegates the transmission itself. The worker therefore
 * has no idea which environment it is in, which is what keeps `AGENTS.md` §8's "no environment
 * branching in domain logic" true as the number of message types grows.
 *
 * `live` is a function rather than an adapter so that it is constructed only when a message
 * is actually going to be transmitted. That matters while `createMailgunAdapter` throws: a QA
 * process in allowlist mode starts, captures everything not on the list, and only fails when
 * it genuinely tries to reach a real inbox.
 */
/**
 * The Gmail road, as the sender needs it for one batch (§NNN): the adapter (built on demand, like
 * Mailgun's), the club's cap, pace and choice at the cap, whether Mailgun's spent allowance spills
 * over, and Gmail's usage as the database had it when the batch began — which the sender then keeps
 * counting, in recipients, as Google counts them.
 */
export type GmailRoad = {
  adapter: () => EmailAdapter;
  usage: GmailUsage;
  dailyCap: number;
  paceSeconds: number;
  /** At the cap: wait for the rolling day to free room (`defer`), or Mailgun at once. */
  atGmailCap: GmailAtCap;
  overflowToGmail: boolean;
  /**
   * Told of every Gmail failure, before the sender turns to Mailgun or hands the row back — so a
   * revoked app password is on `/admin/emails` and in `/api/health`, not merely spending Mailgun.
   */
  onFailure?: (error: string, at: Date) => Promise<void>;
  /** Injected for the tests; the real one waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Injected for the tests; the real one is `Math.random`. */
  random?: () => number;
  /**
   * The most one sender may spend waiting on the pace. Past it, a Gmail message is handed back
   * `paced` for the next run rather than keeping a function alive on a timer.
   */
  paceBudgetMs?: number;
};

/** Twenty seconds of pacing per batch: three or four Gmail sends at the default six seconds apart, and a function that ends. */
export const GMAIL_PACE_BUDGET_MS = 20_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The address and every copy: what Google counts against the day. */
function recipientsOf(message: OutgoingEmail): number {
  return 1 + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0);
}

export function createEmailSender(config: {
  appEnv: AppEnvironment;
  mode: EmailDeliveryMode;
  allowlist: readonly string[];
  capture: EmailAdapter;
  live: () => EmailAdapter;
  /** The club's Gmail (§NNN). Absent — local, test, a deployment without the account — every message takes Mailgun's road. */
  gmail?: GmailRoad;
}): EmailSender {
  const gmail = config.gmail;
  const usage: GmailUsage | null = gmail ? { ...gmail.usage } : null;
  const clock = gmail?.now ?? (() => new Date());
  const sleep = gmail?.sleep ?? realSleep;
  const random = gmail?.random ?? Math.random;
  const budget = gmail?.paceBudgetMs ?? GMAIL_PACE_BUDGET_MS;
  let waited = 0;
  // One Gmail failure and this sender stops asking Gmail: the next message should not pay the
  // same connection timeout to learn the same thing.
  let gmailDown = false;

  /**
   * Gmail's answer for one message: carried, handed back (the pace, the cap the club chose to wait
   * out, or a failure that may have been accepted), or not taken (null) — in which case Mailgun's
   * road is next. `transmit` false is the captured case: nothing leaves, so nothing waits and
   * nothing is counted against the cap, but the route is still recorded as it would have gone.
   * `chosen` is whether the club chose Gmail for this message's group — only then does "defer at
   * the cap" apply; a spill-over from Mailgun keeps Mailgun's own deferral.
   */
  async function viaGmail(message: OutgoingEmail, transmit: boolean, chosen: boolean): Promise<SendResult | null> {
    if (!gmail || !usage || gmailDown || !usage.configured) return null;
    if (!transmit) {
      const captured = await config.capture.send(message);
      return captured.outcome === "sent" ? { ...captured, transport: "gmail", recipients: 0 } : captured;
    }

    const recipients = recipientsOf(message);
    const jitterMs = Math.floor(random() * gmailJitterCeilingMs(gmail.paceSeconds));
    const admission = gmailAdmission(
      usage,
      { gmailDailyCap: gmail.dailyCap, gmailPaceSeconds: gmail.paceSeconds },
      clock(),
      recipients,
      jitterMs,
    );
    if (!admission.admitted) {
      // At the cap and the club said wait: deferred to the moment the oldest send leaves the
      // rolling day, as a spent Mailgun allowance is deferred (§40) — never discarded.
      if (admission.reason === "cap" && chosen && gmail.atGmailCap === "defer") {
        return { outcome: "throttled", error: "gmail daily cap: deferred", retryAfter: admission.roomAt };
      }
      return null;
    }
    if (admission.waitMs > 0) {
      if (waited + admission.waitMs > budget) {
        return {
          outcome: "throttled",
          error: "gmail pace: handed to the next run",
          retryAfter: new Date(clock().getTime() + admission.waitMs),
          paced: true,
        };
      }
      await sleep(admission.waitMs);
      waited += admission.waitMs;
    }
    const result = await gmail.adapter().send(message);
    if (result.outcome !== "sent") {
      gmailDown = true;
      const error = result.error;
      try {
        await gmail.onFailure?.(error, clock());
      } catch {
        // Recording the failure must never be what stops the message.
      }
      // Possibly accepted already: the outbox retries it later rather than Mailgun sending a second copy now.
      if (result.outcome === "transient_failure" && result.mayHaveBeenAccepted) return result;
      return null;
    }
    const at = clock();
    usage.sentLastDay += recipients;
    usage.lastSentAt = at;
    usage.oldestInWindowAt ??= at;
    return { ...result, transport: "gmail", recipients };
  }

  return {
    async send(message: OutgoingEmail): Promise<SendResult> {
      const marked: OutgoingEmail = {
        ...message,
        subject: markSubjectForEnvironment(message.subject, config.appEnv),
      };

      const decision = decideDelivery(config.mode, marked.to, config.allowlist);
      const transmit = decision === "send";
      const adapter = transmit ? config.live() : config.capture;

      /*
        A copy is a recipient (`DECISIONS.md` §244).

        The decision above is about the message — whether this environment may transmit at all
        — and it is made on the address the message is *for*. Every `cc` and `bcc` is then
        judged on its own: a club mailbox nobody authorized must not receive a participant's
        declaration from QA merely because the archive address happens to be on the allowlist.
        Dropped one by one rather than capturing the whole message, so the copy the operator
        did authorize still arrives.

        A captured message keeps its lists untouched: capture is the local record of what would
        have gone out, and filtering it there would hide what was about to happen.
      */
      const copies =
        decision === "send"
          ? {
              ...(marked.cc ? { cc: marked.cc.filter((address) => decideDelivery(config.mode, address, config.allowlist) === "send") } : {}),
              ...(marked.bcc ? { bcc: marked.bcc.filter((address) => decideDelivery(config.mode, address, config.allowlist) === "send") } : {}),
            }
          : {};

      const outgoing: OutgoingEmail = { ...marked, ...copies };

      /*
        The road (§NNN). The environment's decision above is untouched and comes first: a captured
        message is captured whichever road it would have taken, and the allowlist judges a Gmail
        message exactly as it judges a Mailgun one — QA reaches a stranger by neither.

        1. The club chose Gmail for this group: Gmail, if configured and not failed in this batch —
           after the pace. At the cap, deferred or Mailgun, as the club chose. A failure before Gmail
           could have taken it: Mailgun, at once. A failure after it might have: the outbox retries.
        2. Mailgun refuses because the plan's allowance is spent (§40): Gmail, when the club lets
           it spill over and Gmail can take it; otherwise the refusal stands and the outbox defers.
      */
      if (outgoing.transport === "gmail") {
        const carried = await viaGmail(outgoing, transmit, true);
        if (carried) return carried;
      }

      const result = await adapter.send(outgoing);
      if (result.outcome === "sent") return { ...result, transport: "mailgun", recipients: transmit ? recipientsOf(outgoing) : 0 };
      if (result.outcome === "throttled" && gmail?.overflowToGmail && outgoing.transport !== "gmail") {
        // Carried, or handed back for the pace — either is sooner than Mailgun's reset.
        const spilled = await viaGmail(outgoing, transmit, false);
        if (spilled) return spilled;
      }
      return result;
    },
  };
}
