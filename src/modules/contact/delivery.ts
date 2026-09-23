import {
  type CapturedSmtpMessage,
  createCaptureSmtpTransport,
  createSmtpTransport,
} from "@/infrastructure/email/smtp-adapter";
import { env, type Env } from "@/shared/config/env";
import { type ContactRecipients, resolveContactRecipients } from "./domain/recipients";
import type { ContactDelivery } from "./service";

/**
 * Where the contact form's configuration meets its transport (`DECISIONS.md` §149, §164) —
 * the `sender.ts` of this one message, and the only module here that reads `env`.
 *
 * `CONTACT_FORM_MODE` is derived in `env.ts` and answers one question only: has this
 * deployment a way of sending at all — `capture` on a laptop and in the tests (no socket,
 * ever), `smtp` with the Gmail account and its app password, `off` otherwise. *Who* receives
 * is the club's, set on `/admin/emails` and passed in here (§164), with `CONTACT_FORM_TO` as
 * the fallback for a deployment whose database has no row yet. Both must answer for the form
 * to exist: a transport with nobody to send to is `null`, exactly as no transport is.
 */

/** One capture for the process, so what a request captured is what `/devs` shows a minute later (§124). */
const sharedCapture = createCaptureSmtpTransport();
const CAPTURE_KEEP = 20;

/** The most recent captured contact messages, newest first — for the local viewer and the tests. */
export function capturedContactMessages(): readonly CapturedSmtpMessage[] {
  const all = sharedCapture.messages;
  return [...all.slice(Math.max(0, all.length - CAPTURE_KEEP))].reverse();
}

export type ContactConfig = Pick<
  Env,
  | "APP_ENV"
  | "CONTACT_FORM_MODE"
  | "CONTACT_SMTP_HOST"
  | "CONTACT_SMTP_PORT"
  | "CONTACT_SMTP_USER"
  | "CONTACT_SMTP_PASSWORD"
  | "CONTACT_FORM_TO"
  | "EMAIL_FROM_NAME"
>;

type ContactRoute = Omit<ContactDelivery, "transport">;

/** The addresses and the envelope, with no transport attached — what both callers below need. */
function contactRoute(config: ContactConfig, recipients: ContactRecipients | null): ContactRoute | null {
  if (config.CONTACT_FORM_MODE === "off") return null;

  const resolved = resolveContactRecipients(recipients, config.CONTACT_FORM_TO);
  // Nobody to send to is the same answer as no way to send: the page shows the club's address.
  // On a laptop a placeholder stands in, so the form works with nothing configured at all.
  const to =
    resolved.to.length > 0 ? resolved.to : config.CONTACT_FORM_MODE === "capture" ? ["club@localhost"] : null;
  if (!to) return null;

  // The display name is the club's, quoted by Nodemailer; the address is the Gmail account —
  // Google rewrites any other sender to it anyway. Captured, a placeholder stands in.
  const from = { name: config.EMAIL_FROM_NAME, address: config.CONTACT_SMTP_USER ?? "contact@localhost" };
  return { from, to, cc: resolved.cc, bcc: resolved.bcc, appEnv: config.APP_ENV };
}

/** Can a message posted on this deployment reach anybody? The page asks before it shows a form. */
export function contactFormReaches(config: ContactConfig, recipients: ContactRecipients | null): boolean {
  return contactRoute(config, recipients) !== null;
}

export function contactDeliveryFor(
  config: ContactConfig,
  recipients: ContactRecipients | null,
): ContactDelivery | null {
  const route = contactRoute(config, recipients);
  if (!route) return null;

  if (config.CONTACT_FORM_MODE === "capture") return { transport: sharedCapture, ...route };

  return {
    transport: createSmtpTransport({
      host: config.CONTACT_SMTP_HOST,
      port: config.CONTACT_SMTP_PORT,
      user: config.CONTACT_SMTP_USER ?? "",
      password: config.CONTACT_SMTP_PASSWORD ?? "",
    }),
    ...route,
  };
}

/** This process's delivery, from its environment and the club's own recipient list. */
export function contactDelivery(recipients: ContactRecipients | null): ContactDelivery | null {
  return contactDeliveryFor(env, recipients);
}
