import { and, eq } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { getFormatter } from "next-intl/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { registrations } from "@/db/schema/registrations";
import { routing } from "@/i18n/routing";
import { bibDesignFromQuery } from "@/modules/registrations/bib-design";
import { bibNumberFromQuery } from "@/modules/registrations/bib-design-query";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { findEventForBibs } from "@/modules/registrations/bibs";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

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
 * `colour=` is the band's colour as the form's select holds it, empty for the club's. The
 * design parameters are read in sample mode only; with a registration named, the stored design
 * is what is drawn, because that is what will print.
 *
 * No participant data leaves here in sample mode — a placeholder name and a number the club
 * chose — so the gate is the one every staff role already passes for a real bib. The same
 * renderer as the paper, never a second drawing (§180): the preview is a preview of the print.
 */
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
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  const sample = url.searchParams.get("sample") === "1";
  const registrationId = url.searchParams.get("registration") ?? "";
  if (!hasLocale(routing.locales, locale) || (!sample && !/^[0-9a-f-]{36}$/i.test(registrationId))) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventForBibs(db, id, locale);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const format = await getFormatter({ locale });
  const eventDate = format.dateTime(event.startsAt, { timeZone: event.timezone, dateStyle: "long" });
  // The same three the sheet prints (§180), so either picture is a picture of the paper.
  const partners = event.coHosts.map((host) => host.name);

  if (sample) {
    const image = await renderBibImage({
      bibNumber: bibNumberFromQuery(url.searchParams.get("number")) ?? event.bibStartNumber,
      registeredName: SAMPLE_NAME,
      eventTitle: event.title,
      eventDate,
      // As the form holds it, not as the row does: the preview follows the unsaved select too.
      bandColour: url.searchParams.get("colour") || null,
      partners,
      replyTo: env.EMAIL_REPLY_TO,
      design: bibDesignFromQuery(url.searchParams),
    });
    // The design is in the address, so a browser cache would be correct — but the event's
    // title and date are not, and a preview that lags a save is a preview of the wrong thing.
    image.headers.set("Cache-Control", "private, no-store");
    return image;
  }

  const [row] = await db
    .select({ bibNumber: registrations.bibNumber, registeredName: registrations.registeredName, kind: registrations.kind })
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.eventId, id)))
    .limit(1);
  if (!row || row.bibNumber === null || row.kind !== "REAL") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const image = await renderBibImage({
    bibNumber: row.bibNumber,
    registeredName: row.registeredName,
    eventTitle: event.title,
    eventDate,
    bandColour: event.bibColour,
    partners,
    replyTo: env.EMAIL_REPLY_TO,
    // The club's own design (§249), or the preview stops being a preview of the paper.
    design: event.design,
  });
  // A number and a name change rarely; the browser may keep the picture for an hour.
  image.headers.set("Cache-Control", "private, max-age=3600");
  return image;
}
