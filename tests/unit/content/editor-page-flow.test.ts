import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import {
  cardGapLine,
  cardGaps,
  missingForPublish,
  missingInLanguage,
  PUBLISH_GAP_CARD,
  publishCheckValues,
  publishGapLabel,
  type PublishGapLabels,
  storedPublishReader,
} from "@/modules/content/events/ui/publish-check";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";
import { BLANK_PAGE_SECTION_DATA, type PageSectionData } from "@/modules/events/domain/page-sections";

/**
 * §406 — the event editor mirrors the page, and says from outside each card what publication
 * still needs. The owner, 2026-09-25: "am nevoie de mai multe căsuțe la editor ca să văd exact ce
 * flow am în pagină"; at 20:20, of a closed «Titlu și rezumat» whose tabs said only «incomplet»:
 * "I need to see on the cards as well what info is required"; at 20:25: "I am missing the create
 * and publish for some new events… this should be consistent!"
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Admin" }),
    getLocale: async () => currentLocale,
  };
});

const { cardGapWords, requiredLine } = await import("@/modules/content/events/ui/boxes/box-kit");
const { pageFlow } = await import("@/modules/content/events/ui/page-flow");
const { default: SectionMap } = await import("@/modules/content/events/ui/SectionMap");
const { default: LocaleTabPanels } = await import("@/shared/ui/LocaleTabPanels");
const { default: CreateAndPublishButton } = await import("@/modules/content/events/ui/CreateAndPublishButton");
const { askPublishGaps, PublishGapsSummary } = await import("@/modules/content/events/ui/PublishCheck");

afterEach(() => {
  currentLocale = "ro";
});

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
/** The markup without the `<style>` tags Emotion writes beside each element on a server. */
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

const LOCALES = ["ro", "en"] as const;
const NO_PLACE = { locationName: null, locationToBeAnnounced: false };

/** A saved language with what publication needs, less what `blank` names. */
function language(locale: "ro" | "en", blank: readonly ("title" | "excerpt" | "slug")[] = []) {
  return {
    ...blankTranslation(locale),
    title: blank.includes("title") ? "" : locale === "ro" ? "Crosul Tâmpei" : "Tampa Cross",
    excerpt: blank.includes("excerpt") ? null : "Un rezumat.",
    slug: blank.includes("slug") ? "" : locale === "ro" ? "crosul-tampei" : "tampa-cross",
  };
}
const entries = (...translations: ReturnType<typeof language>[]): LanguageEntry[] =>
  translations.map((translation) => ({ translation, mayEdit: true, label: translation.locale === "ro" ? "Română" : "English" }));

