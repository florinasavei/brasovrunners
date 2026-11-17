import PDFDocument from "pdfkit";
import type { ReactElement } from "react";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: vi.fn() }), isStorageConfigured: () => true }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
// The one function, spied: the real one still answers, and the test reads the question each renderer asked it.
const spied = vi.hoisted(() => ({ altitudeInk: vi.fn() }));
vi.mock("@/modules/registrations/bib-profile-strip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/registrations/bib-profile-strip")>();
  spied.altitudeInk.mockImplementation(actual.bibAltitudeInk);
  return { ...actual, bibAltitudeInk: spied.altitudeInk };
});

import {
  BIB_BAND_FALLBACK,
  BIB_MEMBER_CARD,
  type BibDesign,
  type BibMemberCardBackground,
  bibMemberCardColourReadable,
  DEFAULT_BIB_DESIGN,
  DEFAULT_BIB_MEMBER_DESIGN,
} from "@/modules/registrations/bib-design";
import { BIB_IMAGE_SCALE, BIB_LAYOUT, BIB_MARGIN } from "@/modules/registrations/bib-geometry";
import { bibExtrasBlock, renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing } from "@/modules/registrations/bib-profile";
import { bibProfileRow } from "@/modules/registrations/bib-profile-row";
import { type BibAltitudeInk, bibAltitudeInk } from "@/modules/registrations/bib-profile-strip";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { parseGpxElevation } from "@/modules/routes/elevation/parse";
import { BIB_COLOURS, COLOR, contrastRatio, mix } from "@/theme/brand";

/**
 * §NNN, BR-REQ-038-01 — the owner, 2026-11-17, looking at the race's bib, its strip with «Start», «1», «2», «3», «km 4,5 · apă +
 * hrană», «6», «7 km», «Sosire» and the altitudes «622 m» and «815 m»: «pe viitor: aș vrea ca numerele de la elevație să fie un
 * pic colorate diferit, să nu se confunde cu markerii de distanță». The strip's highest and lowest altitude are drawn in the bib's
 * band colour — the ink at 60% where that colour reads too light on white; on a member's card the card's white, at 60% or stronger
 * where 60% would read under 3 : 1 on the card's own ground — and nothing else on the strip changes colour. One function decides it
 * (`bibAltitudeInk`); the sheet is read through what pdfkit is asked to fill, the picture through its markup and its pixels. The
 * track is made up, and so are the names.
 */

afterEach(() => vi.restoreAllMocks());

const design = (overrides: Partial<BibDesign> = {}): BibDesign => ({ ...DEFAULT_BIB_DESIGN, showProfile: true, ...overrides });
const members = (overrides: Partial<BibDesign["member"]>): Partial<BibDesign> => ({ member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, ...overrides } });

