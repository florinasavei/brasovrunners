import { contentDisposition } from "@/shared/http/content-disposition";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { buildVolunteersCsv, volunteersCsvFileName } from "@/modules/volunteers/csv";
import { volunteerExport, volunteerExportHeader, volunteerSheetWords } from "@/modules/volunteers/export";
import { buildVolunteersWorkbook, volunteersWorkbookFileName } from "@/modules/volunteers/workbook";
import { exportVolunteers } from "@/modules/volunteers/volunteers";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă CSV» on an event's «Voluntari» card (§754): the volunteers of one event, grouped by the role given,
 * with the roles each offered for (§761), in the reader's language (`lang`), as a UTF-8 file with a BOM — or, with
 * `format=xlsx` (§839; the owner: «export volunteers in excel as well»), the same rows as a spreadsheet («Descarcă Excel»,
 * on the card and on the «Voluntari» screen), laid out to be read and printed and with its roles on a sheet of their own
 * (§846, `modules/volunteers/workbook.ts`). The rows are built once, for both files and for the every-event download
 * (`modules/volunteers/export.ts`).
 *
 * Whoever reads the card may take it — `canManageVolunteers`, the card's own gate, asserted here again
 * (BR-REQ-060-01): the Tehnic role, a Redactor, a volunteer and a member are refused whatever the link.
 * Nothing is written on the server but one audit row: the download is recorded as the registrations'
 * export is (§322) — who, which event and how many rows, never a name or an address — because a file that
 * leaves the site is the one copy the retention sweep cannot reach. A GET that mutates nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const now = new Date();

  let data;
  try {
    data = await exportVolunteers(getDb(), actor, id, now);
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }

  const t = await getTranslations({ locale, namespace: "Admin" });
  const header = volunteerExportHeader(t);
  const { rows, roles } = volunteerExport(data, locale, t);

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (format === "xlsx") {
    // One event: no «Eveniment» column; the file named like the CSV's, by the club's date.
    const workbook = await buildVolunteersWorkbook(header, [{ label: "", rows, roles }], volunteerSheetWords(t));
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition("attachment", volunteersWorkbookFileName(day), "volunteers"),
        "X-Robots-Tag": "noindex",
        "Cache-Control": "private, no-store",
      },
    });
  }
  const csv = buildVolunteersCsv(header, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", volunteersCsvFileName(day), "volunteers"),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
