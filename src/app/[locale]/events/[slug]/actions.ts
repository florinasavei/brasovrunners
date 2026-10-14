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
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { verifyTurnstile } from "@/modules/registrations/turnstile";
import { isDomainError } from "@/shared/errors/domain-error";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { composePhone } from "@/modules/registrations/phone";
import { VOLUNTEER_ROLES_MAX } from "@/modules/volunteers/domain/volunteer";
import { VOLUNTEER_BOX_ID } from "@/modules/volunteers/ui/volunteer-box";
import { submitVolunteer } from "@/modules/volunteers/volunteers";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The volunteer form's ticked roles (§761): every value posted as `roleIds`, strings only, at most what an event may define. */
function roleIdsOf(form: FormData): string[] {
  return form
    .getAll("roleIds")
    .filter((value): value is string => typeof value === "string")
    .slice(0, VOLUNTEER_ROLES_MAX);
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
 * «Mă ofer voluntar» (§754): a person's offer from an event's page. The registration form's defences —
 * Turnstile first, then the honeypot, the timing check and the throttles in the service — and one answer
 * whatever the person turned out to be: `?volunteer=1` for a new offer, a repeat and a bot's alike
 * (BR-REQ-031-01 criterion 3) — the answer is the same (the count on the page is the residual
 * `volunteers.ts` accepts and says why).
 *
 * Always a redirect back to the event's page, to the box: `invalid` (with `vfields`, the boxes to fix,
 * and what was typed in the sealed draft, never in the URL, §14.5), `captcha`, `limited` or `full` (every
 * role ticked filled while the form was open) with the box open again, and `since`, the rendering time the
 * person is correcting from. An event that no longer takes volunteers — or a notice that stopped
 * describing them — redirects to the plain page, where the box is now gone.
 */
export async function submitVolunteerAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";
  const db = getDb();
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event) redirect(getPathname({ locale, href: "/events" }));

  const country = text(form, "phoneCountry") || "RO";
  const national = text(form, "phone");
  // What was typed comes back sealed, so a refusal never costs the boxes (§142). Never the consent tick:
  // it is the person's own act each time.
  const keepTyped = () =>
    stashDraftValues(
      {
        name: text(form, "name").trim(),
        email: text(form, "email").trim(),
        phoneCountry: country,
        phone: national,
        // The roles ticked (§761), one string in the draft: their ids joined by commas.
        roleIds: roleIdsOf(form).join(","),
        message: text(form, "message"),
      },
      path,
    );

  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(db, new Date()))
    ? await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp)
    : "not_configured";
  if (verdict === "failed") {
    await keepTyped();
    redirect(`${path}?volunteer=captcha${since}#${VOLUNTEER_BOX_ID}`);
  }

  let outcome: Awaited<ReturnType<typeof submitVolunteer>>;
  try {
    outcome = await submitVolunteer(
      db,
      event.id,
      {
        // «Ce ești dispus(ă) să faci» (§761): every box ticked posts its role's id under the one name.
        roleIds: roleIdsOf(form),
        name: text(form, "name"),
        email: text(form, "email"),
        // The country and the digits become the one number a phone can dial, or nothing (a refusal on `phone`).
        phone: composePhone(country, national) ?? "",
        message: text(form, "message"),
        locale,
        // The tick is the person's own act: posted as "on" only when ticked.
        consent: form.get("consent") === "on",
        // The volunteer agreement and the age (§758): the same, each its own act.
        agreement: form.get("agreement") === "on",
        adult: form.get("adult") === "on",
        // Absent rather than empty: the service judges them as the registration form does (`classifySubmission`).
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: renderedAt || undefined,
      },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      await keepTyped();
      const fields = error.fields.length > 0 ? `&vfields=${error.fields.join(",")}` : "";
      redirect(`${path}?volunteer=invalid${fields}${since}#${VOLUNTEER_BOX_ID}`);
    }
    if (isDomainError(error)) redirect(path);
    throw error;
  }
  if (outcome.outcome === "limited" || outcome.outcome === "full") {
    await keepTyped();
    redirect(`${path}?volunteer=${outcome.outcome}${since}#${VOLUNTEER_BOX_ID}`);
  }
  await clearFormDraft(path);
  redirect(`${path}?volunteer=1#${VOLUNTEER_BOX_ID}`);
}
