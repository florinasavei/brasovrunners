"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { HOME_SECTION_KEYS } from "@/modules/appearance/domain/home-page";
import { updateHomePage } from "@/modules/appearance/home-page";
import { updateSiteFontSize } from "@/modules/appearance/site-font-size";
import { updateSiteLook } from "@/modules/appearance/site-look";
import { SITE_TINT_REFUSAL, updateSiteTint } from "@/modules/appearance/site-tint";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { flashOutcome } from "@/shared/feedback/flash";
import { isDomainError } from "@/shared/errors/domain-error";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

const REFUSAL_MARKERS: readonly string[] = Object.values(SITE_TINT_REFUSAL);

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * «Aspectul site-ului» (§488): the public pages' background tint, a preset or «Personalizat». A club
 * setting (§450) — the Administrator's at the door, and the service asserts it again. Asked first
 * (§384): every visitor sees the new colour from the next page view.
 */
export async function updateSiteTintAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/appearance" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateSiteTint(getDb(), actor, { tint: form.get("tint"), hex: form.get("hex") }, new Date());
  } catch (error) {
    const refusal = refused(error, form, { fieldNames: (failure) => failure.fields.filter((name) => !REFUSAL_MARKERS.includes(name)) });
    // A typed colour that breaks a rule says the rule in words (the catalogue's sentence), not
    // "check what you entered": the box is filled correctly, the colour is what is wrong.
    if (isDomainError(error) && error.fields.includes(SITE_TINT_REFUSAL.unreadable)) return { ...refusal, error: "SITE_TINT_UNREADABLE" };
    if (isDomainError(error) && error.fields.includes(SITE_TINT_REFUSAL.tooDark)) return { ...refusal, error: "SITE_TINT_TOO_DARK" };
    return refusal;
  }
  // The public pages read the tint through the public cache, which the service expired (§333);
  // this is the backoffice page's own payload, so it comes back saying what was saved.
  revalidatePath(path);
  await flashOutcome({ saved: "siteTint" });
  redirect(`${path}?saved=siteTint#admin-alert`);
}

/**
 * «Mărimea textului» (§530): the public pages' text size, one of four steps. A club setting (§450)
 * — the Administrator's at the door, and the service asserts it again. Asked first (§384): every
 * visitor reads at the new size from the next page view.
 */
export async function updateSiteFontSizeAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/appearance" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateSiteFontSize(getDb(), actor, { size: form.get("size") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "siteFontSize" });
  redirect(`${path}?saved=siteFontSize#admin-alert`);
}

/**
 * «Aspectul nou» (§708): the facelift's look on the public pages, on or off. A club setting (§450) —
 * the Administrator's at the door, and the service asserts it again. Asked first (§384): every
 * visitor sees the chosen look from the next page view; the backoffice never changes.
 */
export async function updateSiteLookAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/appearance" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateSiteLook(getDb(), actor, { look: form.get("look") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "siteLook" });
  redirect(`${path}?saved=siteLook#admin-alert`);
}

/**
 * «Pagina principală» (§NNN): the home page at the site's root on or off, its hero picture and its two
 * lines. A club setting (§450) — the Administrator's at the door, and the service asserts it again.
 * Asked first (§384): the root becomes the page, or the listing's redirect again, from the next visit.
 * The picture's two hidden fields are read only when the form carried them (`TeamPhotoField`, stem
 * `hero`); a missing field is `undefined`, which keeps the picture as it was.
 */
export async function updateHomePageAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/appearance" });
  const field = (name: string) => {
    const value = form.get(name);
    return value === null ? undefined : value;
  };

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateHomePage(
      getDb(),
      actor,
      {
        page: field("page"),
        heroAssetId: field("heroAssetId"),
        heroCrop: field("heroCrop"),
        headlineRo: field("headlineRo"),
        headlineEn: field("headlineEn"),
        sublineRo: field("sublineRo"),
        sublineEn: field("sublineEn"),
        buttonJoinRo: field("buttonJoinRo"),
        buttonJoinEn: field("buttonJoinEn"),
        buttonCalendarRo: field("buttonCalendarRo"),
        buttonCalendarEn: field("buttonCalendarEn"),
        buttonHowRo: field("buttonHowRo"),
        buttonHowEn: field("buttonHowEn"),
        buttonHowSlug: field("buttonHowSlug"),
        // A checkbox that is off posts nothing, so the form says it carried the switches at all.
        sections: form.has("sectionsPosted") ? Object.fromEntries(HOME_SECTION_KEYS.map((key) => [key, form.has(`section_${key}`)])) : undefined,
      },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "homePage" });
  redirect(`${path}?saved=homePage#admin-alert`);
}
