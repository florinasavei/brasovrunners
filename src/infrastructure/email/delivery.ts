import { ALLOW_EVERY_RECIPIENT } from "@/shared/config/env-enums";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { GMAIL_CAP_DEFERRED_ERROR, type GmailAtCap, gmailJitterCeilingMs, type GmailLedger } from "@/modules/notifications/domain/email-transport";
import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";

/**
 * Which adapter a message goes to, and what its subject says (BR-REQ-080-03; AGENTS.md §16.4):
 * a real person receives email from production only. The unsafe-combination check is in
 * `src/shared/config/env.ts`, so startup fails rather than the first send.
 */

export type AppEnvironment = "local" | "test" | "qa" | "production";
export type EmailDeliveryMode = "capture" | "allowlist" | "live";

export type DeliveryDecision = "send" | "capture";

export { ALLOW_EVERY_RECIPIENT };

/**
 * Whether one recipient may actually be transmitted to. In `allowlist` mode only listed inboxes
 * receive mail; everything else is captured. Membership compares canonical inboxes, never raw
 * strings (`AGENTS.md` §10.4); an address that cannot be canonicalized is captured.
 *
 * `*` authorizes every recipient (§163) while keeping the mode `allowlist` and the `[QA]` mark.
 */
export function decideDelivery(
  mode: EmailDeliveryMode,
  recipient: string,
  allowlist: readonly string[],
): DeliveryDecision {
  if (mode === "capture") return "capture";
  if (mode === "live") return "send";

  // By inbox, not identity: a dotted Gmail spelling is its own participant but the same inbox (§74).
  let recipientInbox: string;
  try {
    recipientInbox = canonicalizeEmail(recipient).inboxEmail;
  } catch {
    return "capture";
  }

  // After canonicalization: a malformed address is captured even under `*`.
  if (allowlist.includes(ALLOW_EVERY_RECIPIENT)) return "send";

  return allowlist.some((entry) => {
    try {
      return canonicalizeEmail(entry).inboxEmail === recipientInbox;
    } catch {
      // A malformed entry authorizes nothing (startup validation normally rejects one).
      return false;
    }
  })
    ? "send"
    : "capture";
}

/** BR-REQ-080-03 criterion 2: a QA message is visibly marked. */
export const QA_SUBJECT_PREFIX = "[QA] ";

/**
 * Mark a QA subject, the one environment whose mail reaches inboxes that also get production's.
 * Idempotent, so a resend does not stack prefixes.
 */
export function markSubjectForEnvironment(subject: string, appEnv: AppEnvironment): string {
  if (appEnv !== "qa") return subject;
  return subject.startsWith(QA_SUBJECT_PREFIX) ? subject : `${QA_SUBJECT_PREFIX}${subject}`;
}

export type EmailSender = {
  send(message: OutgoingEmail): Promise<SendResult>;
  /** End of batch: release the Gmail connection if opened (§493). Safe to call twice. */
  close?(): void;
};

/**
 * The Gmail road for one batch (§443). The ledger is shared across senders, so the cap (in
 * recipients, as Google counts them) and the pace hold across drains and instances.
 */
export type GmailRoad = {
  adapter: () => EmailAdapter;
  ledger: GmailLedger;
  dailyCap: number;
  paceSeconds: number;
  /** At the cap: wait for the rolling day to free room (`defer`), or Mailgun at once. */
  atGmailCap: GmailAtCap;
  overflowToGmail: boolean;
  /** Told of every Gmail failure, so a revoked app password shows on `/admin/emails` and `/api/health`. */
  onFailure?: (error: string, at: Date) => Promise<void>;
  /** Injected for the tests; the real one waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Injected for the tests; the real one is `Math.random`. */
  random?: () => number;
  /** The most one sender waits on the pace; past it a message is handed back `paced`. */
  paceBudgetMs?: number;
};

/** Pacing per batch: three or four Gmail sends at the default six seconds apart. */
export const GMAIL_PACE_BUDGET_MS = 20_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The address and every copy: what Google counts against the day. */
function recipientsOf(message: OutgoingEmail): number {
  return 1 + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0);
}

/**
 * The object the outbox worker talks to, so the worker never branches on environment (AGENTS.md §8).
 * `live` is a factory so the Mailgun adapter is built only when a message is really transmitted.
 */
