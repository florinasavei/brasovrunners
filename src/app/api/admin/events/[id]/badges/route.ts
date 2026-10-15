import { contentDisposition } from "@/shared/http/content-disposition";
import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { BIB_PICTURE_WIDTH, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { canDesignVolunteerBadges } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { type BadgeLocale, badgeWords } from "@/modules/volunteers/badges/badge-design";
import { badgeDefaultWords } from "@/modules/volunteers/badges/badge-words";
import { BADGE_FROM_BOX, BADGE_REFUSED_PARAM, badgePrintEntries, findEventForBadges, listBadgeRoles, printBoxes, readBadgeSingleDefault, readPrintCounts } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă ecusoanele (PDF)» (§764): an event's volunteer badges as a printable A4 sheet, **per role**.
 * `GET /api/admin/events/<id>/badges?locale=ro&n.<role>=6&x.<role>=2&none=4` — for each role «Câte
 * ecusoane» (`n.`, by default the people the role needs) and «În plus» (`x.`, none by default), and
 * «Ecusoane fără rol» (`none`), the badges with «VOLUNTAR» alone. `locale` is the badge's language, the
 * bib's way: the words, the title and the roles' names in it.
 *
 * **When the design is the one badge for everyone** (`mode: single`, the default, §NNN) the sheet is one pile
 * of «VOLUNTAR» badges on the design's colour, no role: `all=40&allx=5` — «Câte ecusoane» (by default the
 * event's confirmed volunteers, else what its roles need together, else ten) and «În plus» (none by default).
 * The role boxes above are not read then. The only thing read of the people is how many are confirmed.
 *
 * A GET that writes nothing, openable in a tab and again (`AGENTS.md` §12.8). Whoever designs the badges
 * (`canDesignVolunteerBadges`), asserted here whatever the page drew. **No volunteer's data is read** (at most how many are confirmed, §NNN): the sheet
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
  // One badge for everyone (§NNN): one pile, «Câte ecusoane» starting at the confirmed volunteers; per role (§764): a pile per role.
  const counts = readPrintCounts(url.searchParams, roles, event.design.mode === "single" ? { defaultCount: url.searchParams.has(printBoxes.all) ? 0 : await readBadgeSingleDefault(db, id, roles) } : undefined);
  if ("refused" in counts) {
    // The form (§764) says which page it came from: a refusal is told there, with the limits, not as bare JSON
    // that would replace the page. A caller that sends no `from` is a script, and gets the 400.
    const from = url.searchParams.get(BADGE_FROM_BOX);
    if (from !== null && hasLocale(routing.locales, from)) {
      // A path alone, no host: the browser resolves it against the address it asked.
      return new Response(null, { status: 303, headers: { Location: `/${from}/admin/events/${id}/badges?${BADGE_REFUSED_PARAM}=${counts.refused}`, "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

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
      "Content-Disposition": contentDisposition("attachment", `badges-${id.slice(0, 8)}-${badgeLocale}.pdf`, "badges"),
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
