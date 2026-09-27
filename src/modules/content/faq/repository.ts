import { asc, eq } from "drizzle-orm";
import { faqItems } from "@/db/schema/faq";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { parseRichText, type RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { readFaqPageSettings } from "./page-settings";

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
  /** The answer as a document, for the page's renderer. */
  answer: RichTextDoc;
  /** The answer's words, for the `FAQPage` JSON-LD. */
  answerText: string;
};

/** What the public page, the header and the sitemap need: the page's state and its questions. */
export type PublicFaqPage = { published: boolean; items: PublicFaqItem[] };

export type AdminFaqItem = {
  id: string;
  questionRo: string;
  questionEn: string;
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

/** Every question on the site, in the club's order, in this language. */
export async function listVisibleFaqItems<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicFaqItem[]> {
  const english = locale === "en";
  const rows = await db
    .select({
      id: faqItems.id,
      question: english ? faqItems.questionEn : faqItems.questionRo,
      answerJson: english ? faqItems.answerEnJson : faqItems.answerRoJson,
      answerText: english ? faqItems.answerEn : faqItems.answerRo,
    })
    .from(faqItems)
    .where(eq(faqItems.visible, true))
    .orderBy(asc(faqItems.position), asc(faqItems.createdAt));

  return rows.flatMap((row) => {
    const answer = docOrNull(row.answerJson);
    return answer ? [{ id: row.id, question: row.question, answer, answerText: row.answerText }] : [];
  });
}

/**
 * The page as a visitor may see it: a DRAFT page shows nothing, whatever the questions say — the
 * page's switch is the first gate, each question's own the second.
 */
export async function readPublicFaqPage<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicFaqPage> {
  const settings = await readFaqPageSettings(db);
  if (settings.status !== "PUBLISHED") return { published: false, items: [] };
  return { published: true, items: await listVisibleFaqItems(db, locale) };
}

/** Whether the page is on the site with a question on it — the header's entry and the sitemap's. */
export function faqPageOnSite(page: PublicFaqPage): boolean {
  return page.published && page.items.length > 0;
}

/** Every question, shown or not, in the club's order — the backoffice screen. */
export async function listFaqItemsForAdmin<T extends Record<string, unknown>>(db: Database<T>): Promise<AdminFaqItem[]> {
  const rows = await db
    .select({
      id: faqItems.id,
      questionRo: faqItems.questionRo,
      questionEn: faqItems.questionEn,
      answerRoJson: faqItems.answerRoJson,
      answerEnJson: faqItems.answerEnJson,
      position: faqItems.position,
      visible: faqItems.visible,
      version: faqItems.version,
      updatedAt: faqItems.updatedAt,
    })
    .from(faqItems)
    .orderBy(asc(faqItems.position), asc(faqItems.createdAt));

  return rows.map(({ answerRoJson, answerEnJson, ...row }) => ({
    ...row,
    answerRo: docOrNull(answerRoJson),
    answerEn: docOrNull(answerEnJson),
  }));
}
