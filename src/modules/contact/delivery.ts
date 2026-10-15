import { env, type Env } from "@/shared/config/env";
import { type ContactRecipients, resolveContactRecipients } from "./domain/recipients";
import type { ContactDelivery } from "./service";

/**
 * Where the contact form's configuration meets its recipients (`DECISIONS.md` §149, §164) — and, since §NNN, no
 * longer a transport: the message is queued in the outbox and the relay carries it, by the club's Gmail or, when that
 * is down, Mailgun (`notifications/relay-roads.ts`). This module only says **whether the form can reach anybody**
 * and **who**, and is the only module here that reads `env`.
 *
 * `CONTACT_FORM_MODE` is derived in `env.ts` and answers one question only: has this deployment a way of sending
 * at all — `capture` on a laptop and in the tests (no socket, ever), `smtp` with the Gmail account and its app
 * password, `off` otherwise. *Who* receives is the club’s, set on `/admin/emails` and passed in here (§164), with
 * `CONTACT_FORM_TO` as the fallback for a deployment whose database has no row yet. Both must answer for the form
 * to exist: a form with nobody to send to is `null`, exactly as no way out is.
 */

export type ContactConfig = Pick<
  Env,
  "APP_ENV" | "CONTACT_FORM_MODE" | "CONTACT_SMTP_USER" | "CONTACT_FORM_TO" | "EMAIL_FROM_NAME"
>;

/** The addresses and the envelope — what the form and the page need. */
function contactRoute(config: ContactConfig, recipients: Pick<ContactRecipients, "to" | "cc" | "bcc"> | null): ContactDelivery | null {
  if (config.CONTACT_FORM_MODE === "off") return null;

  const resolved = resolveContactRecipients(recipients, config.CONTACT_FORM_TO);
  // Nobody to send to is the same answer as no way to send: the page shows the club's address.
  // On a laptop a placeholder stands in, so the form works with nothing configured at all.
  const to =
    resolved.to.length > 0 ? resolved.to : config.CONTACT_FORM_MODE === "capture" ? ["club@localhost"] : null;
  if (!to) return null;

  // The display name is the club’s, quoted by Nodemailer; the address is the Gmail account —
  // Google rewrites any other sender to it anyway. Captured, a placeholder stands in.
  const from = { name: config.EMAIL_FROM_NAME, address: config.CONTACT_SMTP_USER ?? "contact@localhost" };
  return { from, to, cc: resolved.cc, bcc: resolved.bcc, appEnv: config.APP_ENV };
}

/** Can a message posted on this deployment reach anybody? The page asks before it shows a form. */
export function contactFormReaches(config: ContactConfig, recipients: Pick<ContactRecipients, "to" | "cc" | "bcc"> | null): boolean {
  return contactRoute(config, recipients) !== null;
}

export function contactDeliveryFor(
  config: ContactConfig,
  recipients: Pick<ContactRecipients, "to" | "cc" | "bcc"> | null,
): ContactDelivery | null {
  return contactRoute(config, recipients);
}

/**
 * Whether this deployment has the Gmail road at all — the environment alone, so no read and no cache:
 * «Spune-ne ceva» offers a form only where the road the club chose for it exists (§676), the way
 * «Scrie-ne» draws no form where `contactFormReaches` says no. Without it a visitor would be shown a
 * form that could carry nothing.
 */
export function contactSmtpRoadExists(config: Pick<ContactConfig, "CONTACT_FORM_MODE"> = env): boolean {
  return config.CONTACT_FORM_MODE !== "off";
}

/** This process’s delivery, from its environment and the club’s own recipient list. */
export function contactDelivery(recipients: Pick<ContactRecipients, "to" | "cc" | "bcc"> | null): ContactDelivery | null {
  return contactDeliveryFor(env, recipients);
}
