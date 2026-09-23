import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { registrations } from "./registrations";
import { staffUsers } from "./staff-users";

/**
 * How the participant accepted the declaration (BR-REQ-037-07, `DECISIONS.md` §67).
 *
 * `EMAIL_LINK`: the participant read it on their own screen, reached from their own verified
 * address, and typed their name — the only method until 2026-09-18. `PAPER`: the participant
 * signed a printed copy at the desk and a member of staff recorded that, with their own id on
 * the row. In both cases it is the participant who accepted; what differs is the evidence. No
 * method exists in which staff accept on a participant's behalf — a declaration nobody signed
 * protects nobody.
 */
export const declarationMethod = pgEnum("declaration_method", ["EMAIL_LINK", "PAPER"]);

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
    // The declarant's: the participant's, or the parent's or guardian's for a minor (§108, §314).
    // For `PAPER` it is the name as written on the form staff hold — the registered name, or for
    // a minor the guardian's, with the minor's own in `minor_typed_name` (§NNN).
    typedName: text("typed_name").notNull(),
    /**
     * The identity document the declaration names — "posesor al CI seria BV nr. 123456" — as
     * the participant typed it at signing (`DECISIONS.md` §95). The club's own paper
     * declaration asks for it and hands out kits against it. Null for `PAPER`, where the paper
     * has it, and for acceptances recorded before the field existed.
     */
    idDocument: text("id_document"),
    /**
     * The minor's own signature and identity document, when a parent or guardian declares for
     * them (`DECISIONS.md` §NNN, the owner: "I wanna have the ID document of the minor and the
     * parent, and also 2 signatures!"). A minor's declaration is signed by both: `typed_name` and
     * `id_document` above stay the **declarant's** — the parent's, as §108 and §314 already made
     * them — and these two are the child's, typed at the same press against the name the child
     * was registered under.
     *
     * Null for an adult, whose own signature and document are the two columns above, and for a
     * minor's acceptance recorded before two signatures were asked (one signature, the parent's).
     * `minor_typed_name` is kept as long as the row (three years, §95); `minor_id_document` is
     * cleared with `id_document`, seven days after the event (`jobs/retention.ts`). For `PAPER`,
     * `minor_typed_name` is the minor's registered name — the staff member attests that the paper
     * carries both signatures — and the document is on the paper, as for `id_document`.
     */
    minorTypedName: text("minor_typed_name"),
    minorIdDocument: text("minor_id_document"),

    method: declarationMethod("method").notNull().default("EMAIL_LINK"),
    /** Who recorded a paper signature. Required for `PAPER`, absent otherwise. */
    attestedByStaffUserId: uuid("attested_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

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
    // A paper signature is recorded by somebody; an email-link one is recorded by nobody.
    check(
      "declaration_acceptances_paper_is_attested",
      sql`(${t.method} = 'PAPER') = (${t.attestedByStaffUserId} IS NOT NULL)`,
    ),
  ],
);

export type DeclarationAcceptance = typeof declarationAcceptances.$inferSelect;
