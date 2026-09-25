import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { recordAuditEvent } from "@/modules/audit/repository";
import { renderGroupRunDeclarationPdf } from "@/modules/group-run-declarations/pdf";
import { findSignedGroupRunDeclaration } from "@/modules/group-run-declarations/repository";
import { pdfResponse } from "@/modules/registrations/declaration-labels";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * One group run's self-declaration as a PDF, for the backoffice (§NNN): whoever may read the
 * registrations (§289) — the Organizer, the Administrator — and nobody else, asserted here and not
 * by hiding the link (BR-REQ-060-01): the volunteer and the Tehnic role get 403. Whole, identity
 * document included, like the race's backoffice copy (§320): it is read by signed-in staff inside
 * the platform, and it is gone with the row seven days after the run. The download is written to
 * the trail — the event, never whose it was (§324).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; declarationId: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canReadRegistrations(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, declarationId } = await context.params;
  if (!isUuid(id) || !isUuid(declarationId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const db = getDb();
  const signed = await findSignedGroupRunDeclaration(db, declarationId);
  // Another event's declaration under this event's address is not found, not served.
  if (!signed || signed.eventId !== id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const pdf = await renderGroupRunDeclarationPdf(db, signed, "participant", now);
  if (!pdf) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "event.group_run_declaration_downloaded",
    entityType: "event",
    entityId: id,
    metadata: { format: "pdf" },
    now,
  });
  return pdfResponse(pdf, `declaratie-${declarationId.slice(0, 8)}.pdf`, "inline");
}
