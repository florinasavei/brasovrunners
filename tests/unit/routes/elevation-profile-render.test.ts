import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { profileMarkers, type Checkpoint } from "@/modules/event-checkpoints/domain/checkpoint";
import ElevationProfile, { type ElevationProfileMarker, type ElevationProfileWords } from "@/modules/routes/elevation/ElevationProfile";
import { parseGpxElevation } from "@/modules/routes/elevation/parse";
import { elevationGpx } from "../../helpers/elevation-gpx";

/**
 * §NNN — the elevation profile widget (`routes/elevation/ElevationProfile.tsx`) as the event page and the editor's preview
 * draw it: its two sizes, the words, the pins of the checkpoints the club left ticked and the glyph of each kind, and
 * nothing outside its box.
 */
const PROFILE = parseGpxElevation(elevationGpx())!;
const wordsOf = (locale: "ro" | "en") => (locale === "ro" ? ro : en).Event.profile as ElevationProfileWords;

const point = (id: string, km: number, kinds: Checkpoint["kinds"], over: Partial<Checkpoint> = {}): Checkpoint => ({
  id,
  nameRo: `Punct ${id}`,
  nameEn: `Point ${id}`,
  km,
  kinds,
  cutoffMinutes: null,
  cutoffClock: null,
  noteRo: null,
  noteEn: null,
  onProfile: true,
  ...over,
});

const CHECKPOINTS = [point("izvor", 3.8, ["WATER"]), point("cabana", 4.5, ["FOOD"]), point("sosire", 6.2, ["WATER", "FOOD"]), point("ascuns", 7.5, ["FIRST_AID"], { onProfile: false })];

function render(variant: "page" | "compact", locale: "ro" | "en" = "ro", markers: readonly ElevationProfileMarker[] = profileMarkers(CHECKPOINTS, locale), distanceMeters: number | null = null) {
  return renderToStaticMarkup(createElement(ElevationProfile, { variant, profile: PROFILE, distanceMeters, markers, locale, words: wordsOf(locale) }));
}

/** The charts in the markup, one per `<svg>`, with their viewBox and the font size they declare. */
const chartsIn = (html: string) =>
  [...html.matchAll(/<svg\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(tag)!;
    return { tag, width: Number(viewBox[1]), height: Number(viewBox[2]), size: /data-size="(\w+)"/.exec(tag)![1], fontSize: Number(/font-size:(\d+(?:\.\d+)?)px/.exec(tag)![1]) };
  });

