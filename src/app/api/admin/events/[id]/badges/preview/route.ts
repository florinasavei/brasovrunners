import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { BIB_PICTURE_WIDTH, bibPictureForImage, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { canDesignVolunteerBadges } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { type BadgeDesign, type BadgeLocale, badgeDesignFromQuery, badgeWords } from "@/modules/volunteers/badges/badge-design";
import { renderBadgeImage } from "@/modules/volunteers/badges/badge-image";
import { badgeDefaultWords } from "@/modules/volunteers/badges/badge-words";
import { badgeRoleName, findEventForBadges, listBadgeRoles } from "@/modules/volunteers/badges/badges";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * One volunteer badge as a PNG (§764), for «Ecusoane pentru voluntari»: the designer's live preview and
 * the print section's picture of each role's badge. `GET /api/admin/events/<id>/badges/preview?locale=ro&role=<id>|none`.
 * A GET that reads and writes nothing.
 *
 * - **A role's badge as saved** (`role=<id>`, or `none` for «fără rol»): the stored design, the role's
 *   name in the badge's language and its colour. The page stamps the address with what it is drawn from
 *   (`v=`, `badgePictureStamp`), so the browser may keep the answer an hour.
 * - **The sample** (`sample=1`): the design read from the query — the designer's unsaved boxes, through
 *   the save's own schema — for a role of the event or `none`. Never kept: the role's saved name and
 *   colour, and the title, are read here, and a preview that lags a save previews the wrong thing.
 *
 * Whoever designs the badges (`canDesignVolunteerBadges`: the Organizer and the Administrators). No
 * volunteer is read: a badge carries a role and the club's words, never a person.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canDesignVolunteerBadges(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  const roleParam = url.searchParams.get("role") ?? "none";
  if (!hasLocale(routing.locales, locale) || (roleParam !== "none" && !isUuid(roleParam))) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const badgeLocale = locale as BadgeLocale;
  const db = getDb();
  const event = await findEventForBadges(db, id, badgeLocale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const role = roleParam === "none" ? null : ((await listBadgeRoles(db, id)).find((candidate) => candidate.id === roleParam) ?? undefined);
  if (role === undefined) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const sample = url.searchParams.get("sample") === "1";
  const design: BadgeDesign = sample ? badgeDesignFromQuery(url.searchParams) : event.design;
  // The header's picture, read and handed over as PNG (`bib-pictures.ts`): Satori reads no WebP.
  const loaded = await loadBibPictures({ headerImageSrc: design.headerImageSrc, sponsorImageSrc: null }, BIB_PICTURE_WIDTH.preview);
  const image = await renderBadgeImage({
    design,
    locale: badgeLocale,
    words: badgeWords(design, badgeLocale, event.title, await badgeDefaultWords(badgeLocale)),
    role: role ? { name: badgeRoleName(role, badgeLocale), colour: role.colour, phone: role.categoryPhone } : null,
    headerPicture: bibPictureForImage(loaded.header),
  });
  image.headers.set("Cache-Control", sample ? "private, no-store" : "private, max-age=3600");
  return image;
}
