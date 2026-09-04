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

/** The three legal document families of AGENTS.md §12.5. One versioning mechanism serves all three. */
export const legalDocumentKey = pgEnum("legal_document_key", [
  "PRIVACY_NOTICE",
  "TERMS",
  "EVENT_DECLARATION",
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
