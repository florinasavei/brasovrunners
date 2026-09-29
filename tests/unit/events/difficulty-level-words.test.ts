import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §563 (amending §526, §528, §537) — the owner, 2026-09-29, of «Mediu 2 — nivelul 5
 * din 15» beside «Ușor 2 — nivelul 2 din 15»: «nu are cum și una grea și una ușoară să fie nivelul
 * 2 … adică ușor: 1,2,3, mediu 4,5,6 și tot așa, în ordine». **The number is the level, the dots
 * are the step**: every surface says the band with the level of fifteen, from one domain function
 * (`difficultyWords`); the editor's «Nivelul» offers the chosen band's own three levels; the
 * listing's filter still ticks a whole band and names its range.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
  };
});

// The panel's one island reads the app router, which a static render has not mounted.
vi.mock("@/modules/events/ui/FilterAutoApply", () => ({ default: () => null }));

const { createTranslator } = await import("next-intl");
const { DIFFICULTY_BANDS, DIFFICULTY_LEVEL_COUNT, difficultyBandLevelList, difficultyBandRangeWord, difficultyLadder, difficultyWords } =
  await import("@/modules/events/domain/difficulty");
const { default: DifficultyStepField } = await import("@/modules/content/events/ui/DifficultyStepField");
const { difficultyScaleText, difficultyStepWords } = await import("@/modules/content/events/ui/difficulty-words");
const { default: ListingFilterPanel } = await import("@/modules/events/ui/ListingFilterPanel");
const { NO_FILTER } = await import("@/modules/events/domain/listing-filter");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

type Words = Parameters<typeof difficultyWords>[1];

const catalogues = { ro, en } as const;
const tEvent = (locale: "ro" | "en") => createTranslator({ locale, messages: catalogues[locale], namespace: "Event" }) as unknown as Words;
const tAdmin = (locale: "ro" | "en") => createTranslator({ locale, messages: catalogues[locale], namespace: "Admin" }) as unknown as Words;

afterEach(() => {
  currentLocale = "ro";
});

/** Every level of fifteen, as the pill says it and as an email or a calendar entry says it. */
const WORDS = {
  ro: {
    short: ["Ușor 1", "Ușor 2", "Ușor 3", "Mediu 4", "Mediu 5", "Mediu 6", "Greuț 7", "Greuț 8", "Greuț 9", "Greu 10", "Greu 11", "Greu 12", "Foarte greu 13", "Foarte greu 14", "Foarte greu 15"],
    plain: (short: string) => short.replace(/ (\d+)$/, ", nivelul $1 din 15"),
  },
  en: {
    short: ["Easy 1", "Easy 2", "Easy 3", "Medium 4", "Medium 5", "Medium 6", "Fairly hard 7", "Fairly hard 8", "Fairly hard 9", "Hard 10", "Hard 11", "Hard 12", "Very hard 13", "Very hard 14", "Very hard 15"],
    plain: (short: string) => short.replace(/ (\d+)$/, ", level $1 of 15"),
  },
} as const;

describe("§563 the number is the level of fifteen, in order across the bands", () => {
  it.each(["ro", "en"] as const)("in %s, every level's pill word and plain word", (locale) => {
    const t = tEvent(locale);
    const levels = Array.from({ length: DIFFICULTY_LEVEL_COUNT }, (_, index) => index + 1);
    expect(levels.map((level) => difficultyWords(level, t).short)).toEqual([...WORDS[locale].short]);
    expect(levels.map((level) => difficultyWords(level, t).plain)).toEqual(WORDS[locale].short.map(WORDS[locale].plain));
    // No surface says the step within the band in words any more.
    for (const level of levels) {
      const words = difficultyWords(level, t);
      for (const said of Object.values(words)) {
        expect(said).not.toMatch(/treapt|step \d|din 3\b|of 3\b/i);
        for (const line of said.split("\n")) expect(line.length, said).toBeLessThanOrEqual(200);
      }
    }
  });

  it.each([
    ["ro", "ușor 1–3 · mediu 4–6 · greuț 7–9 · greu 10–12 · foarte greu 13–15"],
    ["en", "easy 1–3 · medium 4–6 · fairly hard 7–9 · hard 10–12 · very hard 13–15"],
  ] as const)("in %s, the tooltip's second line is the whole ladder, from the domain", (locale, ladder) => {
    const t = tEvent(locale);
    expect(difficultyLadder(t).join(" · ")).toBe(ladder);
    for (let level = 1; level <= DIFFICULTY_LEVEL_COUNT; level += 1) {
      const [first, second, ...rest] = difficultyWords(level, t).tooltip.split("\n");
      expect(first).toContain(String(level));
      expect(second).toBe(ladder);
      expect(rest).toEqual([]);
    }
  });

  it("names the level's own band range in what a screen reader hears", () => {
    expect(difficultyWords(5, tEvent("ro")).sr).toBe("Dificultate: mediu — nivelul 5 din 15 (mediu: 4–6)");
    expect(difficultyWords(8, tEvent("en")).sr).toBe("Difficulty: fairly hard — level 8 of 15 (fairly hard: 7–9)");
  });
});

