import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { albumFieldsSchema } from "@/modules/content/gallery/fields";
import { pageFieldsSchema } from "@/modules/content/pages/fields";
import { identicalTextLabel, identicalTexts, storedTextReader, type StoredTexts } from "@/modules/content/events/ui/publish-check";
import { readEventNoticeWords } from "@/modules/events/domain/event-changes";
import { comparableText, IDENTICAL_TEXT_MIN_LENGTH, identicalInBothLanguages } from "@/shared/forms/both-languages";

/**
 * §NNN — bilingual everywhere (the owner: "I want multi-lingual, always"). The pure halves of it:
 *
 * - the same words in both languages, as a warning (`identicalInBothLanguages`, `identicalTexts`)
 *   — the English "Happy Monday" date carries the Romanian description on production;
 * - the organizer's note and the cancellation's reason read per language from the outbox, an
 *   older row's one string as before, half a pair as nothing (`readEventNoticeWords`);
 * - a standing page's two search-engine texts and an album's description, both or neither;
 * - the refusal summary's line for each language's box of the note and the reason.
 */
let catalogue: Record<string, unknown> = ro;
let locale: "ro" | "en" = "ro";
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: catalogue, namespace: namespace as never }),
}));

const { eventFormFieldLabels, identicalTextLabels } = await import("@/modules/content/events/ui/field-labels");
const { pageFormFieldLabels } = await import("@/modules/content/pages/ui/field-labels");
const { albumFormFieldLabels } = await import("@/modules/content/gallery/ui/field-labels");

