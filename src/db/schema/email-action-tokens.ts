import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { participants } from "./participants";
import { registrations } from "./registrations";

/**
 * The five purposes from AGENTS.md §12.8. A database enum, so a token issued for a purpose
 * nobody defined cannot exist — BR-REQ-036-02 criterion 2 rejects a token used outside its
 * purpose, and that rule is worth nothing if the purpose column can hold free text.
 */
export const emailActionTokenPurpose = pgEnum("email_action_token_purpose", [
  "VERIFY_REGISTRATION_EMAIL",
  "COMPLETE_DECLARATION",
  "MANAGE_REGISTRATION",
  "WAITLIST_OFFER",
  "MANAGE_PROFILE",
]);

export type EmailActionTokenPurpose = (typeof emailActionTokenPurpose.enumValues)[number];

/**
 * Email action tokens (AGENTS.md §12.8, §13.2; BR-REQ-036-02).
 *
 * This is priority-1 code — `docs/PRACTICES.md` §198 lists action tokens among the code that
 * must be read line by line. A participant has no password and no account, so one of these
 * tokens is the *entire* proof that the person clicking a link is the person who registered.
 *
 * The column that is deliberately absent is the token itself. Only `token_hash` is stored,
 * and the CHECK below refuses anything that is not a SHA-256 hex digest, so a future change
 * that stored the raw secret by mistake would be rejected by PostgreSQL rather than reviewed
 * into production. The secret exists in one place only: the email that was sent.
 *
 */
export const emailActionTokens = pgTable(
  "email_action_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),

    // Null for MANAGE_PROFILE, which is scoped to the participant rather than to one
    // registration (AGENTS.md §13.3). The CHECK below makes that an invariant, not a habit.
    registrationId: uuid("registration_id").references(() => registrations.id, {
      onDelete: "cascade",
    }),

    purpose: emailActionTokenPurpose("purpose").notNull(),

    // SHA-256 of the base64url secret, hex encoded. Never the secret.
    tokenHash: text("token_hash").notNull().unique(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Set once, by the single-use consume statement. A used token is dead forever.
    usedAt: timestamp("used_at", { withTimezone: true }),
    // Set when a newer token supersedes this one, or when staff revoke it.
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * BR-REQ-036-02 criterion 1, enforced by the database rather than by review.
     *
     * A SHA-256 hex digest is 64 characters of `[0-9a-f]`. The secrets this application
     * generates are 43 characters of base64url, which contains uppercase letters, `-` and
     * `_` — no raw secret can satisfy this pattern. Storing one is a write that fails.
     */
    check("email_action_tokens_hash_is_sha256_hex", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),

    // A token that expires before it was created is either a clock bug or a mistaken unit.
    check("email_action_tokens_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),

    /**
     * AGENTS.md §13.3: every participant mutation verifies the participant/registration
     * binding. `MANAGE_PROFILE` is the one purpose scoped to a participant alone; every other
     * purpose acts on exactly one registration. Both halves are refused here — a profile
     * token cannot carry a registration, and a registration token cannot omit one — so a
     * scope check upstream can never be handed a row that has nothing to check against.
     */
    check(
      "email_action_tokens_registration_scope_matches_purpose",
      sql`(${t.purpose} = 'MANAGE_PROFILE') = (${t.registrationId} IS NULL)`,
    ),

    /**
     * BR-REQ-036-02 criterion 5, enforced by the database.
     *
     * Reissuing a token for the same purpose invalidates the previous ones — a participant
     * who asks for a fresh confirmation link must not leave a second live link in an older
     * email. `issueActionToken` performs that invalidation, and these two partial unique
     * indexes make the rule structural: if the invalidation were ever dropped, the second
     * insert would be refused instead of quietly producing two live tokens.
     *
     * Two indexes because the scope differs by purpose: registration-scoped tokens are unique
     * per (registration, purpose), profile tokens per (participant, purpose). Both cover only
     * rows that are still active, so used and superseded rows accumulate freely for audit.
     */
    uniqueIndex("email_action_tokens_one_active_per_registration_purpose")
      .on(t.registrationId, t.purpose)
      .where(sql`"used_at" IS NULL AND "invalidated_at" IS NULL AND "registration_id" IS NOT NULL`),
    uniqueIndex("email_action_tokens_one_active_per_participant_purpose")
      .on(t.participantId, t.purpose)
      .where(sql`"used_at" IS NULL AND "invalidated_at" IS NULL AND "registration_id" IS NULL`),

    // AGENTS.md §12.8 names both indexes: expiry sweeps and per-scope lookups.
    index("email_action_tokens_participant_purpose_expiry_idx").on(
      t.participantId,
      t.purpose,
      t.expiresAt,
    ),
    index("email_action_tokens_registration_purpose_expiry_idx").on(
      t.registrationId,
      t.purpose,
      t.expiresAt,
    ),
  ],
);
