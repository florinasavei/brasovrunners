import {
  type CapturedSmtpMessage,
  createCaptureSmtpTransport,
  createSmtpTransport,
} from "@/infrastructure/email/smtp-adapter";
import { env, type Env } from "@/shared/config/env";
import { type ContactRecipients, resolveContactRecipients } from "./domain/recipients";
import type { ContactDelivery } from "./service";

/**
 * The contact form's transport and route (§149, §164); the only module here that reads `env`.
 * `CONTACT_FORM_MODE` says whether a way to send exists; recipients come from the setting. No
 * transport or nobody to send to both mean `null`: the form is off.
 */

/** One capture per process, so `/devs` shows what a request captured (§124). */
const sharedCapture = createCaptureSmtpTransport();
const CAPTURE_KEEP = 20;

/** Newest first. */
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

function contactRoute(config: ContactConfig, recipients: ContactRecipients | null): ContactRoute | null {
  if (config.CONTACT_FORM_MODE === "off") return null;

  const resolved = resolveContactRecipients(recipients, config.CONTACT_FORM_TO);
  // In capture mode a placeholder stands in, so the form works unconfigured.
  const to =
    resolved.to.length > 0 ? resolved.to : config.CONTACT_FORM_MODE === "capture" ? ["club@localhost"] : null;
  if (!to) return null;

  // Gmail rewrites any other sender address to the account's own.
  const from = { name: config.EMAIL_FROM_NAME, address: config.CONTACT_SMTP_USER ?? "contact@localhost" };
  return { from, to, cc: resolved.cc, bcc: resolved.bcc, appEnv: config.APP_ENV };
}

/** The page asks this before it shows a form. */
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

export function contactDelivery(recipients: ContactRecipients | null): ContactDelivery | null {
  return contactDeliveryFor(env, recipients);
}