const doc = (...paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
const HAPPY_MONDAY = "Alergăm pe Tâmpa în fiecare luni seara, pornind de la telecabină, în ritmul fiecăruia.";

describe("§NNN the same words in both languages", () => {
  it("compares a rich text's words, whatever its paragraphs, spaces and capitals", () => {
    expect(comparableText(doc("Prima frază.", "A doua   frază."))).toBe("prima frază. a doua frază.");
    // The JSON a rich-text box posts reads the same as the stored document.
    expect(comparableText(JSON.stringify(doc("Prima frază.")))).toBe("prima frază.");
    expect(comparableText("  Prima\nFRAZĂ.  ")).toBe("prima frază.");
    // Composed and decomposed diacritics are one text.
    expect(comparableText("Brașov")).toBe(comparableText("Brașov"));
    // A picture with no words is no text.
    expect(comparableText({ type: "doc", content: [{ type: "image", attrs: { src: "x", alt: "" } }] })).toBe("");
    expect(comparableText(null)).toBe("");
  });

  it("warns for a long text copied into the other language — and never for a short one", () => {
    expect(identicalInBothLanguages(doc(HAPPY_MONDAY), doc(`${HAPPY_MONDAY} `))).toBe(true);
    expect(identicalInBothLanguages(doc(HAPPY_MONDAY), JSON.stringify(doc(HAPPY_MONDAY.toUpperCase())))).toBe(true);
    // A name — "Happy Monday", a partner's own brand — may honestly read the same.
    expect(identicalInBothLanguages("Happy Monday", "Happy Monday")).toBe(false);
    const edge = "x".repeat(IDENTICAL_TEXT_MIN_LENGTH);
    expect(identicalInBothLanguages(edge, edge)).toBe(false);
    expect(identicalInBothLanguages(`${edge}y`, `${edge}y`)).toBe(true);
    // Translated, or one side empty: nothing to warn about (the empty side is both-or-neither's).
    expect(identicalInBothLanguages(doc(HAPPY_MONDAY), doc("We run up Tâmpa every Monday evening, from the cable car."))).toBe(false);
    expect(identicalInBothLanguages(doc(HAPPY_MONDAY), "")).toBe(false);
    expect(identicalInBothLanguages("", "")).toBe(false);
  });

  it("lists every copied text of a form, in the editor's order, each by its English box", () => {
    const form: Record<string, string> = {
      "translations.ro.excerptBody": JSON.stringify(doc("Luni seara pe Tâmpa.")),
      "translations.en.excerptBody": JSON.stringify(doc("Luni seara pe Tâmpa.")),
      "translations.ro.body": JSON.stringify(doc(HAPPY_MONDAY)),
      "translations.en.body": JSON.stringify(doc(HAPPY_MONDAY)),
      "translations.ro.checklist": "Frontală, apă și o geacă de ploaie pentru coborâre.",
      "translations.en.checklist": "Frontală, apă și o geacă de ploaie pentru coborâre.",
      "translations.ro.rules": JSON.stringify(doc("Casca e obligatorie pe tot traseul, fără excepție.")),
      "translations.en.rules": JSON.stringify(doc("A helmet is required on the whole course, no exceptions.")),
      "event.coHosts[1].descriptionRo": "Alergăm împreună duminică dimineață, la festival.",
      "event.coHosts[1].descriptionEn": "Alergăm împreună duminică dimineață, la festival.",
    };
    const found = identicalTexts((name) => form[name] ?? "", ["ro", "en"]);
    // The short summary is not counted; the translated rules are not either.
    expect(found).toEqual([
      { box: "description", field: "body", locale: "en", name: "translations.en.body" },
      { box: "programme", field: "checklist", locale: "en", name: "translations.en.checklist" },
      { box: "coHosts", field: "coHostDescription", locale: "en", name: "event.coHosts[1].descriptionEn", partner: 2 },
    ]);
  });

  it("reads a saved event the same way — the English 'Happy Monday' date carrying the Romanian description", () => {
    const language = (code: string, overrides: Partial<StoredTexts> = {}): StoredTexts => ({
      locale: code,
      excerpt: null,
      excerptJson: null,
      bodyJson: null,
      rulesJson: null,
      scheduleJson: null,
      checklist: null,
      ...overrides,
    });
    const stored = [language("ro", { bodyJson: doc(HAPPY_MONDAY), excerpt: HAPPY_MONDAY }), language("en", { bodyJson: doc(HAPPY_MONDAY), excerptJson: doc(HAPPY_MONDAY) })];
    const found = identicalTexts(storedTextReader(stored, []), ["ro", "en"]);
    expect(found.map((item) => item.name)).toEqual(["translations.en.excerptBody", "translations.en.body"]);
    // A partner's two descriptions, as stored.
    const copied = "Alergăm împreună duminică dimineață, la festival.";
    const partners = identicalTexts(storedTextReader([language("ro"), language("en")], [{ descriptionRo: copied, descriptionEn: copied }]), ["ro", "en"]);
    expect(partners).toEqual([{ box: "coHosts", field: "coHostDescription", locale: "en", name: "event.coHosts[0].descriptionEn", partner: 1 }]);
  });

  it("names each warning by the box, the partner, the language and the field, in the catalogue's words", async () => {
    catalogue = ro;
    locale = "ro";
    const labels = await identicalTextLabels();
    expect(identicalTextLabel({ box: "description", field: "body", locale: "en", name: "translations.en.body" }, labels)).toBe(
      `${ro.Admin.editor.boxes.description.title} › English › ${ro.Admin.editor.fields.body}`,
    );
    expect(
      identicalTextLabel({ box: "coHosts", field: "coHostDescription", locale: "en", name: "event.coHosts[1].descriptionEn", partner: 2 }, labels),
    ).toBe(`${ro.Admin.editor.boxes.coHosts.title} › Partenerul 2 › English › Despre parteneriat`);
    catalogue = en;
    locale = "en";
    const english = await identicalTextLabels();
    expect(identicalTextLabel({ box: "coHosts", field: "coHostDescription", locale: "en", name: "event.coHosts[0].descriptionEn", partner: 1 }, english)).toContain(
      "Partner 1 › English › About the partnership",
    );
  });
});

describe("§NNN the organizer's note and the reason, read from the outbox", () => {
  it("reads each half's own language from a row queued with both", () => {
    const note = { ro: "Parcarea e închisă.", en: "The car park is closed." };
    expect(readEventNoticeWords(note, "ro")).toEqual({ text: "Parcarea e închisă.", other: "The car park is closed." });
    expect(readEventNoticeWords(note, "en")).toEqual({ text: "The car park is closed.", other: "Parcarea e închisă." });
  });

  it("reads an older row's one string as the text of both halves, as before", () => {
    expect(readEventNoticeWords("Parcarea e închisă.", "en")).toEqual({ text: "Parcarea e închisă." });
  });

  it("reads half a pair, an unreadable side, or nothing, as no text at all — never one language to a reader of the other", () => {
    expect(readEventNoticeWords({ ro: "Doar în română." }, "en")).toEqual({});
    expect(readEventNoticeWords({ ro: "Doar în română.", en: "   " }, "ro")).toEqual({});
    expect(readEventNoticeWords({ ro: "x".repeat(501), en: "Fine." }, "ro")).toEqual({});
    expect(readEventNoticeWords(undefined, "ro")).toEqual({});
    expect(readEventNoticeWords(42, "ro")).toEqual({});
  });
});

describe("§NNN a standing page's search-engine texts and an album's description: both or neither", () => {
  const page = (seo: { roTitle?: string; enTitle?: string; roDescription?: string; enDescription?: string }) => ({
    navOrder: "0",
    translations: {
      ro: { slug: "despre", title: "Despre", body: "", seoTitle: seo.roTitle ?? "", seoDescription: seo.roDescription ?? "" },
      en: { slug: "about", title: "About", body: "", seoTitle: seo.enTitle ?? "", seoDescription: seo.enDescription ?? "" },
    },
  });
  const paths = (result: ReturnType<typeof pageFieldsSchema.safeParse> | ReturnType<typeof albumFieldsSchema.safeParse>) =>
    result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));

  it("refuses a page's search-engine title or description in one language, on the empty box", () => {
    expect(paths(pageFieldsSchema.safeParse(page({ roTitle: "Despre clubul nostru" })))).toEqual(["translations.en.seoTitle"]);
    expect(paths(pageFieldsSchema.safeParse(page({ enDescription: "Who we are." })))).toEqual(["translations.ro.seoDescription"]);
  });

  it("takes both, or neither", () => {
    expect(paths(pageFieldsSchema.safeParse(page({})))).toEqual([]);
    const both = pageFieldsSchema.safeParse(page({ roTitle: "Despre club", enTitle: "About the club" }));
    expect(both.success && both.data.translations.en.seoTitle).toBe("About the club");
  });

  it("refuses an album's description in one language, on the empty box, and takes both or neither", () => {
    const album = (ro: string, en: string) => ({
      takenOn: "2026-09-20",
      eventId: "",
      translations: { ro: { slug: "tampa", title: "Tâmpa", description: ro }, en: { slug: "tampa-en", title: "Tâmpa", description: en } },
    });
    expect(paths(albumFieldsSchema.safeParse(album("", "Monday on Tâmpa.")))).toEqual(["translations.ro.description"]);
    expect(paths(albumFieldsSchema.safeParse(album("Luni pe Tâmpa.", "  ")))).toEqual(["translations.en.description"]);
    expect(paths(albumFieldsSchema.safeParse(album("Luni pe Tâmpa.", "Monday on Tâmpa.")))).toEqual([]);
    expect(paths(albumFieldsSchema.safeParse(album("", "")))).toEqual([]);
  });

  it("names the refused box with what it needs, in both catalogues", async () => {
    catalogue = ro;
    locale = "ro";
    expect((await pageFormFieldLabels())["translations.en.seoTitle"]).toBe("English: Titlu SEO — scrie-l în ambele limbi sau în niciuna");
    expect((await albumFormFieldLabels())["translations.ro.description"]).toBe("Română: Descriere — scrie-o în ambele limbi sau în niciuna");
    catalogue = en;
    locale = "en";
    expect((await pageFormFieldLabels())["translations.ro.seoDescription"]).toBe("Romanian: SEO description — write it in both languages or neither");
  });
});

describe("§NNN the note's and the reason's boxes in the refusal summary", () => {
  it("names each language's box, its box on the page, and what it needs", async () => {
    catalogue = ro;
    locale = "ro";
    const labels = await eventFormFieldLabels();
    expect(labels["notice.noteEn"]).toBe("Salvare › Ce s-a schimbat (English): scrie mesajul în ambele limbi sau în niciuna, cel mult 500 de caractere");
    expect(labels["cancel.reasonRo"]).toBe("Starea evenimentului › Motivul anulării (Română): obligatoriu în ambele limbi, cel mult 500 de caractere");
    catalogue = en;
    locale = "en";
    const english = await eventFormFieldLabels();
    expect(english["cancel.reasonEn"]).toContain("Why the event is cancelled (English): required in both languages, at most 500 characters");
  });
});