describe("§406 one check, seen from each card", () => {
  it("groups a card's gaps by field, each with the languages it lacks", () => {
    const gaps = missingForPublish(storedPublishReader(NO_PLACE, [language("ro", ["excerpt"]), language("en", ["title", "excerpt", "slug"])]), LOCALES);
    expect(cardGaps(gaps, "titleSummary")).toEqual([
      { field: "excerpt", locales: ["ro", "en"] },
      { field: "title", locales: ["en"] },
    ]);
    expect(cardGaps(gaps, "place")).toEqual([{ field: "locationName", locales: ["ro", "en"] }]);
    expect(cardGaps(gaps, "address")).toEqual([{ field: "slug", locales: ["en"] }]);
    expect(missingInLanguage(gaps, "titleSummary", "ro")).toBe(1);
    expect(missingInLanguage(gaps, "titleSummary", "en")).toBe(2);
    expect(missingInLanguage(gaps, "address", "ro")).toBe(0);
  });

  it("writes each card's line in both catalogues: «lipsesc: Titlu (RO, EN) · Rezumat (RO)» or «complet»", async () => {
    const gaps = missingForPublish(storedPublishReader(NO_PLACE, [language("ro", ["title", "excerpt"]), language("en", ["title"])]), LOCALES);
    const ro = await cardGapWords();
    expect(cardGapLine(gaps, "titleSummary", ro)).toBe("lipsesc: Titlu (RO, EN) · Rezumat (RO)");
    expect(cardGapLine(gaps, "place", ro)).toBe("lipsesc: Punct de întâlnire (RO, EN)");
    expect(cardGapLine(gaps, "address", ro)).toBe("complet");
    currentLocale = "en";
    const en = await cardGapWords();
    expect(cardGapLine(gaps, "titleSummary", en)).toMatch(/^missing: .+ \(RO, EN\) · .+ \(RO\)$/);
    expect(cardGapLine(gaps, "address", en)).toBe("complete");
  });

  it("reads the saved event the way the publication guard does", () => {
    // The meeting point: the language's own name, else the event's; none while it is to be announced.
    const withPlace = storedPublishReader({ locationName: "Parcul Tractorul", locationToBeAnnounced: false }, [language("ro"), language("en")]);
    expect(cardGaps(missingForPublish(withPlace, LOCALES), "place")).toEqual([]);
    const announced = storedPublishReader({ locationName: null, locationToBeAnnounced: true }, [language("ro"), language("en")]);
    expect(missingForPublish(announced, LOCALES)).toEqual([]);
    // A language with no row lacks everything a row would hold.
    const onlyRomanian = storedPublishReader({ locationName: "Parcul", locationToBeAnnounced: false }, [language("ro")]);
    expect(missingForPublish(onlyRomanian, LOCALES).map((gap) => gap.name)).toEqual(["translations.en.title", "translations.en.excerptBody", "translations.en.slug"]);
    // The values an island reads for a box its form does not draw: every name the check asks.
    expect(Object.keys(publishCheckValues(onlyRomanian, LOCALES)).sort()).toEqual(
      [
        "event.locationName",
        "event.locationNameEn",
        "event.locationToBeAnnounced",
        ...LOCALES.flatMap((locale) => ["excerptBody", "slug", "title"].map((field) => `translations.${locale}.${field}`)),
      ].sort(),
    );
  });

  it("sends each gap to the card that holds it", () => {
    expect(PUBLISH_GAP_CARD).toEqual({ titleSummary: "box-title", place: "box-place", address: "box-address" });
  });
});

