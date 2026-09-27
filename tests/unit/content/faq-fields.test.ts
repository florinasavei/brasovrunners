import { describe, expect, it } from "vitest";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, faqItemFieldsSchema } from "@/modules/content/faq/fields";
import type { PublicFaqItem } from "@/modules/content/faq/repository";
import { faqPageJsonLd } from "@/modules/content/faq/structured-data";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";

/**
 * §NNN — «Întrebări frecvente»: what a question's save accepts and refuses, and the page's
 * `FAQPage` JSON-LD.
 */

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const posted = (overrides: Record<string, string | undefined> = {}) => ({
  questionRo: "Cum mă înscriu?",
  questionEn: "How do I register?",
  answerRoBody: JSON.stringify(doc("Din pagina evenimentului.")),
  answerEnBody: JSON.stringify(doc("From the event's page.")),
  ...overrides,
});

const refusedBoxes = (input: Record<string, unknown>) => {
  const parsed = faqItemFieldsSchema.safeParse(input);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].sort();
};

describe("§NNN a question's fields", () => {
  it("keeps both questions on one line and each answer as a document with its words", () => {
    const parsed = faqItemFieldsSchema.parse(
      posted({ questionRo: "  Cum\n mă   înscriu?  ", answerRoBody: JSON.stringify(doc("Din pagina", "evenimentului.")) }),
    );
    expect(parsed.questionRo).toBe("Cum mă înscriu?");
    expect(parsed.answerRoJson).toEqual(doc("Din pagina", "evenimentului."));
    expect(parsed.answerRo).toBe("Din pagina\nevenimentului.");
    expect(parsed.answerEn).toBe("From the event's page.");
  });

  it("requires the question and the answer in both languages, naming the empty box", () => {
    expect(refusedBoxes(posted({ questionEn: "  " }))).toEqual(["questionEn"]);
    expect(refusedBoxes(posted({ questionRo: "" }))).toEqual(["questionRo"]);
    expect(refusedBoxes(posted({ answerEnBody: "" }))).toEqual(["answerEnBody"]);
    expect(refusedBoxes(posted({ answerRoBody: undefined }))).toEqual(["answerRoBody"]);
    // A heading with no words is no answer.
    expect(refusedBoxes(posted({ answerRoBody: JSON.stringify(doc("   ")) }))).toEqual(["answerRoBody"]);
    expect(refusedBoxes({})).toEqual(["answerEnBody", "answerRoBody", "questionEn", "questionRo"]);
  });

  it("refuses a picture, a film or a table in an answer, which the toolbar does not offer", () => {
    const withImage = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Vezi harta." }] },
        { type: "image", attrs: { src: "https://example.test/x.webp", alt: "harta" } },
      ],
    };
    const parsed = faqItemFieldsSchema.safeParse(posted({ answerRoBody: JSON.stringify(withImage) }));
    // Either the allowlist refuses the node outright or the answer's rule does: the box is named either way.
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("answerRoBody");
  });

  it("refuses a question or an answer over its limit, and a body that is not a document", () => {
    expect(refusedBoxes(posted({ questionRo: "x".repeat(FAQ_QUESTION_MAX + 1) }))).toEqual(["questionRo"]);
    expect(refusedBoxes(posted({ answerEnBody: JSON.stringify(doc("y".repeat(FAQ_ANSWER_MAX + 1))) }))).toEqual(["answerEnBody"]);
    expect(refusedBoxes(posted({ answerEnBody: "{not json" }))).toEqual(["answerEnBody"]);
    expect(refusedBoxes(posted({ answerEnBody: JSON.stringify({ type: "doc", content: [{ type: "script" }] }) }))).toEqual(["answerEnBody"]);
  });
});

describe("§NNN the FAQ page's JSON-LD", () => {
  const item = (question: string, answerText: string): PublicFaqItem => ({ id: question, question, answer: doc(answerText) as never, answerText });

  it("is an FAQPage of the page's questions in order, each with its answer's words", () => {
    const data = faqPageJsonLd([item("Cum mă înscriu?", "Din pagina evenimentului."), item("Ce aduc?", "Apă.")], "https://club.test/ro/intrebari-frecvente", "ro");
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: "https://club.test/ro/intrebari-frecvente",
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

describe("§NNN «Copiază și tradu tot» fills a question's English boxes", () => {
  it("allows the question and the answer, and finds each one's Romanian twin", () => {
    expect(isTranslatableEnglishField("questionEn")).toBe(true);
    expect(isTranslatableEnglishField("answerEnBody")).toBe(true);
    expect(isRichTextField("answerEnBody")).toBe(true);
    expect(isRichTextField("questionEn")).toBe(false);
    expect(romanianTwinCandidates("questionEn")[0]).toBe("questionRo");
    expect(romanianTwinCandidates("answerEnBody")).toEqual(["answerRoBody"]);
    // The Romanian boxes are never a target.
    expect(isTranslatableEnglishField("questionRo")).toBe(false);
    expect(isTranslatableEnglishField("answerRoBody")).toBe(false);
  });
});
