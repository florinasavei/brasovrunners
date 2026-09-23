import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { type RegistrationStatus, registrationStatus } from "@/db/schema/registrations";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { recordAuditEvent } from "@/modules/audit/repository";
import { buildRegistrationsWorkbook, type RegistrationSheetRow } from "@/modules/registrations/workbook";
import {
  listEventsWithRegistrations,
  listRegistrationsForAdmin,
  listWorkbookDetails,
  type WorkbookDetails,
} from "@/modules/registrations/admin-repository";
import { ageOnRaceDay } from "@/modules/registrations/domain/age";
import { defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";
import { identityDocumentsOf } from "@/modules/registrations/domain/identity-documents";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

function isRegistrationStatus(value: string | null): value is RegistrationStatus {
  return !!value && (registrationStatus.enumValues as readonly string[]).includes(value);
}

/** The spreadsheet's own columns for one row (§322), blank when the row has none. */
function workbookExtras(details: WorkbookDetails | undefined): Pick<RegistrationSheetRow, "sex" | "ageOnRaceDay" | "nationality" | "city" | "tshirtSize"> {
  if (!details) return {};
  return {
    sex: details.sex,
    ageOnRaceDay: ageOnRaceDay(details.birthDate, details.eventStartsAt, details.eventTimezone),
    nationality: details.nationality,
    city: details.city,
    tshirtSize: details.tshirtSize,
  };
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
 * CSV export (AGENTS.md §15.10, BR-REQ-060-01: whoever may read the registrations — the
 * Organizer since §289, who reads the list and changes nothing on it).
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
  if (!canReadRegistrations(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const status = url.searchParams.get("status");
  const clubMember = url.searchParams.get("clubMember");
  const emailBounced = url.searchParams.get("bounced");
  const search = url.searchParams.get("q");

  /*
    The event scope, by the rule the screen uses (§178, §312) rather than the raw parameter.

    The list's button names the scope it resolved, so this normally just reads it back — but
    `all` is a word, not an event id, and handed to the query as one it compared a uuid column
    with "all" and failed, so "Toate evenimentele" had no file. And a link typed or bookmarked
    without an event means here what it means on the screen: the featured event, or every
    event while a name is searched.
  */
  const db = getDb();
  const scope = defaultEventFilter(eventId ?? undefined, await listEventsWithRegistrations(db), search ?? undefined);

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
  const rows = await listRegistrationsForAdmin(db, {
    eventId: scope.eventId,
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
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  /*
    The export is recorded (§322): who took a file of the club's participants, of which event, in
    which format and how many rows — never a row. A file that leaves the application is the one
    copy the erase cannot reach, so the trail has to be able to say that it was made and when;
    the erase checklist then tells the Administrator to delete it by hand.
  */
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "registration.exported",
    entityType: "event",
    entityId: scope.eventId ?? null,
    metadata: { eventId: scope.eventId ?? null, format, rowCount: rows.length },
    now: new Date(),
  });

  if (format === "xlsx") {
    // Named after the event only when the file is about one: a search across every event is
    // not the start list of whichever race its first row happens to belong to.
    const eventTitle = scope.eventId ? (rows.find((row) => row.eventTitle)?.eventTitle ?? null) : null;
    // Sex, age, origin and t-shirt, for the sheet only (§322) — one query for the exported rows.
    const details = await listWorkbookDetails(db, rows.map((row) => row.id));
    const workbook = await buildRegistrationsWorkbook(
      rows.map((row) => ({
        ...workbookExtras(details.get(row.id)),
        id: row.id,
        eventTitle: row.eventTitle ?? row.eventId,
        registeredName: row.registeredName,
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        idDocument: identityDocumentsOf(row).participant ?? "",
        email: row.participantEmail,
        status: row.status,
        clubName: row.clubName ?? "",
        clubMemberDeclared: row.clubMemberDeclared,
        fitnessDeclaredAt: row.fitnessDeclaredAt,
        stravaUrl: row.stravaUrl ?? "",
        guardianName: row.guardianName ?? "",
        guardianIdDocument: identityDocumentsOf(row).guardian ?? "",
        instagramHandle: row.instagramHandle ?? "",
        submittedAt: row.submittedAt,
        confirmedAt: row.confirmedAt,
        bibNumber: row.bibNumber,
        provisionalBibNumber: row.provisionalBibNumber,
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
      // Whose document is whose (§NNN): the participant's own in its column, the parent's beside
      // the parent's name — never the parent's document under a minor's name, as one column did.
      idDocument: identityDocumentsOf(row).participant ?? "",
      email: row.participantEmail,
      status: row.status,
      clubMemberDeclared: row.clubMemberDeclared,
      fitnessDeclaredAt: row.fitnessDeclaredAt?.toISOString() ?? null,
      stravaUrl: row.stravaUrl ?? "",
      guardianName: row.guardianName ?? "",
      guardianIdDocument: identityDocumentsOf(row).guardian ?? "",
      instagramHandle: row.instagramHandle ?? "",
      submittedAt: row.submittedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? "",
      bibNumber: row.bibNumber,
      provisionalBibNumber: row.provisionalBibNumber,
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