describe("§NNN the elevation profile widget: the page", () => {
  const html = render("page");

  it("draws a narrow chart and a wide one, the right one shown by CSS alone, both role=img with the same label", () => {
    const charts = chartsIn(html);
    expect(charts.map((chart) => chart.size)).toEqual(["narrow", "wide"]);
    expect(charts.map((chart) => `${chart.width}x${chart.height}`)).toEqual(["360x240", "1000x280"]);
    for (const chart of charts) expect(chart.tag).toContain('role="img"');
    const label = /role="img" aria-label="([^"]+)"/.exec(html)![1];
    expect(label).toMatch(/^Profilul traseului: 9,0 km, de la 6\d\d la 8\d\d m$/);
    expect(html.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(2);
    expect(html).toContain("min-width:700px");
  });

  it("keeps its labels at 11 px or more on a 320 px phone and from 700 px of screen up", () => {
    const [narrow, wide] = chartsIn(html);
    // The page's inner width at 320 px: the 16 px gutters take 32. The wide chart is shown from 700 px, gutters likewise.
    expect((narrow.fontSize * (320 - 32)) / narrow.width).toBeGreaterThanOrEqual(11);
    expect((wide.fontSize * (700 - 32)) / wide.width).toBeGreaterThanOrEqual(11);
  });

  it("pins only the checkpoints it is handed — the unticked one is not on the chart — one pin per chart and a glyph per kind", () => {
    const pins = [...html.matchAll(/<g data-testid="elevation-pin" data-glyph="(\w+)">/g)].map((match) => match[1]);
    // Three ticked points in each of the two charts.
    expect(pins).toEqual(["water", "food", "water", "water", "food", "water"]);
    expect(html).toContain("<title>Punct izvor</title>");
    expect(html).toContain("<title>Punct sosire</title>");
    expect(html).not.toContain("Punct ascuns");
  });

  it("draws the glyph of each kind as a path of its own", () => {
    const glyphs = ["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION", "none"].map((kind) => {
      const markup = render("compact", "ro", [{ km: 4, kinds: kind === "none" ? [] : [kind], name: "x" }]);
      const pin = /<g data-testid="elevation-pin" data-glyph="(\w+)">[\s\S]*?<path d="([^"]+)"/.exec(markup)!;
      return { glyph: pin[1], path: pin[2] };
    });
    expect(glyphs.map((entry) => entry.glyph)).toEqual(["water", "food", "firstAid", "timing", "direction", "none"]);
    expect(new Set(glyphs.map((entry) => entry.path)).size).toBe(6);
  });

  it("says «Alt» at the axis, «km» once after the last kilometre, and the altitudes and kilometres as the axes", () => {
    const [narrow] = html.split("</svg>");
    expect(narrow).toContain(">Alt</text>");
    expect(narrow.match(/>km<\/text>/g)).toHaveLength(1);
    for (const km of ["0", "1", "5", "9"]) expect(narrow).toContain(`>${km}</text>`);
    expect(narrow).toMatch(/>(600|700|800)<\/text>/);
  });

  it("lists the pins for a screen reader, outside the picture, with the kilometre in the page's language", () => {
    const list = /<ul[^>]*data-testid="elevation-points"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(list).toContain('aria-label="Punctele de pe profil"');
    expect(list).toContain("Punct izvor, la 3,8 km");
    expect(list).toContain("Punct cabana, la 4,5 km");
    // The start, the three ticked points by distance, the finish.
    expect([...list.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1])).toEqual([
      "Start, la 0 km",
      "Punct izvor, la 3,8 km",
      "Punct cabana, la 4,5 km",
      "Punct sosire, la 6,2 km",
      "Sosire, la 9 km",
    ]);
    expect(html.indexOf("</svg>")).toBeLessThan(html.indexOf('data-testid="elevation-points"'));
  });

  it("keeps every word and every pin inside the viewBox", () => {
    for (const chart of chartsIn(html)) {
      const part = html.slice(html.indexOf(chart.tag), html.indexOf("</svg>", html.indexOf(chart.tag)));
      for (const match of part.matchAll(/<text x="(-?[\d.]+)"/g)) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(0);
        expect(Number(match[1])).toBeLessThanOrEqual(chart.width);
      }
      for (const match of part.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g)) {
        const [cx, cy, r] = [Number(match[1]), Number(match[2]), Number(match[3])];
        expect(cx - r).toBeGreaterThanOrEqual(0);
        expect(cx + r).toBeLessThanOrEqual(chart.width);
        expect(cy - r).toBeGreaterThanOrEqual(-0.01);
        expect(cy + r).toBeLessThanOrEqual(chart.height);
      }
    }
  });

  it("colours the area and the line from the theme's variables, never a literal", () => {
    expect(html).toContain("var(--mui-palette-primary-main)");
    expect(html).toContain("var(--mui-palette-secondary-main)");
    // The SVG's own markup: the Emotion stylesheet of the wrapper is the theme's, not ours.
    const drawn = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    expect(drawn).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(drawn).not.toMatch(/rgba?\(/);
  });

  it("says it in English on the English page, with the English words and a point's English name", () => {
    const english = render("page", "en");
    expect(english).toContain('aria-label="Route profile: 9.0 km, from');
    expect(english).toContain("<title>Point izvor</title>");
    expect(english).toContain(">Alt</text>");
    expect(english).toContain("Point izvor, at 3.8 km");
  });

  it("draws no pin when no checkpoint is ticked — the list has only the start and the finish — and still draws the profile", () => {
    const none = render("page", "ro", []);
    expect(none).not.toContain("elevation-pin");
    expect(none.match(/<li>/g)).toHaveLength(2);
    expect(none).toContain("<path");
    expect(chartsIn(none)).toHaveLength(2);
  });

  it("spans the typed distance: the kilometre axis runs to it, and the label says it", () => {
    const typed = render("page", "ro", [], 10_000);
    expect(typed).toContain("Profilul traseului: 10,0 km, de la");
    expect(typed).toContain(">10</text>");
  });

  it("wraps the page's chart in the pointer island and nothing else", () => {
    expect(html).toContain('data-testid="elevation-pointer"');
    expect(html).toContain('data-variant="page"');
    expect(html).toContain('data-pins="3"');
  });
});

