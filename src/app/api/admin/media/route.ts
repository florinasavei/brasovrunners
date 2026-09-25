import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { MAX_UPLOAD_BYTES } from "@/modules/media/images";
import { parseImageQuality } from "@/modules/media/ladder";
import { listMediaAssetsForAdmin } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { isStorageConfigured } from "@/modules/media/storage";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * A picture is up to nine WebP encodes now (§414): 3–10 seconds for a phone photograph on a
 * shared machine, measured, and a serverless function's default ceiling is not something to find
 * out about from the owner. Sixty seconds is within every Vercel plan's limit.
 */
export const maxDuration = 60;

/**
 * A picture for a body, from the rich-text editor (BR-REQ-050-03 criterion 8). `POST`
 * multipart with a `file`; answers the address the image node carries. Every staff session:
 * a Contributor writes drafts and a draft may have pictures — what they may *publish* is the
 * page's rule, not this route's. The bytes are checked by `processUploadedImage` whatever the
 * client claimed, and nothing is written anywhere until they pass. The answer carries `stored`,
 * the facts the editor shows under its toolbar (§414).
 */
export async function POST(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_UNCONFIGURED" }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "VALIDATION_ERROR", detail: "too large" }, { status: 413 });
  }
  const originalFilename = String(form.get("originalFilename") || file.name || "picture");
  // The choice beside the upload (§414), checked here: absent is "normal", anything but the two
  // words is refused rather than guessed at.
  const quality = parseImageQuality(form.get("quality"));
  if (!quality) return NextResponse.json({ error: "VALIDATION_ERROR", detail: "quality" }, { status: 400 });

  try {
    const result = await uploadBodyImage(getDb(), {
      actorId: actor.id,
      file: Buffer.from(await file.arrayBuffer()),
      originalFilename,
      quality,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.code, detail: error.message }, { status: 400 });
    }
    throw error;
  }
}

/**
 * The pictures already stored, newest first, for the editor's "choose one already uploaded"
 * (`DECISIONS.md` §73): the two variant addresses and the size the image node needs, and
 * nothing about where a picture is used — that is the pictures page's question. Every staff
 * session, like the upload above.
 */
export async function GET(): Promise<Response> {
  try {
    await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!isStorageConfigured()) return NextResponse.json({ assets: [] });

  const assets = await listMediaAssetsForAdmin(getDb(), "ro");
  return NextResponse.json({
    assets: assets.slice(0, 300).map((asset) => ({
      id: asset.id,
      src: asset.webUrl,
      thumb: asset.thumbUrl,
      width: asset.width,
      height: asset.height,
      name: asset.originalFilename,
    })),
  });
}
