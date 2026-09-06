"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { requestRegistrationLink } from "@/modules/registrations/service";

/**
 * Ask for the registration link again (§19.4's second surface).
 *
 * One outcome, always: the same "if that address has a registration, we have sent it" page,
 * whether the address is registered, unknown, malformed or throttled. The service answers
 * identically for the same reason — a form anyone can type any address into must not become a
 * way to find out who entered the race.
 */
export async function requestRegistrationLinkAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const email = String(form.get("email") ?? "");
  const slug = String(form.get("slug") ?? "");

  // The event, when the participant arrived from one — narrows the search to the registration
  // they are actually looking at. An unknown or unpublished slug simply drops back to "their
  // most recent active registration" rather than erroring: this page has one answer.
  const event = slug ? await findPublishedEventBySlug(getDb(), locale, slug) : undefined;

  await requestRegistrationLink(getDb(), { email, eventId: event?.id }, new Date());

  redirect(`${getPathname({ locale, href: "/registrations/resend" })}?sent=1`);
}
