"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { updateSiteTint } from "@/modules/appearance/site-tint";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * «Fundalul site-ului» (§NNN): the public pages' background tint, one of the presets. A club
 * setting (§450) — the Administrator's at the door, and the service asserts it again. Asked first
 * (§384): every visitor sees the new colour from the next page view.
 */
export async function updateSiteTintAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/pages/appearance" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateSiteTint(getDb(), actor, { tint: form.get("tint") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  // The public pages read the tint through the public cache, which the service expired (§333);
  // this is the backoffice page's own payload, so it comes back saying what was saved.
  revalidatePath(path);
  await flashOutcome({ saved: "siteTint" });
  redirect(`${path}?saved=siteTint#admin-alert`);
}