describe("§406 the closed card says what it lacks, with the warning glyph", () => {
  it("names the title card's gaps per language, from the card's own translations", async () => {
    const html = markup(renderToStaticMarkup(await requiredLine("titleSummary", null, entries(language("ro", ["excerpt"]), language("en", ["title", "excerpt"])))));
    expect(html).toContain('data-missing="true"');
    expect(html).toContain("lipsesc: Rezumat (RO, EN) · Titlu (EN)");
    // The glyph, drawn by the island itself: an svg beside the words.
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("says «complet» with no glyph when nothing is missing, and names the place on the place card", async () => {
    const complete = markup(renderToStaticMarkup(await requiredLine("titleSummary", null, entries(language("ro"), language("en")))));
    expect(complete).toContain('data-missing="false"');
    expect(complete).toContain(">complet<");
    expect(complete).not.toContain("<svg");
    const place = markup(renderToStaticMarkup(await requiredLine("place", { locationName: null, locationToBeAnnounced: false }, entries(language("ro"), language("en")))));
    expect(place).toContain("lipsesc: Punct de întâlnire (RO, EN)");
  });

  it("draws the line on the three cards that hold a box publication needs, and on no other", () => {
    const text = read("src/modules/content/events/ui/boxes/TextBoxes.tsx");
    expect(text).toContain('await requiredLine("titleSummary", null, languages)');
    expect(text).toContain('await requiredLine("address", null, languages)');
    expect(read("src/modules/content/events/ui/boxes/PlaceBox.tsx")).toContain('await requiredLine("place", event, languages)');
  });
});

describe("§406 the language tabs count what is missing", () => {
  const counted = (missing: readonly number[]) =>
    markup(
      renderToStaticMarkup(
        createElement(LocaleTabPanels, {
          idPrefix: "title",
          panels: [
            { locale: "ro", label: "Română", missingCount: missing[0], content: "ro" },
            { locale: "en", label: "English", missingCount: missing[1], content: "en" },
          ],
          requiredCount: { one: "{count} obligatoriu lipsă", few: "{count} obligatorii lipsă", other: "{count} de obligatorii lipsă", complete: "complet", locale: "ro", box: "titleSummary" },
        }),
      ),
    );

  it("«Română · 2 obligatorii lipsă», «English · complet»", () => {
    const html = counted([2, 0]);
    expect(html).toContain("Română · 2 obligatorii lipsă");
    expect(html).toContain("English · complet");
    expect(counted([1, 1])).toContain("English · 1 obligatoriu lipsă");
  });

  it("counts on the strips publication reads — the title and the address — and marks the rest as before", () => {
    const text = read("src/modules/content/events/ui/boxes/TextBoxes.tsx");
    expect(text.match(/required="(\w+)"/g)).toEqual(['required="titleSummary"', 'required="address"']);
    for (const locale of ["ro", "en"] as const) {
      const catalogue = JSON.parse(read(`messages/${locale}.json`)).Admin.editor.required.tab;
      expect(Object.keys(catalogue).sort(), locale).toEqual(["few", "one", "other"]);
    }
  });

  it("counts as typed by the publication check itself, filtered to the card — never a second rule", () => {
    const strip = read("src/shared/ui/LocaleTabPanels.tsx");
    const count = strip.slice(strip.indexOf('if (requiredCount && watch.rule === "required")'), strip.indexOf("setCounts("));
    expect(count).toContain("missingForPublish(");
    expect(count).toContain("missingInLanguage(gaps, requiredCount.box, panel.locale)");
    expect(count).not.toContain("isBlankValue");
    expect(read("src/modules/content/events/ui/boxes/TextBoxes.tsx")).toContain("box: required,");
  });
});

describe("§406 the cards' headings and the map", () => {
  const saved = (): PageSectionData => ({
    event: { ...BLANK_PAGE_SECTION_DATA.event, locationName: "Parcul Tractorul" },
    texts: [{ title: "Crosul Tâmpei", bodyJson: null, rulesJson: null, scheduleJson: null, routeDescriptionJson: null, locationName: null }],
    night: false,
  });

  it("heads each card «N · Nume — apare pe pagină / gol, nu apare pe pagină», in both catalogues", async () => {
    const flow = await pageFlow(saved());
    expect(flow.headings.kind).toBe("1 · Ce fel de eveniment — apare pe pagină");
    expect(flow.headings.when).toBe("4 · Data și ora — apare pe pagină");
    expect(flow.headings.place).toBe("5 · Locul — apare pe pagină");
    expect(flow.headings.description).toBe("3 · Descrierea evenimentului — gol, nu apare pe pagină");
    expect(flow.headings.cost).toBe("7 · Cost — apare pe pagină");
    expect(flow.headings.registration).toBe("8 · Participare și înscrieri — gol, nu apare pe pagină");
    expect(flow.headings.video).toBe("13 · Filmul — gol, nu apare pe pagină");
    expect(flow.headings.startList).toBe("14 · Lista publică a participanților — gol, nu apare pe pagină");
    expect("share" in flow.headings).toBe(false);
    currentLocale = "en";
    const en = await pageFlow(saved());
    expect(en.headings.when).toBe("4 · Date and time — on the page");
    expect(en.headings.description).toBe("3 · Event description — empty, not on the page");
  });

  it("links every chip to its card's anchor at 44 pixels, and names the share links as automatic", async () => {
    const flow = await pageFlow(saved());
    const html = renderToStaticMarkup(createElement(SectionMap, { entries: flow.entries, words: flow.words, label: flow.label }) as ReactElement);
    const body = markup(html);
    const links = [...body.matchAll(/<a [^>]*href="#([^"]+)"[^>]*aria-label="([^"]+)"/g)].map((match) => [match[1], match[2]]);
    expect(links.map(([href]) => href)).toEqual([
      "box-kind",
      "box-title",
      "box-description",
      "box-when",
      "box-place",
      "box-course",
      "box-cost",
      "box-registration",
      "box-cohosts",
      "box-links",
      "box-programme",
      "box-rules",
      "box-video",
      "box-start-list",
    ]);
    expect(links[3][1]).toBe("4 · Când — apare pe pagină");
    expect(links[2][1]).toBe("3 · Descrierea — gol, nu apare pe pagină");
    // The map, first paint: the title card's chip is not marked with no provider's answer.
    expect(body).toMatch(/<span[^>]*aria-label="Distribuie — automat, fără card"[^>]*data-section="share"/);
    expect(body).toContain('aria-label="Pagina, de sus în jos"');
    expect(html).toContain("min-height:44px");
    // A filled dot for a drawn section, a ring for an empty one.
    expect(body.match(/data-drawn="true"/g)?.length).toBe(6);
  });
});

describe("§406 «Creează și publică» and «Publică», always there", () => {
  const LABELS: PublishGapLabels = {
    boxes: { titleSummary: "Titlu și rezumat", place: "Locul", address: "Adresa paginii și motoarele de căutare" },
    fields: { title: "Titlu", excerpt: "Rezumat", locationName: "Punct de întâlnire", slug: "Adresa paginii" },
    languages: { ro: "Română", en: "English" },
  };

  it("draws the create button at its full look, with no hint that reads as a missing button", () => {
    const html = renderToStaticMarkup(createElement(CreateAndPublishButton, { label: "Creează și publică", pendingLabel: "…", locales: LOCALES, summaryId: "publish-gaps" }));
    expect(html).toContain('data-testid="create-and-publish"');
    expect(html).not.toMatch(/opacity:0?\.38/);
    expect(html).not.toContain("publish-not-ready");
    const source = read("src/modules/content/events/ui/CreateAndPublishButton.tsx");
    expect(source).not.toContain("opacity");
    // Pressed with a gap: nothing posted, the summary asked for.
    expect(source).toMatch(/if \(publicationGaps\(form, locales\)\.length > 0\) \{\s*event\.preventDefault\(\);\s*askPublishGaps\(summaryId\);/);
  });

  it("gates the editor's «Publică» on the saved event's gaps, the same button whatever it lacks", () => {
    const edit = read("src/app/[locale]/admin/events/[id]/page.tsx");
    expect(edit).toContain('<PublishGateButton label={EDITORIAL_TRANSITION_LABEL[to]} blocked={storedGaps.length > 0} summaryId="publish-gaps" />');
    expect(edit).toContain("const storedGaps = missingForPublish(storedRead, routing.locales);");
    const check = read("src/modules/content/events/ui/PublishCheck.tsx");
    expect(check).toMatch(/if \(!blocked\) return;\s*event\.preventDefault\(\);\s*askPublishGaps\(summaryId\);/);
  });

  it("asks the summary by its id, and the summary names each missing box and language", () => {
    const heard: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener("br:publish-gaps", (event) => heard.push((event as CustomEvent).detail));
    vi.stubGlobal("window", target);
    try {
      askPublishGaps("publish-gaps");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(heard).toEqual(["publish-gaps"]);
    // Nothing is drawn until a press asks.
    expect(renderToStaticMarkup(createElement(PublishGapsSummary, { id: "publish-gaps", title: "t", intro: "i", labels: LABELS, gaps: [] }))).toBe("");
    // What it names, one line per box and language, in the Publicare list's words.
    const gaps = missingForPublish(storedPublishReader(NO_PLACE, [language("ro"), language("en", ["title"])]), LOCALES);
    expect(gaps.map((gap) => publishGapLabel(gap, LABELS))).toEqual([
      "Titlu și rezumat › English › Titlu",
      "Locul › Română › Punct de întâlnire",
      "Locul › English › Punct de întâlnire",
    ]);
  });

  it("puts the summary first in the main column on both pages, under the one id both buttons ask", () => {
    for (const file of ["src/app/[locale]/admin/events/[id]/page.tsx", "src/app/[locale]/admin/events/new/page.tsx"]) {
      const source = read(file);
      expect(source, file).toContain('<PublishGapsSummary');
      expect(source.indexOf("<PublishGapsSummary"), file).toBeLessThan(source.indexOf("<KindBox "));
      expect(source.indexOf("<PublishGapsSummary"), file).toBeGreaterThan(source.indexOf("main={"));
    }
  });
});
