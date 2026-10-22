import { contentDisposition } from "@/shared/http/content-disposition";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { listEventsWithVolunteers } from "@/modules/volunteers/admin-list";
import { volunteerExport, volunteerExportHeader, volunteerSheetWords } from "@/modules/volunteers/export";
import { buildVolunteersWorkbook, type VolunteerSheetEvent, volunteersWorkbookFileName } from "@/modules/volunteers/workbook";
import { exportVolunteers } from "@/modules/volunteers/volunteers";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * «Descarcă Excel: toate evenimentele» on the «Voluntari» screen (§846; the owner, 2026-10-22: «La voluntari vreau să descarc
 * și excel formatat frumos, nu doar CSV»): every event the screen's select offers — the ones that take volunteers or have
 * any, in the select's order — in one workbook, «Eveniment» before every row and every role, each event's people and roles
 * built exactly as its own download builds them (`modules/volunteers/export.ts`). A spreadsheet only: the CSV is one event's,
 * and a column added to it would move what reads it (§761).
 *
 * The card's gate, asserted here (BR-REQ-060-01): `canManageVolunteers`. Each event is read through `exportVolunteers`, so each
 * leaves the same audit row its own download leaves — who, which event, how many rows (§322) — and nothing else is written.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const lang = new URL(request.url).searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const now = new Date();
  const db = getDb();
  const t = await getTranslations({ locale, namespace: "Admin" });

  // The event's day in the sheet's own date format (`STAMP_FORMAT`'s day, in both languages): a column, not a sentence —
  // the club's wall clock read as digits, as the sheet's other dates are (`onClubClock`), never a formatter of its own.
  const eventDay = (at: Date) => toWallTimeInput(at, CLUB_TIME_ZONE).slice(0, 10).split("-").reverse().join(".");
  const sheetEvents: VolunteerSheetEvent[] = [];
  for (const event of await listEventsWithVolunteers(db, locale)) {
    const data = await exportVolunteers(db, actor, event.id, now);
    // «Crosul Brașovului · 21.11.2026»: the title as the select shows it, and the day, so two editions are told apart.
    const day = event.startsAt ? eventDay(event.startsAt) : null;
    const label = [event.title ?? event.id, day].filter(Boolean).join(" · ");
    sheetEvents.push({ label, ...volunteerExport(data, locale, t) });
  }

  const workbook = await buildVolunteersWorkbook(volunteerExportHeader(t), sheetEvents, volunteerSheetWords(t));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition("attachment", volunteersWorkbookFileName(day, true), "volunteers"),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
