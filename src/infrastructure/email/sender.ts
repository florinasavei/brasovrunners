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
/**
 * The From header, assembled from configuration (AGENTS.md §8).
 *
 * `noreply@<sending domain>` is the default because it is correct the moment a Mailgun account
 * exists — a sandbox domain accepts it, and so will the club's domain later — and because the
 * club's real sender address is an owner decision that has not been made yet (`BUSINESS.md`
 * §9). Set `EMAIL_FROM_ADDRESS` when it is.
 *
 * The display name is quoted, so a comma in it cannot split the header into two addresses.
 */
export function formatSenderIdentity(config: {
  EMAIL_FROM_NAME: string;
  EMAIL_FROM_ADDRESS?: string;
  MAILGUN_DOMAIN?: string;
}): string {
  const address = config.EMAIL_FROM_ADDRESS ?? `noreply@${config.MAILGUN_DOMAIN ?? "localhost"}`;
  const name = config.EMAIL_FROM_NAME.replace(/["\\]/g, "");
  return `"${name}" <${address}>`;
}

export function createEmailSenderForEnvironment(
  config: Pick<
    Env,
    | "APP_ENV"
    | "EMAIL_DELIVERY_MODE"
    | "EMAIL_ALLOWLIST"
    | "MAILGUN_API_KEY"
    | "MAILGUN_DOMAIN"
    | "MAILGUN_API_BASE_URL"
    | "EMAIL_FROM_ADDRESS"
    | "EMAIL_FROM_NAME"
    | "EMAIL_REPLY_TO"
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
     * Startup validation has already established that a transmitting mode carries credentials
     * and that live delivery means production, so by the time this runs there is a key and a
     * domain to build with. A QA process in allowlist mode therefore starts, captures
     * everything not on the list, and only opens a connection for an address somebody
     * explicitly authorized.
     */
    live: () =>
      createMailgunAdapter({
        apiKey: config.MAILGUN_API_KEY ?? "",
        domain: config.MAILGUN_DOMAIN ?? "",
        apiBaseUrl: config.MAILGUN_API_BASE_URL ?? "",
        from: formatSenderIdentity(config),
        replyTo: config.EMAIL_REPLY_TO,
      }),
  });

  return { sender, capture };
}
