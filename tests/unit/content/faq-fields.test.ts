import { describe, expect, it } from "vitest";
import {
  FAQ_ANSWER_MAX,
  FAQ_QUESTION_MAX,
  faqFieldName,
  faqPageFieldsSchema,
  faqRowsOf,
  parseFaqMove,
} from "@/modules/content/faq/fields";
import { groupFaqItems, type PublicFaqItem } from "@/modules/content/faq/repository";
import { faqPageJsonLd } from "@/modules/content/faq/structured-data";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";

/**
 * §NNN — «Întrebări frecvente»: what the page's one save accepts and refuses (the introduction and
 * every card), how the cards are read from the form, the categories' grouping, and the page's
 * `FAQPage` JSON-LD.
 */

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const card = (overrides: Record<string, string | undefined> = {}) => ({
  questionRo: "Cum mă înscriu?",
  questionEn: "How do I register?",
  answerRoBody: JSON.stringify(doc("Din pagina evenimentului.")),
  answerEnBody: JSON.stringify(doc("From the event's page.")),
  ...overrides,
});

const refusedBoxes = (input: Record<string, unknown>) => {
  const parsed = faqPageFieldsSchema.safeParse(input);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((issue) => faqFieldName(issue.path)))].sort();
};

describe("§NNN the FAQ page's fields", () => {
  it("keeps each question on one line, each answer as a document with its words, and drops the empty spare card", () => {
    const parsed = faqPageFieldsSchema.parse({
      items: [card({ questionRo: "  Cum\n mă   înscriu?  ", answerRoBody: JSON.stringify(doc("Din pagina", "evenimentului.")) }), {}],
    });
    expect(parsed.rows).toHaveLength(1);
    const [row] = parsed.rows;
    if (row.remove) throw new Error("expected a question");
    expect(row).toMatchObject({ index: 0, id: null, visible: false });
    expect(row.fields.questionRo).toBe("Cum mă înscriu?");
    expect(row.fields.answerRoJson).toEqual(doc("Din pagina", "evenimentului."));
    expect(row.fields.answerRo).toBe("Din pagina\nevenimentului.");
    expect(row.fields).toMatchObject({ categoryRo: null, categoryEn: null });
    expect(parsed.intro).toEqual({ ro: null, en: null, roJson: null, enJson: null });
  });

  it("requires the question and the answer in both languages, naming the empty box by its card", () => {
    expect(refusedBoxes({ items: [card({ questionEn: "  " })] })).toEqual(["faq[0].questionEn"]);
    expect(refusedBoxes({ items: [card(), card({ questionRo: "" })] })).toEqual(["faq[1].questionRo"]);
    expect(refusedBoxes({ items: [card({ answerEnBody: "" })] })).toEqual(["faq[0].answerEnBody"]);
    expect(refusedBoxes({ items: [card({ answerRoBody: JSON.stringify(doc("   ")) })] })).toEqual(["faq[0].answerRoBody"]);
  });

  it("takes a «Categorie» in both languages or neither", () => {
    expect(refusedBoxes({ items: [card({ categoryRo: "Înscriere" })] })).toEqual(["faq[0].categoryEn"]);
    const [row] = faqPageFieldsSchema.parse({ items: [card({ categoryRo: " Înscriere ", categoryEn: "Registration" })] }).rows;
    expect(row).toMatchObject({ fields: { categoryRo: "Înscriere", categoryEn: "Registration" } });
  });

  it("accepts a picture in an answer and refuses a table, which a fold on a phone cannot hold", () => {
    const withImage = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Vezi harta." }] },
        { type: "image", attrs: { src: "/api/media/local/2b0f6f0e-9b1c-4c55-8a7a-1f2e3d4c5b6a/web.webp", alt: "harta" } },
      ],
    };
    const image = faqPageFieldsSchema.safeParse({ items: [card({ answerRoBody: JSON.stringify(withImage) })] });
    expect(image.success).toBe(true);
    const withTable = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Taxe" }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] },
      ],
    };
    expect(refusedBoxes({ items: [card({ answerEnBody: JSON.stringify(withTable) })] })).toEqual(["faq[0].answerEnBody"]);
  });

  it("refuses a question or an answer over its limit, and a body that is not a document", () => {
    expect(refusedBoxes({ items: [card({ questionRo: "x".repeat(FAQ_QUESTION_MAX + 1) })] })).toEqual(["faq[0].questionRo"]);
    expect(refusedBoxes({ items: [card({ answerEnBody: JSON.stringify(doc("y".repeat(FAQ_ANSWER_MAX + 1))) })] })).toEqual(["faq[0].answerEnBody"]);
    expect(refusedBoxes({ items: [card({ answerEnBody: "{not json" })] })).toEqual(["faq[0].answerEnBody"]);
  });

  it("reads a ticked «Șterge» on a stored card as a deletion, whatever its boxes say, and drops it on a new card", () => {
    const id = "2b0f6f0e-9b1c-4c55-8a7a-1f2e3d4c5b6a";
    const parsed = faqPageFieldsSchema.parse({ items: [{ id, remove: "on", questionRo: "" }, card({ remove: "on" })] });
    expect(parsed.rows).toEqual([{ index: 0, id, remove: true }]);
    expect(refusedBoxes({ items: [card({ id: "not-an-id" })] })).toEqual(["faq[0].id"]);
  });

  it("keeps the introduction both languages or neither", () => {
    expect(refusedBoxes({ introRoBody: JSON.stringify(doc("Bun venit.")), introEnBody: "" })).toEqual(["introEnBody"]);
    const parsed = faqPageFieldsSchema.parse({ introRoBody: JSON.stringify(doc("Bun venit.")), introEnBody: JSON.stringify(doc("Welcome.")) });
    expect(parsed.intro).toMatchObject({ ro: "Bun venit.", en: "Welcome.", roJson: doc("Bun venit.") });
  });
});

