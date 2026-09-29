"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { isSelfServiceField, withdrawFromMyRegistrations } from "@/modules/registrations/consent-withdrawal";
import { setListConsentFromMyRegistrations } from "@/modules/registrations/list-consent";
import { setPromoConsentFromMyRegistrations } from "@/modules/registrations/promo-consent";
import {
  checkInSelfFromMyRegistrations,
  consumeAndCancelFromMyRegistrations,
} from "@/modules/registrations/my-registrations";
import { writeFamilySigningPass } from "@/modules/registrations/family-signing";
import { parseCancelReason } from "@/modules/registrations/domain/cancel-reason";
import { startFamilySigningFromMine } from "@/modules/registrations/token-actions";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashPublic } from "@/shared/feedback/flash";

function pagePath(locale: Locale, token: string): string {
  return getPathname({ locale, href: { pathname: "/registrations/mine/[token]", params: { token } } });
}

/** Cancel one registration from the list. Consumes the link; the page then says so. */
export async function cancelFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const path = pagePath(locale, token);

  // The reason, required (§558): refused before the link is spent, the box named under that person.
  const reason = parseCancelReason(form);
  if (!reason.ok) redirect(`${path}?reason=${reason.problem}&person=${encodeURIComponent(registrationId)}#cancel-reason`);

  try {
    const result = await consumeAndCancelFromMyRegistrations(getDb(), token, registrationId, new Date(), reason.reason);
    // The toast on the page it lands on (§427); a refused link says so on the page, never in a toast.
    if (result.ok) await flashPublic("unregistered");
    redirect(result.ok ? `${path}?done=1` : `${path}?invalid=1`);
  } catch (error) {
    // "This event has already started" — the one VALIDATION_ERROR unregister raises.
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?started=1`);
    if (isDomainError(error)) redirect(`${path}?invalid=1`);
    throw error;
  }
}

/** "I am here" for one registration. The link stays valid. */
export async function selfCheckInFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const path = pagePath(locale, token);

  try {
    const result = await checkInSelfFromMyRegistrations(getDb(), token, registrationId, locale, new Date());
    redirect(result.ok ? `${path}?here=${encodeURIComponent(registrationId)}` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?hereFailed=${encodeURIComponent(registrationId)}`);
    throw error;
  }
}

/** The public list's switch for one registration (BR-REQ-039-01; §143). The link stays valid. */
export async function setListConsentFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const listed = form.get("listed") === "1";
  const path = pagePath(locale, token);

  try {
    const result = await setListConsentFromMyRegistrations(getDb(), token, registrationId, listed, new Date());
    redirect(result.ok ? `${path}?list=${encodeURIComponent(registrationId)}` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?listFailed=${encodeURIComponent(registrationId)}`);
    throw error;
  }
}

/**
 * «Nu mai vreau oferte și beneficii» for one registration (§NNN): this door only withdraws — a yes
 * posted here is refused FORBIDDEN in the module (second fix round), since the address link cannot
 * tell the holder from another adult. The link stays valid; the registration must be the link
 * holder's own, checked in the module.
 */
export async function setPromoConsentFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const consent = form.get("consent") === "1";
  const path = pagePath(locale, token);

  try {
    const result = await setPromoConsentFromMyRegistrations(getDb(), token, registrationId, consent, new Date());
    redirect(result.ok ? `${path}?promo=${encodeURIComponent(registrationId)}` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?promoFailed=${encodeURIComponent(registrationId)}`);
    throw error;
  }
}

/**
 * Withdraw the health note, or the socials, of one registration (§322). The link stays valid;
 * the registration must be the link holder's own, checked in the module.
 */
export async function withdrawFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const registrationId = String(form.get("registrationId") ?? "");
  const field = form.get("field");
  const path = pagePath(locale, token);
  if (!isSelfServiceField(field)) redirect(`${path}?withdrawFailed=${encodeURIComponent(registrationId)}`);

  try {
    const result = await withdrawFromMyRegistrations(getDb(), token, registrationId, field, new Date());
    redirect(
      result.ok
        ? `${path}?withdrawn=${encodeURIComponent(registrationId)}&field=${field}`
        : `${path}?invalid=1`,
    );
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?withdrawFailed=${encodeURIComponent(registrationId)}`);
    throw error;
  }
}

/**
 * «Semnează declarațiile» (§471, over §77): the address's declarations still to sign at one event,
 * as the declaration page's wizard. The link is read, not spent, and exchanged on the server for
 * the wizard's pass (`startFamilySigningFromMine`) — no new token goes in any URL. The wizard opens
 * on the declaration page under this same link, which is where the pass travels and nowhere else.
 */
export async function startFamilySigningFromMyRegistrationsAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const eventId = String(form.get("eventId") ?? "");
  const now = new Date();

  const result = await startFamilySigningFromMine(token, eventId, now);
  /*
    Refused (§471, nit found in review): a dead link says so on the page, as every press here does;
    an address with nobody left to walk lands back on the list, and a toast names why — nobody left
    to sign, or one person alone, whose own emailed link signs them.
  */
  if (!result.ok && result.reason === "LINK") redirect(`${pagePath(locale, token)}?invalid=1`);
  if (!result.ok) {
    await flashPublic(result.reason === "ONE_LEFT" ? "familySignOneLeft" : "familySignNothingLeft");
    redirect(pagePath(locale, token));
  }
  await writeFamilySigningPass(result.pass, token, now);
  redirect(getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } }));
}
