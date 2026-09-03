import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { locale } from "./events";

/**
 * Participants (AGENTS.md §12.2).
 *
 * A participant has no password and no account. Their identity is one canonical email, and
 * the UNIQUE constraint below is what enforces it — not application code, which can be
 * bypassed by a second concurrent request. See `modules/participants/domain/canonical-email`.
 *
 * `canonicalization_version` records which version of the rules produced `canonical_email`.
 * It exists so that a future rule change is a migration with a known blast radius rather than
 * a silent reinterpretation of rows written under the old rules (BR-REQ-032-04).
 *
 * §12.2 also warns against indexing or logging email beyond operational need: the UNIQUE
 * index on canonical_email is required for correctness, and nothing else here is indexed.
 */
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),

  // What the participant typed, minus surrounding whitespace. Mail goes here.
  deliveryEmail: text("delivery_email").notNull(),
  // Lowercased, submitted domain intact — googlemail stays googlemail.
  normalizedEmail: text("normalized_email").notNull(),
  // The duplicate-detection identity. Immutable in V1: no merge, no verified-email change.
  canonicalEmail: text("canonical_email").notNull().unique(),
  canonicalizationVersion: integer("canonicalization_version").notNull(),

  defaultName: text("default_name").notNull(),
  preferredLocale: locale("preferred_locale").notNull().default("ro"),

  // Null until the participant proves control of the address by following an email link.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
