import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { fillIsFor, type RichTextFillDetail } from "@/modules/content/rich-text/ui/fill-event";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import TranslateProvider, { type TranslateAction, type TranslateOffer } from "@/modules/translate/ui/TranslateProvider";

/**
 * §NNN — «Copiază și tradu tot: RO → EN», one always-visible button per editor (the owner,
 * 2026-09-27: «I can't find or don't know how to use the AI translate … I just wanna copy all from
 * RO to English and auto-translate with a single button click»).
 *
 * - For a role that writes the club's words the button is drawn on every editor, also where the
 *   deployment has no DeepL key: greyed, saying why, and linking the steps for a reader who may
 *   open them. The per-box buttons stay away without a key.
 * - «Echipa» gets it: the role, the words about the person, the links' labels and the page's
 *   introduction are on the allowlist, and a rich text fills only the card whose button was pressed.
 */

const ROOT = process.cwd();
const action: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });

function render(node: ReturnType<typeof createElement>, offer: TranslateOffer | null, locale: "ro" | "en" = "ro") {
  const intl = { locale, messages: { Translate: (locale === "ro" ? ro : en).Translate } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, node)));
}

describe("§NNN the whole-record button is always there for a role that writes words", () => {
  it("works, in the reader's language, where a translator is configured", () => {
    const html = render(createElement(TranslateAllButton), { action, setupHref: null });
    expect(html).toContain(ro.Translate.all);
    expect(html).toContain(ro.Translate.allHelp);
    expect(html).toContain('data-translate-state="ready"');
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(render(createElement(TranslateAllButton), { action, setupHref: null }, "en")).toContain(en.Translate.all);
  });

  it("is drawn greyed without a key, saying why and linking the steps for an Administrator", () => {
    const html = render(createElement(TranslateAllButton), { action: null, setupHref: "/ro/admin/tasks#task-translation" });
    expect(html).toContain(ro.Translate.all);
    expect(html).toContain('data-translate-state="off"');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain(ro.Translate.off);
    expect(html).toContain('href="/ro/admin/tasks#task-translation"');
    expect(html).toContain(ro.Translate.offSteps);
  });

  it("sends a reader who may not open the tasks page to an Administrator, with no link", () => {
    const html = render(createElement(TranslateAllButton), { action: null, setupHref: null });
    expect(html).toContain(ro.Translate.offAskAdmin);
    expect(html).not.toContain("href=");
  });

  it("draws no per-box button without a key, and nothing at all for a role that writes no words", () => {
    expect(render(createElement(TranslateFieldButton, { en: "translations.en.title" }), { action: null, setupHref: null })).toBe("");
    expect(render(createElement(TranslateAllButton), null)).toBe("");
  });

  it("is mounted on every editor: the event (new and saved), the page, the album and every «Echipa» form", () => {
    const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
    for (const file of [
      "src/app/[locale]/admin/events/new/page.tsx",
      "src/app/[locale]/admin/events/[id]/page.tsx",
      "src/modules/content/pages/ui/PageFieldsForm.tsx",
      "src/modules/content/gallery/ui/AlbumFieldsForm.tsx",
    ]) {
      expect(read(file), file).toContain("<TranslateAllButton />");
    }
    // «Echipa»: the introduction's form, and `MemberFields` — the new card's form and each card's.
    const team = read("src/app/[locale]/admin/pages/team/page.tsx");
    expect(team.match(/<TranslateAllButton \/>/g)?.length).toBe(2);
    expect(team).toMatch(/function MemberFields[\s\S]*<TranslateAllButton \/>/);
  });

  it("links a task row by its own address", () => {
    expect(readFileSync(path.join(ROOT, "src/app/[locale]/admin/tasks/page.tsx"), "utf8")).toContain("id={`task-${task.id}`}");
    expect(readFileSync(path.join(ROOT, "src/app/[locale]/admin/layout.tsx"), "utf8")).toContain("#task-translation");
  });
});

describe("§NNN «Echipa»'s words may be translated", () => {
  it("allows the role, a link's label and the two rich texts, and knows the rich ones", () => {
    for (const name of ["roleEn", "links[0].labelEn", "links[11].labelEn", "bioEnBody", "introEnBody"]) {
      expect(isTranslatableEnglishField(name), name).toBe(true);
    }
    for (const name of ["roleRo", "name", "links[0].url", "links[0].kind", "bioRoBody", "photoAssetId", "fooEnBody"]) {
      expect(isTranslatableEnglishField(name), name).toBe(false);
    }
    expect(isRichTextField("bioEnBody")).toBe(true);
    expect(isRichTextField("introEnBody")).toBe(true);
    expect(isRichTextField("roleEn")).toBe(false);
    expect(isRichTextField("links[0].labelEn")).toBe(false);
  });

  it("finds each Romanian twin", () => {
    expect(romanianTwinCandidates("bioEnBody")).toEqual(["bioRoBody"]);
    expect(romanianTwinCandidates("introEnBody")).toEqual(["introRoBody"]);
    expect(romanianTwinCandidates("roleEn")[0]).toBe("roleRo");
    expect(romanianTwinCandidates("links[2].labelEn")[0]).toBe("links[2].labelRo");
  });
});

describe("§NNN a rich text fills only in the form that pressed", () => {
  const doc = { type: "doc", content: [] } as unknown as RichTextDoc;
  const cardA = {} as HTMLFormElement;
  const cardB = {} as HTMLFormElement;
  const boxIn = (form: HTMLFormElement | null) => ({ form }) as HTMLInputElement;
  const detail = (form: HTMLFormElement | null): RichTextFillDetail => ({ name: "bioEnBody", doc, form });

  it("takes a fill for its own name in its own form, and ignores another card's", () => {
    expect(fillIsFor(detail(cardA), "bioEnBody", boxIn(cardA))).toBe(true);
    expect(fillIsFor(detail(cardA), "bioEnBody", boxIn(cardB))).toBe(false);
    expect(fillIsFor(detail(cardA), "introEnBody", boxIn(cardA))).toBe(false);
  });

  it("keeps the event editor's behaviour: a fill naming no form reaches the box by name", () => {
    expect(fillIsFor(detail(null), "bioEnBody", boxIn(cardB))).toBe(true);
    expect(fillIsFor({ name: "bioEnBody", doc }, "bioEnBody", null)).toBe(true);
    expect(fillIsFor(undefined, "bioEnBody", boxIn(cardA))).toBe(false);
  });
});
