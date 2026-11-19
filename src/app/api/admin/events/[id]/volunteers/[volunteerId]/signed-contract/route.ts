import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { SIGNED_CONTRACT_MAX_BYTES } from "@/db/schema/event-volunteer-documents";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { downloadNameOf, SIGNED_CONTRACT_ANCHOR, SIGNED_CONTRACT_FORMATS } from "@/modules/volunteers/domain/signed-contract";
import {
  attachSignedContract,
  continueSignedContractUpload,
  type SignedContractPartOutcome,
  startSignedContractUpload,
  takeSignedContractFile,
} from "@/modules/volunteers/signed-contract";
import { DomainError, type DomainErrorCode, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { contentDisposition } from "@/shared/http/content-disposition";
import { isUuid } from "@/shared/ids";

/**
 * «Contract semnat» for one volunteer (§NNN): `GET` downloads the signed copy, `POST` attaches one (or the next piece of a large one).
 *
 * **Whoever works the volunteers** (`canManageVolunteers`: the Organizer and the Administrators), asserted here and again by the
 * service (BR-REQ-060-01): a request with no session is 401, any other role 403, and a volunteer of another event, a malformed or an
 * unknown id 404 — never a person of another event through a forged address. A refusal writes nothing.
 *
 * **The download** is never a public address: the file is read from the database (never the media bucket, whose reads are
 * public), sent as an attachment under the name it was uploaded with, made safe (`content-disposition.ts`, the format's extension
 * added when the name does not say it, `downloadNameOf`), typed by its format and never sniffed (`nosniff`), and kept by no cache
 * (`private, no-store`). Each download writes one trail row: the volunteer's id, the length and the format — never the name.
 *
 * **The upload** is multipart, parsed by the platform's own `Request.formData()`. With scripts off the volunteer's card posts its
 * one file and comes back to the person's page (303, the toast in the flash cookie, a refusal's code in the address). With
 * scripts the card's island asks `answer=json` and reads the answer; a file larger than one request carries goes in pieces of
 * at most 4 MB (`size`, `offset`, `upload`), each appended in order and the whole checked by its bytes when the last arrives.
 */

type Context = { params: Promise<{ id: string; volunteerId: string }> };

/** The most a request here may carry: one file at the limit, and the multipart envelope around it. */
const REQUEST_MAX_BYTES = SIGNED_CONTRACT_MAX_BYTES + 256 * 1024;

/** How each refusal answers a script. */
function statusOf(code: DomainErrorCode): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "VOLUNTEER_CONTRACT_TOO_LARGE") return 413;
  if (code === "VOLUNTEER_CONTRACT_TYPE") return 415;
  if (code === "VOLUNTEER_CONTRACT_UPLOAD_GONE") return 409;
  return 400;
}

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

async function staffOrRefusal(): Promise<{ actor: Awaited<ReturnType<typeof requireStaff>> } | { refusal: Response }> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return { refusal: NextResponse.json({ error: error.code }, { status: 401, headers: NO_STORE }) };
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return { refusal: NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  return { actor };
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const staff = await staffOrRefusal();
  if ("refusal" in staff) return staff.refusal;
  const { id, volunteerId } = await context.params;
  if (!isUuid(id) || !isUuid(volunteerId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  const file = await takeSignedContractFile(getDb(), staff.actor, { eventId: id, volunteerId }, new Date());
  if (!file) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  // Sent a megabyte at a time rather than as one body, so a ten-megabyte scan is never held twice on its way out.
  const bytes = file.bytes;
  const slice = 1024 * 1024;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, Math.min(slice, bytes.length - offset)));
      offset += slice;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": SIGNED_CONTRACT_FORMATS[file.format].contentType,
      "Content-Disposition": contentDisposition("attachment", downloadNameOf(file.fileName, file.format), "contract"),
      "Content-Length": String(file.size),
      "X-Content-Type-Options": "nosniff",
      ...NO_STORE,
    },
  });
}

/** The page's language as the form posted it; the default otherwise. */
function localeOf(form: FormData | null): Locale {
  const raw = form?.get("locale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/** A whole number a form field holds, or NaN. */
function numberOf(form: FormData, name: string): number {
  const raw = form.get(name);
  return typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const staff = await staffOrRefusal();
  if ("refusal" in staff) return staff.refusal;
  const { id, volunteerId } = await context.params;
  if (!isUuid(id) || !isUuid(volunteerId)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  // A body past one file at the limit is refused before it is read.
  if (Number(request.headers.get("content-length") ?? 0) > REQUEST_MAX_BYTES) return NextResponse.json({ error: "VOLUNTEER_CONTRACT_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const form = await request.formData().catch(() => null);
  const script = form?.get("answer") === "json";
  const locale = localeOf(form);
  const db = getDb();
  const now = new Date();

  /** Back to the person's page, with scripts off: the toast in the flash cookie, a refusal's code in the address. */
  const backToPerson = async (outcome: { saved?: string; error?: string }): Promise<Response> => {
    const path = getPathname({ locale, href: { pathname: "/admin/volunteers/[id]", params: { id: volunteerId } } });
    if (outcome.saved) await flashOutcome({ saved: outcome.saved });
    // A path alone, no host: the browser resolves it against the address it asked.
    const location = outcome.error ? `${path}?volunteerError=${encodeURIComponent(outcome.error)}` : `${path}#${SIGNED_CONTRACT_ANCHOR}`;
    return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
  };

  try {
    const file = form?.get("file");
    // A form with no file — scripts off and nothing chosen — is the empty file's refusal.
    if (!form || !(file instanceof File)) throw new DomainError("VOLUNTEER_CONTRACT_EMPTY", "no file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let outcome: SignedContractPartOutcome;
    if (form.has("size")) {
      // One piece of a file sent in pieces: the first starts the upload, the next ones continue it in order.
      const size = numberOf(form, "size");
      const offset = numberOf(form, "offset");
      const name = form.get("name");
      const upload = form.get("upload");
      outcome =
        offset === 0
          ? await startSignedContractUpload(db, staff.actor, { eventId: id, volunteerId, fileName: typeof name === "string" ? name : file.name, size, part: bytes }, now)
          : await continueSignedContractUpload(db, staff.actor, { eventId: id, volunteerId, uploadId: typeof upload === "string" ? upload : "", offset, part: bytes }, now);
    } else {
      outcome = { done: true, ...(await attachSignedContract(db, staff.actor, { eventId: id, volunteerId, fileName: file.name, bytes }, now)) };
    }
    if (script) return NextResponse.json(outcome, { status: outcome.done ? 201 : 202, headers: NO_STORE });
    return backToPerson({ saved: outcome.done && outcome.replaced ? "volunteerContractReplaced" : "volunteerContractUploaded" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    if (script) return NextResponse.json({ error: error.code }, { status: statusOf(error.code), headers: NO_STORE });
    return backToPerson({ error: error.code });
  }
}
