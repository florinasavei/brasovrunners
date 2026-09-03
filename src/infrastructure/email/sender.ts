import type { Env } from "@/shared/config/env";
import { type CaptureAdapter, createCaptureAdapter } from "./capture-adapter";
import { createEmailSender, type EmailSender } from "./delivery";
import { createMailgunAdapter } from "./mailgun-adapter";

/**
 * Where configuration meets the provider (AGENTS.md §16.4, §7.2).
 *
 * The one place that reads the email settings and decides which adapter exists. Nothing else
 * in the application asks what environment it is in before sending a message (§8: no
 * environment branching outside configuration).
 *
 * The capture adapter comes back with the sender because it *is* the mailbox in local, test
 * and the captured half of QA: an end-to-end test reads action links out of it (§20.4), and a
 * developer checks it instead of an inbox.
 */
export function createEmailSenderForEnvironment(
  config: Pick<
    Env,
    "APP_ENV" | "EMAIL_DELIVERY_MODE" | "EMAIL_ALLOWLIST" | "MAILGUN_API_KEY" | "MAILGUN_DOMAIN"
  >,
): { sender: EmailSender; capture: CaptureAdapter } {
  const capture = createCaptureAdapter();

  const sender = createEmailSender({
    appEnv: config.APP_ENV,
    mode: config.EMAIL_DELIVERY_MODE,
    allowlist: config.EMAIL_ALLOWLIST,
    capture,
    /**
     * Constructed on demand, and only for a message that is actually being transmitted.
     *
     * Startup validation has already established that a transmitting mode has credentials and
     * that live delivery means production; what it cannot establish is that Mailgun is wired,
     * because it is not. So this throws — loudly, naming what is missing — at the moment a
     * message would otherwise vanish. See `mailgun-adapter.ts`.
     */
    live: () =>
      createMailgunAdapter({
        apiKey: config.MAILGUN_API_KEY ?? "",
        domain: config.MAILGUN_DOMAIN ?? "",
      }),
  });

  return { sender, capture };
}
