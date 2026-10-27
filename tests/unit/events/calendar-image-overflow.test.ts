import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CalendarImageData } from "@/modules/events/domain/calendar-image";
import { CALENDAR_IMAGE_RATIOS, type CalendarImageRatio } from "@/modules/events/ui/calendar-image-canvas";
import { CALENDAR_IMAGE_LAYOUT_CHOICES, CALENDAR_IMAGE_THEME_CHOICES, type CalendarImageAssets, type CalendarImageFonts, type CalendarImageOptions, drawCalendarImage } from "@/modules/events/ui/calendar-image-draw";
import { weekLabel, weeksOf } from "@/modules/events/ui/calendar-image-week";
import { overflowsOf, stubCanvas } from "./calendar-image-stub-canvas";

/**
 * «Salvează ca imagine» (§855): no text overflows its box or meets another, in every sample month of
 * `yarn calendar:preview`, every theme, every layout of «Afiș» and every format — and every week of each
 * month («Perioada» → «Săptămâna») in every theme and format — drawn on the stub canvas of
 * `calendar-image-stub-canvas.ts`, whose `measureText` the layouts fit their words with, so what it records
 * is what they meant to draw. A failure names the picture, the text, where it stands and what it crosses; a
 * text drawn then covered is still a defect, and the mountains and the glyphs are shapes, not text.
 */

const samples = fileURLToPath(new URL("../../../scripts/calendar-image-preview/", import.meta.url));
const months = readdirSync(samples)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({ name: file.replace(/\.json$/, ""), data: JSON.parse(readFileSync(`${samples}${file}`, "utf8")) as CalendarImageData }));
const ratios = Object.keys(CALENDAR_IMAGE_RATIOS) as CalendarImageRatio[];
const fonts: CalendarImageFonts = { body: "Roboto, sans-serif", display: "Facon, sans-serif", script: "Caveat, cursive", poster: "'Poppins', Roboto, sans-serif" };
/** The band draws the club's logo when it has loaded, else the mountains over the spaced name: both are checked. */
const assets: [string, CalendarImageAssets][] = [
  ["with the logo", { logo: {} as CanvasImageSource }],
  ["without the logo", { logo: null }],
];

describe("the stub canvas", () => {
  it("records a text by its alignment, and a word drawn letter by letter as one text", () => {
    const { ctx, records } = stubCanvas();
    ctx.font = "400 20px Poppins";
    ctx.textAlign = "center";
    ctx.fillText("AB", 100, 50);
    ctx.textAlign = "left";
    for (const [index, letter] of [..."RUN"].entries()) ctx.fillText(letter, 200 + index * 20, 50);
    const round = (value: number) => Math.round(value * 10) / 10;
    expect(records.texts.map((text) => [text.text, round(text.left), round(text.right), round(text.top), round(text.bottom)])).toEqual([
      ["AB", 86.4, 113.6, 35.6, 50.8],
      ["RUN", 200, 253.6, 35.6, 50.8],
    ]);
  });

  it("tells a text across a box's edge or a stroked line, two texts that meet, and one covered after it was drawn", () => {
    const { ctx, records } = stubCanvas();
    ctx.font = "400 20px Poppins";
    ctx.beginPath();
    ctx.roundRect(0, 0, 100, 100, 8);
    ctx.fill();
    ctx.fillText("inside", 10, 50);
    ctx.fillText("over the edge", 60, 80);
    ctx.fillText("meets", 10, 52);
    ctx.beginPath();
    ctx.moveTo(10, 200);
    ctx.lineTo(300, 200);
    ctx.stroke();
    ctx.fillText("on the line", 20, 205);
    ctx.fillText("under", 20, 400);
    ctx.fillRect(0, 380, 200, 40);
    const failures = overflowsOf(records, 1080, 1080);
    expect(failures.map((line) => line.replace(/ \([^)]*\)/g, ""))).toEqual([
      "«inside» meets «meets»",
      "«over the edge» crosses the right edge of the roundRect",
      "«on the line» crosses the line y 200 · x 10–300",
      "«under» is covered by the fillRect filled after it",
    ]);
  });

  it("lets texts touch, and ignores the shapes it fills through a Path2D", () => {
    const { ctx, records } = stubCanvas();
    ctx.font = "400 20px Poppins";
    ctx.fillText("ab", 0, 20);
    ctx.fillText("cd", 20.8, 20);
    ctx.fill(new Path2D("M0 0h10v10z"));
    expect(records.texts.map((text) => text.text)).toEqual(["ab", "cd"]);
    expect(records.boxes).toEqual([]);
    expect(overflowsOf(records, 100, 100)).toEqual([]);
  });
});

describe("a week on 16:9", () => {
  it("gives each column the size its own dates allow: a 17-letter word on Saturday leaves Tuesday's title large", () => {
    // The fortnight's second week: «Intervale pe pistă» twice, and on Saturday the 69-character title whose
    // «ultramaratoniștii» no 249 px card holds whole above the floor. One size for the week put every card at 18.
    const fortnight = months.find((month) => month.name === "fortnight");
    if (!fortnight) throw new Error("fortnight.json is missing");
    const { ctx, records } = stubCanvas();
    drawCalendarImage(ctx, fortnight.data, { theme: "poster", ratio: "landscape", layout: "heads", week: 1, legend: true, details: { place: true, distance: true, elevation: true } }, fonts, { logo: null });
    // The stub wraps «INTERVALE / PE PISTĂ»: the first line of each of the two cards, and the long word's first piece.
    const sizeOf = (text: string) => records.texts.filter((record) => record.text.startsWith(text)).map((record) => record.size);
    const intervals = sizeOf("INTERVALE");
    const ultra = records.texts.filter((record) => record.text.startsWith("ULTRAMARA"));
    expect(intervals).toHaveLength(2);
    expect(ultra).toHaveLength(1);
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(26);
    // The long word is split with «-» rather than shrinking its own column to the floor.
    expect(ultra[0].text.endsWith("-")).toBe(true);
    expect(ultra[0].size).toBeGreaterThan(18);
    expect(ultra[0].size).toBeLessThan(Math.min(...intervals));
  });
});

for (const month of months) {
  describe(`${month.name}: ${month.data.words.monthTitle}`, () => {
    /** The month in each layout, and each of its weeks: the layout's name, or the week's days. */
    const pictures: { name: string; options: Omit<CalendarImageOptions, "theme" | "ratio" | "details"> }[] = [
      ...CALENDAR_IMAGE_LAYOUT_CHOICES.map((layout) => ({ name: layout, options: { layout, week: null, legend: true } })),
      ...weeksOf(month.data.month).map((week) => ({ name: weekLabel(week, month.data.words.monthName), options: { layout: "heads" as const, week: week.index, legend: true } })),
    ];
    for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
      for (const picture of pictures) {
        for (const ratio of ratios) {
          it(`${theme} · ${picture.name} · ${ratio}: no text leaves its box or meets another`, () => {
            const { width, height } = CALENDAR_IMAGE_RATIOS[ratio];
            const failures = assets.flatMap(([state, asset]) => {
              const { ctx, records } = stubCanvas();
              drawCalendarImage(ctx, month.data, { theme, ratio, ...picture.options, details: { place: true, distance: true, elevation: true } }, fonts, asset);
              return overflowsOf(records, width, height).map((failure) => `${state}: ${failure}`);
            });
            expect(failures.length, [`${month.name} · ${theme} · ${picture.name} · ${ratio}: ${failures.length} overflow(s)`, ...failures].join("\n  ")).toBe(0);
          });
        }
      }
    }
  });
}
