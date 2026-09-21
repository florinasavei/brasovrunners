"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { registerInterest } from "@/modules/registrations/interest";
import { INTEREST_BOX_ID } from "@/modules/registrations/interest-box";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/modules/registrations/turnstile";
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
