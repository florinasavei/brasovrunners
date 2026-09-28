import type { Env } from "@/shared/config/env";
import { type CaptureAdapter, type CapturedEmail, createCaptureAdapter } from "./capture-adapter";
import { createEmailSender, type EmailSender } from "./delivery";
import type { GmailAtCap, GmailLedger } from "@/modules/notifications/domain/email-transport";
import { createGmailAdapter } from "./gmail-adapter";
import { createMailgunAdapter } from "./mailgun-adapter";

/**
 * Where configuration meets the provider (AGENTS.md §16.4, §7.2, §8): the one place that picks
 * the adapter. The capture adapter is returned too, as the mailbox tests and `/devs` read (§20.4).
 */
/**
 * The From header (AGENTS.md §8): `EMAIL_FROM_ADDRESS`, else `noreply@<sending domain>`. The name
 * is quoted so a comma cannot split the header.
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
 * One capture per process, not per drain, so `/devs` shows what a request captured (§124).
 * Bounded, in memory, per instance.
 */
const sharedCapture = createCaptureAdapter();
const CAPTURE_KEEP = 50;

/** The most recent captured messages, newest first — for the local viewer only. */
export function capturedEmails(): readonly CapturedEmail[] {
  const all = sharedCapture.messages;
  return [...all.slice(Math.max(0, all.length - CAPTURE_KEEP))].reverse();
}

/** The club's Gmail routing for this batch and its ledger (§443), built by `notifications/outbox-sender.ts`. */
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
     * The Reply-To in force (§442), on either road; absent, `EMAIL_REPLY_TO`. The From stays each
     * road's own, since a Gmail From on Mailgun fails DMARC.
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
  // The Gmail road needs the contact form's account and app password (§149) and the club's routing.
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
    /** Built only for a message actually transmitted; startup validation guarantees the credentials. */
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
