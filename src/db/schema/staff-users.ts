import { sql } from "drizzle-orm";
import { check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { locale } from "./locale";

/**
 * The three staff roles of AGENTS.md §10.2. A database enum, so a row with role `SUPERUSER`
 * cannot exist even if application code is bypassed (BR-REQ-060-01).
 */
export const staffRole = pgEnum("staff_role", ["AUTHOR", "EDITOR", "ADMIN"]);

/**
 * Staff users. AGENTS.md §12.1.
 *
 * Two departures from the shape §12.1 wrote down, both recorded in DECISIONS.md §24:
 *
 *   1. The subject column is `auth_subject`, not `zitadel_subject`. The direction is Auth.js
 *      alone with a server-side allowlist and no external identity provider, so naming the
 *      column after a product the club never bought would encode the abandoned plan in the
 *      schema — and a rename after rows exist is a migration nobody wants to write.
 *   2. It is nullable. An Administrator invites a colleague by email and role before that
 *      person has ever signed in, and until they do there is no subject to store. The row is
 *      the allowlist entry: no row, no access, whatever an identity provider asserts.
 *
 * No password and no provider token is stored here, ever.
 *
 * Until the real login exists, the only writer of `auth_subject` is the development staff
 * switcher (AGENTS.md §13.1), whose synthetic subjects are prefixed `dev:` and which refuses
 * to run outside local and test.
 */
export const staffUsers = pgTable(
  "staff_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The provider's immutable subject claim, or null until this person first signs in. */
    authSubject: text("auth_subject").unique(),

    /**
     * The allowlist key, lowercased. Unique, because two rows for one address is two answers
     * to "what may this person do" and the code would take whichever the database returned
     * first.
     */
    email: text("email").notNull().unique(),

    displayName: text("display_name").notNull(),
    preferredLocale: locale("preferred_locale").notNull().default("ro"),
    role: staffRole("role").notNull(),

    /** When an Administrator added this person. The invitation is the row itself. */
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    /** First successful sign-in, or null while the invitation is outstanding. */
    firstSignedInAt: timestamp("first_signed_in_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Lowercase at the database as well as in the service: an invitation typed as
    // "Ana@Example.test" and a sign-in asserting "ana@example.test" must be one person, and a
    // second row for the same address would be a second, contradictory permission set.
    check("staff_users_email_is_lowercase", sql`${t.email} = lower(${t.email})`),
    // A subject only ever arrives with a sign-in, and a sign-in only ever arrives with a
    // subject. Either alone means the sign-in path wrote half a row.
    check(
      "staff_users_signed_in_has_subject",
      sql`(${t.authSubject} IS NULL) = (${t.firstSignedInAt} IS NULL)`,
    ),
  ],
);

export type StaffUser = typeof staffUsers.$inferSelect;
