import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CalendarImageData } from "@/modules/events/domain/calendar-image";
import { CALENDAR_IMAGE_RATIOS, type CalendarImageRatio } from "@/modules/events/ui/calendar-image-canvas";
import { CALENDAR_IMAGE_LAYOUT_CHOICES, CALENDAR_IMAGE_THEME_CHOICES, type CalendarImageAssets, type CalendarImageFonts, type CalendarImageOptions, drawCalendarImage } from "@/modules/events/ui/calendar-image-draw";
import { drawFrame } from "@/modules/events/ui/calendar-image-frame";
import { weekLabel, weeksOf } from "@/modules/events/ui/calendar-image-week";
import { CALENDAR_IMAGE_THEMES } from "@/theme/brand";
import { type Extent, overflowsOf, stubCanvas, type TextRecord } from "./calendar-image-stub-canvas";

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

describe("«Seriile în cap»: the floor a phone's feed still reads (the owner's audit, D17/D31)", () => {
  // A feed shows the picture about 400 px wide, so 14 px at 1080 is 5 px there. On a 1080-wide picture no word
  // of the layout under 17 px — an hour, a detail or a rhythm (an hour's digits, «Anulat», «ora se anunță»,
  // or the Medium face) under 16 — and no day's number under 18; on 16:9 nothing under 21. The band and the
  // foot are the frame's, and left out.
  const details = { place: true, distance: true, elevation: true };
  for (const month of months) {
    for (const ratio of ratios) {
      it(`${month.name} · ${ratio}`, () => {
        const options: CalendarImageOptions = { theme: "poster", ratio, layout: "heads", week: null, legend: true, details };
        const body = drawFrame(stubCanvas().ctx, month.data, options, fonts, { logo: null }, CALENDAR_IMAGE_THEMES.poster);
        if (!body) return;
        const { ctx, records } = stubCanvas();
        drawCalendarImage(ctx, month.data, options, fonts, { logo: null });
        const { words } = month.data;
        const hourish = (text: string, font: string) => /^500 /.test(font) || /\d{1,2}:\d{2}/.test(text) || text === words.cancelled.toLocaleUpperCase("ro-RO") || text === words.tba;
        const floorOf = (text: string, font: string) => (ratio === "landscape" ? 21 : /^\d{1,2}$/.test(text) ? 18 : hourish(text, font) ? 16 : 17);
        const inside = records.texts.filter((text) => text.top >= body.y && text.bottom <= body.y + body.h);
        // The weekdays' seven heads at least: the check has words to look at.
        expect(inside.length).toBeGreaterThanOrEqual(7);
        const small = inside.filter((text) => text.size < floorOf(text.text, text.font));
        expect(small.map((text) => `«${text.text}» at ${text.size} px`)).toEqual([]);
      });
    }
  }
});

describe("«Legenda în celule»: the readable floor (the audit's D17, D31)", () => {
  // A feed shows the picture about 400 px wide: on a 1080-wide picture no title, key line or chip under 17 px,
  // no hour or detail line under 16, no day number under 18; on 16:9, nothing under 21. The frame's band and
  // foot are the frame's own; what the layout draws between them is checked.
  for (const month of months) {
    for (const ratio of ratios) {
      it(`${month.name} · ${ratio}`, () => {
        const options: CalendarImageOptions = { theme: "poster", ratio, layout: "cells", week: null, legend: true, details: { place: true, distance: true, elevation: true } };
        const body = drawFrame(stubCanvas().ctx, month.data, options, fonts, { logo: null }, CALENDAR_IMAGE_THEMES.poster);
        if (!body) return;
        const { ctx, records } = stubCanvas();
        drawCalendarImage(ctx, month.data, options, fonts, { logo: null });
        const { width, height } = CALENDAR_IMAGE_RATIOS[ratio];
        // Told apart by their words, not their weight: the layout sets every title, label, key name and chip's
        // hour in capitals and figures; a day's number (in its cell or the key's badge) is one or two figures; an
        // hour or a detail line («ora 09:00», «Tâmpa · 6 km», «Anulat», a rhythm) always has a small letter.
        const floorOf = (text: (typeof records.texts)[number]) => {
          if (width > height) return 21;
          if (/^\d{1,2}$/.test(text.text)) return 18;
          return /\p{Ll}/u.test(text.text) ? 16 : 17;
        };
        const small = records.texts
          .filter((text) => text.top >= body.y - 0.5 && text.bottom <= body.y + body.h + 0.5)
          .filter((text) => text.size < floorOf(text) - 0.01)
          .map((text) => `«${text.text}» ${text.size}px (floor ${floorOf(text)})`);
        expect(small, small.join("\n  ")).toEqual([]);
      });
    }
  }
});

