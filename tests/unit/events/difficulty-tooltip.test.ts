import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §528 — the difficulty gauge says its level of fifteen, and the backoffice explains
 * the scale behind a «?» — as §563 words it (the owner, 2026-09-29: «ușor: 1,2,3, mediu 4,5,6 și
 * tot așa, în ordine»; the number is the level, the dots are the step).
 *
 * - The event's pill (`route-pills.ts`): the tooltip «Mediu — nivelul 5 din 15», then the whole
 *   ladder on a second line, «ușor 1–3 · mediu 4–6 · greuț 7–9 · greu 10–12 · foarte greu 13–15»
 *   (the owner, 14:18) — never an example (a non-Tâmpa «Mediu 4» is not the Tâmpa run) — and a
 *   screen reader hears the shorter form once, as the chip's `srLabel`: «Dificultate: mediu —
 *   nivelul 5 din 15 (mediu: 4–6)».
 * - An email has no gauge: its facts keep `plain` alone, «Mediu, nivelul 5 din 15».
 * - A band's filter box names its levels on hover: «Greuț: nivelurile 7–9 din 15».
 * - The editor's «Nivelul» and the band select beside it carry a «?» with the whole scale, one
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

const { createTranslator } = await import("next-intl");
const { getFormatter, getTranslations } = await import("next-intl/server");
const { buildRoutePills } = await import("@/modules/events/ui/route-pills");
const { default: RoutePills } = await import("@/modules/events/ui/RoutePills");
const { default: DifficultyTooltipBlock } = await import("@/modules/events/ui/DifficultyTooltipBlock");
const { DIFFICULTY_BANDS, DIFFICULTY_LEVEL_COUNT, difficultyBandLevels } = await import("@/modules/events/domain/difficulty");
const { default: DifficultyStepField } = await import("@/modules/content/events/ui/DifficultyStepField");
const { difficultyScaleText, difficultyStepWords } = await import("@/modules/content/events/ui/difficulty-words");
const { default: ListingFilterPanel } = await import("@/modules/events/ui/ListingFilterPanel");
const { NO_FILTER } = await import("@/modules/events/domain/listing-filter");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

type Words = Parameters<typeof difficultyStepWords>[0];

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

/** The whole ladder, the tooltip's second line (the owner, 2026-09-29 14:18). */
const LADDER = {
  ro: "ușor 1–3 · mediu 4–6 · greuț 7–9 · greu 10–12 · foarte greu 13–15",
  en: "easy 1–3 · medium 4–6 · fairly hard 7–9 · hard 10–12 · very hard 13–15",
} as const;

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

