"use server";

import { redirect, RedirectType } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { isSelfServiceField, withdrawFromManageLink } from "@/modules/registrations/consent-withdrawal";
import { setListConsentFromManageLink } from "@/modules/registrations/list-consent";
import { parseCancelReason } from "@/modules/registrations/domain/cancel-reason";
import { setPromoConsentFromManageLink } from "@/modules/registrations/promo-consent";
import { reconfirmFromManageLink } from "@/modules/registrations/reconfirmation";
import { setResultsNameConsentFromManageLink } from "@/modules/registrations/results-consent";
import { checkInSelf, completeAnswersFromManageLink, consumeAndCancel } from "@/modules/registrations/token-actions";
import { answersRefusalParam, readPostedAnswers } from "@/modules/registrations/complete-answers";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { ANSWER_DRAFT_FIELDS } from "@/modules/registrations/missing-answers";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashPublic } from "@/shared/feedback/flash";

/**
 * The person a per-person press names (§547): a registration id, or undefined for the link's own.
 * Never trusted here — the module checks it is the same address at the same event as the link's.
 */
function personOf(form: FormData): string | undefined {
  const value = form.get("registrationId");
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function cancelRegistrationAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const person = personOf(form);

  /*
    The reason, required (§558): refused before anything is read or spent, back on the same page with
    the box named under the person's own cancel — the link still works for the next press.
  */
  const reason = parseCancelReason(form);
  if (!reason.ok) {
    const who = person ? `&person=${encodeURIComponent(person)}` : "";
    redirect(`${path}?reason=${reason.problem}${who}#cancel-reason`);
  }

  try {
    const result = await consumeAndCancel(token, new Date(), reason.reason, person);
    // The toast on the page it lands on (§427); a refused link says so on the page, never in a toast.
    if (result.ok) await flashPublic("unregistered");
    // `done=family`: the page listed more than one person, so the outcome says how to reach the others (§547) — never who.
    redirect(result.ok ? `${path}?done=${result.family ? "family" : "1"}` : `${path}?invalid=1`);
  } catch (error) {
    // "This event has already started" (§10.5 rule 9) — the only VALIDATION_ERROR unregister
    // can raise. Shown as a fixed fact, not folded into the generic invalid-token message.
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?started=1`);
    // A person the link does not manage (§547): nothing was spent, and the page says the press failed.
    if (isDomainError(error)) redirect(`${path}?invalid=1`);
    throw error;
  }
}

/**
 * "I have arrived" from the participant's own link (BR-REQ-037-08). The token is read, not
 * spent — the same page must still be able to cancel — and the outcome comes back as a query
 * flag the page turns into a sentence. Per person since §547: the flag names the registration
 * id the press named, which the page already lists (an id, never a name, §14.5).
 */
export async function selfCheckInAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const person = personOf(form);
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const who = person ? `&person=${encodeURIComponent(person)}` : "";

  try {
    const result = await checkInSelf(token, new Date(), person);
    redirect(result.ok ? `${path}?here=1${who}` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?here=0${who}`);
    throw error;
  }
}

/**
 * The public participant list, from the participant's own link (BR-REQ-039-01; `DECISIONS.md`
 * §143). Read, not spent, for the same reason as "I am here": the page must still be able to
 * cancel, and the choice is reversible. `listed` is the answer the button carried, so a double
 * submission lands on the state the person pressed for. Per person since §547, each their own.
 */
export async function setListConsentFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const listed = form.get("listed") === "1";
  const person = personOf(form);
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const who = person ? `&person=${encodeURIComponent(person)}` : "";

  try {
    const result = await setListConsentFromManageLink(getDb(), token, listed, new Date(), person);
    redirect(result.ok ? `${path}?list=1${who}#list` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?list=0${who}#list`);
    throw error;
  }
}

/**
 * «Vreau oferte și beneficii» / «Nu mai vreau oferte și beneficii» from the participant's own
 * link (§562), per person like the list switch above: read, not spent. `consent` is the answer the
 * button carried, so a double submission lands on the state the person pressed for. A yes while the
 * notice in force does not describe the materials is refused by the module, never kept.
 */
export async function setPromoConsentFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const consent = form.get("consent") === "1";
  const person = personOf(form);
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const who = person ? `&person=${encodeURIComponent(person)}` : "";

  try {
    const result = await setPromoConsentFromManageLink(getDb(), token, consent, new Date(), person);
    redirect(result.ok ? `${path}?promo=1${who}#promo` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?promo=0${who}#promo`);
    throw error;
  }
}

