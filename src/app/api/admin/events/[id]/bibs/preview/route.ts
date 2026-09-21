import { and, eq } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { getFormatter } from "next-intl/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { registrations } from "@/db/schema/registrations";
import { routing } from "@/i18n/routing";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { findEventForBibs } from "@/modules/registrations/bibs";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

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
  const registrationId = url.searchParams.get("registration") ?? "";
  if (!hasLocale(routing.locales, locale) || !/^[0-9a-f-]{36}$/i.test(registrationId)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventForBibs(db, id, locale);
  const [row] = await db
    .select({ bibNumber: registrations.bibNumber, registeredName: registrations.registeredName, kind: registrations.kind })
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.eventId, id)))
    .limit(1);
  if (!event || !row || row.bibNumber === null || row.kind !== "REAL") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const format = await getFormatter({ locale });
  const image = await renderBibImage({
    bibNumber: row.bibNumber,
    registeredName: row.registeredName,
    eventTitle: event.title,
    eventDate: format.dateTime(event.startsAt, { timeZone: event.timezone, dateStyle: "long" }),
    // The same three the sheet prints (§180), so the preview is a preview of the paper.
    bandColour: event.bibColour,
    partners: event.coHosts.map((host) => host.name),
    replyTo: env.EMAIL_REPLY_TO,
    // The club's own design (§249), or the preview stops being a preview of the paper.
    design: event.design,
  });
  // A number and a name change rarely; the browser may keep the picture for an hour.
  image.headers.set("Cache-Control", "private, max-age=3600");
  return image;
}