describe("§NNN the cards as the form posts them", () => {
  it("reads `faq[n].box` into rows by index, a hole as an empty card, and nothing past the editor's rows", () => {
    const form = new FormData();
    form.append("faq[0].questionRo", "A?");
    form.append("faq[2].questionEn", "C?");
    form.append("faq[2].visible", "on");
    form.append("faq[999].questionRo", "past the end");
    form.append("faq[0].unknown", "x");
    form.append("questionRo", "not a card");
    expect(faqRowsOf(form)).toEqual([{ questionRo: "A?" }, {}, { questionEn: "C?", visible: "on" }]);
  });

  it("reads an arrow's value, and nothing else, as a move", () => {
    expect(parseFaqMove("2:up")).toEqual({ index: 2, direction: "up" });
    expect(parseFaqMove("0:down")).toEqual({ index: 0, direction: "down" });
    expect(parseFaqMove("x:up")).toBeNull();
    expect(parseFaqMove("")).toBeNull();
    expect(parseFaqMove(null)).toBeNull();
  });
});

const item = (question: string, category: string | null = null, answerText = "Răspuns."): PublicFaqItem => ({
  id: question,
  question,
  category,
  answer: doc(answerText) as never,
  answerText,
});

describe("§NNN the questions grouped under their categories", () => {
  it("puts the questions with no category first, then each category where its first question sits, the order kept inside", () => {
    const groups = groupFaqItems([item("A?", "Înscriere"), item("B?"), item("C?", "Traseu"), item("D?", "Înscriere"), item("E?")]);
    expect(groups.map((group) => [group.category, group.items.map((entry) => entry.question)])).toEqual([
      [null, ["B?", "E?"]],
      ["Înscriere", ["A?", "D?"]],
      ["Traseu", ["C?"]],
    ]);
  });

  it("is one group under no heading when no question has a category, and nothing for no question", () => {
    expect(groupFaqItems([item("A?"), item("B?")])).toEqual([{ category: null, items: [item("A?"), item("B?")] }]);
    expect(groupFaqItems([])).toEqual([]);
  });
});

describe("§NNN the FAQ page's JSON-LD", () => {
  it("is an FAQPage of the page's questions in order, each with its answer's words", () => {
    const data = faqPageJsonLd([item("Cum mă înscriu?", null, "Din pagina evenimentului."), item("Ce aduc?", "Echipament", "Apă.")], "https://club.test/ro/intrebari", "ro");
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: "https://club.test/ro/intrebari",
      inLanguage: "ro",
      mainEntity: [
        { "@type": "Question", name: "Cum mă înscriu?", acceptedAnswer: { "@type": "Answer", text: "Din pagina evenimentului." } },
        { "@type": "Question", name: "Ce aduc?", acceptedAnswer: { "@type": "Answer", text: "Apă." } },
      ],
    });
  });

  it("is nothing for a page with no question", () => {
    expect(faqPageJsonLd([], "https://club.test/en/faq", "en")).toBeNull();
  });
});

describe("§NNN «Copiază și tradu tot» and «Tradu cardul» fill a card's English boxes", () => {
  it("allows a card's question, category and answer and the introduction, and finds each one's Romanian twin", () => {
    expect(isTranslatableEnglishField("faq[3].questionEn")).toBe(true);
    expect(isTranslatableEnglishField("faq[3].categoryEn")).toBe(true);
    expect(isTranslatableEnglishField("faq[3].answerEnBody")).toBe(true);
    expect(isTranslatableEnglishField("introEnBody")).toBe(true);
    expect(isRichTextField("faq[3].answerEnBody")).toBe(true);
    expect(isRichTextField("faq[3].questionEn")).toBe(false);
    expect(romanianTwinCandidates("faq[3].questionEn")[0]).toBe("faq[3].questionRo");
    expect(romanianTwinCandidates("faq[3].categoryEn")[0]).toBe("faq[3].categoryRo");
    expect(romanianTwinCandidates("faq[3].answerEnBody")).toEqual(["faq[3].answerRoBody"]);
    // The Romanian boxes are never a target, nor the card's own controls.
    expect(isTranslatableEnglishField("faq[3].questionRo")).toBe(false);
    expect(isTranslatableEnglishField("faq[3].answerRoBody")).toBe(false);
    expect(isTranslatableEnglishField("faq[3].id")).toBe(false);
  });
});