/**
 * «Vreau să apar cu numele în clasament» from the participant's own link (§879), per person like the switches above: read, not
 * spent. `consent` is the state the tick asks for, so a double submission lands on it. A yes the gate does not allow — the notice in
 * force does not describe the results, not a race, a registration made under the results notice already, off the list, another
 * adult — is refused by the module, never kept.
 */
export async function setResultsNameConsentFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const consent = form.get("consent") === "1";
  const person = personOf(form);
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const who = person ? `&person=${encodeURIComponent(person)}` : "";

  try {
    const result = await setResultsNameConsentFromManageLink(getDb(), token, consent, new Date(), person);
    redirect(result.ok ? `${path}?results=1${who}#results` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?results=0${who}#results`);
    throw error;
  }
}

/**
 * «Da, vin la cursă» from the participant's own link (the decision «Cere reconfirmarea»), per person like the switches
 * above: the token read, never spent. Records the answer once — a second press lands on the same success and writes
 * nothing. A registration that no longer answers (cancelled, expired, an offer, the event started or cancelled) is
 * refused with nothing written; a link the registration has left is the refused link.
 *
 * The answer's page REPLACES the page that pressed, never stacks on it: opened at `#reconfirm`, that page pressed by itself
 * (`ReconfirmOnArrival`), and a Back to it would mount the island again, spend another attempt and bounce the person
 * forward. Replaced, Back leaves for wherever the link was opened from.
 */
export async function reconfirmFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const person = personOf(form);
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const who = person ? `&person=${encodeURIComponent(person)}` : "";

  try {
    const result = await reconfirmFromManageLink(getDb(), token, new Date(), person);
    redirect(result.ok ? `${path}?reconfirm=1${who}#reconfirm` : `${path}?invalid=1`, RedirectType.replace);
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") redirect(`${path}?reconfirm=0${who}#reconfirm`, RedirectType.replace);
    // A person the link does not manage: nothing was written, and the page says the press failed — replacing, as every answer does.
    if (isDomainError(error)) redirect(`${path}?invalid=1`, RedirectType.replace);
    throw error;
  }
}

/**
 * «Completează-ți datele» from the participant's own link (§905), per person like the switches above: the token
 * read, never spent; only the answers the public form requires and the registration does not hold, each through
 * the form's own rule, written as the person's own with one audit row. A refusal names the boxes in the URL —
 * names only (§14.5) — and keeps what was typed, sealed, for the page it lands on.
 */
export async function completeAnswersFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const person = personOf(form);
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  const who = person ? `&person=${encodeURIComponent(person)}` : "";

  try {
    const result = await completeAnswersFromManageLink(token, readPostedAnswers(form, locale), new Date(), person);
    if (!result.ok) redirect(`${path}?invalid=1`);
    await clearFormDraft(path);
    redirect(`${path}?answers=1${who}#answers`);
  } catch (error) {
    const refused = isDomainError(error) && error.code === "VALIDATION_ERROR" ? answersRefusalParam(error.fields) : null;
    if (refused) {
      await stashDraftValues(answerDraftOf(form), path);
      redirect(`${path}?answers=0&answersRefused=${encodeURIComponent(refused)}${who}#answers`);
    }
    // A person the link does not manage, or a registration that no longer stands: nothing was written.
    if (isDomainError(error)) redirect(`${path}?invalid=1`);
    throw error;
  }
}

/** What a refused «Completează-ți datele» brings back (§142): the answers' boxes and nothing else — never the token. */
function answerDraftOf(form: FormData): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const name of ANSWER_DRAFT_FIELDS) {
    const value = form.get(name);
    if (typeof value === "string" && value !== "") draft[name] = value;
  }
  return draft;
}

/**
 * "Delete my health note" / "Delete my Strava and Instagram" from the participant's own link
 * (§322). Read, not spent, as the public-list switch above: the page must still be able to
 * cancel. The field group is the only thing taken from the form, and only one of two words.
 */
export async function withdrawFromManageAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const field = form.get("field");
  const path = getPathname({ locale, href: { pathname: "/registrations/manage/[token]", params: { token } } });
  if (!isSelfServiceField(field)) redirect(`${path}?withdrawn=0#consent`);

  try {
    const result = await withdrawFromManageLink(getDb(), token, field, new Date());
    redirect(result.ok ? `${path}?withdrawn=${field}#consent` : `${path}?invalid=1`);
  } catch (error) {
    if (isDomainError(error)) redirect(`${path}?withdrawn=0#consent`);
    throw error;
  }
}
