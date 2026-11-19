import { and, asc, eq, exists, inArray, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { eventVolunteerDocuments, eventVolunteerDocumentUploads, SIGNED_CONTRACT_MAX_BYTES, type VolunteerDocumentFormat } from "@/db/schema/event-volunteer-documents";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { cleanFileName, type ContractFileMatch, type ContractNameRefusal, fallbackFileName, matchContractFiles, mayBeSignedContract, sniffSignedContract } from "./domain/signed-contract";

/**
 * «Contract semnat» (§998, amending §758; the owner, 2026-11-19: «trebuie pentru fiecare voluntar să pot atașa „contract
 * semnat”»): the signed copy of each volunteer's agreement — the club's Word file, a scan, a photograph of the paper — attached to
 * the volunteer's record, one per volunteer, and kept **in the database**, never in the media bucket, whose reads are public.
 *
 * **Who** — whoever works the volunteers (`canManageVolunteers`: the Organizer, the Administrator, the Superadministrator), asserted
 * in every function below, so the page's card, the list's chip and the routes' gates are courtesies and this is the rule
 * (BR-REQ-060-01). Everybody else gets `FORBIDDEN` and nothing written.
 *
 * **What is kept** — the bytes as they came, the name they came with (cleaned: `domain/signed-contract.ts#cleanFileName`), what
 * they are (read from the bytes, never the name: `sniffSignedContract`), the length, who attached them and when. At most
 * `SIGNED_CONTRACT_MAX_BYTES`. One per volunteer: attaching another replaces it in the same statement.
 *
 * **The trail** — `volunteer.signed_contract_uploaded`, `…_replaced`, `…_deleted` and `…_downloaded`, entity `event` as every
 * `volunteer.*` row: the volunteer's id, the file's length and format — **never the file's name**, which carries the person's, and
 * never a byte of it. A refusal writes nothing.
 *
 * **How long** — as long as the volunteer's row and not a moment longer: «Șterge voluntarul», the thirty-day sweep
 * (`jobs/retention.ts`, step `volunteers`) and an event's hard delete take it by the table's `ON DELETE CASCADE`, at the same moment.
 *
 * The only module that reads `event_volunteer_documents`; a file that reads it otherwise is a reviewed edit of
 * `tests/unit/volunteers/signed-contract-never-leaves.test.ts`.
 */

type Actor = Pick<StaffUser, "id" | "role">;

/** One signed copy as the volunteer's card draws it: the name, the format, the length, when and by whom — never the bytes. */
export type SignedContractFacts = {
  fileName: string;
  format: VolunteerDocumentFormat;
  size: number;
  uploadedAt: Date;
  /** The colleague's display name, as the card names a note's author; null once that account is gone. */
  uploadedByName: string | null;
};

/** The signed copy with its bytes: what the download sends. */
export type SignedContractFile = { fileName: string; format: VolunteerDocumentFormat; size: number; bytes: Buffer };

/** What an attach did: a first copy, or one in place of another. */
export type SignedContractStored = { replaced: boolean; format: VolunteerDocumentFormat; size: number };

/** The answer to one piece of a file sent in pieces: more to come, or the whole file attached. */
export type SignedContractPartOutcome = { done: false; uploadId: string; received: number } | ({ done: true } & SignedContractStored);

function assertMayKeep(actor: Pick<StaffUser, "role">): void {
  if (!canManageVolunteers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not keep a volunteer's signed agreement`);
  }
}

/** A forged form's malformed id is the refusal an unknown one gets, not a database error. */
function assertIds(...ids: readonly string[]): void {
  if (ids.some((id) => !isUuid(id))) throw new DomainError("NOT_FOUND", "the event or the volunteer is not there");
}

/** The length the page or a part declared: a whole number of bytes from one to the limit, or the refusal that says which end. */
function assertSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1) throw new DomainError("VOLUNTEER_CONTRACT_EMPTY", "the file is empty");
  if (size > SIGNED_CONTRACT_MAX_BYTES) throw new DomainError("VOLUNTEER_CONTRACT_TOO_LARGE", `the file is over ${SIGNED_CONTRACT_MAX_BYTES} bytes`);
}

