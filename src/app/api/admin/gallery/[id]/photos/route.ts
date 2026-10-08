import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { addPhoto, addStoredPhoto, replacePhoto } from "@/modules/content/gallery/service";
import { MAX_UPLOAD_BYTES } from "@/modules/media/images";
import { parseImageQuality } from "@/modules/media/ladder";
import { isStorageConfigured } from "@/modules/media/storage";
import { isEditorial } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * Up to ten WebP encodes per photo, plus the two probe encodes of «Mare» and «Originală» (§414,
 * §437, §495); the same ceiling as `/api/admin/media`, where the worst case is counted.
 */
export const maxDuration = 60;

/**
 * One photo into an album (BR-REQ-054-01). `POST` multipart with a `file`; the uploader sends
 * one request per photo. Or with an `assetId` instead: a picture already stored, chosen from the
 * gallery (§485), added as it is. Or with a `file` and a `replaceItemId`: «Înlocuiește» (§NNN), the
 * new photo in that photo's place — here rather than in a Server Action because an action's body
 * stops at 1 MB and the browser sends up to 4 (`BROWSER_SEND_BYTES`); the limits and quality of an
 * upload, the roles of a delete. Editorial roles only. The bytes are checked by
 * `processUploadedImage` whatever the client claimed, and nothing is written anywhere until they pass.
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
  if (!isEditorial(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_UNCONFIGURED" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const form = await request.formData();

  // A picture the club already stored (§485, «Din galerie»): its id, no file, nothing encoded.
  const assetId = form.get("assetId");
  if (typeof assetId === "string" && assetId !== "") {
    if (!isUuid(assetId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    try {
      const result = await addStoredPhoto(getDb(), { actor, albumId: id, assetId });
      return NextResponse.json(result, { status: result.added ? 201 : 200 });
    } catch (error) {
      if (isDomainError(error)) {
        const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 400;
        return NextResponse.json({ error: error.code, detail: error.message }, { status });
      }
      throw error;
    }
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "VALIDATION_ERROR", detail: "too large" }, { status: 413 });
  }
  const originalFilename = String(form.get("originalFilename") || file.name || "photo");
  // The choice beside the upload (§414): absent is "normal", anything else must be one of the two.
  const quality = parseImageQuality(form.get("quality"));
  if (!quality) return NextResponse.json({ error: "VALIDATION_ERROR", detail: "quality" }, { status: 400 });

  // «Înlocuiește» (§NNN): the photo whose place the new one takes, in this album.
  const replaceItemId = form.get("replaceItemId");
  if (typeof replaceItemId === "string" && replaceItemId !== "") {
    if (!isUuid(replaceItemId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    try {
      const result = await replacePhoto(getDb(), {
        actor,
        albumId: id,
        itemId: replaceItemId,
        file: Buffer.from(await file.arrayBuffer()),
        originalFilename,
        quality,
      });
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      if (isDomainError(error)) {
        const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400;
        return NextResponse.json({ error: error.code, detail: error.message }, { status });
      }
      throw error;
    }
  }

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
