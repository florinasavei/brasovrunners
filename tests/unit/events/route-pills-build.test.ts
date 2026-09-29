import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §388 — the backoffice event cards wear the public card's route pills. The
 * owner, 2026-09-25, on `/admin` on his phone: "I want the same small icons for the event
 * types, trail, distance, etc. on the back-office cards as well, people will get used to them."
 *
 * `buildRoutePills` (`route-pills.ts`) is the one function that orders and builds the pills —
 * the listing card's compact facts (`EventFacts`) and the backoffice's own event list both call
 * it — and `RoutePills` is the one component that draws whatever it returns. Tested together
 * here, independently of either page, the way `route-pills.test.ts` already tests
 * `orderRoutePills` alone.
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

const { getFormatter, getTranslations } = await import("next-intl/server");
const { buildRoutePills } = await import("@/modules/events/ui/route-pills");
const { default: RoutePills } = await import("@/modules/events/ui/RoutePills");

afterEach(() => {
  currentLocale = "ro";
});

/** QA's `test-bvr`-shaped route: everything the club can state, stated. */
const FULL_ROUTE = {
  type: "RACE" as const,
  surface: "ASPHALT" as const,
  difficultyLevel: 2,
  distanceMeters: 10000,
  elevationGainMeters: 300,
  // A Wednesday 19:00 in November: after dusk in Brașov, so the automatic answer is a night event (§394).
  startsAt: new Date("2026-11-18T17:00:00Z"),
  endsAt: null,
  scheduleItems: null,
  timezone: "Europe/Bucharest",
  nightOverride: null,
  costType: "FREE" as const,
  registrationMode: "INTERNAL" as const,
  // No place of its own: the club's (§428, §416's rule).
  mapUrl: null,
  latitude: null,
  longitude: null,
  locationToBeAnnounced: false,
};

/** Every chip in a fragment: its label, whether it is outlined, and whether it carries a glyph. */
function chips(fragment: string) {
  // `[^>]*` before the class: the night pill's tooltip (§394) puts its words in a `title` first.
  return [...fragment.matchAll(/<div [^>]*?class="(MuiChip-root[^"]*)"[^>]*>([\s\S]*?)<\/div>/g)].map(([, classes, inner]) => ({
    outlined: classes.includes("MuiChip-outlined"),
    small: classes.includes("MuiChip-sizeSmall"),
    label: /class="MuiChip-label[^"]*"[^>]*>(?:<span aria-hidden="true">)?([^<]*)</.exec(inner)?.[1],
    glyph: /<(?:svg|span)\b[^>]*class="[^"]*MuiChip-icon[^"]*"[^>]*>/.exec(inner)?.[0] ?? null,
  }));
}