/**
 * A whole file, checked before a byte is written (§998): not empty, at most `SIGNED_CONTRACT_MAX_BYTES`, and one of the formats by
 * its own bytes. Each refusal its own code, so the page and the upload's list say which.
 */
export function checkSignedContract(bytes: Uint8Array): VolunteerDocumentFormat {
  assertSize(bytes.length);
  const format = sniffSignedContract(bytes);
  if (!format) throw new DomainError("VOLUNTEER_CONTRACT_TYPE", "the file is not a PDF, a Word document or a photograph");
  return format;
}

/** The volunteer, of this event, locked for the write: two attaches of the same person never interleave. NOT_FOUND otherwise. */
async function lockVolunteer<T extends Record<string, unknown>>(tx: Database<T>, eventId: string, volunteerId: string): Promise<void> {
  const [row] = await tx
    .select({ id: eventVolunteers.id })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.id, volunteerId), eq(eventVolunteers.eventId, eventId)))
    .for("update")
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "the volunteer is not there");
}

/**
 * The copy written, inside a transaction holding the volunteer's lock, its bytes already checked: inserted, or in place of the one
 * there — every writer takes that lock first, so the two cannot cross, and `UNIQUE (volunteer_id)` is the last word —, a half-sent
 * upload of the same person dropped, and one trail row — the id, the length, the format, and for a replace the old length and
 * format. Never the name. The bytes travel to the database once.
 */
async function writeSignedContract<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Actor,
  file: { eventId: string; volunteerId: string; fileName: string; format: VolunteerDocumentFormat; bytes: Buffer },
  now: Date,
): Promise<SignedContractStored> {
  const [previous] = await tx
    .select({ size: eventVolunteerDocuments.size, format: eventVolunteerDocuments.format })
    .from(eventVolunteerDocuments)
    .where(eq(eventVolunteerDocuments.volunteerId, file.volunteerId))
    .limit(1);
  const fields = { fileName: file.fileName, format: file.format, size: file.bytes.length, bytes: file.bytes, uploadedByStaffUserId: actor.id, uploadedAt: now };
  if (previous) await tx.update(eventVolunteerDocuments).set(fields).where(eq(eventVolunteerDocuments.volunteerId, file.volunteerId));
  else await tx.insert(eventVolunteerDocuments).values({ volunteerId: file.volunteerId, ...fields });
  await tx.delete(eventVolunteerDocumentUploads).where(eq(eventVolunteerDocumentUploads.volunteerId, file.volunteerId));
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: previous ? "volunteer.signed_contract_replaced" : "volunteer.signed_contract_uploaded",
    entityType: "event",
    entityId: file.eventId,
    metadata: {
      volunteerId: file.volunteerId,
      size: file.bytes.length,
      format: file.format,
      ...(previous ? { previousSize: previous.size, previousFormat: previous.format } : {}),
    },
    now,
  });
  return { replaced: Boolean(previous), format: file.format, size: file.bytes.length };
}

/**
 * «Încarcă» / «Înlocuiește» on the volunteer's card, and each file «Încarcă contractele semnate» matched to a person (§998): one
 * whole file attached to one volunteer of the event, replacing the copy they had. Asserted, then checked whole by its bytes,
 * then written under the volunteer's lock — or refused with nothing written: `FORBIDDEN`, `NOT_FOUND` (another event's person, a
 * malformed or unknown id), `VOLUNTEER_CONTRACT_EMPTY`, `…_TOO_LARGE`, `…_TYPE`.
 */