describe("§528, §563 the pill's tooltip names the level of fifteen, then every band's levels", () => {
  it.each([
    ["ro", 1, "Ușor — nivelul 1 din 15", "Dificultate: ușor — nivelul 1 din 15 (ușor: 1–3)"],
    ["ro", 2, "Ușor — nivelul 2 din 15", "Dificultate: ușor — nivelul 2 din 15 (ușor: 1–3)"],
    ["ro", 4, "Mediu — nivelul 4 din 15", "Dificultate: mediu — nivelul 4 din 15 (mediu: 4–6)"],
    ["ro", 5, "Mediu — nivelul 5 din 15", "Dificultate: mediu — nivelul 5 din 15 (mediu: 4–6)"],
    ["ro", 6, "Mediu — nivelul 6 din 15", "Dificultate: mediu — nivelul 6 din 15 (mediu: 4–6)"],
    ["ro", 8, "Greuț — nivelul 8 din 15", "Dificultate: greuț — nivelul 8 din 15 (greuț: 7–9)"],
    ["ro", 11, "Greu — nivelul 11 din 15", "Dificultate: greu — nivelul 11 din 15 (greu: 10–12)"],
    ["ro", 15, "Foarte greu — nivelul 15 din 15", "Dificultate: foarte greu — nivelul 15 din 15 (foarte greu: 13–15)"],
    ["en", 1, "Easy — level 1 of 15", "Difficulty: easy — level 1 of 15 (easy: 1–3)"],
    ["en", 2, "Easy — level 2 of 15", "Difficulty: easy — level 2 of 15 (easy: 1–3)"],
    ["en", 5, "Medium — level 5 of 15", "Difficulty: medium — level 5 of 15 (medium: 4–6)"],
    ["en", 12, "Hard — level 12 of 15", "Difficulty: hard — level 12 of 15 (hard: 10–12)"],
    ["en", 15, "Very hard — level 15 of 15", "Difficulty: very hard — level 15 of 15 (very hard: 13–15)"],
  ] as const)("in %s, level %i reads «%s» and then the ladder", async (locale, level, first, heard) => {
    currentLocale = locale;
    const pill = await difficultyPill(level);
    expect(pill.tooltip).toBe(`${first}\n${LADDER[locale]}`);
    // Each of the two lines within the owner's 200 characters.
    for (const line of pill.tooltip!.split("\n")) expect(line.length, line).toBeLessThanOrEqual(200);
    // Heard once, without the hover: the chip's own srLabel says the level and its band's range, and no srSuffix repeats it.
    expect(pill.srLabel).toBe(heard);
    expect(pill.srSuffix).toBeUndefined();
    // No example on a public surface: nothing but the level and the ranges.
    expect(pill.tooltip).not.toContain(":");
    expect(pill.tooltip).not.toContain("Tâmpa");
  });

  it("every level of fifteen has its own sentence, in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const sentences = new Set<string>();
      for (let level = 1; level <= DIFFICULTY_LEVEL_COUNT; level += 1) sentences.add((await difficultyPill(level)).tooltip!);
      expect(sentences.size, locale).toBe(DIFFICULTY_LEVEL_COUNT);
    }
  });

  it.each([
    ["ro", 5, "Mediu — nivelul 5 din 15", 1],
    ["ro", 14, "Foarte greu — nivelul 14 din 15", 4],
    ["en", 8, "Fairly hard — level 8 of 15", 2],
  ] as const)("§NNN in %s, level %i's tooltip is a block: the level in bold, then five aligned rows with its band marked", async (locale, level, head, current) => {
    currentLocale = locale;
    const pill = await difficultyPill(level);
    const block = pill.tooltipBlock!;
    // The same words and facts as the string form, only set apart.
    expect(block.head).toBe(head);
    expect(pill.tooltip).toBe(`${head}\n${block.rows.map((row) => `${row.word} ${row.range}`).join(" · ")}`);
    expect(block.rows.map((row) => row.current)).toEqual([0, 1, 2, 3, 4].map((index) => index === current));

    // No DOM in this suite (node): the markup is read by its parts, in order.
    // Emotion's server render interleaves its <style> tags; the structure is what is left.
    const html = renderToStaticMarkup(createElement(DifficultyTooltipBlock, { block })).replace(/<style[^>]*>[^<]*<\/style>/g, "");
    expect(html).toMatch(/^<span [^>]*data-testid="difficulty-tooltip"/);
    expect([...html.matchAll(/data-part="(\w+)"/g)].map((match) => match[1])).toEqual(["head", "ladder", "row", "row", "row", "row", "row"]);
    expect(html).toMatch(new RegExp(`data-part="head"[^>]*>${head}</span>`));
    // Each row: the drawn marker (hidden, empty), the band's word, then its levels in a cell apart.
    const rows = [...html.matchAll(/data-part="row"( data-current="true")?><span[^>]*><span [^>]*aria-hidden="true"><\/span>([^<]+)<\/span><span[^>]*>([^<]+)<\/span><\/span>/g)];
    expect(rows.map((match) => [match[2], match[3]])).toEqual(block.rows.map((row) => [row.word, row.range]));
    expect(rows.map((match) => Boolean(match[1]))).toEqual(block.rows.map((row) => row.current));
  });

  it("the drawn chip carries the tooltip mark and the level once in its accessible name, never an aria-label", async () => {
    const pill = await difficultyPill(5);
    const html = renderToStaticMarkup(RoutePills({ pills: [pill] }));
    expect(html).toContain('data-has-tooltip="true"');
    expect(html).toContain(`<span aria-hidden="true">Mediu</span>`);
    expect(html).toContain(">Dificultate: mediu — nivelul 5 din 15 (mediu: 4–6)<");
    expect(html.match(/nivelul 5 din 15/g)).toHaveLength(1);
    expect(html).not.toMatch(/aria-label=/);
  });
});

/** The words `KindBox` hands «Nivelul», from the catalogue as the page reads it. */
function editorWords(catalogue: typeof ro) {
  const locale = catalogue === ro ? "ro" : "en";
  const t = createTranslator({ locale, messages: catalogue, namespace: "Admin" }) as unknown as Words;
  const tEvent = createTranslator({ locale, messages: catalogue, namespace: "Event" }) as unknown as Words;
  return difficultyStepWords(t, tEvent, difficultyScaleText(t));
}

