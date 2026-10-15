"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { composePhone } from "@/modules/registrations/phone";
import { verifyTurnstile } from "@/modules/registrations/turnstile";
import { flashPublic } from "@/shared/feedback/flash";
import { isDomainError } from "@/shared/errors/domain-error";
import { readSignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
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
 * «Mă ofer voluntar» (§754; moved to the volunteers' own page by §768, 2026-10-14): a person's offer. The registration form's
 * defences — Turnstile first, then the honeypot, the timing check and the throttles in the service — and one answer
 * whatever the person turned out to be: `?volunteer=1` for a new offer, a repeat and a bot's alike (BR-REQ-031-01
 * criterion 3) — the answer is the same (the count on the page is the residual `volunteers.ts` accepts and says why).
 *
 * Always a redirect back to the volunteers' page, to the form: `invalid` (with `vfields`, the boxes to fix, and what was
 * typed in the sealed draft, never in the URL, §14.5), `captcha`, `limited` or `full` (every role ticked filled while
 * the form was open) with the form open again, and `since`, the rendering time the person is correcting from. The thank-you
 * is on that page too, with the house's flash toast (§427) — never on the event's page. An event that no longer takes
 * volunteers — or a notice or an agreement that stopped describing them — redirects to the event's own page, where the
 * volunteers' box is now gone (the volunteers' page would answer 404).
 *
 * The parent's or guardian's boxes (§768) ride along; the service reads them only of a person who typed an age under
 * eighteen, and only while the notice and the agreement in force describe minors.
 */
export async function submitVolunteerAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const eventPath = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/volunteers", params: { slug } } });
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
        // What the person said about themselves (§765) comes back too — never the consent, the agreement or the age tick. The date of birth
        // comes back as typed (§NNN); the box shows it as it was.
        birthDate: text(form, "birthDate").trim(),
        // Their parent's or guardian's name and address (§768) too; the tick that the parent agrees is never kept.
        guardianName: text(form, "guardianName").trim(),
        guardianEmail: text(form, "guardianEmail").trim(),
        sex: text(form, "sex"),
        city: text(form, "city").trim(),
        shirtSize: text(form, "shirtSize"),
        volunteeredBefore: form.get("volunteeredBefore") === "on" ? "on" : "",
        clubMember: form.get("clubMember") === "on" ? "on" : "",
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
        // What the person says about themselves (§765), read by the service only while the notice in force names it:
        // the date of birth as typed (§NNN; the service reads it day first and derives the age on the event's day), the sex, the city, the
        // size, and the two optional ticks — posted as "on" only when ticked.
        birthDate: text(form, "birthDate"),
        sex: text(form, "sex"),
        city: text(form, "city"),
        shirtSize: text(form, "shirtSize"),
        volunteeredBefore: form.get("volunteeredBefore") === "on",
        clubMember: form.get("clubMember") === "on",
        // The parent or guardian of a person under eighteen (§768): the name, the address and the person's tick that the parent knows and agrees.
        guardianName: text(form, "guardianName"),
        guardianEmail: text(form, "guardianEmail"),
        guardianAware: form.get("guardianAware") === "on",
        // Absent rather than empty: the service judges them as the registration form does (`classifySubmission`).
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: renderedAt || undefined,
      },
      new Date(),
      // The agreement's tick is an electronic acceptance: this request's IP address and browser are its trace (§771).
      readSignatureTrace(requestHeaders),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      await keepTyped();
      const fields = error.fields.length > 0 ? `&vfields=${error.fields.join(",")}` : "";
      redirect(`${path}?volunteer=invalid${fields}${since}#${VOLUNTEER_BOX_ID}`);
    }
    // The form is closed now (the switch, the roles, the texts): the event's page, where the box is gone, not a 404.
    if (isDomainError(error)) redirect(eventPath);
    throw error;
  }
  if (outcome.outcome === "limited" || outcome.outcome === "full") {
    await keepTyped();
    redirect(`${path}?volunteer=${outcome.outcome}${since}#${VOLUNTEER_BOX_ID}`);
  }
  await clearFormDraft(path);
  // The thank-you is on the volunteers' page, said twice the house's way: the banner the address asks for, and the toast the flash carries (§427).
  await flashPublic("volunteerSent");
  redirect(`${path}?volunteer=1#${VOLUNTEER_BOX_ID}`);
}
