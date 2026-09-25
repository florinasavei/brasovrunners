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

/** The `<dl>`'s rows, in order: each label (the `<dt>`'s words, its leading glyph aside — an
 * `<svg>` for every Material row and a `<span>` for the partner's 🤝, which is text itself and
 * would otherwise land inside the label) with its `<dt>` and `<dd>` markup. */
function rows(html: string) {
  return [...withoutStyles(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map(([, dt, dd]) => ({
    label: text(dt.replace(/^<(svg|span)\b[^>]*>[\s\S]*?<\/\1>/, "")),
    dt,
    dd,
  }));
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

describe("BR-REQ-041-01 the route is one row of pills (§356, amended §375)", () => {
  it("surface, difficulty, distance, climb — in that order (the owner, 2026-09-24: \"terrain type, difficulty, distance, elevation\"), each a small outlined chip with its glyph", async () => {
    const html = await page();
    const route = row(html, "Traseu");
    const pills = chips(route.dd);
    expect(pills.map((pill) => pill.label)).toEqual(["Asfalt", "Ușor", "10 km", "300 m D+"]);
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
    expect(chips(row(html, "Route").dd).map((pill) => pill.label)).toEqual(["Asphalt", "Easy", "10 km", "300 m climb"]);
  });

  it("lets a pill's words wrap rather than cut them with an ellipsis", async () => {
    const html = await page({ costType: "PAID", costAmount: "50 lei la înscriere, 70 lei în ziua cursei" });
    expect(html).toMatch(/\.MuiChip-label\{[^}]*white-space:normal/);
    expect(chips(row(html, "Cost").dd)[0].label).toBe("50 lei la înscriere, 70 lei în ziua cursei");
  });

  it("gives a pill only to what the club stated: no climb and no difficulty when there are none", async () => {
    const html = await page({ elevationGainMeters: null, difficulty: null });
    expect(chips(row(html, "Traseu").dd).map((pill) => pill.label)).toEqual(["Asfalt", "10 km"]);
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
    // One clock, in front of the first time: the two read as one group (§366).
    expect(when.match(/data-testid="ScheduleIcon"/g)).toHaveLength(1);
    expect(when.indexOf('data-testid="ScheduleIcon"')).toBeLessThan(when.indexOf("întâlnire"));
  });

  it("puts a clock in front of the time, as the listing card does (§366): «[calendar] Sâmbătă, 26 sept. 2026 · [clock] 08:00»", async () => {
    const html = await page();
    const when = row(html, "Când").dd;
    const clock = /<svg\b[^>]*data-testid="ScheduleIcon"[^>]*>/.exec(when)?.[0] ?? "";
    expect(clock).toContain('aria-hidden="true"');
    expect(when.indexOf("2026")).toBeLessThan(when.indexOf(clock));
    expect(when.indexOf(clock)).toBeLessThan(when.indexOf("08:00"));
    // The row glyph's family: twenty pixels, the secondary colour, centred on the line.
    const cls = /class="[^"]*\b(css-[\w-]+)"/.exec(clock)?.[1];
    const rule = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
    expect(rule).toContain("font-size:20px");
    expect(rule).toContain("vertical-align:middle");
    expect(rule).toContain("color:rgba(0, 0, 0, 0.6)");
    // The row's own glyph is still the calendar, in the label.
    expect(row(html, "Când").dt).toContain('data-testid="CalendarMonthIcon"');
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
    // Five Material rows draw an <svg>; the partner's is PartnerEmoji's <span> (§NNN) — a
    // different element and Emotion class, so each row's own rule is checked rather than one
    // shared class name, but every rule carries the same twenty pixels, colour and alignment.
    const html = await page({ coHosts: [{ name: "Salvamont", links: [] }] });
    const glyphs = rows(html).map((r) => /<(?:svg|span)\b[^>]*>/.exec(r.dt)?.[0] ?? "");
    expect(glyphs).toHaveLength(6);
    for (const glyph of glyphs) expect(glyph).toContain('aria-hidden="true"');
    const classes = glyphs.map((glyph) => /class="([^"]*)"/.exec(glyph)?.[1]?.split(" ").at(-1));
    expect(classes.every(Boolean)).toBe(true);
    for (const cls of classes) {
      const rule = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
      expect(rule).toContain("font-size:20px");
      expect(rule).toContain("vertical-align:middle");
      expect(rule).toContain("color:rgba(0, 0, 0, 0.6)");
    }
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

describe("BR-REQ-041-01 the hero keeps its one-line form (§169, §356)", () => {
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

  it("orders the hero's route the same way as the card's and the page's pills — difficulty before distance and elevation (§366, amended §375)", async () => {
    // The owner, 2026-09-24, of "8 km · 250 m D+ · Mediu · Trail": "The order of this should be:
    // terrain type, difficulty, distance, elevation". The hero has no surface pill of its own.
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW }));
    const route = row(html, "Traseu");
    const text = route.dd.replace(/<[^>]+>/g, "");
    expect(text.indexOf("Ușor")).toBeGreaterThan(-1);
    expect(text.indexOf("Ușor")).toBeLessThan(text.indexOf("10 km"));
    expect(text.indexOf("10 km")).toBeLessThan(text.indexOf("300 m diferență de nivel"));
  });

  it("the featured hero's clock is the size of its other glyphs — eighteen pixels, three under the baseline (§366)", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW }));
    const when = row(html, "Când");
    const clock = /<svg\b[^>]*data-testid="ScheduleIcon"[^>]*>/.exec(when.dd)?.[0] ?? "";
    const calendar = /<svg\b[^>]*data-testid="CalendarMonthIcon"[^>]*>/.exec(when.dt)?.[0] ?? "";
    expect(clock).toContain('aria-hidden="true"');
    const classOf = (tag: string) => /class="[^"]*\b(css-[\w-]+)"/.exec(tag)?.[1];
    // One style object for both: the calendar in the label and the clock in the answer.
    expect(classOf(clock)).toBe(classOf(calendar));
    const rule = new RegExp(`\\.${classOf(clock)}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
    expect(rule).toContain("font-size:18px");
    expect(rule).toContain("vertical-align:-3px");
  });

  it("keeps the hero's own pieces on the hero: its route, Strava and Facebook links and its partner sentence, none of them on a card (§366)", async () => {
    const withEverything = event({
      routeUrl: "https://www.strava.com/routes/1",
      stravaEventUrl: "https://www.strava.com/clubs/1/group_events/2",
      facebookEventUrl: "https://www.facebook.com/events/3",
      coHosts: [{ name: "Salvamont", links: [{ kind: "SITE", url: "https://salvamont.example.test" }] }],
    });
    const hero = renderToStaticMarkup(await EventFacts({ event: withEverything, now: NOW }));
    expect(hero).toContain("strava.com/routes/1");
    expect(hero).toContain("facebook.com/events/3");
    expect(hero).toContain("salvamont.example.test");
    const card = renderToStaticMarkup(await EventFacts({ event: withEverything, now: NOW, variant: "compact" }));
    for (const absent of ["strava.com", "facebook.com", "salvamont.example.test", "Salvamont"]) expect(card).not.toContain(absent);
  });

});

/**
 * BR-REQ-041-01 (§366) — the listing card draws the event page's shapes, smaller. The owner,
 * 2026-09-24, with a screenshot of the listing: "There is too much whitespace on these cards, it
 * needs to be better spaced" — and in it, the pin alone on a line with the place under it, and the
 * route as "8 km · 250 m diferență de nivel · ı Mediu" with a tiny glyph and middle dots, the
 * partner's "Împreună cu …" among them, while the event page had just made the same facts pills
 * (§356): "I like these pills on the full page details! this is currently pretty ugly!".
 */
describe("BR-REQ-041-01 the listing card's facts: glyph-led lines and the page's pills (§366)", () => {
  const card = async (overrides: Partial<PublicEvent> = {}, extra: { links?: boolean; whenLead?: string } = {}) =>
    renderToStaticMarkup(await EventFacts({ event: event(overrides), now: NOW, variant: "compact", links: extra.links, whenLead: extra.whenLead }));

  /**
   * The card's lines, in order: each `data-fact` element's name and its markup up to the next
   * line (the last one's up to the end of the block). Lines are siblings, so that is the line.
   */
  function lines(html: string) {
    const markup = withoutStyles(html);
    const starts = [...markup.matchAll(/<div\b[^>]*data-fact="(\w+)"[^>]*>/g)];
    return starts.map((match, index) => {
      const from = (match.index ?? 0) + match[0].length;
      const to = index + 1 < starts.length ? (starts[index + 1]?.index ?? markup.length) : markup.length;
      // Up to the line's own closing tag: drop the trailing closers the slice carries.
      const inner = markup.slice(from, to).replace(/(<\/div>)+$/, (closers) => closers.slice(0, -"</div>".length * (index + 1 < starts.length ? 1 : 2)));
      return { key: match[1] ?? "", inner };
    });
  }

  function line(html: string, key: string) {
    const found = lines(html).find((candidate) => candidate.key === key);
    if (!found) throw new Error(`no line ${key}: ${lines(html).map((l) => l.key).join(", ")}`);
    return found;
  }

  /** The CSS rule Emotion emitted for the last `css-` class on a tag. */
  function ruleOf(html: string, tag: string) {
    const cls = /class="[^"]*\b(css-[\w-]+)"/.exec(tag)?.[1];
    return new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
  }

  it("has no labels and no list: a line for when, a line for where, the pills, then the state of registration", async () => {
    const html = await card();
    expect(html).not.toContain("<dl");
    expect(withoutStyles(html)).not.toMatch(/<ul\b|<li\b/);
    expect(lines(html).map((l) => l.key)).toEqual(["when", "where", "pills", "registration"]);
    expect(html).not.toContain("Când");
    expect(html).not.toContain("Unde");
  });

  it("puts the pin and the place in one line element, the pin first, the place the map link — never the pin alone on a line", async () => {
    const where = line(await card(), "where").inner;
    // The glyph and the words are the two children of one flex row: the glyph stays on the first
    // line of the words, and a long place wraps under itself.
    expect(where).toMatch(
      /^<svg\b[^>]*data-testid="PlaceIcon"[^>]*>[\s\S]*?<\/svg><div\b[^>]*><a\b[^>]*href="https:\/\/maps\.example\.test\/tractorul"[^>]*>Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic<\/a><\/div>$/,
    );
    const html = await card();
    const rule = ruleOf(html, /<div\b[^>]*data-fact="where"[^>]*>/.exec(withoutStyles(html))?.[0] ?? "");
    expect(rule).toContain("display:flex");
    expect(rule).toContain("align-items:flex-start");
  });

  it("says the map once, as the place — 44 pixels to a thumb, padding given back as margin, so the line is as tall as its words even when the place wraps", async () => {
    const html = await card();
    const anchors = [...withoutStyles(line(html, "where").inner).matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toContain('target="_blank"');
    const rule = ruleOf(html, anchors[0] ?? "");
    // The 44 includes the padding, said on the link: inside the listing's fold everything is
    // content-box, and there the link was 64 pixels and its words twelve under the pin (§366).
    expect(rule).toContain("box-sizing:border-box");
    expect(rule).toContain("min-height:44px");
    expect(rule).toContain("padding-top:10px");
    expect(rule).toContain("padding-bottom:10px");
    expect(rule).toContain("margin-top:-10px");
    expect(rule).toContain("margin-bottom:-10px");
  });

  it("keeps the map link's ten pixels below inside the facts when no pills follow it — nothing nearer may sit on them (§366)", async () => {
    // No distance, climb, difficulty, surface or cost: the state of registration is a line's gap
    // (eight pixels) under the place, nearer than the link's ten, and would take its bottom.
    const html = await card({ distanceMeters: null, elevationGainMeters: null, difficulty: null, surface: null, costType: null });
    expect(lines(html).map((l) => l.key)).toEqual(["when", "where", "registration"]);
    const anchors = [...withoutStyles(line(html, "where").inner).matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(1);
    const rule = ruleOf(html, anchors[0] ?? "");
    // The 44 includes the padding, said on the link: inside the listing's fold everything is
    // content-box, and there the link was 64 pixels and its words twelve under the pin (§366).
    expect(rule).toContain("box-sizing:border-box");
    expect(rule).toContain("min-height:44px");
    expect(rule).toContain("padding-top:10px");
    expect(rule).toContain("padding-bottom:10px");
    expect(rule).toContain("margin-top:-10px");
    expect(rule).not.toContain("margin-bottom");
  });

  it("writes the place as words where the facts may carry no link", async () => {
    const where = line(await card({}, { links: false }), "where").inner;
    expect(where).not.toContain("<a ");
    expect(text(where)).toBe("Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic");
  });

  it("leads every line with the event page's own row glyph — one class, twenty pixels, the secondary colour", async () => {
    const html = await card();
    const glyphClass = (fragment: string) => /<svg\b[^>]*class="([^"]*)"/.exec(fragment)?.[1];
    const classes = lines(html)
      .filter((l) => l.key !== "pills")
      .map((l) => glyphClass(l.inner));
    expect(classes).toHaveLength(3);
    expect(new Set(classes).size).toBe(1);
    // The same class the page's rows wear (§356): one style object, `ROW_ICON_SX`.
    const pageGlyph = glyphClass(rows(await page()).at(0)?.dt ?? "");
    expect(classes[0]).toBe(pageGlyph);
  });

  it("writes when as one line: the date with its weekday, a clock, and the time — each piece whole", async () => {
    const html = await card();
    const when = line(html, "when").inner;
    // The event is within the coming twelve months (NOW is 2026-09-01, the event 2026-09-26), so
    // the card carries both renderings of the date — CSS shows only one at a time (below).
    expect(when).toContain("Sâmbătă, 26 sept. 2026");
    expect(when).toContain("Sâmbătă, 26 sept.");
    expect(when).toContain("white-space:nowrap");
    // The separator is hidden from a screen reader.
    expect(when).toMatch(/<span\b[^>]*aria-hidden="true"[^>]*>·<\/span>/);
    // The clock sits after the date pieces and before the time, as big and as grey as the row's glyph.
    const clock = /<svg\b[^>]*data-testid="ScheduleIcon"[^>]*>/.exec(when)?.[0] ?? "";
    expect(clock).toContain('aria-hidden="true"');
    expect(when.indexOf("2026")).toBeLessThan(when.indexOf(clock));
    expect(when.indexOf(clock)).toBeLessThan(when.indexOf("08:00"));
    const rule = ruleOf(html, clock);
    expect(rule).toContain("font-size:20px");
    expect(rule).toContain("vertical-align:middle");
    expect(rule).toContain("color:rgba(0, 0, 0, 0.6)");
  });

  it("drops the year only on a phone, and only when the date is within the coming twelve months (§366, amended §375 — the owner: \"This should be on a single line on a phone\")", async () => {
    // Over a year out: `formatDay` is called once, with the year — no second rendering to toggle.
    // January carries no DST (Europe/Bucharest is UTC+2 then, +3 in September).
    const far = line(await card({ startsAt: new Date("2028-01-15T05:00:00Z") }), "when").inner;
    expect(text(far)).toBe("Sâmbătă, 15 ian. 2028·07:00");
    expect([...far.matchAll(/Sâmbătă, 15 ian\. 2028/g)]).toHaveLength(1);
    // Within the year: both the full date and the short one (no year, still the weekday, §349)
    // are in the markup, one hidden by width at a time — never two read together at once.
    const near = line(await card(), "when").inner;
    expect([...near.matchAll(/Sâmbătă, 26 sept\. 2026/g)]).toHaveLength(1);
    expect([...near.matchAll(/Sâmbătă, 26 sept\.(?! 2026)/g)]).toHaveLength(1);
    // The source says which is which: the full date reads at `sm` and up, the short one at `xs`.
    const source = readFileSync("src/modules/events/ui/EventFacts.tsx", "utf8");
    expect(source).toMatch(/display:\s*\{\s*xs:\s*"none",\s*sm:\s*"inline"\s*\}/);
    expect(source).toMatch(/display:\s*\{\s*xs:\s*"inline",\s*sm:\s*"none"\s*\}/);
    expect(source).toContain('year: false');
  });

  it("puts a series card's «Următoarea:» on the date's own line, before it (§113), and visually hides it below its own breakpoint so the row fits at 320 pixels — never MUI's `sm`, which would hide it on every phone (§366, amended §375)", async () => {
    const html = await card({}, { whenLead: "Următoarea:" });
    const when = line(html, "when").inner;
    // The lead comes before the date, which comes before the time — the calendar glyph is first
    // of all, ahead of every piece of text (`cardLine`'s icon, then `flow`'s row). It is always in
    // the markup — a screen reader reads it — even where a narrow phone does not show it beside
    // the date, the clock and the time (below): measured (§366, amended §375) over every day of a
    // year, the widest row with the lead ("Următoarea: Duminică, 27 sept. · 18:30") needs 274
    // pixels and a card leaves the row the viewport less 94, so the row's own breakpoint is 376
    // (368 and eight to spare) — below `sm` (600), not at it: a review, 2026-09-24, found `sm`
    // hiding the lead on every phone, and a second found 345 (one Monday's) too narrow for a Sunday.
    expect(when.indexOf("Următoarea:")).toBeGreaterThan(-1);
    expect(when.indexOf("Următoarea:")).toBeLessThan(when.indexOf("Sâmbătă, 26 sept."));
    expect(when.indexOf("Sâmbătă, 26 sept.")).toBeLessThan(when.indexOf("08:00"));
    // Not a line of its own above the facts.
    expect(lines(html)[0]?.key).toBe("when");
    // Visually hidden (clipped) below the row's own 376-pixel breakpoint, plain text from it up —
    // never `display: none`, so a screen reader reads it at every width. (The date's year is
    // another mechanism: two renderings swapped with `display`.)
    const leadClass = /<span\b[^>]*class="[^"]*\b(css-[\w-]+)"[^>]*>Următoarea:<\/span>/.exec(when)?.[1] ?? "";
    expect(leadClass).not.toBe("");
    const baseRule = ruleOf(html, `class="MuiBox-root ${leadClass}"`);
    expect(baseRule).toContain("white-space:nowrap");
    expect(baseRule).not.toContain("display:none");
    const mediaRule = new RegExp(`@media \\(max-width: 375\\.95px\\)\\{\\.${leadClass}\\{([^}]*)\\}\\}`).exec(html)?.[1] ?? "";
    expect(mediaRule).not.toBe("");
    expect(mediaRule).toContain("position:absolute");
    expect(mediaRule).toContain("clip:rect(0 0 0 0)");
    expect(mediaRule).not.toContain("display:none");
  });

  it("lets a race's two named times wrap onto their own line rather than have the card clip the start time (§366, amended §375)", async () => {
    const withTwoTimes = await card({ raceStartsAt: new Date("2026-09-26T07:00:00Z") });
    const when = line(withTwoTimes, "when").inner;
    // Both times are whole in the markup — the gathering time and the race's own start.
    expect(when).toContain("08:00");
    expect(when).toContain("10:00");
    // The row itself (`flow`'s own box, the second `<div>` inside the line — the first is
    // `cardLine`'s wrapper): wraps between whole pieces rather than clipping the start time,
    // unlike an ordinary card's row, which stays `nowrap`.
    const rowTag = ([...when.matchAll(/<div\b[^>]*class="[^"]*\b(css-[\w-]+)"[^>]*>/g)][1] ?? [])[0] ?? "";
    expect(rowTag).not.toBe("");
    expect(ruleOf(withTwoTimes, rowTag)).toContain("flex-wrap:wrap");
    const plain = await card();
    const plainWhen = line(plain, "when").inner;
    const plainRowTag = ([...plainWhen.matchAll(/<div\b[^>]*class="[^"]*\b(css-[\w-]+)"[^>]*>/g)][1] ?? [])[0] ?? "";
    expect(plainRowTag).not.toBe("");
    expect(ruleOf(plain, plainRowTag)).toContain("flex-wrap:nowrap");
  });

  it("draws the route and the cost as the page's small outlined pills — surface, difficulty, distance, climb, cost", async () => {
    const pills = chips(line(await card(), "pills").inner);
    expect(pills.map((pill) => pill.label)).toEqual(["Asfalt", "Ușor", "10 km", "300 m D+", "Gratuit"]);
    for (const pill of pills) {
      expect(pill.outlined, pill.label).toBe(true);
      expect(pill.small, pill.label).toBe(true);
      expect(pill.glyph, pill.label).toContain('aria-hidden="true"');
    }
    // No middle dot and no "diferență de nivel" left: the pills are the separators.
    const html = withoutStyles(await card());
    expect(text(line(html, "pills").inner)).not.toContain("·");
    expect(html).not.toContain("diferență de nivel");
  });

  it("in English too", async () => {
    currentLocale = "en";
    const pills = chips(line(await card(), "pills").inner);
    expect(pills.map((pill) => pill.label)).toEqual(["Asphalt", "Easy", "10 km", "300 m climb", "Free"]);
  });

  it("draws no pill for what the club has not stated, and none at all when it stated nothing", async () => {
    const some = chips(line(await card({ elevationGainMeters: null, difficulty: null, costType: null }), "pills").inner);
    expect(some.map((pill) => pill.label)).toEqual(["Asfalt", "10 km"]);
    const none = await card({ distanceMeters: null, elevationGainMeters: null, difficulty: null, surface: null, costType: null });
    expect(lines(none).map((l) => l.key)).not.toContain("pills");
    expect(none).not.toContain("MuiChip-root");
  });

  it("keeps the cost to the closed set's word on a card — no amount, no link (§343)", async () => {
    const html = await card({ costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" });
    expect(chips(line(html, "pills").inner).at(-1)?.label).toBe("Cu taxă");
    expect(html).not.toContain("50 lei");
    expect(html).not.toContain("revolut.me");
  });

  it("says nothing of the partners among the facts — the partner's mark on a card is its chips'", async () => {
    const html = await card({ coHosts: [{ name: "Salvamont", links: [{ kind: "SITE", url: "https://salvamont.example.test" }] }] });
    expect(lines(html).map((l) => l.key)).toEqual(["when", "where", "pills", "registration"]);
    expect(html).not.toContain("Împreună cu");
    expect(html).not.toContain("Salvamont");
    expect(html).not.toContain("salvamont.example.test");
  });
});
