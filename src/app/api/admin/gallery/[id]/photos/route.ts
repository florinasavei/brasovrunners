import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { addPhoto } from "@/modules/content/gallery/service";
import { MAX_UPLOAD_BYTES } from "@/modules/media/images";
import { parseImageQuality } from "@/modules/media/ladder";
import { isStorageConfigured } from "@/modules/media/storage";
import { canEditEventFields } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/** Up to nine WebP encodes per photo (§NNN); the same ceiling as `/api/admin/media`. */
export const maxDuration = 60;

/**
 * One photo into an album (BR-REQ-054-01). `POST` multipart with a `file`; the uploader sends
 * one request per photo. Editorial roles only. The bytes are checked by `processUploadedImage`
 * whatever the client claimed, and nothing is written anywhere until they pass.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canEditEventFields(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_UNCONFIGURED" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "VALIDATION_ERROR", detail: "too large" }, { status: 413 });
  }
  const originalFilename = String(form.get("originalFilename") || file.name || "photo");
  // The choice beside the upload (§NNN): absent is "normal", anything else must be one of the two.
  const quality = parseImageQuality(form.get("quality"));
  if (!quality) return NextResponse.json({ error: "VALIDATION_ERROR", detail: "quality" }, { status: 400 });

  try {
    const result = await addPhoto(getDb(), {
      actor,
      albumId: id,
      file: Buffer.from(await file.arrayBuffer()),
      originalFilename,
      quality,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (isDomainError(error)) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 400;
      return NextResponse.json({ error: error.code, detail: error.message }, { status });
    }
    throw error;
  }
}
