"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { requestMyRegistrationsLink } from "@/modules/registrations/my-registrations";
import { verifyTurnstile } from "@/modules/registrations/turnstile";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * One outcome, always: "if that address has registrations, we have sent the link" — whether
 * the address is known, unknown, malformed, throttled or the post looked automated
 * (BR-REQ-036-04; the oracle rule of `registrations/resend`).
 *
 * The one other answer is the bot check's (§675, the contact form's rule, §216): a token
 * Cloudflare looked at and rejected comes back to the form with the refusal line — decided before
 * anything is counted or looked up, so it says nothing about the address. A widget that never
 * ran, or a Cloudflare that did not answer, passes: the honeypot, the timing check and the
 * throttle are still in front. The URL carries a timestamp, never the address (§14.5).
 */
export async function requestMyRegistrationsLinkAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: "/registrations/mine" });

  // The visitor's IP goes to Cloudflare with the token and nowhere else (AGENTS.md §19.4).
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(getDb(), new Date()))
    ? await verifyTurnstile(text(form, TURNSTILE_FIELD), remoteIp)
    : "not_configured";
  if (verdict === "failed") {
    // `since`: the render the person retries from, so a quick second press is not timed as a bot.
    const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";
    redirect(`${path}?captcha=1${since}`);
  }

  await requestMyRegistrationsLink(
    getDb(),
    {
      email: text(form, "email"),
      locale,
      // Absent rather than empty, as the interest box passes them (`looksLikeSpam`).
      honeypot: text(form, "honeypot") || undefined,
      renderedAt: renderedAt || undefined,
    },
    new Date(),
  );

  redirect(`${path}?sent=1`);
}
