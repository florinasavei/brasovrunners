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
  difficulty: "EASY" as const,
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
    label: /class="MuiChip-label[^"]*"[^>]*>([^<]*)</.exec(inner)?.[1],
    glyph: /<(?:svg|span)\b[^>]*class="[^"]*MuiChip-icon[^"]*"[^>]*>/.exec(inner)?.[0] ?? null,
  }));
}

describe("§388 buildRoutePills — surface, difficulty, distance, elevation, night event, then cost", () => {
  it("builds every pill, in that order, from what the club stated", async () => {
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const pills = buildRoutePills(FULL_ROUTE, t, format);
    expect(pills.map((pill) => pill.label)).toEqual(["Asfalt", "Ușor", "10 km", "300 m D+", "Noapte", "Gratuit"]);
    // A row with a band and no level — one the data cache kept from before §NNN — is at the band's middle.
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
    const some = buildRoutePills({ ...FULL_ROUTE, elevationGainMeters: null, difficulty: null, nightOverride: false }, t, format);
    expect(some.map((pill) => pill.label)).toEqual(["Asfalt", "10 km", "Gratuit"]);
    const none = buildRoutePills(
      {
        type: "RACE",
        surface: null,
        difficulty: null,
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

  // Through `buildRoutePills` and `RoutePills` for every level in both locales, asserting what a
  // screen reader is given — the chip's visible word, then the visually-hidden span — so a wrong
  // key or a missing locale in `routePillParts`'s `srSuffix` line fails here.
  it.each([
    // Five bands since §412 (the owner, 2026-09-25: "foarte ușor, ușor, mediu, greu și foarte greu"),
    // three steps in each since §NNN — the step is heard after the field's name, and seen as dots.
    ["ro", "VERY_EASY", 1, "Foarte ușor", "Dificultate, treapta 1 din 3"],
    ["ro", "EASY", 5, "Ușor", "Dificultate, treapta 2 din 3"],
    ["ro", "MODERATE", 9, "Mediu", "Dificultate, treapta 3 din 3"],
    ["ro", "HARD", 10, "Greu", "Dificultate, treapta 1 din 3"],
    ["ro", "VERY_HARD", 15, "Foarte greu", "Dificultate, treapta 3 din 3"],
    ["en", "VERY_EASY", 2, "Very easy", "Difficulty, step 2 of 3"],
    ["en", "EASY", 4, "Easy", "Difficulty, step 1 of 3"],
    ["en", "MODERATE", 8, "Moderate", "Difficulty, step 2 of 3"],
    ["en", "HARD", 12, "Hard", "Difficulty, step 3 of 3"],
    ["en", "VERY_HARD", 13, "Very hard", "Difficulty, step 1 of 3"],
  ] as const)("in %s, %s at level %i reads «%s» and, hidden, «— %s»", async (locale, difficulty, level, word, field) => {
    currentLocale = locale;
    const t = await getTranslations("Event");
    const format = await getFormatter();
    const step = ((level - 1) % 3) + 1;
    const pills = buildRoutePills({ ...FULL_ROUTE, difficulty, difficultyLevel: level }, t, format).filter(
      (pill) => pill.glyph === `difficulty:${difficulty}-${step}`,
    );
    expect(pills).toHaveLength(1);
    // Where no gauge is drawn (an email's facts, §392), the words say the step.
    expect(pills[0]!.plain).toBe(locale === "ro" ? `${word}, treapta ${step} din 3` : `${word}, step ${step} of 3`);
    const html = renderToStaticMarkup(RoutePills({ pills }));
    const label = /class="MuiChip-label[^"]*"[^>]*>([\s\S]*?)<\/span><\/span>/.exec(html)?.[1] ?? "";
    // The word is the label's own text, shown; the field's name follows it in a span clipped to
    // one pixel (`GlyphChip`'s `srOnlySx`) — the only other text in the label.
    expect(/^([^<]*)</.exec(label)?.[1]).toBe(word);
    const hidden = /<span class="MuiBox-root [^"]*">([^<]*)$/.exec(label)?.[1];
    expect(hidden).toBe(` — ${field}`);
    expect(html).not.toMatch(/aria-label=/);
    expect(html).not.toMatch(/aria-hidden="true">[^<]*(Foarte|Ușor|Mediu|Greu|Very|Easy|Moderate|Hard)/);
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
