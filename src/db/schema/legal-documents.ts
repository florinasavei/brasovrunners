import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * The legal document families of AGENTS.md §12.5. One versioning mechanism serves all of them.
 *
 * `EVENT_DECLARATION` is the race's declaration, the one a registration cannot be confirmed
 * without (BR-REQ-053-01). The two group-run declarations (§393) are optional self-declarations
 * a runner may sign on a group run's page, one per surface: the Tâmpa trail run and the asphalt
 * runs carry different risks. They gate nothing — no registration, no place.
 */
export const legalDocumentKey = pgEnum("legal_document_key", [
  "PRIVACY_NOTICE",
  "TERMS",
  "EVENT_DECLARATION",
  "GROUP_RUN_DECLARATION_ASPHALT",
  "GROUP_RUN_DECLARATION_TRAIL",
]);

export type LegalDocumentKey = (typeof legalDocumentKey.enumValues)[number];

/**
 * Legal documents (AGENTS.md §12.5; BR-REQ-053-01).
 *
 * A version referenced by a `declaration_acceptances` row is immutable — there is no update
 * path in `modules/legal-documents/service.ts` at all, not even for staff, because §12.5 and
 * §11.1 are explicit that no CMS screen edits legal text. Exactly one approved version per key
 * is "current" at a given moment, resolved by the highest `version` whose `effective_at` has
 * passed; nothing here forces that at the database, because more than one version may be
 * approved at once (a future version approved ahead of its effective date), and `UNIQUE(key,
 * version)` is what actually prevents two rows from claiming to be the same version.
 *
 * `created_by_staff_user_id` is nullable for the same reason `events.created_by_staff_user_id`
 * is: the pilot's only writer is a seed, not a person, and inventing an author would be a lie
 * in the trail.
 */
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    key: legalDocumentKey("key").notNull(),
    version: integer("version").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    isApproved: boolean("is_approved").notNull().default(false),

    // SHA-256 of the canonically serialized translations, hex encoded. See
    // modules/legal-documents/domain/content-hash.ts.
    contentSha256: text("content_sha256").notNull(),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    // Nullable for the same reason `created_by_staff_user_id` is: the approval that matters
    // here is the club owner's, off-platform, not a staff member clicking a button in a CMS
    // this system deliberately has none of (§12.5, §11.1) — there is nobody to attribute a
    // seeded PLACEHOLDER version to, and inventing one would be a false record.
    approvedByStaffUserId: uuid("approved_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    /**
     * Withdrawal (`DECISIONS.md` §46, §53): an approved version nothing relied on, taken out of
     * circulation without being taken out of the record.
     *
     * Deliberately not a delete, and the reason is a number rather than a principle.
     * `registrations.privacy_notice_version` is a plain integer with no foreign key, and the
     * next version is `max(version) + 1` — so deleting a row would free its number to be
     * reissued to different words, and every registration that recorded that number would
     * silently become a consent to text written afterwards. The row, the number and the text
     * all stay; only the offering stops.
     *
     * Nullable because "not withdrawn" is the state almost every row is in, and a timestamp
     * says both *whether* and *when* in one column.
     */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    // `ON DELETE SET NULL` for the same reason the other two are: a staff account that is later
    // removed must not take the record of what it did with it.
    withdrawnByStaffUserId: uuid("withdrawn_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("legal_documents_key_version_unique").on(t.key, t.version),
    check("legal_documents_version_positive", sql`${t.version} >= 1`),
    check(
      "legal_documents_hash_is_sha256_hex",
      sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type LegalDocument = typeof legalDocuments.$inferSelect;

/**
 * The high-water mark of retired version numbers, one row per key (`DECISIONS.md` §151).
 *
 * This table is the whole reason an approved version can now be *deleted* rather than only
 * withdrawn, and it exists because of an arithmetic hazard that has nothing to do with
 * principles. `registrations.privacy_notice_version`, `results_consent_version` and
 * `health_consent_version` are plain integers with no foreign key, and the next version is
 * `max(version) + 1`. Delete version 4 and the next draft becomes version 4 again — with
 * different words — and every registration that recorded "privacy notice 4" silently becomes a
 * consent to text nobody was ever shown. PostgreSQL has nothing to raise: there is no key to
 * violate, and the row it would have pointed at is gone.
 *
 * So the row may go and the *number* may not. `highest_retired_version` remembers the largest
 * version number ever destroyed for this key, and the next draft is
 * `max(max(version), highest_retired_version) + 1`. Deleting the top version therefore skips
 * its number for good; deleting a middle one changes nothing, because the surviving maximum is
 * already higher.
 *
 * **Why a number per key and not a tombstone per version.** A tombstone table would be a second
 * record that a deleted version existed, which is exactly what §12.12 and the delete's own
 * promise say there must not be: after the row is gone, the audit entry is the only record. One
 * integer per key says "numbers up to here are spent" and says nothing about what any of them
 * contained. It is also order-independent — every write is `GREATEST(current, version)` — so two
 * deletions racing each other cannot lower the floor.
 *
 * A draft's deletion does **not** write here, and that is deliberate: a draft's number never
 * left the backoffice, because a registration records the version *in force* and a draft is
 * never in force. Retiring it too would make the club's version numbers jump for a reason it
 * could not see.
 */
export const legalDocumentNumbering = pgTable(
  "legal_document_numbering",
  {
    // The key is the identity: there is exactly one floor per document, and no row at all for
    // a document nothing has ever been deleted from.
    key: legalDocumentKey("key").primaryKey(),
    highestRetiredVersion: integer("highest_retired_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("legal_document_numbering_version_positive", sql`${t.highestRetiredVersion} >= 1`),
  ],
);

export type LegalDocumentNumbering = typeof legalDocumentNumbering.$inferSelect;

/** One row per locale per document version. Both locales are required before approval. */
export const legalDocumentTranslations = pgTable(
  "legal_document_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalDocumentId: uuid("legal_document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "cascade" }),
    locale: locale("locale").notNull(),

    title: text("title").notNull(),
    bodyJson: jsonb("body_json").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("legal_document_translations_document_locale_unique").on(t.legalDocumentId, t.locale)],
);

export type LegalDocumentTranslation = typeof legalDocumentTranslations.$inferSelect;