export async function attachSignedContract<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { eventId: string; volunteerId: string; fileName: string; bytes: Uint8Array },
  now: Date,
): Promise<SignedContractStored> {
  assertMayKeep(actor);
  assertIds(input.eventId, input.volunteerId);
  const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  return db.transaction(async (tx) => {
    await lockVolunteer(tx, input.eventId, input.volunteerId);
    const format = checkSignedContract(bytes);
    const fileName = cleanFileName(input.fileName) || fallbackFileName(format);
    return writeSignedContract(tx, actor, { eventId: input.eventId, volunteerId: input.volunteerId, fileName, format, bytes }, now);
  });
}

/**
 * The first piece of a file larger than one request carries (§998, `SIGNED_CONTRACT_PART_BYTES`): the whole length declared and
 * checked against the limit, the piece's signature read so ten megabytes of something else never go up, and the piece kept for the
 * next ones — replacing any upload of the same person left half-sent. A piece that is already the whole file is attached at once.
 */
export async function startSignedContractUpload<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { eventId: string; volunteerId: string; fileName: string; size: number; part: Uint8Array },
  now: Date,
): Promise<SignedContractPartOutcome> {
  assertMayKeep(actor);
  assertIds(input.eventId, input.volunteerId);
  assertSize(input.size);
  if (input.part.length === 0 || input.part.length > input.size) throw new DomainError("VOLUNTEER_CONTRACT_UPLOAD_GONE", "the piece does not fit the file declared");
  if (input.part.length === input.size) return { done: true, ...(await attachSignedContract(db, actor, { ...input, bytes: input.part }, now)) };
  if (!mayBeSignedContract(input.part)) throw new DomainError("VOLUNTEER_CONTRACT_TYPE", "the file is not a PDF, a Word document or a photograph");
  const received = Buffer.from(input.part.buffer, input.part.byteOffset, input.part.byteLength);
  // The name is kept for the move; one with nothing left is «contract», and the download adds the format's extension.
  const fileName = cleanFileName(input.fileName) || "contract";
  const uploadId = await db.transaction(async (tx) => {
    await lockVolunteer(tx, input.eventId, input.volunteerId);
    await tx.delete(eventVolunteerDocumentUploads).where(eq(eventVolunteerDocumentUploads.volunteerId, input.volunteerId));
    const [row] = await tx
      .insert(eventVolunteerDocumentUploads)
      .values({ volunteerId: input.volunteerId, fileName, size: input.size, received, startedByStaffUserId: actor.id, createdAt: now, updatedAt: now })
      .returning({ id: eventVolunteerDocumentUploads.id });
    return row.id;
  });
  return { done: false, uploadId, received: received.length };
}

/**
 * The next piece of a file sent in pieces (§998): appended in order — `offset` must be what arrived so far, so a piece sent twice or
 * out of turn is refused (`VOLUNTEER_CONTRACT_UPLOAD_GONE`, as is an upload replaced by a newer one or gone with its person) — and,
 * with the last one, the whole file checked by its bytes and moved into the volunteer's copy in the same transaction, the upload's
 * row deleted. A whole file that is not one of the formats is refused and its pieces deleted.
 */