/** A made-up track: 41 points, 600 m up to 800 m and down to 700 m. */
function track(): string {
  const body = Array.from({ length: 41 }, (_, i) => {
    const ele = i <= 20 ? 600 + 10 * i : 800 - 5 * (i - 20);
    return `<trkpt lat="45.6000" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${body}</trkseg></trk></gpx>`;
}

const DRAWING: BibProfileDrawing = bibProfileDrawing(parseGpxElevation(track())!, {}, "ro", (key, values) =>
  ({ start: "Start", finish: "Sosire", kmUnit: "km", altitudeUnit: "m", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key],
);
const SHEET = { eventTitle: "Crosul de toamnă", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-10-10T12:00:00Z") };
const RUNNER = { bibNumber: 7, registeredName: "Alergător Unu" };

/** An event's own colour, the editor's green and red; the members' colour, its purple, teal or black; a yellow an event's file may carry. */
const GREEN = BIB_COLOURS.find((choice) => choice.key === "green")!.hex;
const RED = BIB_COLOURS.find((choice) => choice.key === "red")!.hex;
const PURPLE = BIB_COLOURS.find((choice) => choice.key === "purple")!.hex;
const TEAL = BIB_COLOURS.find((choice) => choice.key === "teal")!.hex;
const BLACK = BIB_COLOURS.find((choice) => choice.key === "black")!.hex;
const YELLOW = "#ffd400";
/** A member's card's words (§695): white on the card's own ground. */
const WHITE = BIB_MEMBER_CARD.text;

/** The strip's words for a design, as its row lays them out: the two altitudes, and every other word in drawing order. */
function stripWords(chosen: BibDesign) {
  const row = bibProfileRow(chosen, { profile: DRAWING, profileFigures: null }, false);
  if (row?.kind !== "gpx") throw new Error("no strip drawn");
  return { altitudes: row.strip.texts.filter((text) => text.altitude).map((text) => text.text), others: row.strip.texts.filter((text) => !text.altitude).map((text) => text.text) };
}

type Fill = { colour: unknown; opacity: number };
type FilledRun = { text: string } & Fill;

/** Every text the sheet draws, with the fill pdfkit holds as it draws it — the colour and the opacity, saved and restored as pdfkit does. */
async function filledRuns(input: Parameters<typeof renderBibSheet>[0]): Promise<FilledRun[]> {
  let fill: Fill = { colour: null, opacity: 1 };
  const saved: Fill[] = [];
  const runs: FilledRun[] = [];
  const prototype = PDFDocument.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const watch = (name: string, seen: (args: unknown[]) => void) => {
    const original = prototype[name];
    vi.spyOn(prototype, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      seen(args);
      return original.apply(this, args);
    });
  };
  watch("fillColor", ([colour, opacity]) => (fill = { colour, opacity: typeof opacity === "number" ? opacity : fill.opacity }));
  watch("fillOpacity", ([opacity]) => (fill = { ...fill, opacity: typeof opacity === "number" ? opacity : fill.opacity }));
  watch("save", () => saved.push(fill));
  watch("restore", () => (fill = saved.pop() ?? fill));
  watch("text", ([text]) => {
    if (typeof text === "string") runs.push({ text, ...fill });
  });
  try {
    await renderBibSheet(input);
  } finally {
    vi.restoreAllMocks();
  }
  return runs;
}

/** The strip's runs on the sheet, from «Start»: every word but the altitudes, then the altitudes, as they are drawn. */
function stripRuns(runs: FilledRun[], words: ReturnType<typeof stripWords>, from = 0): FilledRun[] {
  const start = runs.findIndex((run, index) => index >= from && run.text === "Start");
  const strip = runs.slice(start, start + words.others.length + words.altitudes.length);
  expect(strip.map((run) => run.text)).toEqual([...words.others, ...words.altitudes]);
  return strip;
}

const sheet = (chosen: BibDesign, more: Partial<Parameters<typeof renderBibSheet>[0]> = {}) => filledRuns({ rows: [RUNNER], ...SHEET, profile: DRAWING, design: chosen, ...more });

/** Whether `ink` laid at `opacity` on `ground` reads at the altitudes' bar — the two mixed channel by channel, as the renderers lay it. */
const readsOn = (ground: string, ink: string, opacity: number) => contrastRatio(mix(ground, ink, opacity), ground) >= BIB_LAYOUT.profileAltitudeContrast;
/** The altitudes of a member's card on its ground; the band is whatever the bib's band would be, and is not read. */
const onCard = (card: BibMemberCardBackground, band: string = PURPLE) => bibAltitudeInk({ band, ink: WHITE, card });

describe("§NNN one function: the band's colour where it reads on white, else the ink at 60%", () => {
  it("takes the band's colour at 3 : 1 or more against white — the club's own blue and every colour the editor offers", () => {
    for (const band of [BIB_BAND_FALLBACK, ...BIB_COLOURS.map((choice) => choice.hex)]) {
      expect(contrastRatio(band, COLOR.surface), band).toBeGreaterThanOrEqual(BIB_LAYOUT.profileAltitudeContrast);
      expect(bibAltitudeInk({ band, ink: COLOR.ink, card: null }), band).toEqual({ colour: band, opacity: 1 });
    }
  });

  it("takes the ink at 60% under 3 : 1, as WCAG computes it, and never throws on what is not a colour", () => {
    expect(BIB_LAYOUT.profileAltitudeContrast).toBe(3);
    expect(BIB_LAYOUT.profileAltitudeOpacity).toBe(0.6);
    const faded = { colour: COLOR.ink, opacity: 0.6 };
    expect(bibAltitudeInk({ band: YELLOW, ink: COLOR.ink, card: null })).toEqual(faded);
    // Either side of the line: #949494 reads at 3.03 : 1 on white, #959595 at 2.996 : 1.
    expect(contrastRatio("#949494", COLOR.surface)).toBeGreaterThan(3);
    expect(contrastRatio("#959595", COLOR.surface)).toBeLessThan(3);
    expect(bibAltitudeInk({ band: "#949494", ink: COLOR.ink, card: null })).toEqual({ colour: "#949494", opacity: 1 });
    expect(bibAltitudeInk({ band: "#959595", ink: COLOR.ink, card: null })).toEqual(faded);
    for (const band of ["", "blue", "#fff", "#gggggg"]) expect(bibAltitudeInk({ band, ink: COLOR.ink, card: null }), band).toEqual(faded);
    // The fallback itself clears the bar it applies, and stands apart from the kilometres' ink.
    const printed = mix(COLOR.ink, COLOR.surface, 1 - BIB_LAYOUT.profileAltitudeOpacity);
    expect(contrastRatio(printed, COLOR.surface)).toBeGreaterThanOrEqual(BIB_LAYOUT.profileAltitudeContrast);
    expect(contrastRatio(printed, COLOR.ink)).toBeGreaterThan(3);
  });

  it("gives a member's card its own white, never the band's colour, at 60% on the kit's gradient and on the veiled photograph", () => {
    const gradient = { kind: "gradient", stops: BIB_MEMBER_CARD.gradient } as const;
    for (const band of [PURPLE, BIB_BAND_FALLBACK, YELLOW]) expect(onCard(gradient, band), band).toEqual({ colour: WHITE, opacity: 0.6 });
    // On the gradient, top and foot, the white at 60% reads at 3 : 1 or more.
    for (const stop of BIB_MEMBER_CARD.gradient) expect(readsOn(stop, WHITE, 0.6), stop).toBe(true);
    // Their photograph under the veil: over a white photograph — the lightest ground the veil gives — and a black one, 60% reads.
    expect(onCard({ kind: "picture" })).toEqual({ colour: WHITE, opacity: 0.6 });
    for (const photograph of [COLOR.surface, "#000000"]) {
      expect(readsOn(mix(photograph, BIB_MEMBER_CARD.veil, BIB_MEMBER_CARD.veilOpacity), WHITE, 0.6), photograph).toBe(true);
    }
  });

  it("lays it on a card's colour at the faintest of 60%, 65%, 70%… that reads at 3 : 1 there — the editor's red at 65%, its teal at 70%", () => {
    expect(BIB_LAYOUT.profileAltitudeOpacityStep).toBe(0.05);
    // Every colour the editor offers that a card carries (the green and the orange print the gradient), and what each takes.
    const carried = BIB_COLOURS.filter((choice) => bibMemberCardColourReadable(choice.hex));
    expect(Object.fromEntries(carried.map((choice) => [choice.key, onCard({ kind: "colour", colour: choice.hex })]))).toEqual({
      red: { colour: WHITE, opacity: 0.65 },
      purple: { colour: WHITE, opacity: 0.6 },
      teal: { colour: WHITE, opacity: 0.7 },
      black: { colour: WHITE, opacity: 0.6 },
    });
    // At 60% the red would read at 2.86 : 1 and the teal at 2.59 : 1 — under the bar the rest of the change keeps.
    expect(readsOn(RED, WHITE, 0.6)).toBe(false);
    expect(readsOn(TEAL, WHITE, 0.6)).toBe(false);
    // Any colour a card carries — one an event's file may bring too: the strength chosen reads, and 5% less would not (or it is 60%).
    let carriedColours = 0;
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const colour = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
          if (!bibMemberCardColourReadable(colour)) continue;
          carriedColours += 1;
          const { opacity } = onCard({ kind: "colour", colour });
          expect(readsOn(colour, WHITE, opacity), colour).toBe(true);
          if (opacity > BIB_LAYOUT.profileAltitudeOpacity) {
            expect(readsOn(colour, WHITE, Math.round((opacity - BIB_LAYOUT.profileAltitudeOpacityStep) * 100) / 100), colour).toBe(false);
          }
        }
      }
    }
    expect(carriedColours).toBeGreaterThan(1000);
  });
});

