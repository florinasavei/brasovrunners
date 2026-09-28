"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { updateDeadlines } from "@/modules/deadlines/deadlines";
import { DEADLINE_KEYS } from "@/modules/deadlines/domain/deadlines";
import { updateAddressCap } from "@/modules/registrations/address-cap";
import { updateDeliveryTiming } from "@/modules/notifications/delivery-timing";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/*
  «Setări» → «Termene» (§516): the club's deadlines (§377), the per-address limit (§389) and «Când
  pleacă emailurile» (§513). The three actions moved here, unchanged, from `/admin/emails`; they
  land back on this tab.
*/

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "Termene" — the club's deadlines (§377). Administrator at the door and in the service, like
 * every other club setting; every box is a whole number the service checks against its
 * bounds, and a refusal comes back as the form's state with every box as typed (§315). The seven
 * boxes post under their own names (`DEADLINE_KEYS`), read here as strings: the service's schema
 * is what decides whether they are numbers.
 */
export async function updateDeadlinesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/deadlines" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateDeadlines(
      getDb(),
      actor,
      Object.fromEntries(DEADLINE_KEYS.map((key) => [key, typeof form.get(key) === "string" ? String(form.get(key)).trim() : ""])),
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  // The page reads the numbers it has just written; without this it comes back saying the old
  // ones (the trap §164 and §100 documented on the email tab's actions).
  revalidatePath(path);
  await flashOutcome({ saved: "deadlines" });
  redirect(`${path}?saved=deadlines#admin-alert`);
}

/**
 * "Maxim de înscrieri pe o adresă (pe eveniment)" (§389), in the "Termene" fold: the same gates and
 * the same shape as the deadlines' save above — the Administrator at the door and in the service,
 * one whole number the service bounds, a refusal back as the form's state with the box as typed.
 */
export async function updateAddressCapAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/deadlines" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    const raw = form.get("registrationsPerAddress");
    await updateAddressCap(getDb(), actor, { registrationsPerAddress: typeof raw === "string" ? raw.trim() : "" }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  // The tab reads the limit it has just written.
  revalidatePath(path);
  redirect(`${path}?saved=addressCap#admin-alert`);
}

/**
 * «Când pleacă emailurile» (§513), in the "Termene" fold: the same gates and the same shape as the
 * address cap above it — the Administrator at the door and in the service, one closed choice the
 * service's schema decides, a refusal back as the form's state.
 */
export async function updateDeliveryTimingAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/deadlines" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateDeliveryTiming(getDb(), actor, { timing: form.get("timing") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "deliveryTiming" });
  redirect(`${path}?saved=deliveryTiming#admin-alert`);
}
