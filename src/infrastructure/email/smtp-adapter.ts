import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

/**
 * Plain SMTP through the club's Gmail for the contact form, which must not spend the Mailgun
 * allowance (§149). Recipients arrive resolved (`modules/contact/domain/recipients.ts`, §164).
 *
 * Not an `EmailAdapter`: a contact message has several recipients, no outbox row and no retry; a
 * failure is told to the visitor at once. `createSmtpConnection` also serves the outbox's Gmail
 * road (`gmail-adapter.ts`, §443).
 */

export type SmtpAddress = { name: string; address: string };

export type SmtpMessage = {
  from: SmtpAddress;
  to: readonly string[];
  /** The club's visible copy list (§164). */
  cc?: readonly string[];
  /** The club's hidden copies: envelope only, no `Bcc` header (§244). */
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

/** Bounded waits for a serverless request, instead of Nodemailer's two-minute defaults. */
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
 * The SMTP connection for the contact form and the outbox's Gmail road (§443): one TLS rule, one
 * set of waits. `pooled` (§493) keeps one connection per batch, avoiding a login per message;
 * `maxRequeues: 0` because a dropped send may have been accepted and the outbox decides.
 */
export function createSmtpConnection(config: SmtpConfig, options: { pooled?: boolean } = {}) {
  const base = smtpOptions(config);
  return options.pooled
    ? nodemailer.createTransport({ ...base, pool: true, maxConnections: 1, maxRequeues: 0 })
    : nodemailer.createTransport(base);
}

function smtpOptions(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    // Implicit TLS on 465; STARTTLS otherwise, required so the app password never goes in the clear.
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    // All four waits: the resolver alone defaults to thirty seconds.
    dnsTimeout: DNS_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  };
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
        // Failed only when every recipient, copies included, was refused: a delivered copy is a
        // message the club has.
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

/** The capture twin for local, test and e2e: in memory, no socket; read on `/devs`. */
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
