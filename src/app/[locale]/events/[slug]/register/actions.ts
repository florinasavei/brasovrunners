"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findEventForRegistrationById, findPublishedEventBySlug } from "@/modules/events/repository";
import { clearFormDraft, stashFormDraft } from "@/modules/registrations/form-draft";
import { ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { submitRegistration } from "@/modules/registrations/service";
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

  // The bot check, when configured (§97): a token Cloudflare does not confirm is a field
  // error on the form — a person whose widget timed out reads why and presses again.
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp);
  if (verdict === "failed") {
    await stashFormDraft(form, path);
    redirect(`${path}?error=VALIDATION_ERROR&fields=captcha#${ERROR_SUMMARY_ID}`);
  }

  try {
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
      },
      readRegistrationForm(form, locale),
      new Date(),
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
      redirect(`${path}?error=${error.code}${fields}#${ERROR_SUMMARY_ID}`);
    }
    throw error;
  }

  await clearFormDraft(path);
  redirect(`${path}?submitted=1`);
}
