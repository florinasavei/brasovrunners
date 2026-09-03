import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
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
 */
export function decideDelivery(
  mode: EmailDeliveryMode,
  recipient: string,
  allowlist: readonly string[],
): DeliveryDecision {
  if (mode === "capture") return "capture";
  if (mode === "live") return "send";

  let canonicalRecipient: string;
  try {
    canonicalRecipient = canonicalizeEmail(recipient).canonicalEmail;
  } catch {
    return "capture";
  }

  return allowlist.some((entry) => {
    try {
      return canonicalizeEmail(entry).canonicalEmail === canonicalRecipient;
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
export function createEmailSender(config: {
  appEnv: AppEnvironment;
  mode: EmailDeliveryMode;
  allowlist: readonly string[];
  capture: EmailAdapter;
  live: () => EmailAdapter;
}): EmailSender {
  return {
    async send(message: OutgoingEmail): Promise<SendResult> {
      const marked: OutgoingEmail = {
        ...message,
        subject: markSubjectForEnvironment(message.subject, config.appEnv),
      };

      const decision = decideDelivery(config.mode, marked.to, config.allowlist);
      const adapter = decision === "send" ? config.live() : config.capture;

      return adapter.send(marked);
    },
  };
}
