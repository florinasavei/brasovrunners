"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { requestRegistrationLink } from "@/modules/registrations/service";
import { verifyTurnstile } from "@/modules/registrations/turnstile";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Ask for the registration link again (§19.4's second surface).
 *
 * One outcome, always: the same "if that address has a registration, we have sent it" page,
 * whether the address is registered, unknown, malformed, throttled or the post looked automated.
 * The service answers identically for the same reason — a form anyone can type any address into
 * must not become a way to find out who entered the race.
 *
 * The one other answer is the bot check's (§675, the contact form's rule, §216): a token
 * Cloudflare looked at and rejected comes back to the form with the refusal line — decided before
 * anything is counted or looked up, so it says nothing about the address. A widget that never
 * ran, or a Cloudflare that did not answer, passes: the honeypot, the timing check and the
 * throttle are still in front. The URL carries a timestamp and the event's slug, never the
 * address (§14.5).
 */
export async function requestRegistrationLinkAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: "/registrations/resend" });

  // The visitor's IP goes to Cloudflare with the token and nowhere else (AGENTS.md §19.4).
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(getDb(), new Date()))
    ? await verifyTurnstile(text(form, TURNSTILE_FIELD), remoteIp)
    : "not_configured";
  if (verdict === "failed") {
    // `since`: the render the person retries from, so a quick second press is not timed as a
    // bot; `event`: the narrowing they arrived with, kept for the retry.
    const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";
    const event = slug ? `&event=${encodeURIComponent(slug)}` : "";
    redirect(`${path}?captcha=1${since}${event}`);
  }

  // The event, when the participant arrived from one — narrows the search to the registration
  // they are actually looking at. An unknown or unpublished slug simply drops back to "their
  // most recent active registration" rather than erroring: this page has one answer.
  // Any published event, the members' own included (§552): the answer is the same whatever it finds
  // (§19.4), so narrowing by a members' event tells nobody it exists.
  const event = slug ? await findPublishedEventBySlug(getDb(), locale, slug, "members") : undefined;

  await requestRegistrationLink(
    getDb(),
    {
      email: text(form, "email"),
      eventId: event?.id,
      // Absent rather than empty, as the interest box passes them (`looksLikeSpam`).
      honeypot: text(form, "honeypot") || undefined,
      renderedAt: renderedAt || undefined,
    },
    new Date(),
  );

  redirect(`${path}?sent=1`);
}
