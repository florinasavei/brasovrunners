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
 * §802 — the elevation profile widget (`routes/elevation/ElevationProfile.tsx`) as the event page and the editor's preview
 * draw it: its three sizes spanning the section's width, the words, the pins of the checkpoints the club left ticked and the
 * glyph of each kind (food before water), the dotted line at each one's kilometre, and nothing outside its box.
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

describe("§802 the elevation profile widget: the page", () => {
  const html = render("page");

  it("draws a narrow chart, a wide one and a full one, the right one shown by CSS alone, all role=img with the same label", () => {
    const charts = chartsIn(html);
    expect(charts.map((chart) => chart.size)).toEqual(["narrow", "wide", "full"]);
    expect(charts.map((chart) => `${chart.width}x${chart.height}`)).toEqual(["360x240", "1000x280", "1600x320"]);
    for (const chart of charts) expect(chart.tag).toContain('role="img"');
    const label = /role="img" aria-label="([^"]+)"/.exec(html)![1];
    expect(label).toMatch(/^Profilul traseului: 9,0 km, de la 6\d\d la 8\d\d m$/);
    expect(html.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(3);
    expect(html).toContain("min-width:700px");
  });

  it("spans the section's whole width: no 1000 px cap on the wide chart, none on the full one, the phone's 480 px cap kept", () => {
    const rules = [...html.matchAll(/<style[^>]*>([^<]*)<\/style>/g)].map((match) => match[1]);
    const ruleOf = (size: string) => {
      const class_ = new RegExp(`class="[^"]*?(css-\\w+)"[^>]*data-size="${size}"`).exec(html);
      const name = class_?.[1];
      return rules.find((rule) => rule.startsWith(`.${name}{`)) ?? "";
    };
    expect(ruleOf("narrow")).toContain("max-width:480px");
    for (const size of ["wide", "full"]) {
      expect(ruleOf(size), size).toContain("width:100%");
      expect(ruleOf(size), size).not.toMatch(/[;{]max-width:\d/);
    }
    expect(html).not.toContain("max-width:1000px");
    // One chart at a time: the wide from 700 px up to the full one's 1100 px, the full beyond, the narrow below 700 px.
    expect(ruleOf("narrow")).toContain("@media (min-width:700px){");
    expect(ruleOf("wide")).toContain("@media (min-width:700px) and (not (min-width:1100px))");
    expect(ruleOf("full")).toContain("@media (min-width:1100px)");
  });

  it("keeps its labels at 11 px or more on a 320 px phone and from 700 px of screen up, and between 12 and 24 px on a desktop", () => {
    const [narrow, wide, full] = chartsIn(html);
    // The page's inner width at 320 px: the 16 px gutters take 32. The wide chart is shown from 700 px, gutters (24 px a side from 600 px) likewise.
    expect((narrow.fontSize * (320 - 32)) / narrow.width).toBeGreaterThanOrEqual(11);
    expect((wide.fontSize * (700 - 48)) / wide.width).toBeGreaterThanOrEqual(11);
    expect((wide.fontSize * (1099 - 48)) / wide.width).toBeLessThanOrEqual(24);
    expect((full.fontSize * (1100 - 48)) / full.width).toBeGreaterThanOrEqual(11);
    // 1280 and 1920 px of screen, and the container's cap (2040 px: the theme's `xl`).
    expect((full.fontSize * (1280 - 48)) / full.width).toBeCloseTo(14.6, 1);
    expect((full.fontSize * (1920 - 48)) / full.width).toBeCloseTo(22.2, 1);
    expect((full.fontSize * (2040 - 48)) / full.width).toBeLessThanOrEqual(24);
  });

  it("pins only the checkpoints it is handed — the unticked one is not on the chart — one pin per chart and a glyph per kind", () => {
    const pins = [...html.matchAll(/<g data-testid="elevation-pin" data-glyph="(\w+)">/g)].map((match) => match[1]);
    // Three ticked points in each of the three charts; the point with water and food pins the fork, food being the more valuable (the owner, 2026-10-17).
    expect(pins).toEqual(["water", "food", "food", "water", "food", "food", "water", "food", "food"]);
    expect(html).toContain("<title>Punct izvor</title>");
    expect(html).toContain("<title>Punct sosire</title>");
    expect(html).not.toContain("Punct ascuns");
  });

  it("draws the glyph of each kind as a path of its own", () => {
    const glyphs = ["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION", "REGROUP", "none"].map((kind) => {
      const markup = render("compact", "ro", [{ km: 4, kinds: kind === "none" ? [] : [kind], name: "x" }]);
      const pin = /<g data-testid="elevation-pin" data-glyph="(\w+)">[\s\S]*?<path d="([^"]+)"/.exec(markup)!;
      return { glyph: pin[1], path: pin[2] };
    });
    expect(glyphs.map((entry) => entry.glyph)).toEqual(["water", "food", "firstAid", "timing", "direction", "regroup", "none"]);
    expect(new Set(glyphs.map((entry) => entry.path)).size).toBe(7);
  });

  it("draws one dotted line per checkpoint from the pin down to the axis at the point's exact kilometre, under the curve, on the narrow, the wide and the full chart", () => {
    for (const chart of chartsIn(html)) {
      const start = html.indexOf(chart.tag);
      const part = html.slice(start, html.indexOf("</svg>", start));
      const guides = [...part.matchAll(/<line data-testid="elevation-guide" x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)" stroke-width="1" stroke-dasharray="([^"]+)" vector-effect="non-scaling-stroke" style="([^"]+)"/g)];
      expect(guides, chart.size).toHaveLength(3);
      const pins = [...part.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3.2"/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
      const heads = [...part.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="(?!3\.2")([\d.]+)"/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), r: Number(match[3]) }));
      const axis = /<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="\1" style="stroke:var\(--mui-palette-text-secondary\)" stroke-width="1"\/>/.exec(part);
      expect(pins).toHaveLength(3);
      guides.forEach((guide, index) => {
        const [x1, x2, y1, y2] = guide.slice(1, 5).map(Number);
        // Vertical, at the point's x on the curve and the pin's own x.
        expect(x1).toBe(x2);
        expect(x1).toBeCloseTo(pins[index].x, 1);
        expect(x1).toBeCloseTo(heads[index].x, 1);
        // From the pin head's base down to the plot's foot — below the curve's point, which it passes through.
        expect(y1).toBeCloseTo(heads[index].y + heads[index].r, 1);
        expect(y2).toBeGreaterThan(pins[index].y);
        expect(y2).toBeGreaterThan(y1);
        if (axis) expect(y2).toBe(Number(axis[1]));
        // Dots, one pixel thin, in the pin's muted colour: the theme's, never a literal.
        expect(guide[5]).toBe("2 3");
        expect(guide[6]).toContain("var(--mui-palette-text-secondary)");
      });
      // Under the curve's tint and line, so they stay readable; the pin and the dot stay above.
      const lastGuide = part.lastIndexOf('data-testid="elevation-guide"');
      expect(lastGuide).toBeLessThan(part.indexOf('fill-opacity:0.16'));
      expect(part.indexOf('data-testid="elevation-pin"')).toBeGreaterThan(part.indexOf('fill-opacity:0.16'));
      // The pin no longer has its own short stem: the dotted line is it.
      expect(part).not.toMatch(/<g data-testid="elevation-pin"[^>]*>(?:<title>[^<]*<\/title>)?<line/);
    }
  });

  it("draws one dotted line where two pins stand at the same kilometre, and none without a pin", () => {
    const same = render("page", "ro", [
      { km: 4, kinds: ["WATER"], name: "a" },
      { km: 4, kinds: ["FOOD"], name: "b" },
    ]);
    expect(same.match(/data-testid="elevation-guide"/g)).toHaveLength(3);
    expect(same.match(/data-testid="elevation-pin"/g)).toHaveLength(6);
    expect(render("page", "ro", [])).not.toContain("elevation-guide");
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
    expect(chartsIn(none)).toHaveLength(3);
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

describe("§802 the elevation profile widget: the editor's preview", () => {
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

  it("pins the same checkpoints as the page, the fork over the drop for water and food", () => {
    expect([...html.matchAll(/data-glyph="(\w+)"/g)].map((match) => match[1])).toEqual(["water", "food", "food"]);
  });

  it("has no dotted line (its pins keep their short stem down to the curve)", () => {
    expect(html).not.toContain("elevation-guide");
    expect(html).not.toContain("stroke-dasharray");
    expect(html.match(/<g data-testid="elevation-pin"[^>]*>(?:<title>[^<]*<\/title>)?<line /g)).toHaveLength(3);
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

describe("§802 the altitude axis's room and the «Alt» caption", () => {
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
    expect(charts.length).toBe(3);
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

describe("§802 the checkpoints the profile pins", () => {
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