describe("§NNN the sheet fills the two altitudes, and only them, in that ink", () => {
  for (const orientation of ["normal", "turned"] as const) {
    it(`draws the altitudes in the event's colour and every other word of the strip in the ink — profile ${orientation}`, async () => {
      const chosen = design({ profileOrientation: orientation });
      const words = stripWords(chosen);
      // The highest and the lowest, as the core rounds the track's altitudes: «797 m», «602 m».
      expect(words.altitudes).toHaveLength(2);
      for (const text of words.altitudes) expect(text).toMatch(/^\d+ m$/);
      expect(words.others).toEqual(expect.arrayContaining(["Start", "Sosire", "km"]));
      const runs = await sheet(chosen, { bandColour: GREEN });
      // The band's colour fills these two words and nothing else the sheet writes.
      expect(runs.filter((run) => run.colour === GREEN).map((run) => run.text)).toEqual(words.altitudes);
      for (const run of stripRuns(runs, words)) {
        expect(run, run.text).toEqual({ text: run.text, ...(words.altitudes.includes(run.text) ? { colour: GREEN, opacity: 1 } : { colour: COLOR.ink, opacity: 1 }) });
      }
      // After them the figures beside the strip, in the ink at full strength.
      expect(runs.find((run) => run.text.startsWith("Distanță"))).toMatchObject({ colour: COLOR.ink, opacity: 1 });
    });
  }

  it("takes the club's own blue on a race that names no colour, and the event's under the club's header picture", async () => {
    const words = stripWords(design());
    expect((await sheet(design())).filter((run) => run.colour === BIB_BAND_FALLBACK).map((run) => run.text)).toEqual(words.altitudes);
    // A picture across the top: no band is drawn, and the altitudes take the colour the band would have.
    const header = await sharp({ create: { width: 900, height: 100, channels: 3, background: "#808080" } }).png().toBuffer();
    const pictured = await sheet(design(), { bandColour: GREEN, pictures: { header } });
    expect(pictured.filter((run) => run.colour === GREEN).map((run) => run.text)).toEqual(words.altitudes);
  });

  it("draws them in the ink at 60% under a colour too light for small type, and nothing after them faint", async () => {
    const words = stripWords(design());
    const runs = await sheet(design(), { bandColour: YELLOW });
    for (const run of stripRuns(runs, words)) {
      expect(run, run.text).toEqual({ text: run.text, colour: COLOR.ink, opacity: words.altitudes.includes(run.text) ? 0.6 : 1 });
    }
    // The two altitudes are the only words of the sheet laid at less than full strength.
    expect(runs.filter((run) => run.opacity !== 1).map((run) => run.text)).toEqual(words.altitudes);
    expect(runs.some((run) => run.colour === YELLOW)).toBe(false);
  });

  it("takes the members' colour on a member's bib with their band, the event's on the other bibs of the sheet", async () => {
    const chosen = design(members({ style: "band", bandColour: PURPLE }));
    const words = stripWords(chosen);
    const runs = await sheet(chosen, { bandColour: GREEN, rows: [{ ...RUNNER, member: true }, { bibNumber: 8, registeredName: "Alergător Doi" }] });
    expect(runs.filter((run) => run.colour === PURPLE).map((run) => run.text)).toEqual(words.altitudes);
    expect(runs.filter((run) => run.colour === GREEN).map((run) => run.text)).toEqual(words.altitudes);
  });

  it("draws a member's card's altitudes in the card's white at the strength its ground needs, the strip's other words in its white", async () => {
    const photograph = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const cases: Array<[string, Partial<BibDesign["member"]>, number, { memberCard: Buffer } | undefined]> = [
      ["the purple", { bandColour: PURPLE }, 0.6, undefined],
      ["the red", { bandColour: RED }, 0.65, undefined],
      ["the teal", { bandColour: TEAL }, 0.7, undefined],
      ["the black", { bandColour: BLACK }, 0.6, undefined],
      ["the kit's gradient", {}, 0.6, undefined],
      ["the green, which a card does not carry: the gradient", { bandColour: GREEN }, 0.6, undefined],
      ["a white photograph under the veil, over the red", { bandColour: RED }, 0.6, { memberCard: photograph }],
    ];
    for (const [name, member, opacity, pictures] of cases) {
      const chosen = design(members({ style: "card", ...member }));
      const words = stripWords(chosen);
      const runs = await sheet(chosen, { bandColour: GREEN, rows: [{ ...RUNNER, member: true }], pictures });
      for (const run of stripRuns(runs, words)) {
        expect(run, `${name}: ${run.text}`).toEqual({ text: run.text, colour: WHITE, opacity: words.altitudes.includes(run.text) ? opacity : 1 });
      }
      // Never the band's colour on a card: no word of the sheet in the members' colour or the event's.
      expect(runs.some((run) => run.colour === GREEN || (member.bandColour !== undefined && run.colour === member.bandColour)), name).toBe(false);
    }
  });

  it("fills no word in the band's colour with «Kilometrii și altitudinile pe profil» off: there is no altitude to draw", async () => {
    const runs = await sheet(design({ showProfileScale: false }), { bandColour: GREEN });
    expect(runs.some((run) => run.text === "Start")).toBe(true);
    expect(runs.some((run) => run.colour === GREEN || run.opacity !== 1)).toBe(false);
  });
});

