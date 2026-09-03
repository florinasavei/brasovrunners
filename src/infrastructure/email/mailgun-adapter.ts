import type { EmailAdapter } from "./adapter";

/**
 * Mailgun — declared, not wired (AGENTS.md §16; `WEEKEND.md` § The email progression).
 *
 * This file exists so that the shape of live delivery is settled and the outbox has something
 * to talk to, and it deliberately contains no HTTP call and pulls in no SDK. Two things are
 * missing and neither is code:
 *
 *   - a verified sending domain. Mailgun refuses to send to strangers without one, and a
 *     `*.vercel.app` host cannot be verified because its DNS is not the club's. A sandbox
 *     domain reaches five authorized addresses, so it is a development tool, not a launch.
 *   - the Romanian and English templates of BR-REQ-080-01, which do not exist yet.
 *
 * It throws on construction rather than on send, and rather than returning a failure. A
 * `transient_failure` would be retried until the attempt ceiling and then sit in the outbox as
 * FAILED, so production would look like it was sending mail while every message quietly died.
 * Failing at startup means the day someone sets `EMAIL_DELIVERY_MODE=live`, the deployment
 * refuses to boot with a message naming exactly what is missing — which is the same class of
 * guard as the pilot's capacity CHECK: a half-built path is not reachable at all.
 *
 * Wiring it up is: add the HTTP call here, map Mailgun's response to `SendResult`, delete the
 * throw. Nothing outside this file changes.
 */

export class EmailProviderNotWiredError extends Error {
  readonly code = "INTERNAL_ERROR";

  constructor(sendingDomain: string) {
    super(
      `Live email delivery is configured for the sending domain "${sendingDomain}", but the ` +
        "Mailgun adapter is not wired to the network. It needs a verified sending domain and " +
        "the message templates of BR-REQ-080-01. Until then the only delivery mode that " +
        "works is capture (local, test, QA).",
    );
    this.name = "EmailProviderNotWiredError";
  }
}

export type MailgunConfig = {
  apiKey: string;
  /** The verified sending domain. Configuration, never a literal in `src/` (AGENTS.md §8). */
  domain: string;
};

export function createMailgunAdapter(config: MailgunConfig): EmailAdapter {
  // The API key is deliberately not read, not logged, and not stored on any object here.
  throw new EmailProviderNotWiredError(config.domain);
}