describe("§563 the editor's «Nivelul» offers the chosen band's three levels", () => {
  const render = (locale: "ro" | "en", initial: string) => {
    const t = tAdmin(locale);
    return renderToStaticMarkup(
      createElement(DifficultyStepField, {
        name: "event.difficultyStep",
        defaultStep: 2,
        band: { name: "event.difficulty", initial },
        words: difficultyStepWords(t, tEvent(locale), difficultyScaleText(t)),
      }),
    );
  };
  const numbers = (html: string) => [...html.matchAll(/data-testid="difficulty-level-number">([^<]+)</g)].map((match) => match[1]);
  const names = (html: string) => [...html.matchAll(/type="radio"[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);

  it.each(DIFFICULTY_BANDS.map((band) => [band] as const))("for %s, its own three levels, each named «Nivelul N din 15»", (band) => {
    const levels = difficultyBandLevelList(band);
    expect(numbers(render("ro", band))).toEqual(levels.map(String));
    expect(names(render("ro", band))).toEqual(levels.map((level) => `Nivelul ${level} din 15`));
    expect(names(render("en", band))).toEqual(levels.map((level) => `Level ${level} of 15`));
  });

  it("with no band chosen, shows a dash and names each segment by its place in the band", () => {
    const html = render("ro", "");
    expect(numbers(html)).toEqual(["–", "–", "–"]);
    expect(names(html)).toEqual(Object.values(ro.Admin.editor.difficultySteps));
  });

  it("is labelled «Nivelul» / «Level», and still posts the step 1 · 2 · 3", () => {
    expect(ro.Admin.editor.fields.difficultyStep).toBe("Nivelul");
    expect(en.Admin.editor.fields.difficultyStep).toBe("Level");
    const html = render("ro", "MEDIUM");
    expect([...html.matchAll(/type="radio"[^>]*value="(\d)"/g)].map((match) => match[1])).toEqual(["1", "2", "3"]);
  });
});

describe("§563, §413 the listing's filter ticks a whole band and names its range", () => {
  it.each([
    ["ro", ["Ușor (1–3)", "Mediu (4–6)", "Greuț (7–9)", "Greu (10–12)", "Foarte greu (13–15)"]],
    ["en", ["Easy (1–3)", "Medium (4–6)", "Fairly hard (7–9)", "Hard (10–12)", "Very hard (13–15)"]],
  ] as const)("in %s, on every band's box and on the active chip", async (locale, labels) => {
    currentLocale = locale;
    expect(DIFFICULTY_BANDS.map((band) => difficultyBandRangeWord(band, tEvent(locale)))).toEqual([...labels]);
    const html = renderToStaticMarkup(
      await ListingFilterPanel({
        locale,
        pathname: "/events",
        filter: { ...NO_FILTER, difficulty: ["MEDIUM"] },
        offer: { groups: [{ group: "difficulty", values: [...DIFFICULTY_BANDS] }], flags: [] },
      }),
    );
    for (const label of labels) expect(html).toContain(`</svg>${label}</span>`);
    // The box and the active chip both say the range: the band's word appears twice.
    expect(html.split(labels[1]).length - 1).toBeGreaterThanOrEqual(2);
    // Ticking «Mediu» still ticks the band, never a single level.
    const medium = /<input[^>]*name="difficulty"[^>]*value="MEDIUM"[^>]*>|<input[^>]*value="MEDIUM"[^>]*name="difficulty"[^>]*>/.exec(html)?.[0];
    expect(medium).toContain('checked=""');
  });
});