/** The strip's word boxes in the picture's markup: each one's words, colour and opacity. */
function pictureWords(altitudeInk: BibAltitudeInk, ink: string = COLOR.ink) {
  const row = bibProfileRow(design(), { profile: DRAWING, profileFigures: null }, false);
  const element = bibExtrasBlock({ row, picture: null, emergency: null, turn: { block: false, profile: false, phone: false }, ink, altitudeInk }) as ReactElement;
  const tree = JSON.parse(JSON.stringify(element, (key, value) => (key === "_owner" || key === "_store" ? undefined : value)));
  const boxes: Array<{ text: string; color: string; opacity: number | undefined }> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const props = (node as { props?: { children?: unknown; style?: { color: string; opacity?: number }; "data-testid"?: string } }).props;
      if (props?.["data-testid"] === "bib-profile-text") boxes.push({ text: props.children as string, color: props.style!.color, opacity: props.style!.opacity });
      walk(props?.children);
    }
  };
  walk(tree);
  return boxes;
}

describe("§NNN the picture carries the same ink in its markup", () => {
  it("sets the band's colour on the two altitudes' boxes, the ink on every other word's, and no opacity", () => {
    const words = stripWords(design());
    const boxes = pictureWords(bibAltitudeInk({ band: GREEN, ink: COLOR.ink, card: null }));
    expect(boxes.map((box) => box.text)).toEqual([...words.others, ...words.altitudes]);
    for (const box of boxes) expect(box, box.text).toEqual({ text: box.text, color: words.altitudes.includes(box.text) ? GREEN : COLOR.ink, opacity: undefined });
  });

  it("sets the ink and the sheet's 60% on the two altitudes' boxes alone under a colour too light", () => {
    const words = stripWords(design());
    for (const box of pictureWords(bibAltitudeInk({ band: YELLOW, ink: COLOR.ink, card: null }))) {
      expect(box, box.text).toEqual({ text: box.text, color: COLOR.ink, opacity: words.altitudes.includes(box.text) ? 0.6 : undefined });
    }
  });

  it("sets the card's white at the strength its ground needs on the altitudes' boxes alone: 65% on a red card", () => {
    const words = stripWords(design());
    for (const box of pictureWords(onCard({ kind: "colour", colour: RED }), WHITE)) {
      expect(box, box.text).toEqual({ text: box.text, color: WHITE, opacity: words.altitudes.includes(box.text) ? 0.65 : undefined });
    }
  });

  it("asks the function the sheet asks, the same question for the same bib: the event's, the members' band, their card, an elite bib", async () => {
    const cases: Array<[string, BibDesign, { member?: boolean; elite?: boolean }, Parameters<typeof bibAltitudeInk>[0]]> = [
      ["an ordinary bib", design(), {}, { band: GREEN, ink: COLOR.ink, card: null }],
      ["a member's bib with the members' band", design(members({ style: "band", bandColour: PURPLE })), { member: true }, { band: PURPLE, ink: COLOR.ink, card: null }],
      ["a member's whole card", design(members({ style: "card", bandColour: PURPLE })), { member: true }, { band: PURPLE, ink: WHITE, card: { kind: "colour", colour: PURPLE } }],
      ["a member's card in the red", design(members({ style: "card", bandColour: RED })), { member: true }, { band: RED, ink: WHITE, card: { kind: "colour", colour: RED } }],
      ["a member's card on the kit's gradient", design(members({ style: "card" })), { member: true }, { band: GREEN, ink: WHITE, card: { kind: "gradient", stops: BIB_MEMBER_CARD.gradient } }],
      ["an elite bib", design(), { elite: true }, { band: GREEN, ink: COLOR.ink, card: null }],
    ];
    for (const [name, chosen, who, asked] of cases) {
      const entry = { name: "Ana", bibNumber: null };
      spied.altitudeInk.mockClear();
      await renderBibSheet({ ...SHEET, rows: who.elite ? [] : [{ ...RUNNER, member: who.member }], elite: who.elite ? [entry] : undefined, bandColour: GREEN, profile: DRAWING, design: chosen });
      expect(spied.altitudeInk.mock.calls.map(([question]) => question), `${name}: the sheet`).toEqual([asked]);
      spied.altitudeInk.mockClear();
      await renderBibImage({ ...SHEET, ...RUNNER, member: who.member, elite: who.elite ? entry : undefined, bandColour: GREEN, profile: DRAWING, design: chosen });
      expect(spied.altitudeInk.mock.calls.map(([question]) => question), `${name}: the picture`).toEqual([asked]);
    }
  });
});