describe("§388 buildRoutePills — surface, difficulty, distance, elevation, night event, then cost", () => {
  it("builds every pill, in that order, from what the club stated", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const pills = buildRoutePills(FULL_ROUTE, t, format);
    expect(pills.map((pill) => pill.label)).toEqual(["Asfalt", "Ușor", "10 km", "300 m D+", "Noapte", "Gratuit"]);
    // A row with a band and no level — one the data cache kept from before §526 — is at the band's middle.
    expect(pills.map((pill) => pill.glyph)).toEqual(["surface:ASPHALT", "difficulty:EASY-2", "distance", "elevation", "night", "cost:FREE"]);
  });

  it("builds the same order in English", async () => {
    currentLocale = "en";
    const t = await getTranslations("Event");
    const format = await getFormatter();
    expect(buildRoutePills(FULL_ROUTE, t, format).map((pill) => pill.label)).toEqual(["Asphalt", "Easy", "10 km", "300 m climb", "Night", "Free"]);
  });

  it("gives a pill only to what the club stated, and none at all when it stated nothing", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const some = buildRoutePills({ ...FULL_ROUTE, elevationGainMeters: null, difficultyLevel: null, nightOverride: false }, t, format);
    expect(some.map((pill) => pill.label)).toEqual(["Asfalt", "10 km", "Gratuit"]);
    const none = buildRoutePills(
      {
        type: "RACE",
        surface: null,
        difficultyLevel: null,
        distanceMeters: null,
        elevationGainMeters: null,
        startsAt: FULL_ROUTE.startsAt,
        endsAt: null,
        scheduleItems: null,
        timezone: "Europe/Bucharest",
        nightOverride: false,
        costType: null,
        registrationMode: "INTERNAL",
        mapUrl: null,
        latitude: null,
        longitude: null,
        locationToBeAnnounced: false,
      },
      t,
      format,
    );
    expect(none).toEqual([]);
  });

  it("keeps the cost to the closed set's short word — no amount, no link (§343)", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const pills = buildRoutePills({ ...FULL_ROUTE, costType: "PAID" }, t, format);
    expect(pills.at(-1)?.label).toBe("Cu taxă");
    expect(pills.at(-1)?.srSuffix).toBeUndefined();
  });

  it("adds the organizer's screen-reader-only suffix only on EXTERNAL + PAID (§394)", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const internalPaid = buildRoutePills({ ...FULL_ROUTE, costType: "PAID", registrationMode: "INTERNAL" }, t, format);
    expect(internalPaid.at(-1)?.label).toBe("Cu taxă");
    expect(internalPaid.at(-1)?.srSuffix).toBeUndefined();

    const externalPaid = buildRoutePills({ ...FULL_ROUTE, costType: "PAID", registrationMode: "EXTERNAL" }, t, format);
    expect(externalPaid.at(-1)?.label).toBe("Cu taxă");
    expect(externalPaid.at(-1)?.srSuffix).toBe("plătit la organizator, nu la club");
  });

  // Through `buildRoutePills` and `RoutePills` for levels in every band and both locales, asserting
  // what the eye and a screen reader are given — the visible band alone, «Mediu» (the owner, 2026-09-29 19:08: «the sub indicator is enough»), hidden from the reader, and
  // the visually-hidden «Dificultate: mediu — nivelul 5 din 15 (mediu: 4–6)» in its place (§526,
  // §528; §563: the number is the level, the dots are the step — the glyph carries the step, the words the level).
  it.each([
    // The owner's five bands (§526): ușor, mediu, greuț, greu, foarte greu — three levels each.
    ["ro", "EASY", 1, "Ușor", "Dificultate: ușor — nivelul 1 din 15 (ușor: 1–3)", "Ușor, nivelul 1 din 15"],
    ["ro", "MEDIUM", 5, "Mediu", "Dificultate: mediu — nivelul 5 din 15 (mediu: 4–6)", "Mediu, nivelul 5 din 15"],
    ["ro", "FAIRLY_HARD", 9, "Greuț", "Dificultate: greuț — nivelul 9 din 15 (greuț: 7–9)", "Greuț, nivelul 9 din 15"],
    ["ro", "HARD", 10, "Greu", "Dificultate: greu — nivelul 10 din 15 (greu: 10–12)", "Greu, nivelul 10 din 15"],
    ["ro", "VERY_HARD", 15, "Foarte greu", "Dificultate: foarte greu — nivelul 15 din 15 (foarte greu: 13–15)", "Foarte greu, nivelul 15 din 15"],
    ["en", "EASY", 2, "Easy", "Difficulty: easy — level 2 of 15 (easy: 1–3)", "Easy, level 2 of 15"],
    ["en", "MEDIUM", 4, "Medium", "Difficulty: medium — level 4 of 15 (medium: 4–6)", "Medium, level 4 of 15"],
    ["en", "FAIRLY_HARD", 8, "Fairly hard", "Difficulty: fairly hard — level 8 of 15 (fairly hard: 7–9)", "Fairly hard, level 8 of 15"],
    ["en", "HARD", 12, "Hard", "Difficulty: hard — level 12 of 15 (hard: 10–12)", "Hard, level 12 of 15"],
    ["en", "VERY_HARD", 13, "Very hard", "Difficulty: very hard — level 13 of 15 (very hard: 13–15)", "Very hard, level 13 of 15"],
  ] as const)("in %s, %s at level %i shows «%s» and is heard as «%s»", async (locale, band, level, shown, heard, plain) => {
    currentLocale = locale;
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const step = ((level - 1) % 3) + 1;
    const pills = buildRoutePills({ ...FULL_ROUTE, difficultyLevel: level }, t, format).filter((pill) => pill.glyph === `difficulty:${band}-${step}`);
    expect(pills).toHaveLength(1);
    expect(pills[0]!.label).toBe(shown);
    // Where no gauge is drawn (an email's facts, §392), the words say the level of fifteen (§563).
    expect(pills[0]!.plain).toBe(plain);
    const html = renderToStaticMarkup(RoutePills({ pills }));
    // The visible words, hidden from a screen reader; the heard words, once, in a span clipped to
    // one pixel — the level of fifteen inside them, never repeated after them (§528).
    expect(html).toContain(`<span aria-hidden="true">${shown}</span>`);
    expect(html).toContain(`>${heard}<`);
    expect(html.split(heard.slice(heard.indexOf("—")))).toHaveLength(2);
    expect(html).not.toMatch(/aria-label=/);
  });
});

describe("§388 RoutePills — one small outlined chip per pill, its glyph, nothing when there is nothing", () => {
  it("draws every pill built for it, small and outlined, each with its glyph", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const html = renderToStaticMarkup(RoutePills({ pills: buildRoutePills(FULL_ROUTE, t, format) }));
    const drawn = chips(html);
    expect(drawn.map((pill) => pill.label)).toEqual(["Asfalt", "Ușor", "10 km", "300 m D+", "Noapte", "Gratuit"]);
    for (const pill of drawn) {
      expect(pill.outlined, pill.label).toBe(true);
      expect(pill.small, pill.label).toBe(true);
      expect(pill.glyph, pill.label).not.toBeNull();
    }
  });

  it("draws nothing at all for an empty list", () => {
    expect(renderToStaticMarkup(RoutePills({ pills: [] }))).toBe("");
  });
});
