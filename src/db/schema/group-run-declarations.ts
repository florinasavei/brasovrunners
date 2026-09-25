import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";

/**
 * An optional self-declaration signed on a group run's page (§NNN; the owner, 2026-09-25: "people
 * should be able to sign and email it to us").
 *
 * **Never a registration.** A group run is turned up to (§111): no place, no queue, no participant
 * row. So this is a table of its own rather than a `declaration_acceptances` row, whose
 * `registration_id` is not null and whose whole meaning is "this registration may be confirmed".
 * One row is one signature, bound to an event and to the version it was read in: the version id
 * and its hash, compared with the text in force at the press and refused against any other
 * (§57), exactly as the race's declaration is.
 *
 * **What it keeps, and for how long.** The name typed as the signature (§86, in a hand), the
 * identity document as it was typed — never a scan (§95) — the address the copy was sent to, and
 * the language of the PDF. The whole row goes seven days after the event's start
 * (`jobs/retention.ts`): the declaration exists for the run, and a runner's identity number has
 * no business outliving it here. The signer keeps the PDF that was emailed; the club's archive
 * copy leaves with the document masked (§320). Insert-only apart from that sweep and the
 * Administrator's erase, which writes an audit row naming who and why, never who was erased.
 *
 * `event_id` cascades: an event erased outright takes its declarations with it (the event's own
 * audit row records the erase). `legal_document_id` does not: a version somebody signed is
 * relied upon and is never deleted (§53, §151, `deletability.ts`).
 */
export const groupRunDeclarations = pgTable(
  "group_run_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    legalDocumentId: uuid("legal_document_id")
      .notNull()
      .references(() => legalDocuments.id),
    declarationVersion: integer("declaration_version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    /** The language the signer read and signed in, and the PDF is written in. */
    locale: locale("locale").notNull(),

    /** The signature: the signer's full name, typed (§86). */
    typedName: text("typed_name").notNull(),
    /** "Carte de identitate BV 123456", as typed at signing (§95, §283). Null when the text names no document. */
    idDocument: text("id_document"),
    /** Where the signer's copy was sent. Kept only as long as the row, for the copy and its resend. */
    email: text("email").notNull(),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "Every declaration signed for this run, in order" — the backoffice's one question.
    index("group_run_declarations_event_accepted_at_idx").on(t.eventId, t.acceptedAt),
    check("group_run_declarations_version_positive", sql`${t.declarationVersion} >= 1`),
    check("group_run_declarations_hash_is_sha256_hex", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type GroupRunDeclaration = typeof groupRunDeclarations.$inferSelect;
