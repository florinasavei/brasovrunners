import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { recordAuditEvent } from "@/modules/audit/repository";
import { declarationWords, pdfResponse } from "@/modules/registrations/declaration-labels";
import { findRegistrationById } from "@/modules/registrations/repository";
import { findSignedDeclaration, renderSignedDeclarationPdf } from "@/modules/registrations/signed-declaration";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/** One registration's signed declaration, for the organizer (`DECISIONS.md` §95, §289). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canReadRegistrations(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const db = getDb();
  const registration = await findRegistrationById(db, id);
  const signed = registration ? await findSignedDeclaration(db, registration.id) : undefined;
  if (!registration || !signed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  // Whole, like the event's bundle: read by signed-in staff inside the platform, and only for as
  // long as the database keeps the identity document (§95, §320).
  const pdf = await renderSignedDeclarationPdf(db, signed, registration.eventId, await declarationWords(signed.locale, now), now, "participant");
  if (!pdf) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // A file with a name and an identity document in it, out of the erase's reach (§324): who
  // made it and when, on the registration's own timeline — never what it holds.
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: registration.participantId,
    action: "registration.declaration_downloaded",
    entityType: "registration",
    entityId: registration.id,
    metadata: { format: "pdf" },
    now,
  });
  return pdfResponse(pdf, `declaratie-${id.slice(0, 8)}.pdf`);
}
