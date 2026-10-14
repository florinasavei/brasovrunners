import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { recordAuditEvent } from "@/modules/audit/repository";
import { pdfResponse } from "@/modules/registrations/declaration-labels";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { renderVolunteerAgreementPdf, VOLUNTEER_AGREEMENT_PDF_NAME } from "@/modules/volunteers/agreement-pdf";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * One volunteer's agreement as a PDF (§758), from the event's «Voluntari» card: the accepted copy — the version,
 * the blanks as accepted, the moment, the way, the fingerprint — or, for a person who has not accepted yet, the
 * copy to sign at the desk, filled for them with two signature lines. Rendered from the rows, never stored.
 *
 * Whoever reads the card may take it — `canManageVolunteers`, asserted here again (BR-REQ-060-01) — and the
 * volunteer must be this event's (NOT_FOUND otherwise, never another event's person through a forged address).
 * A file with a person's name leaves the site, so the download is audited as the declaration's is (§324): who and
 * when, never what it holds. A GET that mutates nothing else.
 *
 * `?for=guardian` (§NNN) is the desk's sheet for the parent or guardian of a volunteer under eighteen whose consent is
 * still to come: the text to sign, with the volunteer's line and the guardian's, even though the volunteer accepted their
 * own — read by «Acordul părintelui pe hârtie». For anybody else it is the same file as without it.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; volunteerId: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, volunteerId } = await context.params;
  if (!isUuid(id) || !isUuid(volunteerId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const db = getDb();
  const [volunteer] = await db
    .select({ id: eventVolunteers.id })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.id, volunteerId), eq(eventVolunteers.eventId, id)))
    .limit(1);
  if (!volunteer) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const rendered = await renderVolunteerAgreementPdf(db, volunteer.id, now, { sheet: new URL(request.url).searchParams.get("for") === "guardian" });
  // Not accepted and no agreement in force: there is no text to print.
  if (!rendered) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "volunteer.agreement_downloaded",
    entityType: "event",
    entityId: id,
    metadata: { volunteerId: volunteer.id, accepted: rendered.accepted },
    now,
  });
  return pdfResponse(rendered.pdf, VOLUNTEER_AGREEMENT_PDF_NAME);
}