describe("§NNN the elevation profile widget: the editor's preview", () => {
  const html = render("compact");

  it("draws one small chart, no pointer island, no «Alt» caption, at most two altitude labels", () => {
    const charts = chartsIn(html);
    expect(charts).toHaveLength(1);
    expect(charts[0]).toMatchObject({ size: "compact", width: 300, height: 160 });
    expect(html).toContain('data-variant="compact"');
    expect(html).not.toContain("elevation-pointer");
    expect(html).not.toContain(">Alt</text>");
    expect(html.match(/>(5|6|7|8|9)\d\d<\/text>/g)?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("keeps its labels at 11 px or more in the editor's card on a 320 px phone", () => {
    const [chart] = chartsIn(html);
    // The width the chart really has there: the editor's page gutters and the nested cards leave it about 204 px (measured in the
    // editor's own e2e at 320 px, which holds this figure to the browser's).
    expect((chart.fontSize * 204) / chart.width).toBeGreaterThanOrEqual(11);
    // And it is never drawn larger than it was made: the figure's width stops at the box's.
    expect(html).toContain("max-width:300px");
  });

  it("pins the same checkpoints as the page", () => {
    expect([...html.matchAll(/data-glyph="(\w+)"/g)].map((match) => match[1])).toEqual(["water", "food", "water"]);
  });
});

/** Every <text> of one chart, with the box its words fill: the estimate the core itself uses (0.6 em a character), in the viewBox's units. */
function textsOf(html: string, chart: ReturnType<typeof chartsIn>[number]) {
  const start = html.indexOf(chart.tag);
  const part = html.slice(start, html.indexOf("</svg>", start));
  return [...part.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)" text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map((match) => {
    const [x, y, anchor, text] = [Number(match[1]), Number(match[2]), match[3], match[4]];
    const width = text.length * chart.fontSize * 0.6;
    const left = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
    return { text, anchor, left, right: left + width, top: y - chart.fontSize * 0.72, bottom: y + chart.fontSize * 0.2 };
  });
}

describe("§NNN the altitude axis's room and the «Alt» caption", () => {
  // A route from 800 to 990 m: its top round tick, «1000», is one digit longer than the highest altitude, and sits close to the top of the plot.
  const tall = parseGpxElevation(elevationGpx({ low: 800, high: 990 }))!;
  const renderTall = (variant: "page" | "compact", markers: readonly ElevationProfileMarker[]) =>
    renderToStaticMarkup(createElement(ElevationProfile, { variant, profile: tall, distanceMeters: null, markers, locale: "ro", words: wordsOf("ro") }));
  const cases = [
    ["with pins", profileMarkers(CHECKPOINTS, "ro")],
    ["without pins", []],
  ] as const;

  for (const [name, markers] of cases) {
    it(`keeps every word inside the box when the top tick is «1000», on the narrow, the wide and the compact chart, ${name}`, () => {
      for (const variant of ["page", "compact"] as const) {
        const html = renderTall(variant, markers);
        for (const chart of chartsIn(html)) {
          const texts = textsOf(html, chart);
          expect(texts.map((entry) => entry.text)).toContain("1000");
          for (const entry of texts) {
            expect(entry.left, `${chart.size} «${entry.text}» leaves at the left`).toBeGreaterThanOrEqual(0);
            expect(entry.right, `${chart.size} «${entry.text}» leaves at the right`).toBeLessThanOrEqual(chart.width + 0.5);
          }
        }
      }
    });
  }

  it("keeps the «Alt» caption clear of every other word, on a chart with no pins whose top tick is near the top", () => {
    const html = renderTall("page", []);
    const charts = chartsIn(html);
    expect(charts.length).toBe(2);
    for (const chart of charts) {
      const texts = textsOf(html, chart);
      const caption = texts.find((entry) => entry.text === "Alt")!;
      expect(caption).toBeDefined();
      for (const other of texts.filter((entry) => entry !== caption)) {
        const apart = other.right <= caption.left || other.left >= caption.right || other.bottom <= caption.top || other.top >= caption.bottom;
        expect(apart, `${chart.size}: «Alt» and «${other.text}» overlap`).toBe(true);
      }
    }
  });

  it("holds for the owner's own route too: 608 to 828 m, with and without pins, nothing touches the caption", () => {
    for (const markers of [profileMarkers(CHECKPOINTS, "ro"), []]) {
      const html = render("page", "ro", markers);
      for (const chart of chartsIn(html)) {
        const texts = textsOf(html, chart);
        const caption = texts.find((entry) => entry.text === "Alt")!;
        for (const other of texts.filter((entry) => entry !== caption)) {
          expect(other.right <= caption.left || other.left >= caption.right || other.bottom <= caption.top || other.top >= caption.bottom).toBe(true);
        }
      }
    }
  });
});

describe("§NNN the checkpoints the profile pins", () => {
  it("leaves out the unticked ones, keeps the order by distance and names each in the page's language", () => {
    const rows = [point("b", 9, ["FOOD"]), point("a", 2, ["WATER"]), point("c", 5, [], { onProfile: false })];
    expect(profileMarkers(rows, "ro")).toEqual([
      { km: 2, kinds: ["WATER"], name: "Punct a" },
      { km: 9, kinds: ["FOOD"], name: "Punct b" },
    ]);
    expect(profileMarkers(rows, "en").map((marker) => marker.name)).toEqual(["Point a", "Point b"]);
  });

  it("counts a row without the flag — an old copy in the public cache — as ticked, as the column's default does", () => {
    const old = { km: 3, kinds: ["WATER"] as const, nameRo: "Vechi", nameEn: "Old" };
    expect(profileMarkers([old], "ro")).toHaveLength(1);
  });
});