export async function continueSignedContractUpload<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { eventId: string; volunteerId: string; uploadId: string; offset: number; part: Uint8Array },
  now: Date,
): Promise<SignedContractPartOutcome> {
  assertMayKeep(actor);
  assertIds(input.eventId, input.volunteerId, input.uploadId);
  const gone = () => new DomainError("VOLUNTEER_CONTRACT_UPLOAD_GONE", "the upload is not there, or the piece is not the next one");
  if (input.part.length === 0 || !Number.isSafeInteger(input.offset) || input.offset < 1) throw gone();
  const part = Buffer.from(input.part.buffer, input.part.byteOffset, input.part.byteLength);
  const outcome = await db.transaction(async (tx): Promise<SignedContractPartOutcome | { refused: DomainError }> => {
    await lockVolunteer(tx, input.eventId, input.volunteerId);
    // The length so far, not the bytes: a middle piece reads nothing back.
    const [upload] = await tx
      .select({ size: eventVolunteerDocumentUploads.size, fileName: eventVolunteerDocumentUploads.fileName, received: sql<number>`octet_length(${eventVolunteerDocumentUploads.received})`.mapWith(Number) })
      .from(eventVolunteerDocumentUploads)
      .where(and(eq(eventVolunteerDocumentUploads.id, input.uploadId), eq(eventVolunteerDocumentUploads.volunteerId, input.volunteerId)))
      .limit(1);
    if (!upload || upload.received !== input.offset || input.offset + part.length > upload.size) throw gone();
    const received = input.offset + part.length;
    if (received < upload.size) {
      await tx
        .update(eventVolunteerDocumentUploads)
        .set({ received: sql`${eventVolunteerDocumentUploads.received} || ${part}`, updatedAt: now })
        .where(eq(eventVolunteerDocumentUploads.id, input.uploadId));
      return { done: false, uploadId: input.uploadId, received };
    }
    // The last piece: the pieces so far read back once, the whole file checked by its bytes and moved — or refused, its row deleted.
    const [kept] = await tx.select({ received: eventVolunteerDocumentUploads.received }).from(eventVolunteerDocumentUploads).where(eq(eventVolunteerDocumentUploads.id, input.uploadId));
    const bytes = Buffer.concat([kept.received, part]);
    let format: VolunteerDocumentFormat;
    try {
      format = checkSignedContract(bytes);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await tx.delete(eventVolunteerDocumentUploads).where(eq(eventVolunteerDocumentUploads.id, input.uploadId));
      return { refused: error };
    }
    return { done: true, ...(await writeSignedContract(tx, actor, { eventId: input.eventId, volunteerId: input.volunteerId, fileName: upload.fileName, format, bytes }, now)) };
  });
  if ("refused" in outcome) throw outcome.refused;
  return outcome;
}

/**
 * «Șterge» on the volunteer's card (§998): the signed copy gone, with any upload of the person left half-sent, and one trail row —
 * the id, the length and the format. `deleted: false` when there was none (another colleague's delete first): nothing to record.
 */
export async function deleteSignedContract<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { eventId: string; volunteerId: string },
  now: Date,
): Promise<{ deleted: boolean }> {
  assertMayKeep(actor);
  assertIds(input.eventId, input.volunteerId);
  return db.transaction(async (tx) => {
    await lockVolunteer(tx, input.eventId, input.volunteerId);
    const [gone] = await tx
      .delete(eventVolunteerDocuments)
      .where(eq(eventVolunteerDocuments.volunteerId, input.volunteerId))
      .returning({ size: eventVolunteerDocuments.size, format: eventVolunteerDocuments.format });
    await tx.delete(eventVolunteerDocumentUploads).where(eq(eventVolunteerDocumentUploads.volunteerId, input.volunteerId));
    if (!gone) return { deleted: false };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.signed_contract_deleted",
      entityType: "event",
      entityId: input.eventId,
      metadata: { volunteerId: input.volunteerId, size: gone.size, format: gone.format },
      now,
    });
    return { deleted: true };
  });
}

/** The volunteer's signed copy as their card draws it — its facts, never its bytes — or null while there is none. */
export async function readSignedContract<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, volunteerId: string): Promise<SignedContractFacts | null> {
  assertMayKeep(actor);
  if (!isUuid(volunteerId)) return null;
  const [row] = await db
    .select({
      fileName: eventVolunteerDocuments.fileName,
      format: eventVolunteerDocuments.format,
      size: eventVolunteerDocuments.size,
      uploadedAt: eventVolunteerDocuments.uploadedAt,
      uploadedByName: staffUsers.displayName,
    })
    .from(eventVolunteerDocuments)
    .leftJoin(staffUsers, eq(staffUsers.id, eventVolunteerDocuments.uploadedByStaffUserId))
    .where(eq(eventVolunteerDocuments.volunteerId, volunteerId))
    .limit(1);
  return row ?? null;
}

