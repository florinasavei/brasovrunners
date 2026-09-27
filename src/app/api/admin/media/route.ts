import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { MAX_UPLOAD_BYTES } from "@/modules/media/images";
import { parseImageQuality } from "@/modules/media/ladder";
import { parsePictureSource, PICKER_LIMIT, pictureUses, visiblePictures } from "@/modules/media/picker";
import { listMediaAssetsForAdmin } from "@/modules/media/references";
import { uploadBodyImage } from "@/modules/media/service";
import { isStorageConfigured } from "@/modules/media/storage";
import { canEditEventFields, canEditTexts } from "@/modules/staff-identity/domain/roles";
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
 * The pictures already stored, newest first, for every «Din galerie» in the backoffice
 * (`DECISIONS.md` §73, §NNN: a text, a film's poster, a card of «Echipa», an album): the two
 * variant addresses, the stored size and weight the picker writes under each thumbnail, and the
 * kinds of place a picture is used — the picker's «Folosită în» chips — never which page or who.
 *
 * Only the roles that may put a picture somewhere (BR-REQ-060-01): whoever writes an event's or
 * a page's words, or sets an event's fields and albums. A volunteer's backoffice is the desk, and
 * the club's stored pictures, with their file names, are not the desk's to read. The upload above
 * stays every staff session's; this list is what a picker needs, and a volunteer has none.
 *
 * `?q=` (a name, accents and case ignored) and `?source=` (`event`, `album`, `page`, `team`) narrow
 * the list here, before the cap, so an old picture is found by name however many came after it;
 * a film's automatic poster (`yt-<id>`, §403) is left out unless `?posters=1` — the film's own
 * poster picker asks for it, a text, a card and an album do not.
 */
export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canEditTexts(actor.role) && !canEditEventFields(actor.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (!isStorageConfigured()) return NextResponse.json({ assets: [] });

  const params = new URL(request.url).searchParams;
  const withPosters = params.get("posters") === "1";
  const assets = (await listMediaAssetsForAdmin(getDb(), "ro")).map((asset) => ({
    id: asset.id,
    src: asset.webUrl,
    thumb: asset.thumbUrl,
    width: asset.width,
    height: asset.height,
    bytes: asset.byteSize,
    name: asset.originalFilename,
    uses: pictureUses(asset.references.map((reference) => reference.kind)),
    // A body's picture must carry an uploaded picture's address (§72).
    poster: asset.keyPrefix.startsWith("yt-"),
  }));
  const shown = visiblePictures(assets, {
    accept: (asset) => withPosters || !asset.poster,
    needle: (params.get("q") ?? "").slice(0, 200),
    source: parsePictureSource(params.get("source")),
  });
  return NextResponse.json({ assets: shown.slice(0, PICKER_LIMIT) });
}
