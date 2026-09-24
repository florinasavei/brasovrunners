import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 (`DECISIONS.md` §356) — the event page's facts, grouped by the question they
 * answer and drawn in the shape their facts have. The owner, 2026-09-24, of the bulleted list
 * §168 had made of them: "This info needs to be better grouped, address with address icons not
 * consistent, distance, difficulty, elevation should be on the same line, better styled", and of
 * the bullets under "Traseu": "these need to be pills".
 *
 * Rendered on the server as the page renders them; the rows are read back as `<dt>`/`<dd>` pairs,
 * with Emotion's inline `<style>` tags set aside.
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
    getLocale: async () => currentLocale,
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-01T09:00:00.000Z");

/** QA's `test-bvr`, the race the owner measured: Saturday 26 September 2026 at 08:00 in Brașov. */
function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "RACE",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-26T05:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: "https://maps.example.test/tractorul",
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 10000,
    elevationGainMeters: 300,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "test-bvr",
    title: "Test BVR",
    excerpt: "Zece kilometri.",
    locationName: "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic",
    locationAddress: "Strada Nicolae Labiș, Brașov",
    locationToBeAnnounced: false,
    difficulty: "EASY",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

const page = async (overrides: Partial<PublicEvent> = {}) =>
  renderToStaticMarkup(await EventFacts({ event: event(overrides), now: NOW, stacked: true }));

// `[\s\S]` rather than the `s` flag: `next build` type-checks the tests against an older target.
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");

