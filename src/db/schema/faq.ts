import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "./staff-users";

/**
 * «Întrebări frecvente» / "FAQ" (§NNN): the questions a runner asks the club before a first run,
 * one row each, on a platform page of its own — like «Echipa» (§459), not a standing page the club
 * writes from nothing, because the page has a fixed shape (a question, its answer, in folds) and a
 * search engine reads it as an `FAQPage` only when that shape holds.
 *
 * A question is the club's own text, so it is Romanian **and** English (§352) — and a question
 * with no words is no question, so both are required, not "both or neither". The answer is written
 * in the rich-text editor every page uses (§72, §474) and kept as its document, both languages
 * required; `answer_ro` / `answer_en` carry its plain words (`richTextToPlainText`), written by
 * every save, for the page's `FAQPage` JSON-LD and for a reader that wants words, not a document.
 *
 * Nothing about a person: a question and an answer.
 */
export const faqItems = pgTable(
  "faq_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The question, one line, in each language. */
    questionRo: text("question_ro").notNull(),
    questionEn: text("question_en").notNull(),
    /** The answer as the rich-text editor wrote it, in each language. */
    answerRoJson: jsonb("answer_ro_json").notNull(),
    answerEnJson: jsonb("answer_en_json").notNull(),
    /** The answer's words (`richTextToPlainText`), written with the document by every save. */
    answerRo: text("answer_ro").notNull(),
    answerEn: text("answer_en").notNull(),

    /** Where the question sits on the page, lowest first, moved with two arrows as «Echipa»'s cards are. */
    position: integer("position").notNull(),
    /**
     * Whether the question is on the site. A new one starts hidden: it goes up when an
     * Administrator shows it, as a team card does (§201, §459).
     */
    visible: boolean("visible").notNull().default(false),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    /** Optimistic concurrency, as `pages.version` is (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("faq_items_questions_present", sql`length(btrim(${t.questionRo})) > 0 AND length(btrim(${t.questionEn})) > 0`),
    check("faq_items_position_positive", sql`${t.position} >= 1`),
    check("faq_items_version_positive", sql`${t.version} >= 1`),
    index("faq_items_visible_position_idx").on(t.visible, t.position),
  ],
);

export type FaqItem = typeof faqItems.$inferSelect;
