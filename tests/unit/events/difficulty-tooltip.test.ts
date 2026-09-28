import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §NNN — the difficulty gauge says its level of fifteen, and the backoffice explains
 * the scale behind a «?».
 *
 * - The event's pill (`route-pills.ts`): the tooltip «Nivelul 5 din 15: o alergare mai lungă», the
 *   owner's own example for the level (§526), and the same sentence in the chip's accessible name
 *   (`srSuffix`), so a screen reader hears it without the hover.
 * - An email has no gauge: its facts keep `plain` alone, «Mediu, treapta 2 din 3».
 * - A band's filter box names its levels on hover: «Greuț: nivelurile 7–9 din 15».
 * - The editor's «Treapta» carries a «?» with the whole scale, outside the radio group's own
 *   one-line description.
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

const { getFormatter, getTranslations } = await import("next-intl/server");
const { buildRoutePills } = await import("@/modules/events/ui/route-pills");
const { default: RoutePills } = await import("@/modules/events/ui/RoutePills");
const { DIFFICULTY_BANDS, DIFFICULTY_LEVEL_COUNT, difficultyBandLevels, difficultyExampleKey } = await import("@/modules/events/domain/difficulty");
const { default: DifficultyStepField } = await import("@/modules/content/events/ui/DifficultyStepField");
const { default: ListingFilterPanel } = await import("@/modules/events/ui/ListingFilterPanel");
const { NO_FILTER } = await import("@/modules/events/domain/listing-filter");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

describe("§NNN a band's filter box names its levels", () => {
  it.each([
    ["ro", ["Ușor: nivelurile 1–3 din 15", "Greuț: nivelurile 7–9 din 15"]],
    ["en", ["Easy: levels 1–3 of 15", "Fairly hard: levels 7–9 of 15"]],
  ] as const)("in %s, on the box's label as a native title", async (locale, titles) => {
    currentLocale = locale;
    const panel = await ListingFilterPanel({
      locale,
      pathname: "/events",
      filter: NO_FILTER,
      offer: { groups: [{ group: "difficulty", values: ["EASY", "FAIRLY_HARD"] }], flags: [] },
    });
    const html = renderToStaticMarkup(panel);
    const labelTitles = [...html.matchAll(/<label [^>]*title="([^"]+)"/g)].map((match) => match[1]);
    expect(labelTitles).toEqual(titles);
  });
});

afterEach(() => {
  currentLocale = "ro";
});

const ROUTE = {
  type: "GROUP_RUN" as const,
  surface: null,
  difficultyLevel: 5,
  distanceMeters: null,
  elevationGainMeters: null,
  // A summer morning: never a night event, so the difficulty is the only pill.
  startsAt: new Date("2026-07-05T06:00:00Z"),
  endsAt: null,
  scheduleItems: null,
  timezone: "Europe/Bucharest",
  nightOverride: false,
  costType: null,
  registrationMode: "INTERNAL" as const,
  mapUrl: null,
  latitude: null,
  longitude: null,
  locationToBeAnnounced: false,
};

async function difficultyPill(level: number) {
  const t = await getTranslations("Event");
  const format = await getFormatter();
  const pills = buildRoutePills({ ...ROUTE, difficultyLevel: level }, t, format);
  expect(pills).toHaveLength(1);
  return pills[0]!;
}

describe("§NNN the scale's arithmetic", () => {
  it("names each band's levels, 1–3 up to 13–15", () => {
    expect(DIFFICULTY_BANDS.map((band) => difficultyBandLevels(band))).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 9 },
      { from: 10, to: 12 },
      { from: 13, to: 15 },
    ]);
  });

  it("gives «Mediu» one example per step and every other band one for all three", () => {
    const keys = Array.from({ length: DIFFICULTY_LEVEL_COUNT }, (_, index) => difficultyExampleKey(index + 1));
    expect(keys).toEqual(["EASY", "EASY", "EASY", "MEDIUM1", "MEDIUM2", "MEDIUM3", "FAIRLY_HARD", "FAIRLY_HARD", "FAIRLY_HARD", "HARD", "HARD", "HARD", "VERY_HARD", "VERY_HARD", "VERY_HARD"]);
    for (const key of new Set(keys)) {
      expect(ro.Event.difficultyExamples[key as keyof typeof ro.Event.difficultyExamples], key).toBeTruthy();
      expect(en.Event.difficultyExamples[key as keyof typeof en.Event.difficultyExamples], key).toBeTruthy();
    }
  });
});

