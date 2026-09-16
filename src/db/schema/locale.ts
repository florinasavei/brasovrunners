import { pgEnum } from "drizzle-orm/pg-core";

/**
 * The content locales (AGENTS.md §9.1), as a database enum.
 *
 * In a file of its own because four tables need it — events, translations, participants, the
 * outbox and staff users — and two of those reference each other. Keeping the enum where one
 * of the tables lives makes the import graph a cycle: `staff_users` needs the locale from
 * `events`, and `events` needs the staff user for its attribution columns. Drizzle loads these
 * modules eagerly, so a cycle is not a style problem — it is `Cannot access 'locale' before
 * initialization` at migration time.
 */
export const locale = pgEnum("locale", ["ro", "en"]);
