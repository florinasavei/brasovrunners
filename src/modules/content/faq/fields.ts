import { z } from "zod";
import { EMPTY_DOC, type RichTextDoc, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { hasTable, resolveRichPair, richTextBox } from "@/modules/content/team/fields";
import { refuseOneLanguage, type TextLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";

/**
 * «Întrebări frecvente» (§525), the whole page in one save (§28): a rich-text introduction, both
 * languages or neither (§352), and question cards posted as `faq[<n>].<box>`. A card's question and
 * answer are required in both languages; its category is both or neither. Answers refuse tables,
 * which a fold on a phone cannot hold (§270: a toolbar is not a guard). The blank spare card is
 * not a question; refusals name the box by the posted index (§315).
 */

export const FAQ_QUESTION_MAX = 200;
export const FAQ_CATEGORY_MAX = 60;
/** The answer's words, counted as the page reads them (`richTextToPlainText`). */
export const FAQ_ANSWER_MAX = 3000;
export const FAQ_INTRO_MAX = 3000;
/** The questions a page may hold; the editor's spare card is one more row than this. */
export const FAQ_MAX_QUESTIONS = 100;
/** Rows past this index are never read (§483). */
const FAQ_MAX_ROWS = FAQ_MAX_QUESTIONS + 1;

const ROW_BOXES = ["id", "questionRo", "questionEn", "categoryRo", "categoryEn", "answerRoBody", "answerEnBody", "visible", "remove"] as const;

/** The posted name of one card's box — the editor writes it, the refusal summary links to it. */
export function faqBoxName(index: number, box: (typeof ROW_BOXES)[number]): string {
  return `faq[${index}].${box}`;
}

/** `["items", 2, "questionEn"]` → `faq[2].questionEn`. */
export function faqFieldName(path: readonly PropertyKey[]): string {
  if (path[0] === "items" && typeof path[1] === "number" && typeof path[2] === "string") return faqBoxName(path[1], path[2] as (typeof ROW_BOXES)[number]);
  if (path[0] === "items") return "faq";
  return path.map(String).join(".");
}

/** The posted cards by index; a hole is an empty card (the spare). */
export function faqRowsOf(form: FormData): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const pattern = new RegExp(`^faq\\[(\\d{1,3})\\]\\.(${ROW_BOXES.join("|")})$`);
  for (const [key, entry] of form.entries()) {
    const match = pattern.exec(key);
    if (!match || typeof entry !== "string") continue;
    const index = Number(match[1]);
    if (index >= FAQ_MAX_ROWS) continue;
    rows[index] = { ...(rows[index] ?? {}), [match[2]!]: entry };
  }
  return Array.from(rows, (row) => row ?? {});
}

/** One line, spaces collapsed, trimmed. */
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

const oneLine = (max: number) => z.string().optional().default("").transform(normalizeQuestion).pipe(z.string().max(max));

const rowSchema = z.object({
  id: z.string().trim().max(64).optional().default(""),
  questionRo: oneLine(FAQ_QUESTION_MAX),
  questionEn: oneLine(FAQ_QUESTION_MAX),
  categoryRo: oneLine(FAQ_CATEGORY_MAX),
  categoryEn: oneLine(FAQ_CATEGORY_MAX),
  answerRoBody: richTextBox,
  answerEnBody: richTextBox,
  visible: z.string().optional(),
  remove: z.string().optional(),
});

type RowInput = z.output<typeof rowSchema>;

export type FaqQuestionFields = {
  questionRo: string;
  questionEn: string;
  categoryRo: string | null;
  categoryEn: string | null;
  answerRoJson: RichTextDoc;
  answerEnJson: RichTextDoc;
  answerRo: string;
  answerEn: string;
};

/** One card: a question to write (`fields`) or an id to delete (`remove`); `index` is its posted place. */
export type FaqRow =
  | { index: number; id: string | null; remove: false; visible: boolean; fields: FaqQuestionFields }
  | { index: number; id: string; remove: true };

export type FaqPageFields = {
  intro: { ro: string | null; en: string | null; roJson: RichTextDoc | null; enJson: RichTextDoc | null };
  rows: FaqRow[];
};

const isOn = (value: string | undefined) => value === "on" || value === "true";

/** The spare card: nothing typed and no id. */
function isSpare(row: RowInput): boolean {
  const empty = (doc: RichTextDoc | undefined) => doc === undefined || answerWords(doc) === "";
  return (
    row.id === "" &&
    row.questionRo === "" &&
    row.questionEn === "" &&
    row.categoryRo === "" &&
    row.categoryEn === "" &&
    empty(row.answerRoBody) &&
    empty(row.answerEnBody)
  );
}

function readRow(row: RowInput, index: number, ctx: z.RefinementCtx): FaqRow | null {
  if (row.id !== "" && !isUuid(row.id)) {
    ctx.addIssue({ code: "custom", path: ["items", index, "id"], message: "not a question of this page" });
    return null;
  }
  if (isOn(row.remove)) return row.id === "" ? null : { index, id: row.id, remove: true };
  if (isSpare(row)) return null;

  for (const language of ["ro", "en"] as const satisfies readonly TextLanguage[]) {
    const name = language === "ro" ? "questionRo" : "questionEn";
    if (row[name] === "") ctx.addIssue({ code: "custom", path: ["items", index, name], message: "the question is required in both languages" });
  }
  refuseOneLanguage(ctx, { ro: row.categoryRo, en: row.categoryEn }, { ro: ["items", index, "categoryRo"], en: ["items", index, "categoryEn"] }, `question ${index + 1}: the category`);

  const answers = {} as Record<TextLanguage, { doc: RichTextDoc; words: string }>;
  for (const language of ["ro", "en"] as const) {
    const name = language === "ro" ? "answerRoBody" : "answerEnBody";
    const doc = row[name] ?? EMPTY_DOC;
    const words = answerWords(doc);
    answers[language] = { doc, words };
    if (hasTable(doc)) {
      ctx.addIssue({ code: "custom", path: ["items", index, name], message: "an answer may not hold a table" });
    }
    if (words === "") {
      ctx.addIssue({ code: "custom", path: ["items", index, name], message: "the answer is required in both languages" });
    } else if (words.length > FAQ_ANSWER_MAX) {
      ctx.addIssue({ code: "custom", path: ["items", index, name], message: `the answer is longer than ${FAQ_ANSWER_MAX} characters` });
    }
  }

  const bothCategories = row.categoryRo !== "" && row.categoryEn !== "";
  return {
    index,
    id: row.id === "" ? null : row.id,
    remove: false,
    visible: isOn(row.visible),
    fields: {
      questionRo: row.questionRo,
      questionEn: row.questionEn,
      categoryRo: bothCategories ? row.categoryRo : null,
      categoryEn: bothCategories ? row.categoryEn : null,
      answerRoJson: answers.ro.doc,
      answerEnJson: answers.en.doc,
      answerRo: answers.ro.words,
      answerEn: answers.en.words,
    },
  };
}

export const faqPageFieldsSchema = z
  .object({
    /** Absent reads as empty. */
    introRoBody: richTextBox,
    introEnBody: richTextBox,
    items: z.array(rowSchema).max(FAQ_MAX_ROWS).optional().default([]),
  })
  .transform((input, ctx): FaqPageFields => {
    const intro = resolveRichPair(
      ctx,
      { ro: { plain: "", body: input.introRoBody }, en: { plain: "", body: input.introEnBody } },
      { ro: { plain: "introRoBody", body: "introRoBody" }, en: { plain: "introEnBody", body: "introEnBody" } },
    // A table fits in the page's own column (§474).
      { max: FAQ_INTRO_MAX, tables: true, what: "the introduction" },
    );
    const rows = input.items.flatMap((row, index) => readRow(row, index, ctx) ?? []);
    if (rows.filter((row) => !row.remove).length > FAQ_MAX_QUESTIONS) {
      ctx.addIssue({ code: "custom", path: ["items"], message: `at most ${FAQ_MAX_QUESTIONS} questions` });
    }
    const ids = rows.flatMap((row) => (row.id ? [row.id] : []));
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "a question was posted twice" });
    }
    return {
      intro: { ro: intro.ro.plain, en: intro.en.plain, roJson: intro.ro.doc, enJson: intro.en.doc },
      rows,
    };
  });

/** A move pressed on a card, `"<n>:up"` / `"<n>:down"` — a save button, so no typed word is lost. */
export function parseFaqMove(value: string | null | undefined): { index: number; direction: "up" | "down" } | null {
  const match = /^(\d{1,3}):(up|down)$/.exec(value ?? "");
  return match ? { index: Number(match[1]), direction: match[2] as "up" | "down" } : null;
}
