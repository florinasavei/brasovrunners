import { asc, eq } from "drizzle-orm";
import { faqQuestions } from "@/db/schema/faq";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { parseRichText, type RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { faqIntroFor, readFaqPageSettings } from "./page-settings";

/**
 * Reads for «Întrebări frecvente» (§NNN), public and backoffice.
 *
 * The public read names its columns (BR-REQ-070-01), reads only the questions shown on the site,
 * and gives each the words of the page's own language alone — never the other language's (§28).
 * A stored document this code cannot read (only a hand-made row can hold one) drops the question
 * from the page rather than failing the page.
 */

export type PublicFaqItem = {
  id: string;
  question: string;
  /** «Categorie» in this language, or null for a question under no heading. */
  category: string | null;
  /** The answer as a document, for the page's renderer. */
  answer: RichTextDoc;
  /** The answer's words, for the `FAQPage` JSON-LD. */
  answerText: string;
};

/**
 * What the public page, the header, the footer and the sitemap need: the page's state, the club's
 * introduction in this language (null unless written in both), and its questions.
 */
export type PublicFaqPage = {
  published: boolean;
  intro: RichTextDoc | null;
  introText: string | null;
  items: PublicFaqItem[];
};

/** The questions under one heading, in the club's order; `category` null for those under none. */
export type FaqGroup = { category: string | null; items: PublicFaqItem[] };

export type AdminFaqItem = {
  id: string;
  questionRo: string;
  questionEn: string;
  categoryRo: string | null;
  categoryEn: string | null;
  answerRo: RichTextDoc | null;
  answerEn: RichTextDoc | null;
  position: number;
  visible: boolean;
  version: number;
  updatedAt: Date;
};

function docOrNull(value: unknown): RichTextDoc | null {
  try {
    return parseRichText(value);
  } catch {
    return null;
  }
}

/**
 * The page's questions grouped under their «Categorie» (§NNN), each group where its first question
 * sits in the club's order, the questions keeping that order inside it. The questions with no
 * category come first, under no heading: a heading-less group after a headed one would read as
 * part of it.
 */
export function groupFaqItems(items: readonly PublicFaqItem[]): FaqGroup[] {
  const loose: PublicFaqItem[] = [];
  const groups = new Map<string, PublicFaqItem[]>();
  for (const item of items) {
    if (item.category === null) {
      loose.push(item);
      continue;
    }
    const group = groups.get(item.category);
    if (group) group.push(item);
    else groups.set(item.category, [item]);
  }
  const headed = [...groups].map(([category, grouped]) => ({ category, items: grouped }));
  return loose.length > 0 ? [{ category: null, items: loose }, ...headed] : headed;
}

/** Every question on the site, in the club's order, in this language. */
export async function listVisibleFaqItems<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicFaqItem[]> {
  const english = locale === "en";
  const rows = await db
    .select({
      id: faqQuestions.id,
      question: english ? faqQuestions.questionEn : faqQuestions.questionRo,
      category: english ? faqQuestions.categoryEn : faqQuestions.categoryRo,
      answerJson: english ? faqQuestions.answerEnJson : faqQuestions.answerRoJson,
      answerText: english ? faqQuestions.answerEn : faqQuestions.answerRo,
    })
    .from(faqQuestions)
    .where(eq(faqQuestions.visible, true))
    .orderBy(asc(faqQuestions.position), asc(faqQuestions.createdAt));

  return rows.flatMap((row) => {
    const answer = docOrNull(row.answerJson);
    return answer ? [{ id: row.id, question: row.question, category: row.category, answer, answerText: row.answerText }] : [];
  });
}

/**
 * The page as a visitor may see it: a DRAFT page shows nothing, whatever the questions say — the
 * page's switch is the first gate, each question's own the second.
 */
export async function readPublicFaqPage<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicFaqPage> {
  const settings = await readFaqPageSettings(db);
  if (settings.status !== "PUBLISHED") return { published: false, intro: null, introText: null, items: [] };
  const intro = faqIntroFor(locale, settings);
  return { published: true, intro: intro.doc, introText: intro.text, items: await listVisibleFaqItems(db, locale) };
}

/** Whether the page is on the site with a question on it — the header's entry, the footer's, the contact page's and the sitemap's. */
export function faqPageOnSite(page: PublicFaqPage): boolean {
  return page.published && page.items.length > 0;
}

/** Every question, shown or not, in the club's order — the backoffice screen. */
export async function listFaqItemsForAdmin<T extends Record<string, unknown>>(db: Database<T>): Promise<AdminFaqItem[]> {
  const rows = await db
    .select({
      id: faqQuestions.id,
      questionRo: faqQuestions.questionRo,
      questionEn: faqQuestions.questionEn,
      categoryRo: faqQuestions.categoryRo,
      categoryEn: faqQuestions.categoryEn,
      answerRoJson: faqQuestions.answerRoJson,
      answerEnJson: faqQuestions.answerEnJson,
      position: faqQuestions.position,
      visible: faqQuestions.visible,
      version: faqQuestions.version,
      updatedAt: faqQuestions.updatedAt,
    })
    .from(faqQuestions)
    .orderBy(asc(faqQuestions.position), asc(faqQuestions.createdAt));

  return rows.map(({ answerRoJson, answerEnJson, ...row }) => ({
    ...row,
    answerRo: docOrNull(answerRoJson),
    answerEn: docOrNull(answerEnJson),
  }));
}
