import { and, eq } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { getFormatter } from "next-intl/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { registrations } from "@/db/schema/registrations";
import { routing } from "@/i18n/routing";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { findEventForBibs } from "@/modules/registrations/bibs";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * One participant's bib as a PNG, for the preview grid on the event page (`DECISIONS.md`
 * §94). `GET /api/admin/events/<id>/bibs/preview?registration=<id>&locale=ro`. Administrator
 * only, like the sheet: a bib carries a name. A GET that reads and writes nothing.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageRegistrations(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

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
  });
  image.headers.set("Cache-Control", "private, no-store");
  return image;
}
