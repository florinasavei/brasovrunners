import {
  type CapturedSmtpMessage,
  createCaptureSmtpTransport,
  createSmtpTransport,
} from "@/infrastructure/email/smtp-adapter";
import { env, type Env } from "@/shared/config/env";
import type { ContactDelivery } from "./service";

/**
 * Where the contact form's configuration meets its transport (`DECISIONS.md` §149) — the
 * `sender.ts` of this one message, and the only module here that reads `env`.
 *
 * `CONTACT_FORM_MODE` is derived in `env.ts`: `capture` on a laptop and in the tests (no
 * socket, ever), `smtp` on a deployment with a sender, its password and somebody to send
 * to, `off` otherwise. The page reads the mode to decide whether to show the form at all;
 * the action asks for the delivery and gets `null` when there is none.
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

export function contactDeliveryFor(config: ContactConfig): ContactDelivery | null {
  if (config.CONTACT_FORM_MODE === "off") return null;

  // The display name is the club's, quoted by Nodemailer; the address is the Gmail account —
  // Google rewrites any other sender to it anyway. Captured, a placeholder stands in.
  const from = { name: config.EMAIL_FROM_NAME, address: config.CONTACT_SMTP_USER ?? "contact@localhost" };
  const to = config.CONTACT_FORM_TO.length > 0 ? config.CONTACT_FORM_TO : ["club@localhost"];
  const appEnv = config.APP_ENV;

  if (config.CONTACT_FORM_MODE === "capture") return { transport: sharedCapture, from, to, appEnv };

  return {
    transport: createSmtpTransport({
      host: config.CONTACT_SMTP_HOST,
      port: config.CONTACT_SMTP_PORT,
      user: config.CONTACT_SMTP_USER ?? "",
      password: config.CONTACT_SMTP_PASSWORD ?? "",
    }),
    from,
    to,
    appEnv,
  };
}

/** This process's delivery, from its environment. */
export function contactDelivery(): ContactDelivery | null {
  return contactDeliveryFor(env);
}
