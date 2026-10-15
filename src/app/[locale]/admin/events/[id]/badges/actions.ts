"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";
import { readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { BadgeSizeRefusal, type PostedRoleColour, saveBadgeDesign, saveBadgeRoleColours } from "@/modules/volunteers/badges/badges";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";

/*
  «Ecusoane pentru voluntari» (§764): the two Server Actions of the page — «Salvează ecusonul» (the
  designer) and «Salvează culorile» (each role's band). Plain forms that work with scripts off; each asks
  its service, which asserts `canDesignVolunteerBadges` again (BR-REQ-060-01), so the page's buttons are a
  courtesy. A refusal comes back to the form with what was typed (§315); a save goes back to the page
  with its toast and the card open.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and the service refuses it (NOT_FOUND). */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

async function backToPage(form: FormData, saved: string, anchor: string): Promise<never> {
  const locale = localeOf(form);
  await flashOutcome({ saved });
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/badges", params: { id: eventIdOf(form) } } });
  revalidatePath(path);
  redirect(`${path}#${anchor}`);
}

/** «Salvează ecusonul»: the designer's boxes, read as the preview reads them (`readBadgeDesignForm`). */
export async function saveBadgeDesignAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    const actor = await requireStaff();
    const values = readBadgeDesignForm((name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : null;
    });
    changed = (await saveBadgeDesign(getDb(), actor, eventIdOf(form), values, new Date())).changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // A size with no room for everything ticked (§NNN): the sentence names what does not fit and how tall a badge it needs.
    if (error instanceof BadgeSizeRefusal) {
      const t = await getTranslations({ locale: localeOf(form), namespace: "Admin" });
      const what = error.what.map((extra) => t(`badges.design.extras.${extra}`)).join(", ");
      return { ...refused(error, form), errorValues: { what, width: String(error.widthMm), height: String(error.heightMm), minHeight: String(error.minHeightMm) } };
    }
    return refused(error, form);
  }
  return backToPage(form, changed ? "badgeDesignSaved" : "badgeDesignUnchanged", "box-badge-design");
}

/** «Salvează culorile»: every role the form drew, its choice and the colour typed beside «Altă culoare». */
export async function saveBadgeRoleColoursAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: number;
  try {
    const actor = await requireStaff();
    const posted: PostedRoleColour[] = form
      .getAll("roleId")
      .filter((value): value is string => typeof value === "string" && isUuid(value))
      .map((roleId) => ({ roleId, choice: field(form, `role.${roleId}.colour`), typed: field(form, `role.${roleId}.typedColour`) }));
    changed = (await saveBadgeRoleColours(getDb(), actor, eventIdOf(form), posted, new Date())).changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return refused(error, form);
  }
  return backToPage(form, changed > 0 ? "badgeColoursSaved" : "badgeColoursUnchanged", "box-badge-colours");
}
