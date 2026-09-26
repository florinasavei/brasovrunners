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
import { stashDraftValues, stashFormDraft } from "@/modules/registrations/form-draft";
import { subscribeToNewsletter } from "@/modules/newsletter/service";
import { NEWSLETTER_DIALOG_ID, NEWSLETTER_SECTION_ID } from "@/modules/newsletter/ui/newsletter-box";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/modules/registrations/turnstile";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashPublic } from "@/shared/feedback/flash";

/**
 * The newsletter's pop-up (§445), on the same page: the contact form's defences — Turnstile first,
 * then the honeypot and the timing check in the service — and one answer whatever the address
 * turned out to be, so the pop-up cannot say whether somebody is subscribed (BR-REQ-031-01 c3).
 *
 * Always a redirect back to the contact page: `?newsletter=sent` for "check your inbox";
 * `invalid` (with the boxes, and the typed address and topics in the sealed draft, never in the
 * URL, §14.5), `captcha` or `limited` with the pop-up open again to fix; `unavailable` when the
 * pop-up should not have been there — the notice no longer describes the newsletter.
 */
export async function submitNewsletterAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/contact" });
  const topics = form.getAll("topics").filter((value): value is string => typeof value === "string");
  const renderedAt = text(form, "renderedAt");
  // What was typed comes back sealed, so a refusal never costs the address or the ticks (§142).
  // The consent tick is the person's own act: posted as "on" only when ticked (§445).
  const consent = form.get("consent") === "on";
  const keepTyped = () =>
    stashDraftValues(
      { newsletterEmail: text(form, "newsletterEmail").trim(), newsletterTopics: topics.join(","), newsletterConsent: consent ? "on" : "" },
      path,
    );
  // The corrected form is timed from the render it corrects (§146's `since`), or a quick fix reads as a bot.
  const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";

  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const token = String(form.get(TURNSTILE_FIELD) ?? "");
  const verdict = (await botCheckIsOn(getDb(), new Date())) ? await verifyTurnstile(token, remoteIp) : "not_configured";
  if (verdict === "failed") {
    await keepTyped();
    redirect(`${path}?newsletter=captcha${since}#${NEWSLETTER_DIALOG_ID}`);
  }

  let outcome: Awaited<ReturnType<typeof subscribeToNewsletter>>;
  try {
    outcome = await subscribeToNewsletter(
      getDb(),
      {
        email: text(form, "newsletterEmail"),
        locale,
        topics,
        consent,
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: renderedAt || undefined,
      },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      await keepTyped();
      // Its own parameter: `fields` is the contact form's, and would mark that form's boxes.
      const fields = error.fields.length > 0 ? `&nfields=${error.fields.join(",")}` : "";
      redirect(`${path}?newsletter=invalid${fields}${since}#${NEWSLETTER_DIALOG_ID}`);
    }
    if (isDomainError(error)) redirect(`${path}?newsletter=unavailable#${NEWSLETTER_SECTION_ID}`);
    throw error;
  }
  if (outcome === "limited") {
    await keepTyped();
    redirect(`${path}?newsletter=limited${since}#${NEWSLETTER_DIALOG_ID}`);
  }
  redirect(`${path}?newsletter=sent#${NEWSLETTER_SECTION_ID}`);
}

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
  try {
    await sendOrRefuse(form, locale, path);
  } catch (error) {
    /*
      The database is away (§447): the bot-check switch, the throttle and the stored message all
      need it. The page's own `UNAVAILABLE` sentence says the message did not leave, and the draft
      cookie keeps what was typed. `redirect()` throws too, and is not an away-error.
    */
    if (!isDatabaseAwayError(error)) throw error;
    console.error("[contact] the database is away; the message goes back with the form", error);
    await stashFormDraft(form, path);
    redirect(`${path}?error=UNAVAILABLE#${CONTACT_ERROR_SUMMARY_ID}`);
  }
}

async function sendOrRefuse(form: FormData, locale: Locale, path: string): Promise<void> {

  // The bot check, when configured (§97, §216): only a token Cloudflare looked at and
  // rejected is a field error. A widget that never ran, or a Cloudflare that did not answer,
  // is "unavailable" and passes — the honeypot and the timing check are still in front.
  // The visitor's IP goes to Cloudflare with the token and nowhere else — not into the message,
  // not into the screening below, not into a row (AGENTS.md §19.4).
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const token = String(form.get(TURNSTILE_FIELD) ?? "");
  const verdict = (await botCheckIsOn(getDb(), new Date())) ? await verifyTurnstile(token, remoteIp) : "not_configured";
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
      /*
        What the gates could not decide, handed on to be marked rather than refused (the owner,
        2026-09-23: SEO spam through this form). "No token" is read here, from the post itself,
        and not from the verdict: `unavailable` means both "no token" and "Cloudflare did not
        answer", and only the first is what a script leaves behind — a Cloudflare outage must
        not mark every message. `not_configured` is the switch off or the keys missing.
      */
      {
        botCheckOn: verdict !== "not_configured",
        tokenPresent: token.length > 0,
        turnstileVerdict: verdict,
        clubHost: new URL(env.APP_BASE_URL).hostname,
      },
    );
  } catch (error) {
    if (isDomainError(error)) {
      const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
      await stashFormDraft(form, path);
      redirect(`${path}?error=${error.code}${fields}#${CONTACT_ERROR_SUMMARY_ID}`);
    }
    throw error;
  }

  // A bot's post is answered exactly like a person's (BR-REQ-031-01 c3), and a message delivered
  // marked "[posibil spam]" is `sent` like any other — nothing here can tell them apart. The draft is replaced
  // by the address alone, so "we answer at <address>" can be said without the address ever
  // touching the URL (§14.5); the cookie is path-scoped, encrypted and gone in ten minutes.
  if (outcome.outcome === "sent" || outcome.outcome === "ignored") {
    const addressOnly = new FormData();
    addressOnly.set("email", text(form, "email").trim());
    await stashFormDraft(addressOnly, path);
    // The toast says it too (§427) — the same sentence whatever the classification, as the page is.
    await flashPublic("contactSent");
    redirect(`${path}?sent=1`);
  }

  // The three whole-form answers, each a sentence on the page; the message stays typed.
  const code =
    outcome.outcome === "limited" ? "LIMITED" : outcome.outcome === "unavailable" ? "UNAVAILABLE" : "DELIVERY";
  await stashFormDraft(form, path);
  redirect(`${path}?error=${code}#${CONTACT_ERROR_SUMMARY_ID}`);
}
