import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { editorialStatus } from "./events";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * Standing pages: "About Brașov Runners", "Contact", and whatever else the club needs to say
 * that is not an event (BR-REQ-050-03, `DECISIONS.md` §51).
 *
 * ## What this deliberately is not
 *
 * It is not the M5 content system. There are no galleries, no media library, no cover images
 * and no Tiptap. The body is the same plain-text format the legal-document editor already uses
 * — a blank line between paragraphs, `## ` for a heading — converted by
 * `modules/legal-documents/domain/body-text.ts`, which round-trips. Pulling Tiptap forward to
 * write an About page would decide the M5 body schema for the wrong reason, exactly as
 * `DECISIONS.md` §46 refused to for a privacy notice.
 *
 * ## What it reuses rather than reinvents
 *
 * The editorial status enum is `events`', not a second one: DRAFT → IN_REVIEW → PUBLISHED →
 * ARCHIVED means the same thing here, the same roles may make the same transitions, and two
 * enums with the same four values would drift. Publication is likewise one state for the whole
 * page with a complete translation required in every locale (`AGENTS.md` §11.2), because a page
 * that exists in Romanian and 404s in English is the failure BR-REQ-040-02 forbids.
 */
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    editorialStatus: editorialStatus("editorial_status").notNull().default("DRAFT"),
    /** Stamped on first publication and never touched again — it is what slug stability dates from. */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /**
     * Where this page sits in the site navigation, lowest first.
     *
     * An integer rather than a drag handle: `docs/PRACTICES.md` § Accessibility requires a
     * non-drag alternative for any reordering anyway, and with three pages a number is the
     * alternative rather than a fallback to one.
     */
    navOrder: integer("nav_order").notNull().default(0),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    /** Optimistic concurrency, exactly as `events.version` is (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("pages_version_positive", sql`${t.version} >= 1`),
    // The same invariant `events` carries: PUBLISHED without a date is a row whose slug
    // stability has no start.
    check(
      "pages_published_has_date",
      sql`${t.editorialStatus} <> 'PUBLISHED' OR ${t.publishedAt} IS NOT NULL`,
    ),
  ],
);

export const pageTranslations = pgTable(
  "page_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    locale: locale("locale").notNull(),

    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /**
     * Sections, each with an optional heading and its paragraphs — the shape
     * `legal_documents.body_json` uses, and the reason this reuses that converter rather than
     * inventing a second text format for the club to learn.
     */
    bodyJson: jsonb("body_json"),

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    authorStaffUserId: uuid("author_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("page_translations_page_locale_unique").on(t.pageId, t.locale),
    /**
     * Slugs are scoped per locale, like an event's, so `ro` and `en` may each use "contact".
     *
     * They are *not* scoped against `event_translations`: the two live under different path
     * prefixes (`/evenimente/…` and `/pagini/…`), so "contact" as both an event and a page is
     * two distinct URLs rather than a collision.
     */
    unique("page_translations_locale_slug_unique").on(t.locale, t.slug),
    check("page_translations_version_positive", sql`${t.version} >= 1`),
    // The half a CHECK can honestly state about "complete"; the rest is asserted in the service,
    // because it reads rows in another table.
    check(
      "page_translations_required_fields_present",
      sql`length(btrim(${t.title})) > 0 AND length(btrim(${t.slug})) > 0`,
    ),
  ],
);

export type Page = typeof pages.$inferSelect;
export type PageTranslation = typeof pageTranslations.$inferSelect;