describe("§528, §563 the editor's «?» explains the whole scale", () => {
  const words = editorWords(ro);
  const band = { name: "event.difficulty", initial: "MEDIUM" };

  it("draws a «?» named by the scale, beside the toggle (§537) and outside the radio group's description", () => {
    const html = renderToStaticMarkup(createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, band, words }));
    expect(html).toContain('data-testid="difficulty-scale-help"');
    expect(html).toContain(`aria-label="${words.scale}"`);
    expect(html).toContain('type="button"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    // The description is the one short line, never the «?»'s paragraph.
    expect(html).toContain(`<span id="${describedBy}">${words.help}</span>`);
  });

  it("says the scale in the owner's own words, one line per band («mediu» per level), every number the level of fifteen", () => {
    // The owner's words (§526, §528), word for word — the one source the «?» and «Ghid» share.
    expect(words.scale.split("\n")).toEqual([
      "ușor 1–3: scurt, plat, pentru oricine",
      "mediu 4: alergarea de pe Tâmpa",
      "mediu 5: alergările mai lungi",
      "mediu 6: lungi și tehnice",
      "greuț 7–9: de la semimaraton în sus",
      "greu 10–12: maratoane",
      "foarte greu 13–15: ultramaratoane și mai sus",
      "în fiecare categorie, primul nivel e cel mai ușor, al treilea cel mai greu",
    ]);
    expect(editorWords(en).scale.split("\n")).toEqual([
      "easy 1–3: short, flat, for anyone",
      "medium 4: the run up Tâmpa",
      "medium 5: the longer runs",
      "medium 6: long and technical",
      "fairly hard 7–9: from a half marathon up",
      "hard 10–12: marathons",
      "very hard 13–15: ultramarathons and beyond",
      "in every band, the first level is the easiest, the third the hardest",
    ]);
    expect(Object.keys(en.Admin.editor.difficultyScale)).toEqual(Object.keys(ro.Admin.editor.difficultyScale));
    for (const catalogue of [ro, en] as const) {
      for (const line of editorWords(catalogue as typeof ro).scale.split("\n")) expect(line.length, line).toBeLessThanOrEqual(200);
    }
  });

  it("says the rule and the whole ladder under «Nivelul», in one sentence per language", () => {
    expect(words.help).toBe(
      "Nivelul e de la 1 (ușor) la 15 (foarte greu): fiecare categorie are trei niveluri — ușor 1–3, mediu 4–6, greuț 7–9, greu 10–12, foarte greu 13–15.",
    );
    expect(editorWords(en).help).toBe(
      "The level runs from 1 (easy) to 15 (very hard): every band has three levels — easy 1–3, medium 4–6, fairly hard 7–9, hard 10–12, very hard 13–15.",
    );
    for (const catalogue of [ro, en] as const) expect(editorWords(catalogue as typeof ro).help.length).toBeLessThanOrEqual(200);
  });

  it("«Ghid» points to the «?» and never repeats the examples in words of its own", () => {
    // The Tâmpa example is said once in each catalogue, by the scale's own key.
    expect(JSON.stringify(ro).match(/Tâmpa/g)?.length).toBe(JSON.stringify(ro).match(/de pe Tâmpa/g)?.length);
    expect(JSON.stringify(ro).match(/alergarea de pe Tâmpa/g)).toHaveLength(1);
    expect(JSON.stringify(en).match(/the run up Tâmpa/g)).toHaveLength(1);
  });

  it("«Ghid» says the same ladder as the pill's tooltip", () => {
    const steps = (catalogue: typeof ro) => JSON.stringify(catalogue.Admin.guide);
    expect(steps(ro)).toContain(LADDER.ro.replace(/ · /g, ", "));
    expect(steps(en as typeof ro)).toContain(LADDER.en.replace(/ · /g, ", "));
  });

  it("draws no «?» when no scale is handed to it", () => {
    const { scale: _scale, ...without } = words;
    void _scale;
    const html = renderToStaticMarkup(createElement(DifficultyStepField, { name: "event.difficultyStep", defaultStep: 2, band, words: without }));
    expect(html).not.toContain("difficulty-scale-help");
  });
});
