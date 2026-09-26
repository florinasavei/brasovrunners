"use server";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS, ANOTHER_LINK_INVALID } from "@/modules/registrations/domain/family";
import { waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { consumeAndConfirmFamilyEntry } from "@/modules/registrations/token-actions";
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
