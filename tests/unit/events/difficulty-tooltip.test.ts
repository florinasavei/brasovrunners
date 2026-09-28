import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §528 — the difficulty gauge says its level of fifteen, and the backoffice explains
 * the scale behind a «?».
 *
 * - The event's pill (`route-pills.ts`): the tooltip «Mediu 2 — nivelul 5 din 15» — the band and
 *   step, then the level of fifteen, never an example (a non-Tâmpa «Mediu 1» is not the Tâmpa run) —
 *   and a screen reader hears it once, as the chip's `srLabel`: «Dificultate: mediu 2 — nivelul 5 din 15».
 * - An email has no gauge: its facts keep `plain` alone, «Mediu, treapta 2 din 3».
 * - A band's filter box names its levels on hover: «Greuț: nivelurile 7–9 din 15».
 * - The editor's «Treapta» and the band select beside it carry a «?» with the whole scale, one
 *   line per band in the owner's words, outside the radio group's own one-line description.
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
const { DIFFICULTY_BANDS, DIFFICULTY_LEVEL_COUNT, difficultyBandLevels } = await import("@/modules/events/domain/difficulty");
const { default: DifficultyStepField } = await import("@/modules/content/events/ui/DifficultyStepField");
const { default: ListingFilterPanel } = await import("@/modules/events/ui/ListingFilterPanel");
const { NO_FILTER } = await import("@/modules/events/domain/listing-filter");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

describe("§528 a band's filter box names its levels", () => {
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

describe("§528 the scale's arithmetic", () => {
  it("names each band's levels, 1–3 up to 13–15", () => {
    expect(DIFFICULTY_BANDS.map((band) => difficultyBandLevels(band))).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 9 },
      { from: 10, to: 12 },
      { from: 13, to: 15 },
    ]);
  });

});

describe("§528 the pill's tooltip names the level of fifteen", () => {
  it.each([
    ["ro", 1, "Ușor 1 — nivelul 1 din 15"],
    ["ro", 2, "Ușor 2 — nivelul 2 din 15"],
    ["ro", 4, "Mediu 1 — nivelul 4 din 15"],
    ["ro", 5, "Mediu 2 — nivelul 5 din 15"],
    ["ro", 6, "Mediu 3 — nivelul 6 din 15"],
    ["ro", 8, "Greuț 2 — nivelul 8 din 15"],
    ["ro", 11, "Greu 2 — nivelul 11 din 15"],
    ["ro", 15, "Foarte greu 3 — nivelul 15 din 15"],
    ["en", 1, "Easy 1 — level 1 of 15"],
    ["en", 2, "Easy 2 — level 2 of 15"],
    ["en", 5, "Medium 2 — level 5 of 15"],
    ["en", 12, "Hard 3 — level 12 of 15"],
    ["en", 15, "Very hard 3 — level 15 of 15"],
  ] as const)("in %s, level %i reads «%s»", async (locale, level, sentence) => {
    currentLocale = locale;
    const pill = await difficultyPill(level);
    expect(pill.tooltip).toBe(sentence);
    // Heard once, without the hover: the chip's own srLabel says the same level, and no srSuffix repeats it.
    expect(pill.srLabel).toBe(`${locale === "ro" ? "Dificultate" : "Difficulty"}: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`);
    expect(pill.srSuffix).toBeUndefined();
    // No example on a public surface: nothing after the level.
    expect(pill.tooltip).not.toContain(":");
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

  it("the drawn chip carries the tooltip mark and the sentence once in its accessible name, never an aria-label", async () => {
    const pill = await difficultyPill(5);
    const html = renderToStaticMarkup(RoutePills({ pills: [pill] }));
    expect(html).toContain('data-has-tooltip="true"');
    expect(html).toContain(`<span aria-hidden="true">Mediu 2</span>`);
    expect(html).toContain(">Dificultate: mediu 2 — nivelul 5 din 15<");
    expect(html.match(/nivelul 5 din 15/g)).toHaveLength(1);
    expect(html).not.toMatch(/aria-label=/);
  });
});

describe("§528 the editor's «?» explains the whole scale", () => {
  const words = {
    label: ro.Admin.editor.fields.difficultyStep,
    help: ro.Admin.editor.difficultyStepHelp,
    scale: Object.values(ro.Admin.editor.difficultyScale).join("\n"),
    choices: ro.Admin.editor.difficultySteps,
  };

  it("draws a «?» named by the scale, beside the toggle (§537) and outside the radio group's description", () => {
    const html = renderToStaticMarkup(createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, words }));
    expect(html).toContain('data-testid="difficulty-scale-help"');
    expect(html).toContain(`aria-label="${words.scale}"`);
    expect(html).toContain('type="button"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    // The description is the one short line, never the «?»'s paragraph.
    expect(html).toContain(`<span id="${describedBy}">${words.help}</span>`);
  });

  it("says the scale in the owner's own words, one line per band («mediu» per step), in both languages", () => {
    // The owner's words (§526, §528), word for word — the one source the «?» and «Ghid» share.
    expect(Object.values(ro.Admin.editor.difficultyScale)).toEqual([
      "ușor: scurt, plat, pentru oricine",
      "mediu 1: alergarea de pe Tâmpa",
      "mediu 2: alergările mai lungi",
      "mediu 3: lungi și tehnice",
      "greuț: de la semimaraton în sus",
      "greu: maratoane",
      "foarte greu: ultramaratoane și mai sus",
      "în fiecare categorie 1 = cel mai ușor, 3 = cel mai greu",
    ]);
    expect(Object.keys(en.Admin.editor.difficultyScale)).toEqual(Object.keys(ro.Admin.editor.difficultyScale));
    for (const scale of [ro.Admin.editor.difficultyScale, en.Admin.editor.difficultyScale]) {
      for (const line of Object.values(scale)) expect(line.length, line).toBeLessThanOrEqual(200);
    }
  });

  it("«Ghid» points to the «?» and never repeats the examples in words of its own", () => {
    // The Tâmpa example is said once in each catalogue, by the scale's own key.
    expect(JSON.stringify(ro).match(/Tâmpa/g)?.length).toBe(JSON.stringify(ro).match(/de pe Tâmpa/g)?.length);
    expect(JSON.stringify(ro).match(/alergarea de pe Tâmpa/g)).toHaveLength(1);
    expect(JSON.stringify(en).match(/the run up Tâmpa/g)).toHaveLength(1);
  });

  it("draws no «?» when no scale is handed to it", () => {
    const { scale: _scale, ...without } = words;
    void _scale;
    const html = renderToStaticMarkup(createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, words: without }));
    expect(html).not.toContain("difficulty-scale-help");
  });
});
