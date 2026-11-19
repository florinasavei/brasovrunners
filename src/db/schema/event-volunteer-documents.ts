import { sql } from "drizzle-orm";
import { check, customType, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { eventVolunteers } from "./event-volunteers";
import { staffUsers } from "./staff-users";

/**
 * The largest signed agreement kept, in bytes (§NNN): 10 MB — a phone's photograph of two pages, or a scanner app's PDF, with
 * room to spare; a Word file is a few hundred kilobytes. The service refuses past it before anything is written, and the
 * tables' own checks say the same. Written once: the service, the checks and the page's help read it.
 */
export const SIGNED_CONTRACT_MAX_BYTES = 10 * 1024 * 1024;

/** The longest file name kept, in characters: a name past it is cut, its extension kept (`domain/signed-contract.ts#cleanFileName`). */
export const SIGNED_CONTRACT_NAME_MAX = 200;

/**
 * A file's bytes, kept in the row: PostgreSQL's `bytea`, which Drizzle 0.45 has no column for. node-postgres reads it as a
 * `Buffer` and PGlite as a `Uint8Array`; every reader here gets a `Buffer` either way.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === "string") return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * What a signed agreement is, read from its own first bytes and never from its name or the browser's word
 * (`domain/signed-contract.ts#sniffSignedContract`): a PDF, a Word document (`DOCX`, or the older `DOC`), or a photograph —
 * `JPEG`, `PNG`, or a phone's `HEIC` / `HEIF`. A closed set at the database, like every kind here: another is a migration.
 * The type a download is served as follows from it (`SIGNED_CONTRACT_FORMATS`).
 */
export const volunteerDocumentFormat = pgEnum("event_volunteer_document_format", ["PDF", "DOCX", "DOC", "JPEG", "PNG", "HEIC", "HEIF"]);

/**
 * «Contract semnat» (§NNN, amending §758; the owner, 2026-11-19: «trebuie pentru fiecare voluntar să pot atașa „contract
 * semnat”»): the signed copy of one volunteer's agreement — the Word file the club printed and the president signed, a scan or a
 * photograph of the paper — attached by whoever works the volunteers (`canManageVolunteers`), **one per volunteer**: attaching
 * another replaces it (`UNIQUE (volunteer_id)`).
 *
 * **Here, in the database, and never in the bucket.** The file carries a signature and personal data, and the media bucket's
 * reads are public (`SETUP.md`: «Reads are public because the gallery is»): nothing kept there is private. A row is read only by
 * `modules/volunteers/signed-contract.ts`, behind the role, and leaves the site only through the authenticated download
 * (`/api/admin/events/<id>/volunteers/<volunteerId>/signed-contract`: attachment, `private, no-store`). The files are small and
 * few — at most `SIGNED_CONTRACT_MAX_BYTES`, one per volunteer of an event — and live no longer than the volunteer's row.
 *
 * - **The name as it was uploaded**, cleaned of a path and of control characters and cut at `SIGNED_CONTRACT_NAME_MAX`: shown to
 *   the organizers and given back on the download. It carries the person's name, so it is never written to the trail.
 * - **Deleted with the volunteer.** `ON DELETE CASCADE`: «Șterge voluntarul», the thirty-day retention sweep (`jobs/retention.ts`,
 *   step `volunteers`) and an event's hard delete take the file with the row, at the same moment, with no code of their own.
 * - **Who attached it** is a reference, not a copy (`ON DELETE SET NULL`).
 */
export const eventVolunteerDocuments = pgTable(
  "event_volunteer_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    volunteerId: uuid("volunteer_id")
      .notNull()
      .references(() => eventVolunteers.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    format: volunteerDocumentFormat("format").notNull(),
    /** The file's length in bytes: what the page says and the download's `Content-Length`; always the bytes' own (the check). */
    size: integer("size").notNull(),
    bytes: bytea("bytes").notNull(),
    uploadedByStaffUserId: uuid("uploaded_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One signed copy per volunteer: the list's chip, the person's card, and the replace's one row.
    unique("event_volunteer_documents_volunteer_unique").on(t.volunteerId),
    check("event_volunteer_documents_size", sql`${t.size} BETWEEN 1 AND ${sql.raw(String(SIGNED_CONTRACT_MAX_BYTES))} AND octet_length(${t.bytes}) = ${t.size}`),
    check("event_volunteer_documents_file_name_length", sql`char_length(${t.fileName}) BETWEEN 1 AND ${sql.raw(String(SIGNED_CONTRACT_NAME_MAX))}`),
  ],
);

/**
 * A signed agreement on its way up in parts (§NNN): a request to a function on the host carries at most 4.5 MB, so the page sends a
 * file larger than that in pieces of at most 4 MB (`ui/SignedContractUpload.tsx`), each one appended here in order, and moves it
 * into `event_volunteer_documents` — replacing the copy there, checked whole by its bytes — the moment the last piece arrives,
 * deleting this row in the same transaction. A smaller file never comes here.
 *
 * One upload under way per volunteer (`UNIQUE (volunteer_id)`): starting another replaces the one left half-sent, so a tab closed
 * mid-way leaves at most one partial file, never read by anything and gone with the volunteer (`ON DELETE CASCADE`) — the same
 * moment as the signed copy itself, so nothing of the person outlives their row.
 */
export const eventVolunteerDocumentUploads = pgTable(
  "event_volunteer_document_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    volunteerId: uuid("volunteer_id")
      .notNull()
      .references(() => eventVolunteers.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    /** The whole file's length as the first piece declared it; the upload is complete when `received` is this long. */
    size: integer("size").notNull(),
    /** The pieces so far, in order. */
    received: bytea("received").notNull(),
    startedByStaffUserId: uuid("started_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("event_volunteer_document_uploads_volunteer_unique").on(t.volunteerId),
    check("event_volunteer_document_uploads_size", sql`${t.size} BETWEEN 1 AND ${sql.raw(String(SIGNED_CONTRACT_MAX_BYTES))} AND octet_length(${t.received}) <= ${t.size}`),
    check("event_volunteer_document_uploads_file_name_length", sql`char_length(${t.fileName}) BETWEEN 1 AND ${sql.raw(String(SIGNED_CONTRACT_NAME_MAX))}`),
  ],
);

export type VolunteerDocumentFormat = (typeof volunteerDocumentFormat.enumValues)[number];
export type EventVolunteerDocument = typeof eventVolunteerDocuments.$inferSelect;
