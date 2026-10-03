import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { type RegistrationStatus, registrationStatus } from "@/db/schema/registrations";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { cancelReasonCell } from "@/modules/registrations/domain/cancel-reason";
import { familyColumn, familyOf } from "@/modules/registrations/family-marker";
import { recordAuditEvent } from "@/modules/audit/repository";
import { buildRegistrationsWorkbook, workbookExtras } from "@/modules/registrations/workbook";
import {
  listEventsWithRegistrations,
  listLatestDeclarationAcceptances,
  listRegistrationsForAdmin,
  listWorkbookDetails,
} from "@/modules/registrations/admin-repository";
import { defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";
import { identityDocumentsOf } from "@/modules/registrations/domain/identity-documents";
import { rowDeadlineOf } from "@/modules/registrations/domain/row-deadline";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
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
  // «Doar cu oferte și beneficii» (§581): the list's filter, so the file is the rows on screen.
  const promo = url.searchParams.get("promo");
  // «În afara locurilor» (§643): the list's pill filters the rows on screen, so it filters the file too.
  const outside = url.searchParams.get("outside");

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
    promoConsented: promo === "1" || undefined,
    outsideCapacity: outside === "1" || undefined,
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
  // Which declaration each row signed, and when (§499): both formats, one query for the exported rows.
  const declarations = await listLatestDeclarationAcceptances(db, rows.map((row) => row.id));
  // The other people on each row's address (§543), the `family` column of both formats: one query.
  const family = await familyOf(db, rows);
  // The list's «Termen» (§NNN), one clock for the whole file: the moment each row waits on, or none.
  const deadlinesNow = new Date();
  const deadlineOf = (row: (typeof rows)[number]) => rowDeadlineOf(row, deadlinesNow)?.at ?? null;

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
        listSocials: row.listSocials,
        // The public-list tick (§581), beside the socials it governs.
        listPublic: !row.listOptOut,
        submittedAt: row.submittedAt,
        confirmedAt: row.confirmedAt,
        bibNumber: row.bibNumber,
        checkedInAt: row.checkedInAt,
        emailBounced: row.emailRejectedReason !== null,
        termsVersion: row.termsVersion,
        termsAcceptedAt: row.termsAcceptedAt,
        declarationVersion: declarations.get(row.id)?.version ?? null,
        declarationSignedAt: declarations.get(row.id)?.acceptedAt ?? null,
        family: familyColumn(family.get(row.id)),
        cancelReason: cancelReasonCell(row.cancelReasonKind, row.cancelReason),
        // The consent to offers and benefits (§562): its moment, blank for no.
        promoConsentAt: row.promoConsent ? row.promoConsentAt : null,
        outsideCapacity: row.outsideCapacity,
        deadline: deadlineOf(row),
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
      // Whose document is whose (§330): the participant's own in its column, the parent's beside
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
      // Whether the public list prints the socials (§500): beside Instagram, as on the spreadsheet.
      listSocials: row.listSocials,
      // The public-list tick (§581): «Vreau să apar pe lista de participanți & rezultate».
      listPublic: !row.listOptOut,
      submittedAt: row.submittedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? "",
      bibNumber: row.bibNumber,
      checkedInAt: row.checkedInAt?.toISOString() ?? "",
      emailBounced: row.emailRejectedReason !== null,
      // The terms accepted on the form (§421, §425): blank for a staff or desk entry.
      termsVersion: row.termsVersion,
      termsAcceptedAt: row.termsAcceptedAt?.toISOString() ?? "",
      // The declaration signed (§499): blank while none is.
      declarationVersion: declarations.get(row.id)?.version ?? null,
      declarationSignedAt: declarations.get(row.id)?.acceptedAt.toISOString() ?? "",
      family: familyColumn(family.get(row.id)),
      // Why the participant cancelled (§558): blank for a staff cancellation and every live row.
      cancelReason: cancelReasonCell(row.cancelReasonKind, row.cancelReason),
      // «Oferte și beneficii» (§562): the moment of the yes, empty for no — last, like the family.
      promoConsentAt: row.promoConsent ? (row.promoConsentAt?.toISOString() ?? "") : "",
      outsideCapacity: row.outsideCapacity,
      // The list's «Termen» (§NNN): the moment the row waits on, empty when none — last, like the special guest.
      deadline: deadlineOf(row)?.toISOString() ?? "",
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