/** The `<dl>`'s rows, in order: each label (the `<dt>`'s words) with its `<dt>` and `<dd>` markup. */
function rows(html: string) {
  return [...withoutStyles(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map(([, dt, dd]) => ({ label: text(dt), dt, dd }));
}

function row(html: string, label: string) {
  const found = rows(html).find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no row labelled ${label}: ${rows(html).map((r) => r.label).join(", ")}`);
  return found;
}

/** Every chip in a fragment: its variant, its label and whether it carries its glyph. */
function chips(fragment: string) {
  return [...fragment.matchAll(/<div class="(MuiChip-root[^"]*)"[^>]*>([\s\S]*?)<\/div>/g)].map(([, classes, inner]) => ({
    outlined: classes.includes("MuiChip-outlined"),
    small: classes.includes("MuiChip-sizeSmall"),
    label: /class="MuiChip-label[^"]*"[^>]*>([^<]*)</.exec(inner)?.[1],
    glyph: /<svg\b[^>]*class="[^"]*MuiChip-icon[^"]*"[^>]*>/.exec(inner)?.[0] ?? null,
  }));
}

describe("BR-REQ-041-01 the event page's facts are grouped by question (§356)", () => {
  it("in this order: when, where, the route, the cost, the age, the partners — each once", async () => {
    const html = await page({ coHosts: [{ name: "Salvamont", links: [] }] });
    expect(rows(html).map((r) => r.label)).toEqual(["Când", "Unde", "Traseu", "Cost", "Vârstă", "Împreună cu"]);
  });

  it("says «no registration needed» on an event that takes none, before the partners", async () => {
    const html = await page({ registrationMode: "NONE", coHosts: [{ name: "Salvamont", links: [] }] });
    expect(rows(html).map((r) => r.label)).toEqual(["Când", "Unde", "Traseu", "Cost", "Înscriere", "Împreună cu"]);
    expect(text(row(html, "Înscriere").dd)).toBe("Nu este necesară înscrierea");
  });

  it("draws no list, no bullet and no empty item anywhere in the block", async () => {
    const html = withoutStyles(await page({ coHosts: [{ name: "Salvamont", links: [] }, { name: "Brașov Marathon", links: [] }] }));
    expect(html).not.toMatch(/<ul\b|<li\b/);
    expect(html).not.toContain("•");
  });
});

describe("BR-REQ-041-01 the route is one row of pills (§356)", () => {
  it("distance, climb, difficulty, surface — in that order, each a small outlined chip with its glyph", async () => {
    const html = await page();
    const route = row(html, "Traseu");
    const pills = chips(route.dd);
    expect(pills.map((pill) => pill.label)).toEqual(["10 km", "300 m D+", "Ușor", "Asfalt"]);
    for (const pill of pills) {
      expect(pill.outlined, pill.label).toBe(true);
      expect(pill.small, pill.label).toBe(true);
      expect(pill.glyph, pill.label).not.toBeNull();
      expect(pill.glyph, pill.label).toContain('aria-hidden="true"');
    }
    // One glyph style for all four: MUI's small chip icon, the same classes on each.
    const glyphClasses = pills.map((pill) => /class="([^"]*)"/.exec(pill.glyph ?? "")?.[1]?.split(" ").filter((c) => c.startsWith("MuiChip-icon")).sort().join(" "));
    expect(new Set(glyphClasses).size).toBe(1);
    expect(route.dd).toContain('data-testid="StraightenIcon"');
    expect(route.dd).toContain('data-testid="TrendingUpIcon"');
    expect(route.dd).toContain('data-testid="SignalCellularAlt1BarIcon"');
  });

  it("says the climb short in English too", async () => {
    currentLocale = "en";
    const html = await page();
    expect(chips(row(html, "Route").dd).map((pill) => pill.label)).toEqual(["10 km", "300 m climb", "Easy", "Asphalt"]);
  });

  it("lets a pill's words wrap rather than cut them with an ellipsis", async () => {
    const html = await page({ costType: "PAID", costAmount: "50 lei la înscriere, 70 lei în ziua cursei" });
    expect(html).toMatch(/\.MuiChip-label\{[^}]*white-space:normal/);
    expect(chips(row(html, "Cost").dd)[0].label).toBe("50 lei la înscriere, 70 lei în ziua cursei");
  });

  it("gives a pill only to what the club stated: no climb and no difficulty when there are none", async () => {
    const html = await page({ elevationGainMeters: null, difficulty: null });
    expect(chips(row(html, "Traseu").dd).map((pill) => pill.label)).toEqual(["10 km", "Asfalt"]);
    expect(html).not.toContain("D+");
  });

  it("never makes a route row out of the surface alone — the overline already says it", async () => {
    const html = await page({ distanceMeters: null, elevationGainMeters: null, difficulty: null, surface: "TRAIL" });
    expect(rows(html).map((r) => r.label)).not.toContain("Traseu");
  });

  it("puts the surface beside the route's link when the link is all the route has", async () => {
    const html = await page({ distanceMeters: null, elevationGainMeters: null, difficulty: null, surface: "TRAIL", routeUrl: "https://routes.example.test/tampa" });
    const route = row(html, "Traseu");
    expect(chips(route.dd).map((pill) => pill.label)).toEqual(["Trail"]);
    expect(route.dd).toContain('href="https://routes.example.test/tampa"');
    expect(text(route.dd)).toContain("Vezi traseul");
  });

  it("gives the two numbers their own glyphs by name, for the chip to make on the client (§112)", () => {
    expect(GLYPHS.distance).toBeTruthy();
    expect(GLYPHS.elevation).toBeTruthy();
  });
});

describe("BR-REQ-041-01 the cost is its own row, with its own pill (§356, §343)", () => {
  it("«Gratuit» under «Cost», never inside the route", async () => {
    const html = await page();
    expect(chips(row(html, "Cost").dd).map((pill) => pill.label)).toEqual(["Gratuit"]);
    expect(row(html, "Cost").dd).toContain('data-testid="MoneyOffIcon"');
    expect(text(row(html, "Traseu").dd)).not.toContain("Gratuit");
  });

  it("the club's own amount as the pill, and where to pay as a link after it", async () => {
    const html = await page({ costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" });
    const cost = row(html, "Cost");
    expect(chips(cost.dd).map((pill) => pill.label)).toEqual(["50 lei"]);
    expect(cost.dd).toContain('href="https://revolut.me/brasovrunners"');
    expect(text(cost.dd)).toContain("plata pe revolut.me");
  });

  it("«Donație» as the pill, then «Donează pe {host}» and the suggested amount", async () => {
    const html = await page({ costType: "DONATION", costAmount: "50 lei", costUrl: "https://www.wingsforlifeworldrun.com/en/donate" });
    const cost = row(html, "Cost");
    expect(chips(cost.dd).map((pill) => pill.label)).toEqual(["Donație"]);
    expect(/<a [^>]*>([^<]*)<\/a>/.exec(cost.dd)?.[1]).toBe("Donează pe wingsforlifeworldrun.com");
    expect(text(cost.dd)).toContain("sugerat 50 lei");
  });

  it("says nothing about a cost the club has not stated", async () => {
    const html = await page({ costType: null });
    expect(rows(html).map((r) => r.label)).not.toContain("Cost");
  });
});

describe("BR-REQ-041-01 «când» is one line with its weekday (§356, §349)", () => {
  it("the date and the time, a hidden middle dot between them, and no «începe la»", async () => {
    const when = row(await page(), "Când").dd;
    expect(text(when)).toBe("Sâmbătă, 26 sept. 2026·08:00");
    expect(when).toContain('aria-hidden="true">·');
    expect(text(when)).not.toContain("începe la");
  });

  it("in English, the English weekday", async () => {
    currentLocale = "en";
    // ICU versions disagree on September's abbreviation in English ("Sep" / "Sept"); the rest is fixed.
    expect(text(row(await page(), "When").dd)).toMatch(/^Saturday, 26 Sept? 2026·08:00$/);
  });

  it("a race's two times, each named, on the same line", async () => {
    const when = row(await page({ startsAt: new Date("2026-09-26T06:00:00Z"), raceStartsAt: new Date("2026-09-26T07:00:00Z") }), "Când").dd;
    expect(text(when)).toBe("Sâmbătă, 26 sept. 2026·întâlnire la 09:00·start la 10:00");
  });
});

describe("BR-REQ-041-01 «unde» carries its address, and every row the same glyph (§356)", () => {
  it("the place as the one link to the map, the address on the line under it", async () => {
    const where = row(await page(), "Unde").dd;
    expect([...where.matchAll(/<a\b/g)]).toHaveLength(1);
    expect(where).toContain('href="https://maps.example.test/tractorul"');
    expect(where).toContain("Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic");
    expect(where).toMatch(/data-testid="event-address">Strada Nicolae Labiș, Brașov</);
  });

  it("the address without a link when the club gave no map", async () => {
    const where = row(await page({ mapUrl: null }), "Unde").dd;
    expect(where).not.toContain("<a ");
    expect(text(where)).toBe("Parcul Sportiv Tractorul – intrarea dinspre Patinoarul OlimpicStrada Nicolae Labiș, Brașov");
  });

  it("only the sentence while the place is to be announced (§328) — never the address", async () => {
    const where = row(await page({ locationToBeAnnounced: true }), "Unde").dd;
    expect(text(where)).toBe("Locația se anunță în curând");
  });

  it("one glyph per row, all of one size, one colour and one alignment", async () => {
    const html = await page({ coHosts: [{ name: "Salvamont", links: [] }] });
    const glyphs = rows(html).map((r) => /<svg\b[^>]*>/.exec(r.dt)?.[0] ?? "");
    expect(glyphs).toHaveLength(6);
    for (const glyph of glyphs) expect(glyph).toContain('aria-hidden="true"');
    const classes = glyphs.map((glyph) => /class="([^"]*)"/.exec(glyph)?.[1]);
    expect(new Set(classes).size).toBe(1);
    // …and that one class is twenty pixels, the secondary text colour, centred on the label's line.
    const rule = new RegExp(`\\.${classes[0]?.split(" ").at(-1)}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
    expect(rule).toContain("font-size:20px");
    expect(rule).toContain("vertical-align:middle");
    expect(rule).toContain("color:rgba(0, 0, 0, 0.6)");
  });

  it("keeps a link's 44 pixels while it sits on a line as tall as its text", async () => {
    const html = await page({ costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" });
    const anchors = [...withoutStyles(html).matchAll(/<a\b[^>]*class="[^"]*\b(css-[\w-]+)"/g)].map((match) => match[1]);
    expect(anchors).toHaveLength(2);
    for (const cls of anchors) {
      const rule = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
      expect(rule).toContain("min-height:44px");
    }
  });

  it("is what the event page and the preview draw, with no address of their own underneath", () => {
    for (const file of ["src/app/[locale]/events/[slug]/page.tsx", "src/app/[locale]/preview/events/[id]/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/<EventFacts\b[^>]*\bstacked\b[^>]*\/>/);
      expect(source, file).not.toMatch(/\.locationAddress\s*&&/);
    }
  });
});

describe("BR-REQ-041-01 the hero and the cards keep their one-line forms (§169, §356)", () => {
  it("the featured hero: one line of pieces under «Traseu», middle dots, no pills, the cost in the route", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ costType: "PAID", costAmount: "50 lei" }), now: NOW }));
    expect(html).not.toContain("MuiChip-root");
    const route = row(html, "Traseu");
    expect(text(route.dd)).toContain("300 m diferență de nivel");
    expect(text(route.dd)).toContain("Taxă: 50 lei");
    expect(rows(html).map((r) => r.label)).not.toContain("Cost");
    // The hero says no address: a summary above the fold.
    expect(html).not.toContain("Strada Nicolae Labiș");
  });

  it("the listing card: two plain lines, no labels, no pills", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact", links: false }));
    expect(html).not.toContain("MuiChip-root");
    expect(html).not.toContain("<dl");
    expect(html).toContain("Sâmbătă, 26 sept. 2026");
  });
});
