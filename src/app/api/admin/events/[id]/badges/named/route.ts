import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { BIB_PICTURE_WIDTH, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { canDesignVolunteerBadges } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { type BadgeLocale, badgeWords } from "@/modules/volunteers/badges/badge-design";
import { parseNamedBadgeLines } from "@/modules/volunteers/badges/badge-named";
import { badgeDefaultWords } from "@/modules/volunteers/badges/badge-words";
import { findEventForBadges } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { isDomainError } from "@/shared/errors/domain-error";
import { contentDisposition } from "@/shared/http/content-disposition";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă PDF cu nume» — «Ecusoane cu nume», the hotfix of 2026-11-19 (the owner: «pune-mi și numele lor pe ele, să nu mai scriem
 * cu carioca», «Vreau doar prenume pe ele», «… să pot scrie "Voluntar/Fotograf/Organizator" Dany/Amalia»), amending §764's «no name
 * is printed»: the badges page's list, one line a badge — the word on its band, «;», the first name — posted here and printed with
 * the event's own design (its size, colours, header, logo), every badge with no role, its own word on the band and the first name
 * where the marker went (`badge-named.ts`, `badges-pdf.ts`).
 *
 * A POST, so the names travel in the body and never in an address; nothing is stored but one audit row (§322's exports: who, which
 * event, how many badges — never a name). Whoever designs the badges (`canDesignVolunteerBadges`: the Organizer and the
 * Administrators), asserted here whatever the page drew (BR-REQ-060-01). The session's cookie is `SameSite=Lax`, so another site's
 * form cannot post here as the organizer.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const typedLocale = form.get("locale");
  const locale = typeof typedLocale === "string" && hasLocale(routing.locales, typedLocale) ? typedLocale : routing.defaultLocale;
  const badgeLocale = locale as BadgeLocale;

  const db = getDb();
  const event = await findEventForBadges(db, id, badgeLocale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const words = badgeWords(event.design, badgeLocale, event.title, await badgeDefaultWords(badgeLocale));
  const lines = form.get("lines");
  const badges = parseNamedBadgeLines(typeof lines === "string" ? lines : "", words.label);

  // The header's picture as PNG bytes (`bib-pictures.ts`): pdfkit embeds no WebP; a failure prints the band.
  const loaded = await loadBibPictures({ headerImageSrc: event.design.headerImageSrc, sponsorImageSrc: null }, BIB_PICTURE_WIDTH.sheet);
  const now = new Date();
  const pdf = await renderBadgeSheet({
    design: event.design,
    locale: badgeLocale,
    words,
    entries: badges.map((badge) => ({ role: null, count: 1, label: badge.label, printedName: badge.name, ...(badge.colour ? { colour: badge.colour } : {}) })),
    headerPicture: loaded.header?.png ?? null,
    eventTitle: event.title,
    generatedAt: now,
  });
  await recordAuditEvent(db, { actorStaffUserId: actor.id, action: "event.badges_named_printed", entityType: "event", entityId: id, metadata: { badges: badges.length }, now });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("attachment", `badges-names-${id.slice(0, 8)}-${badgeLocale}.pdf`, "badges"),
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
