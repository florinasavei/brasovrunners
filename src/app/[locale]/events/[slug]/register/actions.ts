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
import { publicFormEvent } from "@/modules/registrations/public-form-event";
import { submitRegistration } from "@/modules/registrations/service";
import { consumeAndRegisterAnotherPerson } from "@/modules/registrations/token-actions";
import { ANOTHER_LINK_INVALID, ANOTHER_PERSON_PARAM } from "@/modules/registrations/domain/family";
import { botCheckIsOn, honeypotIsOn } from "@/modules/registrations/bot-check";
import { SECOND_ATTEMPT_FIELD } from "@/modules/registrations/fields";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/modules/registrations/turnstile";
import { headers } from "next/headers";
import { isDomainError } from "@/shared/errors/domain-error";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";

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
  try {
    await submitRegistrationOrRefuse(form);
  } catch (error) {
    /*
      The database is away (§NNN) — a compute that could not start, or Neon refusing on the month's
      quota. Not a bug and nothing the person did: what they typed goes back with them in the
      draft cookie, and the form says so politely instead of the error page eating twenty fields.
      `redirect()` and `notFound()` throw too; they are not away-errors and pass straight through.
      Only the family link is kept in the address, as every other refusal keeps it: it was not spent.
    */
    if (!isDatabaseAwayError(error)) throw error;
    console.error("[registration] the database is away; the form goes back with its answers", error);
    const locale = toLocale(form.get("locale"));
    const path = getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug: text(form, "slug") } } });
    const another = text(form, ANOTHER_PERSON_PARAM).trim();
    await stashFormDraft(form, path);
    redirect(`${path}?${another ? `${ANOTHER_PERSON_PARAM}=${encodeURIComponent(another)}&` : ""}error=DATABASE_AWAY&fields=databaseAway#${ERROR_SUMMARY_ID}`);
  }
}

async function submitRegistrationOrRefuse(form: FormData): Promise<void> {
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
  // Read before the bot check (§389): a rejected check from the family form returns to that form, the
  // link still in the address bar — the token was never spent and still works.
  const another = text(form, ANOTHER_PERSON_PARAM).trim();
  const anotherPath = another ? `${path}?${ANOTHER_PERSON_PARAM}=${encodeURIComponent(another)}` : null;

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
    redirect(`${anotherPath ? `${anotherPath}&` : `${path}?`}error=VALIDATION_ERROR&fields=captcha#${ERROR_SUMMARY_ID}`);
  }

  /*
    The form for another person on a registered address (§389), opened from the link emailed to
    that address: the token rides in a hidden field, the address is the token's — never the form's
    — and the token is spent in the same transaction that creates the registration, so a refusal
    leaves the link working. A link that does not work any more comes back as the plain form with
    one sentence saying so; the token is not carried back into the address bar.
  */
  if (anotherPath) {
    let registered: { ok: true; email: string } | { ok: false };
    try {
      const internalEvent = await findEventForRegistrationById(db, publicEvent.id);
      if (!internalEvent) redirect(getPathname({ locale, href: "/events" }));
      registered = await consumeAndRegisterAnotherPerson(
        another,
        // The whole row the allocator needs, the participation window included (§104, §420).
        publicFormEvent(internalEvent, publicEvent.publishedAt),
        readRegistrationForm(form, locale),
        {
          turnstile: verdict,
          secondAttempt: String(form.get(SECOND_ATTEMPT_FIELD) ?? "") === "1",
          honeypotOn: await honeypotIsOn(getDb(), new Date()),
        },
        new Date(),
      );
    } catch (error) {
      if (isDomainError(error)) {
        const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
        const linkGone = error.fields.includes(ANOTHER_LINK_INVALID);
        // On the form's path either way: a cookie's path is a path, never the query that carries the link.
        await stashFormDraft(form, path);
        const retry = error.fields.includes("tooFast") ? "&retry=1" : "";
        redirect(`${linkGone ? `${path}?` : `${anotherPath}&`}error=${error.code}${fields}${retry}#${ERROR_SUMMARY_ID}`);
      }
      throw error;
    }
    if (!registered.ok) {
      await stashFormDraft(form, path);
      redirect(`${path}?error=VALIDATION_ERROR&fields=${ANOTHER_LINK_INVALID}#${ERROR_SUMMARY_ID}`);
    }
    await clearFormDraft(path);
    await stashSubmittedFacts({ email: registered.email, firstName: text(form, "firstName") }, path);
    redirect(`${path}?submitted=1`);
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
      // The whole row the allocator needs: the race's own day and minimum age (§321, §329), and the
      // participation window, which a verified runner's restart is held until (§104, §420).
      publicFormEvent(internalEvent, publicEvent.publishedAt),
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