/**
 * The download (§998): the copy's bytes, name and format, for a volunteer of this event, with one trail row — the id, the length and
 * the format — because a file with a person's signature leaves the site. Null while there is none (and no row written).
 */
export async function takeSignedContractFile<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { eventId: string; volunteerId: string },
  now: Date,
): Promise<SignedContractFile | null> {
  assertMayKeep(actor);
  assertIds(input.eventId, input.volunteerId);
  const [row] = await db
    .select({ fileName: eventVolunteerDocuments.fileName, format: eventVolunteerDocuments.format, size: eventVolunteerDocuments.size, bytes: eventVolunteerDocuments.bytes })
    .from(eventVolunteerDocuments)
    .innerJoin(eventVolunteers, eq(eventVolunteers.id, eventVolunteerDocuments.volunteerId))
    .where(and(eq(eventVolunteerDocuments.volunteerId, input.volunteerId), eq(eventVolunteers.eventId, input.eventId)))
    .limit(1);
  if (!row) return null;
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "volunteer.signed_contract_downloaded",
    entityType: "event",
    entityId: input.eventId,
    metadata: { volunteerId: input.volunteerId, size: row.size, format: row.format },
    now,
  });
  return row;
}

/** Of these volunteers, the ones with a signed copy attached: the «Voluntari» list's chip, one read for the page's rows. */
export async function volunteersWithSignedContract<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, volunteerIds: readonly string[]): Promise<Set<string>> {
  assertMayKeep(actor);
  const ids = volunteerIds.filter(isUuid);
  if (ids.length === 0) return new Set();
  const rows = await db.select({ volunteerId: eventVolunteerDocuments.volunteerId }).from(eventVolunteerDocuments).where(inArray(eventVolunteerDocuments.volunteerId, ids));
  return new Set(rows.map((row) => row.volunteerId));
}

/**
 * Whether the volunteer the column names has a signed copy attached, as a condition of a query (§998): the «Voluntari» list's
 * filter and its strip's «Contracte semnate: N din M» read the table through this alone, never its rows.
 */
export function hasSignedContract(volunteerId: AnyPgColumn | SQL): SQL {
  return exists(sql`(SELECT 1 FROM ${eventVolunteerDocuments} WHERE ${eventVolunteerDocuments.volunteerId} = ${volunteerId})`);
}

/**
 * The signed copies of a person's offers, for «Toate datele unei persoane» (art. 15 GDPR, §322): each one's facts — the name, the
 * format, the length, when — never the bytes, which the volunteer's page downloads. Asks no role itself: its one reader,
 * `registrations/person-data.ts`, is the Administrator's alone (`canManageRegistrations`, asserted before it collects anything),
 * a narrower gate than this file's.
 */
export async function signedContractsOfOffers<T extends Record<string, unknown>>(
  db: Database<T>,
  volunteerIds: readonly string[],
): Promise<Map<string, Omit<SignedContractFacts, "uploadedByName">>> {
  const ids = volunteerIds.filter(isUuid);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      volunteerId: eventVolunteerDocuments.volunteerId,
      fileName: eventVolunteerDocuments.fileName,
      format: eventVolunteerDocuments.format,
      size: eventVolunteerDocuments.size,
      uploadedAt: eventVolunteerDocuments.uploadedAt,
    })
    .from(eventVolunteerDocuments)
    .where(inArray(eventVolunteerDocuments.volunteerId, ids));
  return new Map(rows.map(({ volunteerId, ...facts }) => [volunteerId, facts]));
}

/** The most files one «Încarcă contractele semnate» names: far more volunteers than a race has, far fewer than a forged list. */
export const SIGNED_CONTRACT_BATCH_MAX = 500;

/** The event's volunteers as the match reads them, every state; NOT_FOUND for an event nobody has. */
async function contractCandidates<T extends Record<string, unknown>>(db: Database<T>, eventId: string) {
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  const rows = await db
    .select({ id: eventVolunteers.id, name: eventVolunteers.name, state: eventVolunteers.state })
    .from(eventVolunteers)
    .where(eq(eventVolunteers.eventId, eventId))
    .orderBy(asc(eventVolunteers.createdAt), asc(eventVolunteers.id));
  return rows.map((row) => ({ id: row.id, name: row.name, cancelled: row.state === "CANCELLED" }));
}

