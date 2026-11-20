import { NextResponse } from "next/server";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { contentDisposition } from "@/shared/http/content-disposition";

/**
 * The «PR Kit»'s door (§NNN), asked by every one of its routes on the server whatever the page drew (BR-REQ-060-01): a staff
 * session that works the desk (`canWorkTheDesk`) — every backoffice role, the volunteers included, never a club member. No
 * session is `UNAUTHENTICATED` (401); a role that may not, or a colleague who still owes the team's undertaking (§1006), is
 * `FORBIDDEN` (403). `null` lets the request through.
 */
export async function refusePrKit(): Promise<Response | null> {
  try {
    const actor = await requireStaff();
    return canWorkTheDesk(actor.role) ? null : NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: error.code === "FORBIDDEN" ? 403 : 401 });
    throw error;
  }
}

/**
 * A kit file handed out to be saved: always an attachment under its own name (`contentDisposition`, §779), never kept by a
 * cache shared or private — the drawn ones are made per request, and the kit's are read from the build.
 */
export function kitDownload(body: Buffer | string, contentType: string, fileName: string): Response {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition("attachment", fileName, "pr-kit"),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
