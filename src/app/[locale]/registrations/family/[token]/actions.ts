"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS, ANOTHER_LINK_INVALID } from "@/modules/registrations/domain/family";
import { waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { consumeAndConfirmFamilyEntry, consumeAndConfirmFamilySitting, consumeAndDeclineFamilyEntry } from "@/modules/registrations/token-actions";
import { writeFamilySigningPass } from "@/modules/registrations/family-signing";
import { isDomainError } from "@/shared/errors/domain-error";

/** The refusals the page has a sentence for, in the order a refusal is read; anything else is the generic one. */
const NAMED_REFUSALS = [ALREADY_ON_ADDRESS, ADDRESS_AT_CAP, "fitnessAcknowledged"] as const;

/**
 * The press on the confirmation page (§446, amending §389): the token spent, the other person
 * registered from the kept form and the address confirmed, in one transaction
 * (`family-confirm.ts`). Lands on the same page:
 *
 * - `done=declare` — a place is held and the declaration email is queued; `done=waitlist` — on
 *   the waiting list, with its own email;
 * - `refused=<marker>` — nothing happened and the link still works (the refusal rolled the spend
 *   back): the person is on the address already, the address is at its limit, the adult's tick is
 *   missing, the waiting list is full, or — `refused=other` — something about the kept form itself
 *   (the terms changed since, the age), which only sending the form again can fix;
 * - `invalid=1` — the link is spent, lapsed or unknown: the one generic notice (§13.2).
 *
 * Markers only, never a value (§14.5): the URL carries nothing anybody typed.
 */
export async function confirmFamilyEntryAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/family/[token]", params: { token } } });

  let result: Awaited<ReturnType<typeof consumeAndConfirmFamilyEntry>>;
  try {
    result = await consumeAndConfirmFamilyEntry(token, { fitnessAcknowledged: form.get("fitnessAcknowledged") === "on" }, new Date());
  } catch (error) {
    const waitlist = waitlistRefusalOf(error);
    if (waitlist) redirect(`${path}?refused=${waitlist}`);
    if (isDomainError(error)) {
      if (error.fields.includes(ANOTHER_LINK_INVALID)) redirect(`${path}?invalid=1`);
      const named = NAMED_REFUSALS.find((marker) => error.fields.includes(marker));
      redirect(`${path}?refused=${named ?? "other"}`);
    }
    throw error;
  }
  if (!result.ok) redirect(`${path}?invalid=1`);
  redirect(`${path}?done=${result.registration.status === "WAITLISTED" ? "waitlist" : "declare"}`);
}

/**
 * The family's one button (§NNN): the token spent, the address and everybody ticked confirmed, each
 * given a place or the waiting list (`family-sitting-confirm.ts`), the unticked kept forms deleted.
 * Then straight into the declarations as the wizard (§471) — «Declarația 1 din N» — on the
 * declaration page under this same link, which the pass is bound to. Lands on this page instead when
 * somebody on the list did not join (`done=family&refused=<markers>`, with `wizard=1` when there is
 * something to sign), or when nobody has a declaration to sign (all on the waiting list).
 *
 * The one refusal of the whole press — the acknowledgement for another adult missing (§421) — comes
 * back to the list with the link unspent (`refused=fitnessAcknowledged`). Markers only (§14.5).
 */
export async function confirmFamilySittingAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/family/[token]", params: { token } } });
  const now = new Date();

  let result: Awaited<ReturnType<typeof consumeAndConfirmFamilySitting>>;
  try {
    result = await consumeAndConfirmFamilySitting(
      token,
      {
        includedKeys: form.getAll("include").map(String),
        fitnessAcknowledged: form.get("fitnessAcknowledged") === "on",
      },
      now,
    );
  } catch (error) {
    if (isDomainError(error) && error.fields.includes("fitnessAcknowledged")) redirect(`${path}?refused=fitnessAcknowledged`);
    throw error;
  }
  if (!result.ok) redirect(`${path}?invalid=1`);
  if (result.pass) await writeFamilySigningPass(result.pass, token, now);
  const declarations = getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } });
  if (result.pass && result.refused.length === 0 && result.joined > 0) redirect(declarations);
  const refused = result.refused.length > 0 ? `&refused=${[...new Set(result.refused)].join(",")}` : "";
  /*
    Nobody joined — every kept form unticked, or every person refused: the address is not confirmed
    and nobody is registered, which the page says instead of «the registrations are made».
  */
  const nobody = result.joined === 0 ? "&nobody=1" : "";
  redirect(`${path}?done=family${result.pass ? "&wizard=1" : ""}${nobody}${refused}`);
}

/**
 * «Nu înscriu această persoană» (§468): the other answer to the same single-use link. The token is
 * spent and the kept form deleted (`declineFamilyEntry`); lands on `done=declined`, or on the one
 * generic notice when the link was spent, lapsed or unknown. Markers only in the URL (§14.5).
 */
export async function declineFamilyEntryAction(form: FormData): Promise<void> {
  const locale = (form.get("locale") === "en" ? "en" : "ro") as Locale;
  const token = String(form.get("token") ?? "");
  const path = getPathname({ locale, href: { pathname: "/registrations/family/[token]", params: { token } } });
  const result = await consumeAndDeclineFamilyEntry(token, new Date());
  redirect(result.ok ? `${path}?done=declined` : `${path}?invalid=1`);
}
