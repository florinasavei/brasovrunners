"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findEventForRegistrationById, findPublishedEventBySlug } from "@/modules/events/repository";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { submitRegistration } from "@/modules/registrations/service";
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
      redirect(`${path}?error=${error.code}${fields}`);
    }
    throw error;
  }

  redirect(`${path}?submitted=1`);
}
