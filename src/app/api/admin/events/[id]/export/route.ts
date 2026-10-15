import { contentDisposition } from "@/shared/http/content-disposition";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { exportEvent } from "@/modules/content/events/transfer/export";
import { serializeEventFile } from "@/modules/content/events/transfer/file-format";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/** The export reads and hashes every picture the event names; the platform's ten seconds are not enough (the import page asks the same). */
export const maxDuration = 60;

/**
 * «Exportă evenimentul (JSON)» (§751): one event's configuration as a file — `<slug>-<day>.json` —
 * for the Administrator, asserted again here whatever the editor's button showed (BR-REQ-060-01) and
 * recorded in the trail (`event.exported`: who, which event, never a word of the file).
 *
 * The file is the response; nothing is written on the server. It holds no registration and no volunteer
 * (`transfer/file-format.ts` says what it holds), but it carries each volunteer category's contact person —
 * a third person's name, telephone and email, published by the club — and it is the club's whole page for the
 * event, so it is for staff alone, never cached and never indexed.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const { file, fileName } = await exportEvent(getDb(), { actor, eventId: id });
    return new NextResponse(serializeEventFile(file), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": contentDisposition("attachment", fileName, "event"),
        "X-Robots-Tag": "noindex",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
}
