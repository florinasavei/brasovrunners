"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { registerInterest } from "@/modules/registrations/interest";
import { looksLikeSpam } from "@/modules/registrations/service";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp, requestWithdrawLink } from "@/modules/rsvp/rsvp";
import { RSVP_BOX_ID, RSVP_OUTCOME_QUERY } from "@/modules/rsvp/rsvp-box";
import { INTEREST_BOX_ID } from "@/modules/registrations/interest-box";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { verifyTurnstile } from "@/modules/registrations/turnstile";
import { isDomainError } from "@/shared/errors/domain-error";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * "Anunță-mă când se deschid înscrierile" (`DECISIONS.md` §146; BR-REQ-011-01 criterion 13).
 *
 * Always redirects back to the event's page, to the box: `interest=1` whatever the address
 * turned out to mean (new, already on the list, a bot — one answer, BR-REQ-031-01 criterion
 * 3), `interest=invalid` for an address the person can fix, `interest=captcha` for a widget
 * that timed out — with `since`, the rendering time the person is correcting from, so the
 * retyped address is not timed from the redirect. Names and a timestamp, never values, in the
 * URL (§14.5). A window that is no longer ahead, or no approved privacy notice, redirects to
 * the plain page, where the button now stands or the box is gone.
 */
export async function registerInterestAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });

  const db = getDb();
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event) redirect(getPathname({ locale, href: "/events" }));

  // The same bot check as the registration form (§97, §216), when configured: a rejected
  // token stops this, a widget that could not run does not.
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(getDb(), new Date()))
    ? await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp)
    : "not_configured";
  if (verdict === "failed") redirect(`${path}?interest=captcha#${INTEREST_BOX_ID}`);

  try {
    await registerInterest(
      db,
      event,
      {
        email: text(form, "email"),
        locale,
        // Absent rather than empty, so a stripped field reads as a bot (`looksLikeSpam`) and
        // gets the silent answer, never a validation error naming what it tripped.
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: renderedAt || undefined,
      },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === "CONFLICT") redirect(path);
      const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";
      redirect(`${path}?interest=invalid${since}#${INTEREST_BOX_ID}`);
    }
    throw error;
  }

  redirect(`${path}?interest=1#${INTEREST_BOX_ID}`);
}

/**
 * «Vin!» (§NNN, «Vin!» part 1): the typed answer on a turn-up event's page, and the interest box's twin in every rule that
 * matters — the same honeypot, timing check and Turnstile, answered with the same silence, and **the same sentence whatever
 * the address turned out to mean** (a new one, one already counted, a message the throttle held back: BR-REQ-031-01 criterion 3).
 * The answer is never verified here (`source: "page"`): it waits for the emailed «Da, vin».
 *
 * Always redirects back to the event's page, to the box: `vin=1` whatever happened, `vin=invalid` for an address the person can
 * fix, `vin=captcha` for a widget that timed out — with `since`, the rendering time the person is correcting from. Names and a
 * timestamp, never values, in the URL (§14.5). An event that no longer takes answers redirects to the plain page, where the box is gone.
 */
export async function answerRsvpAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const back = (outcome: keyof typeof RSVP_OUTCOME_QUERY, withSince = false) =>
    `${path}?vin=${RSVP_OUTCOME_QUERY[outcome]}${withSince && renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : ""}#${RSVP_BOX_ID}`;

  const db = getDb();
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event) redirect(getPathname({ locale, href: "/events" }));

  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(db, new Date()))
    ? await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp)
    : "not_configured";
  if (verdict === "failed") redirect(back("captcha", true));

  const now = new Date();
  // Absent rather than empty, so a stripped field reads as a bot and gets the silent answer (`looksLikeSpam`).
  if (looksLikeSpam({ honeypot: text(form, "honeypot") || undefined, renderedAt: renderedAt || undefined, email: text(form, "email") }, now)) {
    redirect(back("sent"));
  }

  try {
    await answerRsvp(
      db,
      event.id,
      identityOf("page", { email: text(form, "email"), displayName: text(form, "name"), showName: form.get("showName") === "on", locale }),
      now,
    );
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === "CONFLICT") redirect(path);
      redirect(back("invalid", true));
    }
    throw error;
  }
  redirect(back("sent"));
}

/**
 * «Nu mai vin» under the box (§NNN): the address typed, the withdraw link by email — and the same sentence whether or not the
 * address had answered. The same spam defences as the answer.
 */
export async function requestRsvpWithdrawAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const back = (outcome: keyof typeof RSVP_OUTCOME_QUERY, withSince = false) =>
    `${path}?vin=${RSVP_OUTCOME_QUERY[outcome]}${withSince && renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : ""}#${RSVP_BOX_ID}`;

  const db = getDb();
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event) redirect(getPathname({ locale, href: "/events" }));

  // No Turnstile on this small fold: it only ever mails an address that already answered, once per ten minutes, and the
  // honeypot and the timing check stand (the throttle, not a widget, bounds what a script can cause).
  const now = new Date();
  if (looksLikeSpam({ honeypot: text(form, "honeypot") || undefined, renderedAt: renderedAt || undefined, email: text(form, "withdrawEmail") }, now)) {
    redirect(back("withdrawSent"));
  }
  try {
    await requestWithdrawLink(db, event.id, { email: text(form, "withdrawEmail"), locale }, now);
  } catch (error) {
    if (isDomainError(error)) redirect(back("invalid", true));
    throw error;
  }
  redirect(back("withdrawSent"));
}
