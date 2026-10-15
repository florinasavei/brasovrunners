import nodemailer from "nodemailer";

/**
 * Plain SMTP to the club's own Gmail (`DECISIONS.md` §149, §443): the connection, its bounded waits and the
 * words for a failure — the one place that knows how the club's Gmail is reached.
 *
 * Until §NNN this file also held the contact form's own transport, a narrow contract beside the outbox's because a
 * contact message had no row to retry from and a failure was told to the visitor on the spot. It is a row now
 * (`CONTACT_MESSAGE`): «Scrie-ne» and «Spune-ne ceva» are carried by the outbox like every other mail, and the Gmail
 * road they use is `gmail-adapter.ts`, an `EmailAdapter` over `createSmtpConnection` below. What stays here is what
 * both roads share: the connection, `describeSmtpFailure` and the message's shape (`SmtpMessage`, which the contact
 * message is composed as before it is queued).
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
  /**
   * Where "Reply" goes: the visitor, on the contact form; the address somebody typed for an answer,
   * on «Spune-ne ceva» (§676) — and none when they left none, so nobody is answered by mistake.
   */
  replyTo?: SmtpAddress;
  subject: string;
  text: string;
  html: string;
};

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
 * The connection every SMTP send here opens — the contact form's and, since §443, the outbox's
 * Gmail road (`gmail-adapter.ts`) — so both keep the same TLS rule and the same bounded waits.
 *
 * `pooled` is the outbox's (§493): one batch sends several Gmail messages a few seconds apart, and
 * without a pool each of them paid its own TCP, TLS and login handshake — three round trips to
 * Google and one more "new sign-in" per message on an account Google watches for automated use.
 * Pooled, a batch keeps one connection (`maxConnections: 1`) and closes it when it ends
 * (`close()`); an idle one closes by itself after the socket wait below. A message whose connection
 * dropped while it was being sent is never re-sent by the pool (`maxRequeues: 0`): it may already
 * have been accepted, and the outbox decides what happens to it (`gmail-adapter.ts`), not Nodemailer.
 * The contact form sends one message per request and keeps its own connection.
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
  };
}
