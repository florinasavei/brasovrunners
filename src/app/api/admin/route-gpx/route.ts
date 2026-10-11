import { NextResponse } from "next/server";
import { GpxRefusedError, storeRouteGpx } from "@/modules/content/events/route-gpx";
import { MAX_GPX_BYTES } from "@/modules/events/domain/route-gpx";
import { getStorage, isStorageConfigured } from "@/modules/media/storage";
import { canEditEventFields } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The GPX of «Traseul» (§NNN), from the event editor: `POST` multipart with a `file`; answers the
 * value the editor puts in its hidden input (`event.routeGpx`), which the event's save stores.
 *
 * Only whoever may change the event's settings (`canEditEventFields`, the route field's own rule):
 * asked here, on the server, whatever the editor showed. The bytes are checked for what they are —
 * an XML document whose root is `<gpx>`, at most four megabytes (`checkGpx`) — never by the file's
 * extension or the type the browser claimed, and nothing is written until they pass.
 */
export async function POST(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canEditEventFields(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!isStorageConfigured()) return NextResponse.json({ error: "STORAGE_UNCONFIGURED" }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "VALIDATION_ERROR", detail: "empty" }, { status: 400 });
  if (file.size > MAX_GPX_BYTES) return NextResponse.json({ error: "VALIDATION_ERROR", detail: "tooLarge" }, { status: 413 });

  try {
    const gpx = await storeRouteGpx(getStorage(), {
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name || "traseu.gpx",
      environment: env.APP_ENV,
      now: new Date(),
    });
    return NextResponse.json(gpx, { status: 201 });
  } catch (error) {
    if (error instanceof GpxRefusedError) {
      return NextResponse.json({ error: "VALIDATION_ERROR", detail: error.reason }, { status: error.reason === "tooLarge" ? 413 : 400 });
    }
    throw error;
  }
}