describe("§NNN the pill's tooltip names the level of fifteen", () => {
  it.each([
    ["ro", 1, "Nivelul 1 din 15: scurt și pe plat, pentru oricine"],
    ["ro", 4, "Nivelul 4 din 15: cam cât alergarea pe Tâmpa"],
    ["ro", 5, "Nivelul 5 din 15: o alergare mai lungă"],
    ["ro", 6, "Nivelul 6 din 15: o alergare lungă și tehnică"],
    ["ro", 8, "Nivelul 8 din 15: de la semimaraton în sus"],
    ["ro", 11, "Nivelul 11 din 15: un maraton"],
    ["ro", 15, "Nivelul 15 din 15: un ultramaraton sau mai mult"],
    ["en", 2, "Level 2 of 15: short and flat, for anyone"],
    ["en", 5, "Level 5 of 15: a longer run"],
    ["en", 12, "Level 12 of 15: a marathon"],
    ["en", 13, "Level 13 of 15: an ultramarathon or more"],
  ] as const)("in %s, level %i reads «%s»", async (locale, level, sentence) => {
    currentLocale = locale;
    const pill = await difficultyPill(level);
    expect(pill.tooltip).toBe(sentence);
    // Heard without the hover, the night pill's way (§428).
    expect(pill.srSuffix).toBe(sentence);
    // An email has no gauge: its words stay the band and the step alone.
    expect(pill.plain).not.toContain(String(DIFFICULTY_LEVEL_COUNT));
  });

  it("every level of fifteen has its own sentence, in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const sentences = new Set<string>();
      for (let level = 1; level <= DIFFICULTY_LEVEL_COUNT; level += 1) sentences.add((await difficultyPill(level)).tooltip!);
      expect(sentences.size, locale).toBe(DIFFICULTY_LEVEL_COUNT);
    }
  });

  it("the drawn chip carries the tooltip mark and the sentence in its accessible name, never an aria-label", async () => {
    const pill = await difficultyPill(5);
    const html = renderToStaticMarkup(RoutePills({ pills: [pill] }));
    expect(html).toContain('data-has-tooltip="true"');
    expect(html).toContain(`<span aria-hidden="true">Mediu 2</span>`);
    expect(html).toContain("Dificultate: mediu, treapta 2 din 3");
    expect(html).toContain(" — Nivelul 5 din 15: o alergare mai lungă");
    expect(html).not.toMatch(/aria-label=/);
  });
});

describe("§NNN the editor's «?» explains the whole scale", () => {
  const words = {
    label: ro.Admin.editor.fields.difficultyStep,
    help: ro.Admin.editor.difficultyStepHelp,
    scale: ro.Admin.editor.difficultyStepHelpMore,
    choices: ro.Admin.editor.difficultySteps,
  };

  it("draws a «?» named by the scale, after the help line and outside the radio group's description", () => {
    const html = renderToStaticMarkup(createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, words }));
    expect(html).toContain('data-testid="difficulty-scale-help"');
    expect(html).toContain(`aria-label="${words.scale}"`);
    expect(html).toContain('type="button"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    // The description is the one short line, never the «?»'s paragraph.
    expect(html).toContain(`<span id="${describedBy}">${words.help}</span>`);
  });

  it("says the fifteen levels and the club's examples, in both languages", () => {
    for (const text of [ro.Admin.editor.difficultyStepHelpMore, en.Admin.editor.difficultyStepHelpMore]) {
      expect(text).toContain("15");
      expect(text).toContain("Tâmpa");
    }
  });

  it("draws no «?» when no scale is handed to it", () => {
    const { scale: _scale, ...without } = words;
    void _scale;
    const html = renderToStaticMarkup(createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, words: without }));
    expect(html).not.toContain("difficulty-scale-help");
  });
});
