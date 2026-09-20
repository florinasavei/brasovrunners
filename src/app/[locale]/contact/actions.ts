"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { contactDelivery } from "@/modules/contact/delivery";
import { CONTACT_ERROR_SUMMARY_ID } from "@/modules/contact/fields";
import { readContactRecipients } from "@/modules/contact/recipients";
import { submitContactMessage } from "@/modules/contact/service";
import { stashFormDraft } from "@/modules/registrations/form-draft";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/modules/registrations/turnstile";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The contact form's submit handler (BR-REQ-070-04, `DECISIONS.md` §149).
 *
 * Always a redirect back to the page: `?sent=1` when the message left (or was a bot's, which
 * is answered the same), `?error=<code>` otherwise — `VALIDATION_ERROR` with the field names
 * (never a value, §14.5; what was typed rides back in the draft cookie, §142), `LIMITED`,
 * `DELIVERY` or `UNAVAILABLE`, each one sentence on the page.
 */
export async function submitContactAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/contact" });

  // The bot check, when configured (§97): a token Cloudflare does not confirm is a field
  // error on the form — a person whose widget timed out reads why and presses again.
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp);
  if (verdict === "failed") {
    await stashFormDraft(form, path);
    redirect(`${path}?error=VALIDATION_ERROR&fields=captcha#${CONTACT_ERROR_SUMMARY_ID}`);
  }

  // Who receives, as the club set it (§164), with `CONTACT_FORM_TO` behind it; read here
  // rather than inside the delivery so the module that knows the transport stays pure over
  // its inputs and the tests can hand it a list.
  const db = getDb();
  // A database that is not answering hands the question to `CONTACT_FORM_TO` rather than
  // throwing here; the send itself still needs the database, and says so in its own sentence.
  const recipients = await readContactRecipients(db).catch(() => null);

  let outcome: Awaited<ReturnType<typeof submitContactMessage>>;
  try {
    outcome = await submitContactMessage(
      db,
      contactDelivery(recipients),
      {
        name: text(form, "name"),
        email: text(form, "email"),
        message: text(form, "message"),
        locale,
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: text(form, "renderedAt") || undefined,
      },
      new Date(),
      `${env.APP_BASE_URL}${path}`,
    );
  } catch (error) {
    if (isDomainError(error)) {
      const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
      await stashFormDraft(form, path);
      redirect(`${path}?error=${error.code}${fields}#${CONTACT_ERROR_SUMMARY_ID}`);
    }
    throw error;
  }

  // A bot's post is answered exactly like a person's (BR-REQ-031-01 c3). The draft is replaced
  // by the address alone, so "we answer at <address>" can be said without the address ever
  // touching the URL (§14.5); the cookie is path-scoped, encrypted and gone in ten minutes.
  if (outcome.outcome === "sent" || outcome.outcome === "ignored") {
    const addressOnly = new FormData();
    addressOnly.set("email", text(form, "email").trim());
    await stashFormDraft(addressOnly, path);
    redirect(`${path}?sent=1`);
  }

  // The three whole-form answers, each a sentence on the page; the message stays typed.
  const code =
    outcome.outcome === "limited" ? "LIMITED" : outcome.outcome === "unavailable" ? "UNAVAILABLE" : "DELIVERY";
  await stashFormDraft(form, path);
  redirect(`${path}?error=${code}#${CONTACT_ERROR_SUMMARY_ID}`);
}