export function createEmailSender(config: {
  appEnv: AppEnvironment;
  mode: EmailDeliveryMode;
  allowlist: readonly string[];
  capture: EmailAdapter;
  live: () => EmailAdapter;
  /** The club's Gmail (§443). Absent: every message takes Mailgun's road. */
  gmail?: GmailRoad;
}): EmailSender {
  const gmail = config.gmail;
  const clock = gmail?.now ?? (() => new Date());
  const sleep = gmail?.sleep ?? realSleep;
  const random = gmail?.random ?? Math.random;
  const budget = gmail?.paceBudgetMs ?? GMAIL_PACE_BUDGET_MS;
  let waited = 0;
  // After one Gmail failure this sender stops asking, rather than paying the timeout again.
  let gmailDown = false;
  // One Gmail adapter per sender (per batch), so one pooled connection serves the batch (§493).
  let gmailAdapter: EmailAdapter | null = null;
  const gmailAdapterOnce = (road: GmailRoad): EmailAdapter => (gmailAdapter ??= road.adapter());

  /**
   * Gmail's answer for one message: a result (sent or handed back), or null for Mailgun next.
   * `transmit` false is captured: nothing waits or counts, but the route is recorded. `chosen`
   * (the club picked Gmail) is the only case "defer at the cap" applies.
   */
  async function viaGmail(message: OutgoingEmail, transmit: boolean, chosen: boolean): Promise<SendResult | null> {
    if (!gmail || gmailDown) return null;
    if (!transmit) {
      const captured = await config.capture.send(message);
      return captured.outcome === "sent" ? { ...captured, transport: "gmail", recipients: 0 } : captured;
    }

    const recipients = recipientsOf(message);
    const jitterMs = Math.floor(random() * gmailJitterCeilingMs(gmail.paceSeconds));
    // Read afresh every message: another drain or instance may have just sent (§443).
    const admission = await gmail.ledger.admit({
      recipients,
      clock,
      jitterMs,
      maxWaitMs: Math.max(0, budget - waited),
      dailyCap: gmail.dailyCap,
      paceSeconds: gmail.paceSeconds,
    });
    if (!admission.admitted) {
      // At the cap and the club chose to wait: deferred until the rolling day frees room (§40).
      if (admission.reason === "cap" && chosen && gmail.atGmailCap === "defer") {
        return { outcome: "throttled", error: GMAIL_CAP_DEFERRED_ERROR, retryAfter: admission.roomAt };
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
      // Sleep until the held slot by the clock now: the ledger's transaction used part of the wait.
      const rest = admission.slotAt ? Math.max(0, admission.slotAt.getTime() - clock().getTime()) : admission.waitMs;
      if (rest > 0) await sleep(rest);
      waited += admission.waitMs;
    }
    const result = await gmailAdapterOnce(gmail).send(message);
    /*
      The address refused (permanently, or for now while the copies went; §493): not a Gmail
      failure, and not Mailgun's to retry, which would bounce again or send the copies twice.
      The outbox handles the row; the copies Gmail took count against its day.
    */
    const addressRefused =
      result.outcome === "permanent_failure" || (result.outcome === "transient_failure" && result.addressRefusedForNow === true);
    if (addressRefused) {
      const acceptedCopies = result.acceptedRecipients ?? 0;
      if (acceptedCopies > 0) {
        try {
          await gmail.ledger.accepted(acceptedCopies, clock());
        } catch {
          // Ledger errors never change the message's outcome.
        }
      }
      return result;
    }
    if (result.outcome !== "sent") {
      gmailDown = true;
      const error = result.error;
      try {
        await gmail.onFailure?.(error, clock());
      } catch {
        // Recording the failure must never be what stops the message.
      }
      // Possibly accepted: the outbox retries later rather than Mailgun sending a second copy.
      if (result.outcome === "transient_failure" && result.mayHaveBeenAccepted) return result;
      return null;
    }
    // The row's `sent_at`, which every sender paces from.
    const at = clock();
    try {
      await gmail.ledger.accepted(recipients, at);
    } catch {
      // Sent is sent: a ledger error must not turn it into a retry.
    }
    return { ...result, transport: "gmail", recipients, acceptedAt: at };
  }

  return {
    close() {
      const opened = gmailAdapter;
      gmailAdapter = null;
      try {
        opened?.close?.();
      } catch {
        // Closing must never fail the batch.
      }
    },

    async send(message: OutgoingEmail): Promise<SendResult> {
      const marked: OutgoingEmail = {
        ...message,
        subject: markSubjectForEnvironment(message.subject, config.appEnv),
      };

      const decision = decideDelivery(config.mode, marked.to, config.allowlist);
      const transmit = decision === "send";
      const adapter = transmit ? config.live() : config.capture;

      /*
        Each copy is judged on its own (§244): unauthorized copies are dropped, authorized ones
        still arrive. A captured message keeps its lists, as the record of what would have gone.
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
        The road (§443), after the environment's decision, which applies to both roads alike.
        1. Gmail chosen: Gmail if up, after the pace; at the cap, defer or Mailgun as the club chose;
           a failure before acceptance falls to Mailgun, one after may have been accepted is retried;
           a refused address bounces on neither road (§493).
        2. Mailgun's allowance spent (§40): Gmail if the club allows spill-over, else the outbox defers.
      */
      if (outgoing.transport === "gmail") {
        const carried = await viaGmail(outgoing, transmit, true);
        if (carried) return carried;
      }

      const result = await adapter.send(outgoing);
      if (result.outcome === "sent") return { ...result, transport: "mailgun", recipients: transmit ? recipientsOf(outgoing) : 0 };
      if (result.outcome === "throttled" && gmail?.overflowToGmail && outgoing.transport !== "gmail") {
        // Carried or paced: either is sooner than Mailgun's reset.
        const spilled = await viaGmail(outgoing, transmit, false);
        if (spilled) return spilled;
      }
      return result;
    },
  };
}