describe("«Legenda dedesubt»: no word under the readable floor, and the race always on the picture (the owner's audit, D17 and D31)", () => {
  // A feed shows the picture about 400 pixels wide: on a 1080-wide one a title, a chip or a key line is 17
  // pixels at the least, an hour or a detail line 16, a day's number 18; on 16:9 nothing is under 21. The
  // frame's words are the frame's, drawn first: counted on a stub of their own and left out. With the
  // «Legendă» unticked nothing else names a date, so a month's race is never hidden behind «+N altele»: its
  // hour (its chip, or the line under its title) is on the picture, every date of its own is named by its
  // title, and a day counts in «+N» only its weekly dates, folded to give a special its lines.
  const all = { place: true, distance: true, elevation: true };
  const none = { place: false, distance: false, elevation: false };
  for (const month of months) {
    for (const ratio of ratios) {
      for (const [legend, details] of [
        [true, all],
        [false, all],
        [true, none],
        [false, none],
      ] as const) {
        it(`${month.name} · ${ratio} · ${legend ? "with" : "without"} the legend · ${details === all ? "every" : "no"} detail`, () => {
          const options: CalendarImageOptions = { theme: "poster", ratio, layout: "formats", week: null, legend, details };
          const frame = stubCanvas();
          drawFrame(frame.ctx, month.data, options, fonts, { logo: null }, CALENDAR_IMAGE_THEMES.poster);
          const { ctx, records } = stubCanvas();
          drawCalendarImage(ctx, month.data, options, fonts, { logo: null });
          // A bold word where an hour goes — «Anulat» on a cancelled date's line — is an hour line too.
          const hourWords = [month.data.words.cancelled, month.data.words.tba];
          const floorOf = (text: TextRecord) => {
            if (ratio === "landscape") return 21;
            const weight = Number(/^(\d00) /.exec(text.font)?.[1] ?? 400);
            if (/^\d{1,2}$/.test(text.text) && weight >= 800) return 18;
            return weight >= 700 && !hourWords.includes(text.text) ? 17 : 16;
          };
          const texts = records.texts.slice(frame.records.texts.length);
          const under = texts.filter((text) => text.size < floorOf(text) - 0.05);
          expect(under.map((text) => `«${text.text}» at ${Math.round(text.size * 10) / 10}px, under ${floorOf(text)}`)).toEqual([]);
          if (!legend) {
            // Nothing else names a date of its own: its title stands in its own day — its lines from the first,
            // read in order, the whole title or up to one ending in «…» — each line read for one date alone, so
            // a weekly title's «BRAȘOV» elsewhere names no special. A weekly date's title, or its chip, gives way
            // first (the owner's hierarchy).
            const letters = (text: string) => text.toLocaleUpperCase("ro-RO").replace(/[^\p{L}\p{N}]/gu, "");
            const inside = (box: Extent, text: Extent) => box.left <= text.left + 0.5 && box.right >= text.right - 0.5 && box.top <= text.top + 0.5 && box.bottom >= text.bottom - 0.5;
            const read = new Set<TextRecord>();
            const unnamed = month.data.specials.filter((special) => {
              // The day: the tint its number stands on, the smallest box filled under it.
              const number = texts.find((text) => text.text === String(special.day) && /^800 /.test(text.font));
              const area = (box: Extent) => (box.right - box.left) * (box.bottom - box.top);
              const cell = number && records.boxes.filter((box) => box.how === "fillRect" && box.order < number.order && inside(box, number)).sort((one, other) => area(one) - area(other))[0];
              if (!cell) return true;
              const lines = texts.filter((text) => text.order > cell.order && inside(cell, text) && !read.has(text));
              const title = letters(special.title);
              for (let start = 0; start < lines.length; start += 1) {
                let words = "";
                for (let end = start; end < lines.length; end += 1) {
                  words += letters(lines[end].text);
                  if (words === "" || !title.startsWith(words)) break;
                  if (words === title || lines[end].text.endsWith("…")) {
                    for (const used of lines.slice(start, end + 1)) read.add(used);
                    return false;
                  }
                }
              }
              return true;
            });
            expect(unnamed.map((special) => `the ${special.day}: «${special.title}» is not named in its day`)).toEqual([]);
          }
          const counted = new RegExp(`^${month.data.words.more.replace(/[+]/g, "\\+").replace("{count}", "(\\d+)")}$`);
          const folded = texts.reduce((total, text) => total + Number(counted.exec(text.text)?.[1] ?? 0), 0);
          if (!legend) expect(folded, "«+N» counts weekly dates alone").toBeLessThanOrEqual(month.data.entries.length - month.data.specials.length);
          const races = month.data.entries.filter((entry) => entry.type === "RACE" && entry.time);
          if (races.length === 0) return;
          if (legend) expect(texts.filter((text) => counted.test(text.text)).map((text) => text.text)).toEqual([]);
          for (const race of races) expect(texts.some((text) => text.text.includes(race.time ?? "")), `${race.title}'s hour is on the picture`).toBe(true);
        });
      }
    }
  }
});

