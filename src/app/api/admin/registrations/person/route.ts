import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { exportPersonData, openPersonLookup } from "@/modules/registrations/person-data";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * "Descarcă JSON" (§322): everything held about one person, as a file — the copy an access
 * request (art. 15 GDPR) is answered with.
 *
 * Administrator only, as the page. The lookup arrives sealed (`?q=`, `person-data.ts`) and is
 * refused once it is older than half an hour; the address itself is never in this URL. The
 * export is recorded (`participant.data_exported`, counts only) before the file is returned,
 * and nothing is kept on the server: the response body is the file.
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

  const now = new Date();
  const sealed = new URL(request.url).searchParams.get("q") ?? "";
  const canonicalEmail = openPersonLookup(sealed, now);
  if (!canonicalEmail) return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 400 });

  const data = await exportPersonData(getDb(), actor, canonicalEmail, now);
  const day = now.toISOString().slice(0, 10);
  // Named by the participant's id, never the address: a downloads folder is a list of filenames.
  const stem = data.participant?.id ?? "no-participant";

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="participant-${stem}-${day}.json"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
