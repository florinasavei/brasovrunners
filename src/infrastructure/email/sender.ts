import type { Env } from "@/shared/config/env";
import { type CaptureAdapter, type CapturedEmail, createCaptureAdapter } from "./capture-adapter";
import { createEmailSender, type EmailSender } from "./delivery";
import type { GmailAtCap, GmailLedger } from "@/modules/notifications/domain/email-transport";
import { createGmailAdapter } from "./gmail-adapter";
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

/**
 * One capture for the process, not one per drain: what a request captured is what `/devs`
 * shows a minute later (§124; the owner, testing locally: "why did I not receive the
 * email?" — locally nothing is sent). Bounded, in memory, per instance; on the platforms
 * that transmit it holds only what the allowlist kept back and is never shown.
 */
const sharedCapture = createCaptureAdapter();
const CAPTURE_KEEP = 50;

/** The most recent captured messages, newest first — for the local viewer only. */
export function capturedEmails(): readonly CapturedEmail[] {
  const all = sharedCapture.messages;
  return [...all.slice(Math.max(0, all.length - CAPTURE_KEEP))].reverse();
}

/**
 * The club's choice about the Gmail road for this batch (§443) and the ledger Gmail's usage is read
 * from before every message — the database's, built by the caller (`notifications/outbox-sender.ts`);
 * this file reads none.
 */
export type GmailRouting = {
  dailyCap: number;
  paceSeconds: number;
  atGmailCap: GmailAtCap;
  overflowToGmail: boolean;
  ledger: GmailLedger;
  /** Where a Gmail failure is recorded (§443, `notifications/email-transport.ts`). */
  onFailure?: (error: string, at: Date) => Promise<void>;
};

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
  > &
    Pick<Env, "CONTACT_SMTP_HOST" | "CONTACT_SMTP_PORT" | "CONTACT_SMTP_USER" | "CONTACT_SMTP_PASSWORD">,
  options: {
    /**
     * The Reply-To in force (§442): «Adresa de contact afișată» on `/admin/emails` — the mailbox,
     * the club's Gmail, or both, comma-separated. Absent, `EMAIL_REPLY_TO` as before. Only the
     * Reply-To follows the setting, on either road; the From stays the road's own — the Mailgun
     * domain on Mailgun's (a Gmail From there fails DMARC), the Gmail account on Gmail's.
     */
    replyTo?: string;
    /** The club's routing for the Gmail road (§443); absent, every message takes Mailgun's. */
    gmail?: GmailRouting;
  } = {},
): { sender: EmailSender; capture: CaptureAdapter } {
  const capture = sharedCapture;
  const replyTo = options.replyTo ?? config.EMAIL_REPLY_TO;
  const routing = options.gmail;
  const { CONTACT_SMTP_USER: gmailUser, CONTACT_SMTP_PASSWORD: gmailPassword } = config;
  /*
    The Gmail road exists only with the account and its app password — the contact form's two
    variables (§149) — and only when the caller brought the club's routing. Without either, every
    message takes Mailgun's road, as before §443.
  */
  const gmail =
    routing && gmailUser && gmailPassword
      ? {
          adapter: () =>
            createGmailAdapter({
              host: config.CONTACT_SMTP_HOST,
              port: config.CONTACT_SMTP_PORT,
              user: gmailUser,
              password: gmailPassword,
              from: { name: config.EMAIL_FROM_NAME.replace(/["\\]/g, ""), address: gmailUser },
              ...(replyTo ? { replyTo } : {}),
            }),
          ledger: routing.ledger,
          dailyCap: routing.dailyCap,
          paceSeconds: routing.paceSeconds,
          atGmailCap: routing.atGmailCap,
          overflowToGmail: routing.overflowToGmail,
          ...(routing.onFailure ? { onFailure: routing.onFailure } : {}),
        }
      : undefined;

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
        replyTo,
      }),
    ...(gmail ? { gmail } : {}),
  });

  return { sender, capture };
}
