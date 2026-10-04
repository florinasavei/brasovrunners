import { and, eq } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { routing } from "@/i18n/routing";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import { type BibDesign, bibDesignFromQuery } from "@/modules/registrations/bib-design";
import { bibNumberFromQuery } from "@/modules/registrations/bib-design-query";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { BIB_PICTURE_WIDTH, bibPictureForImage, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { bibEventDate, findEventForBibs } from "@/modules/registrations/bibs";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { memberCanonicalEmails } from "@/modules/registrations/member-ticks";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { CLUB_NAME } from "@/theme/brand";

/**
 * The name on a sample bib. Not a translation: a bib carries a name as typed, and this one is
 * a placeholder an organizer recognises as one whichever language the backoffice is in.
 */
const SAMPLE_NAME = "Nume Prenume";

/**
 * One participant's bib as a PNG, for the preview grid on the event page (`DECISIONS.md`
 * §94) and for the race-day desk (§184). `GET /api/admin/events/<id>/bibs/preview?registration=<id>&locale=ro`.
 * A GET that reads and writes nothing.
 *
 * **Every desk role may ask for one**, unlike the sheet, which stays Administrator-only. The
 * picture carries a name and a number and nothing else — which is exactly what `AGENTS.md`
 * §15.11 says every staff role already sees at the desk, and precisely what a volunteer holding
 * the right envelope needs. One registration at a time, by its id, on the event it belongs to:
 * this is not the list, and asking for two hundred of them one at a time is not the export.
 *
 * ## The sample, for the editor's design panel
 *
 * `?sample=1` instead of `registration=`: the same card, drawn for nobody — "Nume Prenume",
 * the event's start number (or `number=`), the event's own title and date — with the design
 * read from the query string rather than from the row (the owner: "la BID îmi trebuie un
 * preview aici"). That is how the panel shows the bib as the boxes change, before a save:
 * `bibDesignFromQuery` validates the unsaved design with the same schema the save uses, and
 * `colour=` is the band's colour as the form's select holds it, empty for the club's; each
 * picture's crop travels beside it (`headerImageCrop=`, `sponsorImageCrop=`, §560) and is drawn
 * through the same crop rule as the sheet (`bib-picture-frame.ts`). The
 * design parameters are read in sample mode only; with a registration named, the stored design
 * is what is drawn, because that is what will print.
 *
 * No participant data leaves here in sample mode — a placeholder name and a number the club
 * chose — so the gate is the one every staff role already passes for a real bib. The same
 * renderer as the paper, never a second drawing (§180): the preview is a preview of the print.
 */
/** The design's pictures, read and turned into what `next/og` draws (`bib-pictures.ts`); the members' header for a member's bib (§664). */
async function imagePictures(design: BibDesign, member = false) {
  const loaded = await loadBibPictures(design, BIB_PICTURE_WIDTH.preview, member);
  return { header: bibPictureForImage(loaded.header), sponsors: bibPictureForImage(loaded.sponsors), memberHeader: bibPictureForImage(loaded.memberHeader) };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canWorkTheDesk(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  const sample = url.searchParams.get("sample") === "1";
  const registrationId = url.searchParams.get("registration") ?? "";
  if (!hasLocale(routing.locales, locale) || (!sample && !isUuid(registrationId))) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventForBibs(db, id, locale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // The bib's own line, in the language it is drawn for and the event's zone (§349, §317); empty
  // while the date is to be announced later (§545).
  const eventDate = bibEventDate(event, locale);
  // The first address the club shows (§442): one line of small print has room for one.
  const replyTo = (await shownContactAddresses(db))[0] ?? null;
  // The same facts the sheet's footer is made of (§180, §317), so either picture is a picture of
  // the paper; which of them print is the design's to say.
  const partners = event.coHosts.map((host) => host.name);
  // The members' label when the club typed none (§664), in the picture's language — read only for a member's bib.
  const memberLabelDefault = async () => (await getTranslations({ locale, namespace: "Admin" }))("bibs.memberLabelDefault", { club: CLUB_NAME });

  if (sample) {
    const design = bibDesignFromQuery(url.searchParams);
    /*
      `member=1` draws a member's bib (§664) — the designer's second preview and the bibs page's — with
      the members' design as the query carries it, whether or not its switch is on yet: the club sees
      the members' bib before it offers it.
    */
    const member = url.searchParams.get("member") === "1";
    const drawn = member ? { ...design, member: { ...design.member, enabled: true } } : design;
    const image = await renderBibImage({
      bibNumber: bibNumberFromQuery(url.searchParams.get("number")) ?? event.bibStartNumber,
      // `blank=1` draws a desk spare (§444): the empty line the name is written on at the desk.
      registeredName: url.searchParams.get("blank") === "1" ? null : SAMPLE_NAME,
      ...(url.searchParams.get("blank") === "1" ? { blankMark: (await getTranslations({ locale, namespace: "Admin" }))("bibs.spareMark") } : {}),
      eventTitle: event.title,
      eventDate,
      // As the form holds it, not as the row does: the preview follows the unsaved select too.
      bandColour: url.searchParams.get("colour") || null,
      partners,
      replyTo,
      siteUrl: env.APP_BASE_URL,
      design: drawn,
      member,
      ...(member ? { memberLabelDefault: await memberLabelDefault() } : {}),
      // The pictures read here (§560): `next/og` cannot read the stored WebP, and their size makes
      // the unsaved crop exact — the same rule the sheet prints with.
      pictures: await imagePictures(drawn, member),
    });
    // The design is in the address, so a browser cache would be correct — but the event's
    // title and date are not, and a preview that lags a save is a preview of the wrong thing.
    image.headers.set("Cache-Control", "private, no-store");
    return image;
  }

  const [row] = await db
    .select({
      bibNumber: registrations.bibNumber,
      registeredName: registrations.registeredName,
      kind: registrations.kind,
      status: registrations.status,
      memberBibWanted: registrations.memberBibWanted,
      canonicalEmail: participants.canonicalEmail,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(and(eq(registrations.id, registrationId), eq(registrations.eventId, id)))
    .limit(1);
  // The sheet's own rule (`bibs.ts#bibScopeWhere`): a bib is drawn for a confirmed real
  // registration only, so a restarted row still wearing its retired number draws none (§548).
  if (!row || row.kind !== "REAL" || row.status !== "CONFIRMED" || raceNumberOf(row) === null || row.bibNumber === null) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  /*
    The bib this row prints (§664): the members' when the event offers it, the row asked, and its
    canonical address is a member account's (§662) — `bibs.ts#listBibs`'s rule, asked of one row. The
    member set is read only when the first two hold.
  */
  const member =
    event.design.member.enabled && row.memberBibWanted && (await memberCanonicalEmails(db)).has(row.canonicalEmail);
  const image = await renderBibImage({
    bibNumber: row.bibNumber,
    registeredName: row.registeredName,
    member,
    ...(member ? { memberLabelDefault: await memberLabelDefault() } : {}),
    eventTitle: event.title,
    eventDate,
    bandColour: event.bibColour,
    partners,
    replyTo,
    siteUrl: env.APP_BASE_URL,
    // The club's own design (§249), or the preview stops being a preview of the paper.
    design: event.design,
    pictures: await imagePictures(event.design, member),
  });
  /*
    A number and a name change rarely; the browser may keep the picture for an hour. Whether it is a
    member's bib changes when «Echipa» does, so the bibs page's grid puts the row's `member` flag in
    the address it asks (`m=1`, read by nobody here): a change in verification is a new address (§664).
  */
  image.headers.set("Cache-Control", "private, max-age=3600");
  return image;
}
