import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { BIB_PICTURE_WIDTH, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { canDesignVolunteerBadges } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { type BadgeLocale, badgeWords } from "@/modules/volunteers/badges/badge-design";
import { badgeDefaultWords } from "@/modules/volunteers/badges/badge-words";
import { badgePrintEntries, findEventForBadges, listBadgeRoles, readPrintCounts } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă ecusoanele (PDF)» (§NNN): an event's volunteer badges as a printable A4 sheet, **per role**.
 * `GET /api/admin/events/<id>/badges?locale=ro&n.<role>=6&x.<role>=2&none=4` — for each role «Câte
 * ecusoane» (`n.`, by default the people the role needs) and «În plus» (`x.`, none by default), and
 * «Ecusoane fără rol» (`none`), the badges with «VOLUNTAR» alone. `locale` is the badge's language, the
 * bib's way: the words, the title and the roles' names in it.
 *
 * A GET that writes nothing, openable in a tab and again (`AGENTS.md` §12.8). Whoever designs the badges
 * (`canDesignVolunteerBadges`), asserted here whatever the page drew. **No volunteer is read**: the sheet
 * holds the club's words and the roles' names, and the names are written by hand at the desk — so the
 * file carries no personal data and needs no trail of its own.
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
  if (!hasLocale(routing.locales, locale)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const badgeLocale = locale as BadgeLocale;

  const db = getDb();
  const event = await findEventForBadges(db, id, badgeLocale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const roles = await listBadgeRoles(db, id);
  const counts = readPrintCounts(url.searchParams, roles);
  if (!counts) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  // The header's picture as PNG bytes (`bib-pictures.ts`): pdfkit embeds no WebP; a failure prints the band.
  const loaded = await loadBibPictures({ headerImageSrc: event.design.headerImageSrc, sponsorImageSrc: null }, BIB_PICTURE_WIDTH.sheet);
  const pdf = await renderBadgeSheet({
    design: event.design,
    locale: badgeLocale,
    words: badgeWords(event.design, badgeLocale, event.title, await badgeDefaultWords(badgeLocale)),
    entries: badgePrintEntries(roles, counts, badgeLocale),
    headerPicture: loaded.header?.png ?? null,
    eventTitle: event.title,
    generatedAt: new Date(),
  });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="badges-${id.slice(0, 8)}-${badgeLocale}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
