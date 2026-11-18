"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { readSignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { TURNSTILE_FIELD } from "@/modules/registrations/domain/turnstile-widget";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { verifyTurnstile } from "@/modules/registrations/turnstile";
import { signUpForRaffleByForm } from "@/modules/volunteers/raffle-entries";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashPublic } from "@/shared/feedback/flash";

/** The form's own anchor, where every answer lands. */
const FORM_ID = "raffle-form";

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * «Particip la tombolă» on the event's raffle page (FORM, §NNN): a race number and a name, matched to one person by the service. The
 * house's public-form defences — Turnstile first, here; the honeypot, the timing check and the two throttles in the service — and
 * one answer for every refusal of the match: `?tombola=nomatch`, the neutral sentence that names neither half. A person signed up
 * already reads the same thank-you as a new one. Every answer comes back to the raffle's page, at the form; what was typed comes
 * back sealed (§142), never in the address (§14.5) — the acceptance's tick never, it is the person's own act each time. A sign-up
 * the gate no longer takes lands on the event's page, where the raffle's link is gone. No email leaves.
 */
export async function raffleFormAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const slug = text(form, "slug");
  const renderedAt = text(form, "renderedAt");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/tombola", params: { slug } } });
  const eventPath = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  const since = renderedAt ? `&since=${encodeURIComponent(renderedAt)}` : "";
  const db = getDb();
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event) redirect(getPathname({ locale, href: "/events" }));

  const keepTyped = () => stashDraftValues({ number: text(form, "number").trim(), name: text(form, "name").trim(), volunteer: form.get("volunteer") === "on" ? "on" : "" }, path);

  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(db, new Date())) ? await verifyTurnstile(String(form.get(TURNSTILE_FIELD) ?? ""), remoteIp) : "not_configured";
  if (verdict === "failed") {
    await keepTyped();
    redirect(`${path}?tombola=captcha${since}#${FORM_ID}`);
  }

  let outcome: Awaited<ReturnType<typeof signUpForRaffleByForm>>;
  try {
    outcome = await signUpForRaffleByForm(
      db,
      event.id,
      {
        number: text(form, "number"),
        name: text(form, "name"),
        volunteer: form.get("volunteer") === "on",
        // The tick is the person's own act: posted as "on" only when ticked.
        accepted: form.get("accept") === "on",
        locale,
        // Absent rather than empty: the service judges them as the registration form does (`classifySubmission`).
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: renderedAt || undefined,
      },
      new Date(),
      // The acceptance is electronic: this request's IP address and browser are its trace (§771).
      readSignatureTrace(requestHeaders),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      await keepTyped();
      const fields = error.fields.length > 0 ? `&fields=${error.fields.join(",")}` : "";
      redirect(`${path}?tombola=invalid${fields}${since}#${FORM_ID}`);
    }
    // The gate shut while the page was open: the event's page, where the raffle's link is gone, not a 404.
    if (isDomainError(error)) redirect(eventPath);
    throw error;
  }
  if (outcome !== "done") {
    await keepTyped();
    redirect(`${path}?tombola=${outcome === "noMatch" ? "nomatch" : "limited"}${since}#${FORM_ID}`);
  }
  await clearFormDraft(path);
  // The thank-you on the raffle's page, said twice the house's way: the banner the address asks for, and the toast (§427).
  await flashPublic("raffleSignedUp");
  redirect(`${path}?tombola=done#${FORM_ID}`);
}
