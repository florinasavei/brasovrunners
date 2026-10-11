import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import { type BibSheetPart, type BibSheetRow, renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { bibEventDate, findEventForBibs, freeSpareBibNumbers, listBibs } from "@/modules/registrations/bibs";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { BIB_PICTURE_WIDTH, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/** The `part` query (§681): an unknown value, or none, is the whole sheet — refused nowhere. */
const PART = z.enum(["all", "members", "others"]).catch("all");

/** What the file's name says of the part it holds; the whole sheet keeps the name it had. */
const PART_SUFFIX: Record<BibSheetPart, string> = { all: "", members: "-members", others: "-without-members" };

/**
 * The race numbers of one event as a printable sheet (BR-REQ-038-01).
 *
 * `GET /api/admin/events/<id>/bibs?locale=ro&from=1&to=50&only=unprinted`. Whoever may read the
 * registrations (§289; the owner: "organizer should also be able to see BIDs and export them") —
 * a bib carries a participant's name, which is personal data the club holds for the event and
 * nothing else (`AGENTS.md` §19.2). `from` and `to` bound the numbers printed, for a reprint;
 * `only=unprinted` is the club's weekly job — the people who registered after the last sheet
 * went to the printer (§264). Omitted, every assigned number. `spares=1` prints the desk's free
 * spares instead, blank (§444). The members' bibs print first, on pages of their own (§681);
 * `part=members` prints only theirs and `part=others` every bib but theirs — anything else, or
 * nothing, is the whole sheet, never an error.
 *
 * **A GET that mutates nothing**, which is why marking a batch printed is a separate press on the
 * registrations list and not something this route does: the sheet has to be openable in a tab,
 * saveable and openable again (`AGENTS.md` §12.8). Assigning numbers is the action on the event's
 * page; this only reads what that assigned.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canReadRegistrations(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const bound = (name: string) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : Number.NaN;
  };
  const from = bound("from");
  const to = bound("to");
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  // Two A5 bibs per A4 page unless "one" is asked for — each centred alone on its own page, no
  // cut line (§79); anything else is the default, not an error.
  const layout = url.searchParams.get("layout") === "one" ? ("one" as const) : ("two" as const);
  // The only scope besides a range: the bibs nobody has printed yet (§264).
  const only = url.searchParams.get("only") === "unprinted" ? ("unprinted" as const) : undefined;
  /*
    The desk's spares instead of the runners (§444): every number the event reserved for the desk
    that nobody wears, holds or wore, each with an empty line where the name goes and «înscris la
    fața locului» under it — the walk-in's name is written on at the desk. Within `from`–`to` when
    those are given: that is the link the print's banner carries, the range it just reserved. A GET
    that reserves nothing — the reservation is the print's POST (`reserveSpareBibs`).
  */
  const spares = url.searchParams.get("spares") === "1";
  /*
    Which bibs go into the file (§681): the members' pile alone, to print on other card, or every
    bib but theirs; anything else is the whole sheet with the members' pages first. A download
    marks nothing printed, whole or part: the mark is the club's own press on the registrations
    list (§264), so no file can make it claim a bib that was not in it.
  */
  const part: BibSheetPart = PART.parse(url.searchParams.get("part"));

  const db = getDb();
  const event = await findEventForBibs(db, id, locale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const rows: BibSheetRow[] = spares
    ? (await freeSpareBibNumbers(db, id)).free
        .filter((number) => (from === undefined || number >= from) && (to === undefined || number <= to))
        .map((bibNumber) => ({ bibNumber, registeredName: null }))
    : await listBibs(db, id, { from, to, only });

  /*
    The club's own pictures, fetched here rather than inside the renderer (§249).

    pdfkit takes bytes, and the sheet must print whatever happens: a store that is slow, a
    picture that was deleted, a variant that is not an image any more. So each is fetched with
    a deadline and a ceiling, and anything that fails is `null` — which prints the coloured
    band and no sponsors' strip, exactly as every sheet printed before this existed. And each is
    handed over as PNG (§560, `bib-pictures.ts`): pdfkit embeds no WebP, which every stored
    picture is, and a design with a picture failed the whole sheet with "Unknown image format.".
  */
  // The members' header or card photograph too (§664, §NNN), only when a member's bib is on this sheet; a spare never is one.
  const anyMember = part !== "others" && rows.some((row) => row.member === true);
  const loaded = await loadBibPictures(event.design, BIB_PICTURE_WIDTH.sheet, anyMember);
  const header = loaded.header?.png ?? null;
  const sponsors = loaded.sponsors?.png ?? null;
  const memberHeader = loaded.memberHeader?.png ?? null;
  const memberCard = loaded.memberCard?.png ?? null;
  // The sheet's own words, in its language: read only when the sheet prints them (§444, §664).
  const admin = spares || anyMember ? await getTranslations({ locale, namespace: "Admin" }) : null;

  const pdf = await renderBibSheet({
    rows,
    eventTitle: event.title,
    // Empty while the date is to be announced later (§545): never the provisional day on paper.
    eventDate: bibEventDate(event, locale),
    // The band in the event's own colour, and the facts the foot is composed from — the
    // partners, the club's mailbox, the site (§180, §317) — the same the preview draws from.
    bandColour: event.bibColour,
    partners: event.coHosts.map((host) => host.name),
    // The first address the club shows (§442): one line of small print has room for one.
    replyTo: (await shownContactAddresses(db))[0] ?? null,
    siteUrl: env.APP_BASE_URL,
    generatedAt: now,
    layout,
    part,
    design: event.design,
    pictures: { header, sponsors, memberHeader, memberCard },
    // The members' label when the club typed none (§664), in the sheet's language.
    ...(anyMember && admin ? { memberLabelDefault: admin("bibs.memberLabelDefault", { club: CLUB_NAME }) } : {}),
    // Under a spare's empty line (§444), in the sheet's language.
    ...(spares && admin ? { blankMark: admin("bibs.spareMark") } : {}),
  });

  const suffix = `${spares ? "-spares" : ""}${from !== undefined || to !== undefined ? `-${from ?? 1}-${to ?? "end"}` : ""}${only && !spares ? "-unprinted" : ""}${PART_SUFFIX[part]}${layout === "one" ? "-one-per-page" : ""}`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bibs-${id.slice(0, 8)}${suffix}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