describe("§NNN the picture's pixels", () => {
  const px = (points: number) => points * BIB_IMAGE_SCALE;
  const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  /** The first row of pixels under the header band, clear of its edge. */
  const underHeader = Math.ceil(px(BIB_MARGIN + BIB_LAYOUT.bandHeight)) + 2;

  /** The picture's raw pixels. */
  async function rendered(input: Parameters<typeof renderBibImage>[0]) {
    const response = await renderBibImage(input);
    return sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  }

  /**
   * How many pixels under the header are `colour` laid on the white paper at half strength or more: a pixel the colour explains,
   * channel by channel, within a few levels. A neutral ink anti-aliased on white is never one: its channels fall together.
   */
  async function pixelsOf(input: Parameters<typeof renderBibImage>[0], colour: string): Promise<number> {
    const { data, info } = await rendered(input);
    const spans = channels(colour).map((value) => 255 - value);
    const across = spans.reduce((sum, span) => sum + span * span, 0);
    let count = 0;
    for (let y = underHeader; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const at = (y * info.width + x) * info.channels;
        const pixel = [data[at], data[at + 1], data[at + 2]];
        const strength = spans.reduce((sum, span, index) => sum + span * (255 - pixel[index]), 0) / across;
        if (strength >= 0.5 && pixel.every((value, index) => Math.abs(value - (255 - strength * spans[index])) <= 24)) count += 1;
      }
    }
    return count;
  }

  it("prints the altitudes in the event's red and the members' purple, and nothing else under the header in either", async () => {
    const bib = { ...SHEET, ...RUNNER, profile: DRAWING };
    expect(await pixelsOf({ ...bib, bandColour: RED, design: design() }, RED)).toBeGreaterThan(10);
    // The scale off draws no altitude: no pixel of the band's colour under the header.
    expect(await pixelsOf({ ...bib, bandColour: RED, design: design({ showProfileScale: false }) }, RED)).toBe(0);
    const chosen = design(members({ style: "band", bandColour: PURPLE }));
    expect(await pixelsOf({ ...bib, bandColour: RED, design: chosen, member: true }, PURPLE)).toBeGreaterThan(10);
    expect(await pixelsOf({ ...bib, bandColour: RED, design: chosen, member: true }, RED)).toBe(0);
    // A yellow band: its colour stays in the header, the altitudes take the ink.
    expect(await pixelsOf({ ...bib, bandColour: YELLOW, design: design() }, YELLOW)).toBe(0);
  });

  it("lays the altitudes under a yellow band at 60%: the very pixels the full ink draws, each 60% as dark", async () => {
    const bib = { ...SHEET, ...RUNNER, profile: DRAWING, design: design() };
    // A band in the ink's own colour reads on white, so its altitudes are the ink at full strength: the same words at the same
    // place, every other pixel under the header the same as under the yellow band — only the altitudes' opacity differs.
    expect(bibAltitudeInk({ band: COLOR.ink, ink: COLOR.ink, card: null })).toEqual({ colour: COLOR.ink, opacity: 1 });
    const full = await rendered({ ...bib, bandColour: COLOR.ink });
    const faded = await rendered({ ...bib, bandColour: YELLOW });
    const { width, channels: stride } = full.info;
    let differing = 0;
    let darkest = 0;
    for (let at = underHeader * width * stride; at < full.data.length; at += stride) {
      // How far each channel is from the white paper: the full ink's darkness, and the faded one's.
      const ink = [0, 1, 2].map((channel) => 255 - full.data[at + channel]);
      const laid = [0, 1, 2].map((channel) => 255 - faded.data[at + channel]);
      if (laid.every((value, channel) => value === ink[channel])) continue;
      differing += 1;
      darkest = Math.max(darkest, ...ink);
      for (const channel of [0, 1, 2]) expect(Math.abs(laid[channel] - 0.6 * ink[channel]), `byte ${at + channel}`).toBeLessThanOrEqual(3);
    }
    // Drawn at the full ink, the faded picture would differ nowhere: it differs, and every pixel that differs is 60% as dark.
    expect(differing).toBeGreaterThan(10);
    expect(darkest).toBeGreaterThan(100);
  });
});
