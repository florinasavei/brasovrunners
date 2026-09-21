import { ALLOW_EVERY_RECIPIENT } from "@/shared/config/env-enums";
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

      return adapter.send({ ...marked, ...copies });
    },
  };
}
