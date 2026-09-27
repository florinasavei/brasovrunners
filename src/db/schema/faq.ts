import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "./staff-users";

/**
 * «Întrebări frecvente» / "FAQ" (§525): the questions a runner asks the club before a first run,
 * one row each, on a platform page of its own — like «Echipa» (§459), not a standing page the club
 * writes from nothing, because the page has a fixed shape (a question, its answer, in folds,
 * grouped under the club's categories) and a search engine reads it as an `FAQPage` only when that
 * shape holds.
 *
 * A question is the club's own text, so it is Romanian **and** English (§352) — and a question
 * with no words is no question, so both are required, not "both or neither". The optional
 * «Categorie» groups the questions on the page, both languages or neither. The answer is written
 * in the rich-text editor every page uses (§72, §474) — words, links and pictures (§414) — and
 * kept as its document, both languages required; `answer_ro` / `answer_en` carry its plain words
 * (`richTextToPlainText`), written by every save, for the page's `FAQPage` JSON-LD.
 *
 * The page's own switch, its version and its introduction live in the `faqPage` platform setting
 * (`modules/content/faq/page-settings.ts`); the whole page is one save (§28).
 *
 * Nothing about a person: a question and an answer.
 */
export const faqQuestions = pgTable(
  "faq_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The question, one line, in each language. */
    questionRo: text("question_ro").notNull(),
    questionEn: text("question_en").notNull(),
    /** «Categorie»: the heading the question sits under on the page, both languages or neither. */
    categoryRo: text("category_ro"),
    categoryEn: text("category_en"),
    /** The answer as the rich-text editor wrote it, in each language. */
    answerRoJson: jsonb("answer_ro_json").notNull(),
    answerEnJson: jsonb("answer_en_json").notNull(),
    /** The answer's words (`richTextToPlainText`), written with the document by every save. */
    answerRo: text("answer_ro").notNull(),
    answerEn: text("answer_en").notNull(),

    /** Where the question sits on the page, lowest first — the order of the cards in the editor. */
    position: integer("position").notNull(),
    /**
     * Whether the question is on the site. A new one starts hidden unless an Administrator ticks
     * «Pe site» on it, as a team card is shown (§201, §459).
     */
    visible: boolean("visible").notNull().default(false),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    /** Bumped by every save that touches the row; the page's version guards the save (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("faq_questions_questions_present", sql`length(btrim(${t.questionRo})) > 0 AND length(btrim(${t.questionEn})) > 0`),
    check("faq_questions_category_pair", sql`(${t.categoryRo} IS NULL) = (${t.categoryEn} IS NULL)`),
    check("faq_questions_position_positive", sql`${t.position} >= 1`),
    check("faq_questions_version_positive", sql`${t.version} >= 1`),
    index("faq_questions_visible_position_idx").on(t.visible, t.position),
  ],
);

export type FaqQuestion = typeof faqQuestions.$inferSelect;
