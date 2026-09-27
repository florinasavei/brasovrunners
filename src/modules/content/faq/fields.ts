import { z } from "zod";
import { EMPTY_DOC, type RichTextBlock, type RichTextDoc, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { richTextBox } from "@/modules/content/team/fields";
import type { TextLanguage } from "@/shared/forms/both-languages";

/**
 * What the club types for one question of «Întrebări frecvente» (§NNN).
 *
 * **The question**, one line, Romanian **and** English — both required: the club's text is
 * bilingual always (§352), and a question with no words in either language is not a question, so
 * "both or neither" becomes "both". **The answer**, written in the rich-text editor every page uses
 * (§72, §474), both languages required for the same reason; "written" is "has words", since the
 * answer is words alone:
 *
 * - **No picture, no film, no table.** An answer is a few sentences a search engine reads as the
 *   `FAQPage`'s `acceptedAnswer` text, and a fold on a phone; a picture there would be a
 *   reference the orphan sweep must count (§73) for a page whose job is words. The toolbar does
 *   not offer them and the save refuses them (§270: a toolbar is not a guard).
 * - Paragraphs, lists, bold, italic, a link in the text, a subheading, a quote — the rest of the
 *   allowlist.
 *
 * One side written and the other empty is refused on the empty box, every other box kept (§315).
 */

export const FAQ_QUESTION_MAX = 200;
/** The answer's words, counted as the page reads them (`richTextToPlainText`). */
export const FAQ_ANSWER_MAX = 3000;

/** The block types an answer may not hold — top-level only, as a list item and a quote hold paragraphs (`schema.ts`). */
const REFUSED_IN_ANSWER: ReadonlySet<RichTextBlock["type"]> = new Set(["image", "youtube", "table"]);

/** Whether a document holds a picture, a film or a table — refused in an answer. */
export function hasRefusedBlock(doc: RichTextDoc): boolean {
  return (doc.content ?? []).some((block) => REFUSED_IN_ANSWER.has(block.type));
}

/** A question as the page keeps it: one line, spaces collapsed, trimmed. */
export function normalizeQuestion(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** An answer's words: the document's plain text, lines kept, spaces collapsed within them. */
export function answerWords(doc: RichTextDoc): string {
  return richTextToPlainText(doc)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

const question = z.string().optional().default("").transform(normalizeQuestion).pipe(z.string().max(FAQ_QUESTION_MAX));

export const faqItemFieldsSchema = z
  .object({
    questionRo: question,
    questionEn: question,
    /** The answer as the rich-text editor posts it; absent reads as empty. */
    answerRoBody: richTextBox,
    answerEnBody: richTextBox,
  })
  .transform((fields, ctx) => {
    for (const language of ["ro", "en"] as const satisfies readonly TextLanguage[]) {
      const name = language === "ro" ? "questionRo" : "questionEn";
      if (fields[name] === "") {
        ctx.addIssue({ code: "custom", path: [name], message: "the question is required in both languages" });
      }
    }
    const answers = {} as Record<TextLanguage, { doc: RichTextDoc; words: string }>;
    for (const language of ["ro", "en"] as const) {
      const name = language === "ro" ? "answerRoBody" : "answerEnBody";
      const doc = fields[name] ?? EMPTY_DOC;
      const words = answerWords(doc);
      answers[language] = { doc, words };
      if (hasRefusedBlock(doc)) {
        ctx.addIssue({ code: "custom", path: [name], message: "an answer holds words only: no picture, film or table" });
      }
      if (words === "") {
        ctx.addIssue({ code: "custom", path: [name], message: "the answer is required in both languages" });
      } else if (words.length > FAQ_ANSWER_MAX) {
        ctx.addIssue({ code: "custom", path: [name], message: `the answer is longer than ${FAQ_ANSWER_MAX} characters` });
      }
    }
    return {
      questionRo: fields.questionRo,
      questionEn: fields.questionEn,
      answerRoJson: answers.ro.doc,
      answerEnJson: answers.en.doc,
      answerRo: answers.ro.words,
      answerEn: answers.en.words,
    };
  });

export type FaqItemFields = z.output<typeof faqItemFieldsSchema>;
