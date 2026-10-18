import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A remembered browser (§NNN, «Vin!» part 1; the owner, 2026-10-18: «I want the flow to be super easy, also later to
 * integrate with the member zone»).
 *
 * After a person uses a «Da, vin» link, their browser carries a long-lived cookie (`br_person`, `httpOnly`) whose
 * value is a secret generated here and shown to the browser once; **only its SHA-256 is stored**
 * (`secret_hash`, checked as 64 hex digits), the same discipline as every email action link (AGENTS.md §13.2). With
 * it «Vin!» and «Nu mai vin» are one tap on any event that takes answers, counted at once: the browser is the
 * proof of an address the person already proved by email (`source: "remembered"`, verified).
 *
 * Not a login and not an account: it opens nothing but the answers (`modules/person-session/`), never a
 * registration, a profile or a staff page; participants still have no passwords (AGENTS.md §10.3). The members'
 * zone reuses the same module for its own one-tap answers (lane 59). A year from the last issue (`expires_at`),
 * forgotten by «Nu sunt eu» (`forgetPerson`), swept when expired (`jobs/retention.ts`), and listed and erased by
 * «all the data of a person» (`registrations/person-data.ts`).
 */
export const personSessions = pgTable(
  "person_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalEmail: text("canonical_email").notNull(),
    deliveryEmail: text("delivery_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    // The name the person gave, to greet them with; null when they gave none.
    displayName: text("display_name"),
    // SHA-256 of the cookie's secret, hex. Never the secret.
    secretHash: text("secret_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("person_sessions_secret_hash_is_sha256_hex", sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
    check("person_sessions_display_name_length", sql`${t.displayName} IS NULL OR char_length(${t.displayName}) <= 80`),
    index("person_sessions_canonical_email_idx").on(t.canonicalEmail),
    index("person_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type PersonSession = typeof personSessions.$inferSelect;
