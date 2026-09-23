"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findEventForRegistrationById, findPublishedEventBySlug } from "@/modules/events/repository";
import { clearFormDraft, stashFormDraft, stashSubmittedFacts } from "@/modules/registrations/form-draft";
import { ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { assertEmailTypedTwice } from "@/modules/registrations/fields";
import { submitRegistration } from "@/modules/registrations/service";
import { botCheckIsOn, honeypotIsOn } from "@/modules/registrations/bot-check";
import { SECOND_ATTEMPT_FIELD } from "@/modules/registrations/fields";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/modules/registrations/turnstile";
import { headers } from "next/headers";
import { isDomainError } from "@/shared/errors/domain-error";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}


/**
 * The registration form's submit handler (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-033-01).
 *
 * Always redirects back to the same page — with `submitted=1` on success, an error code
 * otherwise. A malformed form (the privacy box left unchecked) gets a distinct, fixable error;
 * everything past that point answers identically, whatever the submitted address turns out to
 * mean (BR-REQ-031-01 criterion 3).
 */
export async function submitRegistrationAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug } } });

  const db = getDb();
  const publicEvent = await findPublishedEventBySlug(db, locale, slug);
  if (!publicEvent) redirect(getPathname({ locale, href: "/events" }));

  /*
    The bot check, when configured (§97, §216).

    Only a token Cloudflare **looked at and rejected** stops a registration. No token at all —
    a blocked script, a privacy browser, JavaScript off — and Cloudflare not answering are
    "unavailable", and a registration is not refused for either: the honeypot, the timing
    check and the per-identity throttle are still in front of this form, and §205 is explicit
    that people must be able to register at all costs. It is logged so the club can see how
    often the widget does not run, and the line never carries an address.
  */
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(getDb(), new Date()))
    ? await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp)
    : "not_configured";
  if (verdict === "unavailable") {
    console.warn("[turnstile] unavailable, registration accepted on the other defences", { slug });
  }
  if (verdict === "failed") {
    await stashFormDraft(form, path);
    redirect(`${path}?error=VALIDATION_ERROR&fields=captcha#${ERROR_SUMMARY_ID}`);
  }

  try {
    /*
      The address, twice, and the same mailbox both times (§206).

      Before anything else in the try, so a mismatch is a field error on the form rather than
      a registration created for an address nobody can read. It is a property of this form and
      not of a registration, which is why it is asserted here and not in the service's schema.
    */
    assertEmailTypedTwice(readRegistrationForm(form, locale));

    const internalEvent = await findEventForRegistrationById(db, publicEvent.id);
    if (!internalEvent) redirect(getPathname({ locale, href: "/events" }));

    await submitRegistration(
      db,
      {
        id: internalEvent.id,
        eventStatus: internalEvent.eventStatus,
        registrationMode: internalEvent.registrationMode,
        startsAt: internalEvent.startsAt,
        registrationOpensAt: internalEvent.registrationOpensAt,
        registrationClosesAt: internalEvent.registrationClosesAt,
        capacity: internalEvent.capacity,
        raceId: internalEvent.raceId,
        publishedAt: publicEvent.publishedAt,
        // The day the minimum age is counted against is the race's own (§321), and so is the
        // number (§NNN).
        timezone: internalEvent.timezone,
        minAge: internalEvent.minAge,
      },
      readRegistrationForm(form, locale),
      new Date(),
      "REAL",
      {
        source: "PUBLIC",
        createdByStaffUserId: null,
        /*
          What the two guesses are weighed against (§282). Cloudflare's verdict outranks the
          hidden trap, and a submission after a refusal is let through whatever the trap says —
          a password manager refills it every time, and looping a real person forever is the one
          outcome this form must not have.
        */
        turnstile: verdict,
        secondAttempt: String(form.get(SECOND_ATTEMPT_FIELD) ?? "") === "1",
        honeypotOn: await honeypotIsOn(getDb(), new Date()),
      },
    );
  } catch (error) {
    if (isDomainError(error)) {
      // Field names, never values: nothing a participant typed goes into a URL, which is
      // logged by every proxy between here and them (§14.5).
      const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
      // What they typed comes back with them — in a cookie, never in the URL (§142).
      await stashFormDraft(form, path);
      // The fragment is what stops a rejection landing somebody at the top of a long form with
      // nothing said: the browser scrolls to the summary and, because it is focusable, focuses
      // it. No JavaScript is involved, which is the point — this path exists for the submission
      // the browser's own validation could not catch.
      /*
        `retry=1` is what makes the next press work (§282). The form renders a hidden field from
        it, the action reads it back, and a person whose browser keeps filling the trap is not
        refused twice for the same reason.
      */
      const retry = error.fields.includes("tooFast") ? "&retry=1" : "";
      redirect(`${path}?error=${error.code}${fields}${retry}#${ERROR_SUMMARY_ID}`);
    }
    throw error;
  }

  await clearFormDraft(path);
  // The screen that follows says to go and read an inbox, so it names which one (§224) — and
  // greets the person by first name while it does. Its own short-lived sealed cookie, never
  // the URL: nothing typed goes into one (§14.5).
  await stashSubmittedFacts({ email: text(form, "email").trim(), firstName: text(form, "firstName") }, path);
  redirect(`${path}?submitted=1`);
}