/**
 * «Încarcă contractele semnate», first step (§998): which volunteer of **this** event each file is, by the name it carries
 * (`matchContractFiles`) — only the names travel, never a byte, so a file nobody matches never goes up. The page then sends each
 * matched file to its volunteer (`attachSignedContract`, in pieces when large) and lists the rest with the reason.
 */
export async function matchSignedContractFiles<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  fileNames: readonly string[],
): Promise<ContractFileMatch[]> {
  assertMayKeep(actor);
  assertIds(eventId);
  if (fileNames.length > SIGNED_CONTRACT_BATCH_MAX) throw new DomainError("VALIDATION_ERROR", "too many files at once", ["files"]);
  return matchContractFiles(fileNames, await contractCandidates(db, eventId));
}

/** One file's answer of «Încarcă contractele semnate»: attached (in place of another, or not), or why not. */
export type SignedContractBatchOutcome =
  | { fileName: string; outcome: "attached"; replaced: boolean }
  | { fileName: string; outcome: "refused"; reason: ContractNameRefusal | "empty" | "tooLarge" | "type" | "gone" };

/** A content refusal's code, as the upload's list names it. */
export function batchReasonOf(code: string): "empty" | "tooLarge" | "type" | "gone" {
  if (code === "VOLUNTEER_CONTRACT_EMPTY") return "empty";
  if (code === "VOLUNTEER_CONTRACT_TOO_LARGE") return "tooLarge";
  if (code === "VOLUNTEER_CONTRACT_TYPE") return "type";
  return "gone";
}

/**
 * «Încarcă contractele semnate» in one request (§998) — the form as it posts with scripts off: every file matched by its name, and
 * each matched one attached in a transaction of its own, so **one bad file never stops the others**: a file refused by its bytes,
 * or whose volunteer was deleted meanwhile, is listed with the reason and the next one goes on — and a later file for the same
 * person (`twice`) takes its turn then, since nothing of this upload is theirs yet. The page's own way, with scripts, is the match
 * above and one request a file, by the same rule. No file at all is `VOLUNTEER_CONTRACTS_NONE_CHOSEN`, never «0 attached».
 */
export async function attachSignedContractsByName<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  files: ReadonlyArray<{ fileName: string; bytes: Uint8Array }>,
  now: Date,
): Promise<SignedContractBatchOutcome[]> {
  const matches = await matchSignedContractFiles(db, actor, eventId, files.map((file) => file.fileName));
  if (files.length === 0) throw new DomainError("VOLUNTEER_CONTRACTS_NONE_CHOSEN", "no file was chosen");
  const outcomes: SignedContractBatchOutcome[] = [];
  /** The volunteers a file of this upload was attached to: a spare for one of them stays out. */
  const attachedTo = new Set<string>();
  for (const [index, file] of files.entries()) {
    const match = matches[index];
    const volunteerId = match.kind === "matched" || match.reason === "twice" ? match.volunteerId : null;
    if (volunteerId === null || attachedTo.has(volunteerId)) {
      outcomes.push({ fileName: file.fileName, outcome: "refused", reason: match.kind === "refused" ? match.reason : "twice" });
      continue;
    }
    try {
      const stored = await attachSignedContract(db, actor, { eventId, volunteerId, fileName: file.fileName, bytes: file.bytes }, now);
      attachedTo.add(volunteerId);
      outcomes.push({ fileName: file.fileName, outcome: "attached", replaced: stored.replaced });
    } catch (error) {
      if (!(error instanceof DomainError) || error.code === "FORBIDDEN") throw error;
      outcomes.push({ fileName: file.fileName, outcome: "refused", reason: batchReasonOf(error.code) });
    }
  }
  return outcomes;
}
