import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

/**
 * Plain SMTP, for the one message that must not go through Mailgun (`DECISIONS.md` §149).
 *
 * The contact form's message is correspondence, not transactional mail: it is written by a
 * visitor to the club, it carries no token, no participant row depends on its delivery, and
 * every one of them would otherwise spend a unit of the Mailgun allowance the registrations
 * need (the owner: "email communication must be minimal so we meet the quota"). So it leaves
 * through the club's own Gmail — an app password, port 465, TLS from the first byte — and
 * lands in whichever mailboxes the club named, with the visitor as `Reply-To`. *Which*
 * mailboxes is not this module's question and not the environment's either since §164: the
 * resolution order is `platform_settings.contactRecipients` first and `CONTACT_FORM_TO`
 * behind it, in `modules/contact/domain/recipients.ts`; here they arrive already resolved.
 *
 * This is deliberately NOT an `EmailAdapter` (`adapter.ts`): that contract is the outbox's —
 * one recipient, an idempotency key, a locale tag, a classified failure the job retries. A
 * contact message has several recipients, no row to retry from and no queue; a failure is
 * told to the visitor on the spot with the club's address to write to instead. Two narrow
 * types instead of one wide one, and nothing here is reachable from `createEmailSender`.
 * Since §NNN the outbox has a Gmail road of its own — `gmail-adapter.ts`, a real `EmailAdapter`
 * over the same connection (`createSmtpConnection`) — and this contract is still the contact form's.
 *
 * Nodemailer 10 ships its own types, and is the one SMTP client the ecosystem uses; Node has
 * no SMTP client of its own, and a hand-written one over `node:tls` is the kind of code that
 * works until Google changes a greeting. Pinned exactly in `package.json`.
 */

export type SmtpAddress = { name: string; address: string };

export type SmtpMessage = {
  from: SmtpAddress;
  to: readonly string[];
  /** The club's own copy list (`DECISIONS.md` §164): everybody on it sees everybody else, which is what a club wants. */
  cc?: readonly string[];
  /**
   * The club's hidden copies (2026-09-22): Nodemailer puts them on the envelope (`RCPT TO`) and
   * writes no `Bcc` header, so nobody else on the message — the Cc'd colleagues, the visitor
   * answering "Reply all" — learns they exist. That is the whole of what Bcc means, and the
   * reason `mailgun-adapter.ts` does the same for the outbox's copies (§244).
   */
  bcc?: readonly string[];
  replyTo: SmtpAddress;
  subject: string;
  text: string;
  html: string;
};

export type SmtpSendResult =
  | { outcome: "sent"; providerMessageId: string }
  /** The error is safe to log: a code and a class, never the password or a header. */
  | { outcome: "failed"; error: string };

export interface SmtpTransport {
  readonly name: string;
  send(message: SmtpMessage): Promise<SmtpSendResult>;
}

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};

/**
 * Bounded waits, in a serverless function that has ten seconds of a visitor's patience and
 * not Nodemailer's two-minute defaults: a Gmail that does not answer is a "write to us
 * directly" on the page, not a spinner.
 */
const DNS_TIMEOUT_MS = 5_000;
const CONNECTION_TIMEOUT_MS = 8_000;
const GREETING_TIMEOUT_MS = 8_000;
const SOCKET_TIMEOUT_MS = 15_000;

/** What the log may carry: the error's code or class. The message can quote the server's reply, which may echo the login. */
export function describeSmtpFailure(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return `smtp ${code}`;
    if (error instanceof Error) return `smtp ${error.name}`;
  }
  return "smtp failure";
}

/**
 * The connection every SMTP send here opens — the contact form's and, since §NNN, the outbox's
 * Gmail road (`gmail-adapter.ts`) — so both keep the same TLS rule and the same bounded waits.
 */
export function createSmtpConnection(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Implicit TLS on 465 (Gmail's submission port); STARTTLS otherwise, required, never
    // opportunistic — an app password is not sent in the clear on a bad day.
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    // All four of Nodemailer's waits: the resolver's default is thirty seconds on its own.
    dnsTimeout: DNS_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

export function createSmtpTransport(config: SmtpConfig): SmtpTransport {
  const transporter = createSmtpConnection(config);

  return {
    name: "smtp",

    async send(message: SmtpMessage): Promise<SmtpSendResult> {
      try {
        const info = await transporter.sendMail({
          from: message.from,
          to: [...message.to],
          ...(message.cc && message.cc.length > 0 ? { cc: [...message.cc] } : {}),
          ...(message.bcc && message.bcc.length > 0 ? { bcc: [...message.bcc] } : {}),
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        // Gmail accepts for every address it relays; a recipient it refuses outright is a
        // failure the visitor should hear about rather than a "sent" that reached nobody.
        // Deliberately "every recipient", `cc` included: a copy that arrived is a message the
        // club has, and telling the visitor "we could not send" would be a second, wrong
        // message on top of a delivered one. A refused address shows in the function log.
        if (info.accepted.length === 0) return { outcome: "failed", error: "smtp rejected every recipient" };
        return { outcome: "sent", providerMessageId: info.messageId };
      } catch (error) {
        return { outcome: "failed", error: describeSmtpFailure(error) };
      }
    },
  };
}

export type CapturedSmtpMessage = SmtpMessage & { providerMessageId: string; capturedAt: Date };

export type CaptureSmtpTransport = SmtpTransport & {
  /** Everything captured since the last `clear()`, oldest first. */
  readonly messages: readonly CapturedSmtpMessage[];
  clear(): void;
};

/**
 * The capture twin, for local, test and the end-to-end suite: accepts the message, keeps it
 * in memory, opens no socket. The same shape the outbox's capture adapter has, for the same
 * reason — a developer reads it on `/devs` instead of an inbox.
 */
export function createCaptureSmtpTransport(now: () => Date = () => new Date()): CaptureSmtpTransport {
  const captured: CapturedSmtpMessage[] = [];

  return {
    name: "capture",

    async send(message: SmtpMessage): Promise<SmtpSendResult> {
      const providerMessageId = `capture:${randomUUID()}`;
      captured.push({ ...message, providerMessageId, capturedAt: now() });
      return { outcome: "sent", providerMessageId };
    },

    get messages() {
      return captured;
    },

    clear() {
      captured.length = 0;
    },
  };
}