for (const month of months) {
  describe(`${month.name}: ${month.data.words.monthTitle}`, () => {
    /**
     * The month in each layout, and each of its weeks: the layout's name, or the week's days — and «Legenda
     * dedesubt» with the «Legendă» unticked and with no detail, which compose its weeks otherwise.
     */
    const all = { place: true, distance: true, elevation: true };
    const pictures: { name: string; options: Omit<CalendarImageOptions, "theme" | "ratio"> }[] = [
      ...CALENDAR_IMAGE_LAYOUT_CHOICES.map((layout) => ({ name: layout, options: { layout, week: null, legend: true, details: all } })),
      { name: "formats without the legend", options: { layout: "formats", week: null, legend: false, details: all } },
      { name: "formats without the details", options: { layout: "formats", week: null, legend: true, details: { place: false, distance: false, elevation: false } } },
      ...weeksOf(month.data.month).map((week) => ({ name: weekLabel(week, month.data.words.monthName), options: { layout: "heads" as const, week: week.index, legend: true, details: all } })),
    ];
    for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
      for (const picture of pictures) {
        for (const ratio of ratios) {
          it(`${theme} · ${picture.name} · ${ratio}: no text leaves its box or meets another`, () => {
            const { width, height } = CALENDAR_IMAGE_RATIOS[ratio];
            const failures = assets.flatMap(([state, asset]) => {
              const { ctx, records } = stubCanvas();
              drawCalendarImage(ctx, month.data, { theme, ratio, ...picture.options }, fonts, asset);
              // The week's floor: nothing under 17 px on a 1080-wide picture, and no title — Bold, the weight
              // the week gives its titles alone — under 18.
              const small = picture.options.week === null ? [] : records.texts.filter((text) => text.size < 17 || (/^700 /.test(text.font) && text.size < 18));
              return [...overflowsOf(records, width, height).map((failure) => `${state}: ${failure}`), ...small.map((text) => `${state}: «${text.text}» is set at ${text.size} px (${text.font}), under the week's floor`)];
            });
            expect(failures.length, [`${month.name} · ${theme} · ${picture.name} · ${ratio}: ${failures.length} overflow(s)`, ...failures].join("\n  ")).toBe(0);
          });
        }
      }
    }
  });
}
