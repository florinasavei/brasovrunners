import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { type RegistrationStatus, registrationStatus } from "@/db/schema/registrations";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { buildRegistrationsWorkbook } from "@/modules/registrations/workbook";
import { listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

function isRegistrationStatus(value: string | null): value is RegistrationStatus {
  return !!value && (registrationStatus.enumValues as readonly string[]).includes(value);
}

/**
 * What the downloaded file is called (§172).
 *
 * The event's own title, reduced to what every filesystem accepts — diacritics kept, because
 * Windows, macOS and Linux all take them and "Crosul Tâmpei" is what the club calls it — with
 * the date appended so two exports of the same race a week apart are two files. Falls back to
 * the plain name when nothing was filtered for.
 */
function fileNameFor(eventTitle: string | null): string {
  const day = new Date().toISOString().slice(0, 10);
  const stem = (eventTitle ?? "inscrieri")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${stem || "inscrieri"} ${day}`;
}

/**
 * CSV export (AGENTS.md §15.10, BR-REQ-060-01: Administrator only).
 *
 * No file is written on the server — the response body is the file — and nothing about the
 * export is logged beyond the fact that it happened (`§15.10`: "no public storage/log body").
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageRegistrations(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const status = url.searchParams.get("status");
  const clubMember = url.searchParams.get("clubMember");
  const emailBounced = url.searchParams.get("bounced");
  const search = url.searchParams.get("q");

  /**
   * `TEST` rows are omitted, not labelled (`DECISIONS.md` §30). The export is the club's own
   * count of who is coming: it leaves this application, is sorted and filtered in a spreadsheet,
   * and is read at a start line by somebody who never saw the backoffice. A column that says
   * "test" is one filter away from being gone; a row that is not there cannot be miscounted.
   *
   * Every filter the list screen applies is applied here too, and paging deliberately is not.
   * The button that reaches this route sits above a filtered list, so a file that ignored the
   * search box would silently disagree with the rows the organizer was looking at when they
   * pressed it — and one that honoured the page would export whichever 25 rows were on screen.
   * Filters narrow what the file is *about*; a page is only how much of it fits.
   */
  const rows = await listRegistrationsForAdmin(getDb(), {
    eventId: eventId || undefined,
    status: isRegistrationStatus(status) ? status : undefined,
    clubMemberDeclared: clubMember === "1" || undefined,
    emailBounced: emailBounced === "1" || undefined,
    search: search || undefined,
    excludeTest: true,
  });

  /**
   * The spreadsheet, or the comma-separated file (§172; the owner: "CSV is stupid! I want
   * excel!"). `format=xlsx` is what the button asks for now; the CSV stays behind the same
   * route because it is what a script reads and what nothing can misinterpret.
   *
   * The filename carries the event when one was filtered for — "export just for a particular
   * race" was already what the filter did, and the file it produced was called
   * `registrations.csv` whichever race it was about, which is how three of them end up in a
   * downloads folder telling you nothing.
   */
  if (url.searchParams.get("format") === "xlsx") {
    const eventTitle = rows.find((row) => row.eventTitle)?.eventTitle ?? null;
    const workbook = await buildRegistrationsWorkbook(
      rows.map((row) => ({
        id: row.id,
        eventTitle: row.eventTitle ?? row.eventId,
        registeredName: row.registeredName,
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        idDocument: row.idDocument ?? "",
        email: row.participantEmail,
        status: row.status,
        clubName: row.clubName ?? "",
        clubMemberDeclared: row.clubMemberDeclared,
        fitnessDeclaredAt: row.fitnessDeclaredAt,
        stravaUrl: row.stravaUrl ?? "",
        guardianName: row.guardianName ?? "",
        instagramHandle: row.instagramHandle ?? "",
        submittedAt: row.submittedAt,
        confirmedAt: row.confirmedAt,
        bibNumber: row.bibNumber,
        checkedInAt: row.checkedInAt,
        emailBounced: row.emailRejectedReason !== null,
      })),
      eventTitle ?? "Participants",
    );

    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileNameFor(eventTitle)}.xlsx"`,
        "X-Robots-Tag": "noindex",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const csv = buildRegistrationsCsv(
    rows.map((row) => ({
      eventTitle: row.eventTitle ?? row.eventId,
      registeredName: row.registeredName,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      idDocument: row.idDocument ?? "",
      email: row.participantEmail,
      status: row.status,
      clubMemberDeclared: row.clubMemberDeclared,
      fitnessDeclaredAt: row.fitnessDeclaredAt?.toISOString() ?? null,
      stravaUrl: row.stravaUrl ?? "",
      guardianName: row.guardianName ?? "",
      instagramHandle: row.instagramHandle ?? "",
      submittedAt: row.submittedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? "",
      bibNumber: row.bibNumber,
      checkedInAt: row.checkedInAt?.toISOString() ?? "",
      emailBounced: row.emailRejectedReason !== null,
    })),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrations.csv"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
