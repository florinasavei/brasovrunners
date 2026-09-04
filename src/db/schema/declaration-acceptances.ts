import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { registrations } from "./registrations";

/**
 * Declaration acceptances (AGENTS.md §12.7, §10.8; BR-REQ-053-01).
 *
 * Insert-only. A restart that re-signs the declaration gets a new row — "do not overwrite
 * historical rows" (§12.7) — so `registration_id` is not unique here even though a
 * registration normally accepts one declaration; the latest row for a registration is what
 * confirmation references, found by `ORDER BY accepted_at DESC LIMIT 1`, never by an UPDATE.
 *
 * `content_sha256` is copied from the `legal_documents` row at acceptance time rather than
 * joined at read time: the version it points at is immutable, so this is redundant with the
 * join today, but it is what keeps the acceptance self-describing if a future migration ever
 * needs to audit it without the parent table.
 */
export const declarationAcceptances = pgTable(
  "declaration_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id),
    legalDocumentId: uuid("legal_document_id")
      .notNull()
      .references(() => legalDocuments.id),

    declarationVersion: integer("declaration_version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    locale: locale("locale").notNull(),

    // Explicit checkbox plus typed full name (§10.8) — not a qualified electronic signature.
    typedName: text("typed_name").notNull(),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("declaration_acceptances_registration_accepted_at_idx").on(t.registrationId, t.acceptedAt),
    check("declaration_acceptances_version_positive", sql`${t.declarationVersion} >= 1`),
    check(
      "declaration_acceptances_hash_is_sha256_hex",
      sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type DeclarationAcceptance = typeof declarationAcceptances.$inferSelect;
