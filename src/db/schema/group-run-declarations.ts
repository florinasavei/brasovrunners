import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";

/**
 * An optional self-declaration signed on a group run's page (§393; the owner, 2026-09-25: "people
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
 * the language of the PDF. The row is **kept while the signer takes part in the club's runs and
 * deleted at their request** (§503, reversing §393's seven days): it is the club's evidence for
 * the runs the signer keeps coming to, and the Administrator's erase — an
 * audit row naming who and why, never who was erased — is how it goes. Only the identity
 * document, which a text approved before §418 could still ask for, is cleared seven days after
 * the event's start (`jobs/retention.ts`): a runner's identity number has no business outliving
 * the run here. The signer keeps the PDF that was emailed; the club's archive copy leaves with the
 * document masked (§320). Insert-only apart from that clearing and the erase.
 *
 * **One per person per series and text version (§523).** `event_id` is the date it was signed on;
 * `series_key` says the declaration covers every date of that run — §113's series, the same type and
 * title, recorded at the signing as `seriesKey` wrote it — and is null for a one-off run, whose
 * declaration covers its own date. `signer_key` is who signed (`signerIdentity`: the canonical
 * address and the name read loosely), and the unique index below holds one live signature per
 * (text version, series — or the date, for a one-off —, signer): two presses at once for the same
 * person write one row, the second finds the first. A newer version is a new row; the older rows
 * stay as the evidence for the runs attended under them, and leave only by the Administrator's
 * erase. Rows from before §523 carry neither key: each covers its own date, as it said.
 *
 * `signed_facts` is what the text's blanks said at the signing (the run, its date and place, the
 * series, its rhythm and its usual place, the age), in the row's language: the PDF is drawn from
 * it, so a date moved or renamed later never changes what a signed declaration says (§57). Null on
 * a row from before §523, drawn from the event as it is. `view_token_hash` is the signer's own link
 * (the SHA-256 of a secret minted when their copy is sent, as `email_action_tokens` keeps its
 * own, §12.8): the run's page reads «Ai semnat deja…» from it and nothing else; a read, never an
 * action, so opening it changes nothing.
 *
 * `event_id` cascades: an event erased outright takes its declarations with it (the event's own
 * audit row records the erase) — once the delete has moved a series' declarations to another date
 * of the run, if the run has one (`rehomeGroupRunDeclarationsOfEvent`, §523). `legal_document_id`
 * does not: a version somebody signed is relied upon and is never deleted (§53, §151, `deletability.ts`).
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
    /** Where the signer's copy was sent, and whom a request to delete it is checked against. Kept as long as the row. */
    email: text("email").notNull(),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** The run's series as `seriesKey` wrote it at the signing (§113, §523); null for a one-off run. */
    seriesKey: text("series_key"),
    /** Who signed, as `signerIdentity` reads it (§523); null on a row from before it. */
    signerKey: text("signer_key"),
    /** The blanks as they were filled at the signing, in the row's language (§523; `readSignedFacts`). */
    signedFacts: jsonb("signed_facts"),
    /** The SHA-256 of the signer's own link (§523), never the secret; null until their copy is sent. */
    viewTokenHash: text("view_token_hash"),
  },
  (t) => [
    // "Every declaration signed for this run, in order" — the backoffice's one question.
    index("group_run_declarations_event_accepted_at_idx").on(t.eventId, t.acceptedAt),
    check("group_run_declarations_version_positive", sql`${t.declarationVersion} >= 1`),
    check("group_run_declarations_hash_is_sha256_hex", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    // One live signature per text version, series (or date) and signer (§523): the press's race held here.
    uniqueIndex("group_run_declarations_one_per_series_signer_version")
      .on(t.legalDocumentId, sql`coalesce(${t.seriesKey}, ${t.eventId}::text)`, t.signerKey)
      .where(sql`${t.signerKey} IS NOT NULL`),
    uniqueIndex("group_run_declarations_view_token_hash_unique").on(t.viewTokenHash),
    check("group_run_declarations_view_token_is_sha256_hex", sql`${t.viewTokenHash} IS NULL OR ${t.viewTokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type GroupRunDeclaration = typeof groupRunDeclarations.$inferSelect;
