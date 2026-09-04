import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { type RegistrationStatus, registrationStatus } from "@/db/schema/registrations";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

function isRegistrationStatus(value: string | null): value is RegistrationStatus {
  return !!value && (registrationStatus.enumValues as readonly string[]).includes(value);
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
  if (!canManageStaff(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const status = url.searchParams.get("status");

  /**
   * `TEST` rows are omitted, not labelled (`DECISIONS.md` §30). The export is the club's own
   * count of who is coming: it leaves this application, is sorted and filtered in a spreadsheet,
   * and is read at a start line by somebody who never saw the backoffice. A column that says
   * "test" is one filter away from being gone; a row that is not there cannot be miscounted.
   */
  const rows = await listRegistrationsForAdmin(getDb(), {
    eventId: eventId || undefined,
    status: isRegistrationStatus(status) ? status : undefined,
    excludeTest: true,
  });

  const csv = buildRegistrationsCsv(
    rows.map((row) => ({
      eventTitle: row.eventTitle ?? row.eventId,
      registeredName: row.registeredName,
      email: row.participantEmail,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? "",
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
