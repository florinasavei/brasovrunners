import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/** The longest full name a colleague types under the team's undertaking (§1006): the house's 200 characters. */
export const TEAM_AGREEMENT_NAME_MAX = 200;

/**
 * The team's undertaking, accepted (§1006; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în
 * platformă»): one row per account and per version of «Angajament de confidențialitate și protecția datelor pentru echipă»
 * (`STAFF_DATA_AGREEMENT`) the account accepted on `/admin/acord`.
 *
 * **The record of §1006, kept as it was, written no more since §1026.** The undertaking is now owed at every sign-in, and every
 * acceptance is a row of `staff_team_agreement_sign_in_acceptances` below, which names the sign-in it answers. The rows here stay:
 * «Echipa» still reads them and each one is still a reliance on its version (`acceptanceCount`); none of them answers a sign-in,
 * so the gate reads only the table below. Expand only (AGENTS.md §7.6): this table and its unique key are not touched — a later
 * release may fold it into the other, never in the step that adds it.
 *
 * **Once per account and version** (`staff_team_agreement_acceptances_once`): a second press found the first row and wrote
 * nothing; a new version the club approved was a new row.
 *
 * **The proof is the declarations' (§556, §771)**: the version accepted (`legal_document_id`, `RESTRICT` — a version somebody
 * accepted is never deleted under them, §567 retires it instead — and its number), the version's own hash (`content_sha256`, both
 * languages, copied as `declaration_acceptances` copies it), the language read, the full name typed, the SHA-256 of the exact text
 * read in that language (`text_hash`, `signedTextHash`), the moment, and the IP address and browser of the press — always an
 * electronic acceptance: there is no paper road for a sign-in.
 *
 * **Gone with the account** (`ON DELETE CASCADE`): «Retrage accesul» removes the colleague's row, and their acceptances with it;
 * switching the account off keeps both. The trail keeps `staff.team_agreement_accepted` — the version, never the name typed.
 */
export const staffTeamAgreementAcceptances = pgTable(
  "staff_team_agreement_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    legalDocumentId: uuid("legal_document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "restrict" }),
    documentVersion: integer("document_version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    locale: locale("locale").notNull(),
    /** The full name as typed: trimmed, inner spaces collapsed, 1–200 characters. */
    typedName: text("typed_name").notNull(),
    textHash: text("text_hash").notNull(),
    /** The electronic acceptance's trace (§771): the IP address and browser of the press; null when the request carried none. */
    ip: text("ip"),
    userAgent: text("user_agent"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("staff_team_agreement_acceptances_once").on(t.staffUserId, t.legalDocumentId),
    // The legal list counts every acceptance of a version (`listVersionsForBackoffice`): the reliance that keeps it.
    index("staff_team_agreement_acceptances_document_idx").on(t.legalDocumentId),
    check("staff_team_agreement_acceptances_version_positive", sql`${t.documentVersion} >= 1`),
    check("staff_team_agreement_acceptances_content_sha256", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("staff_team_agreement_acceptances_text_sha256", sql`${t.textHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "staff_team_agreement_acceptances_typed_name",
      sql`char_length(btrim(${t.typedName})) BETWEEN 1 AND ${sql.raw(String(TEAM_AGREEMENT_NAME_MAX))}`,
    ),
  ],
);

export type StaffTeamAgreementAcceptance = typeof staffTeamAgreementAcceptances.$inferSelect;

/**
 * The team's undertaking, accepted at a sign-in (§1026, amending §1006): **every acceptance kept**, one row per press that
 * accepted — so the club can show that a colleague accepted the version in force at each sign-in, not once per account.
 *
 * Each row is the declarations' proof, as above — who (`staff_user_id`), the version (`legal_document_id`, `RESTRICT`, and its
 * number), the version's own hash, the language read, the full name typed, the SHA-256 of the exact text read, the moment
 * (`accepted_at`), the IP address and browser of the press — and **the sign-in it answers** (`signed_in_at`): the moment the
 * session was signed in, the claim the `jwt` callback writes at a sign-in (the development sign-in writes it too). It is null for
 * a session signed in before §1026, which carries no such moment: that session is asked once and answered by this row.
 *
 * **Once per account, version and sign-in** (`staff_team_agreement_sign_in_acceptances_once`, NULLS NOT DISTINCT so the sessions
 * from before §1026 count as one): a double tap on a phone finds the first row and writes nothing; the next sign-in is a new row.
 *
 * **Gone with the account** (`ON DELETE CASCADE`), as the rows above: «Retrage accesul» removes the colleague's row and their
 * acceptances with it; switching the account off keeps both. The trail keeps `staff.team_agreement_accepted` without the name.
 */
export const staffTeamAgreementSignInAcceptances = pgTable(
  "staff_team_agreement_sign_in_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    legalDocumentId: uuid("legal_document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "restrict" }),
    documentVersion: integer("document_version").notNull(),
    contentSha256: text("content_sha256").notNull(),
    locale: locale("locale").notNull(),
    /** The full name as typed: trimmed, inner spaces collapsed, 1–200 characters. */
    typedName: text("typed_name").notNull(),
    textHash: text("text_hash").notNull(),
    /** The electronic acceptance's trace (§771): the IP address and browser of the press; null when the request carried none. */
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** The sign-in this acceptance answers: the moment the session was signed in; null for a session from before §1026. */
    signedInAt: timestamp("signed_in_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Also the gate's index: the account's acceptances of the version in force (`outstandingTeamAgreement`).
    unique("staff_team_agreement_sign_in_acceptances_once").on(t.staffUserId, t.legalDocumentId, t.signedInAt).nullsNotDistinct(),
    // The legal list counts every acceptance of a version (`listVersionsForBackoffice`): the reliance that keeps it.
    index("staff_team_agreement_sign_in_acceptances_document_idx").on(t.legalDocumentId),
    check("staff_team_agreement_sign_in_acceptances_version_positive", sql`${t.documentVersion} >= 1`),
    check("staff_team_agreement_sign_in_acceptances_content_sha256", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("staff_team_agreement_sign_in_acceptances_text_sha256", sql`${t.textHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "staff_team_agreement_sign_in_acceptances_typed_name",
      sql`char_length(btrim(${t.typedName})) BETWEEN 1 AND ${sql.raw(String(TEAM_AGREEMENT_NAME_MAX))}`,
    ),
  ],
);

export type StaffTeamAgreementSignInAcceptance = typeof staffTeamAgreementSignInAcceptances.$inferSelect;
