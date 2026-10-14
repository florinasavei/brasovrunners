import { PgDialect } from "drizzle-orm/pg-core";
import PDFDocument from "pdfkit";
import type { ReactElement } from "react";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: stored.get }) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { km?: string; m?: string; time?: string }) =>
    key === "bibs.profileDistance"
      ? `Distanță: ${values?.km} km`
      : key === "bibs.profileGain"
        ? `Diferență de nivel: +${values?.m} m`
        : key === "bibs.emergencyLabel"
          ? "Urgențe"
          : key === "bibs.checkpointKm"
            ? `km ${values?.km}`
            : key,
}));

import {
  BIB_EMERGENCY_LABEL_MAX,
  BIB_EMERGENCY_NAME_MAX,
  type BibDesign,
  bibEmergencyLine,
  DEFAULT_BIB_DESIGN,
  readBibDesign,
} from "@/modules/registrations/bib-design";
import { bibCheckpointMarks } from "@/modules/registrations/bib-checkpoints";
import { clearBibProfileCache, bibNeedsCheckpoints, loadBibExtras } from "@/modules/registrations/bib-extras";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import {
  BIB_CARD,
  BIB_EMERGENCY_WIDTH,
  BIB_LAYOUT,
  BIB_MARGIN,
  bibEmergencyFit,
  bibExtrasHeight,
  bibExtrasTurn,
  bibNumberArea,
  bibProfileChartWidth,
} from "@/modules/registrations/bib-geometry";
import { bibExtrasBlock, renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing, parseGpxProfile } from "@/modules/registrations/bib-profile";
import { bibProfileRow } from "@/modules/registrations/bib-profile-row";
import { BIB_PICTURE_SLOTS } from "@/modules/registrations/bib-picture-frame";
import { BIB_DRAWING_VERSION, bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { BIB_STAMP } from "@/modules/events/repository";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * BR-REQ-038-01, §759 (amending §750 and §755) — the route's profile from the GPX or from a picture the
 * club uploads, the figures beside it or not, the profile turned for the runner (with the phone, as one
 * block, when the phone is turned too), and the emergency line's label and two numbers. The sheet is
 * read through what pdfkit is asked to draw; the picture through its markup and its bytes. No real
 * person's name or number: the names are roles, the numbers made up.
 */

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });

/** A made-up track: 41 points, 600 m up to 800 m and down to 700 m. */
function track(): string {
  const body = Array.from({ length: 41 }, (_, i) => {
    const ele = i <= 20.5 ? 600 + (200 * i) / 20.5 : 800 - (100 * (i - 20.5)) / 20.5;
    return `<trkpt lat="45.6000" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${body}</trkseg></trk></gpx>`;
}

const DRAWING: BibProfileDrawing = bibProfileDrawing(parseGpxProfile(track())!, {}, "ro", (key, values) =>
  ({ start: "Start", finish: "Sosire", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key],
);

const SHEET = { eventTitle: "Crosul de toamnă", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-10-10T12:00:00Z") };

/** Two made-up numbers in the shape a club types. */
const PHONE_A = "0700 000 001";
const PHONE_B = "+40 700 000 002";

let profilePng: Buffer;
beforeEach(async () => {
  profilePng = await sharp({ create: { width: 800, height: 60, channels: 3, background: "#2255ee" } }).png().toBuffer();
});
afterEach(() => vi.restoreAllMocks());

/** Every `image()` call of a sheet: where and in what box. */
async function images(input: Parameters<typeof renderBibSheet>[0]) {
  const calls: Array<{ x: number; y: number; fit?: [number, number] }> = [];
  const original = PDFDocument.prototype.image;
  vi.spyOn(PDFDocument.prototype, "image").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    calls.push({ x: args[1] as number, y: args[2] as number, fit: (args[3] as { fit?: [number, number] } | undefined)?.fit });
    return (original as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await renderBibSheet(input);
  vi.restoreAllMocks();
  return calls;
}

/** Every `rotate()` call of a sheet: the angle and its origin. */
async function rotations(input: Parameters<typeof renderBibSheet>[0]) {
  const calls: Array<{ angle: number; origin: [number, number] }> = [];
  const original = PDFDocument.prototype.rotate;
  vi.spyOn(PDFDocument.prototype, "rotate").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    calls.push({ angle: args[0] as number, origin: (args[1] as { origin: [number, number] }).origin });
    return (original as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await renderBibSheet(input);
  vi.restoreAllMocks();
  return calls;
}

describe("§759 the profile's new keys read their defaults from an old design", () => {
  it("draws from the GPX, with its figures, the right way up, one number with the platform's word", () => {
    const old = readBibDesign({ showProfile: true, showEmergency: true, emergencyPhone: PHONE_A });
    expect(old).toMatchObject({
      profileSource: "gpx",
      profileImageSrc: null,
      showProfileFigures: true,
      profileOrientation: "normal",
      emergencyLabel: "",
      emergencyPhoneLabel: "",
      emergencyPhone2: "",
      emergencyPhone2Label: "",
    });
    expect(bibEmergencyLine(old, "Urgențe")).toBe(`Urgențe: ${PHONE_A}`);
  });

  it("keeps only what the schema allows: a known source and orientation, a stored picture, phones shaped like phones", () => {
    const read = readBibDesign({
      profileSource: "strava",
      profileOrientation: "sideways",
      profileImageSrc: "https://elsewhere.example/profile.png",
      emergencyPhone2: "call the office",
      emergencyLabel: `  ${"x".repeat(80)} `,
      emergencyPhoneLabel: "y".repeat(60),
    });
    expect(read.profileSource).toBe("gpx");
    expect(read.profileOrientation).toBe("normal");
    expect(read.profileImageSrc).toBeNull();
    expect(read.emergencyPhone2).toBe("");
    expect(read.emergencyLabel).toBe("x".repeat(BIB_EMERGENCY_LABEL_MAX));
    expect(read.emergencyPhoneLabel).toBe("y".repeat(BIB_EMERGENCY_NAME_MAX));
  });

  it("names the profile's picture as a place of its own, never cropped", () => {
    expect(BIB_PICTURE_SLOTS).toContain("profile");
  });
});

describe("§759 the profile's row: the GPX drawn, or the club's picture, the figures beside it or not", () => {
  const extras = { profile: DRAWING, profileFigures: { distance: "Distanță: 21,0 km", gain: null } };

  it("decides once, for both renderers, what the row holds and how wide its chart is", () => {
    expect(bibProfileRow(design({ showProfile: false }), extras, true)).toBeNull();
    expect(bibProfileRow(design({ showProfile: true }), extras, false)).toMatchObject({ kind: "gpx", chartWidth: BIB_LAYOUT.profileChartWidth });
    expect(bibProfileRow(design({ showProfile: true, showProfileFigures: false }), extras, false)).toMatchObject({
      kind: "gpx",
      chartWidth: BIB_CARD.width - 2 * BIB_LAYOUT.inset,
      figures: null,
    });
    expect(bibProfileRow(design({ showProfile: true, profileSource: "picture" }), extras, true)).toMatchObject({
      kind: "picture",
      chartWidth: BIB_LAYOUT.profileChartWidth,
      figures: { distance: "Distanță: 21,0 km", gain: null },
    });
    // Nothing known to say beside it: the picture takes the whole width.
    expect(bibProfileRow(design({ showProfile: true, profileSource: "picture" }), { ...extras, profileFigures: null }, true)?.chartWidth).toBe(bibProfileChartWidth(false));
    // A picture the route could not read draws no row at all, never a GPX line in its place.
    expect(bibProfileRow(design({ showProfile: true, profileSource: "picture" }), extras, false)).toBeNull();
  });

  it("fits the club's picture whole in the chart's box on the sheet, the figures beside it — or across the whole strip", async () => {
    const left = BIB_MARGIN + BIB_LAYOUT.inset;
    const base = { rows: [{ bibNumber: 7, registeredName: "Alergător Unu" }], ...SHEET, pictures: { profile: profilePng }, profileFigures: { distance: "Distanță: 21,0 km", gain: "Diferență de nivel: +640 m" } };
    const beside = (await images({ ...base, design: design({ showProfile: true, profileSource: "picture" }) })).filter((call) => call.fit?.[1] === BIB_LAYOUT.profilePictureHeight);
    expect(beside).toEqual([expect.objectContaining({ x: left, fit: [BIB_LAYOUT.profileChartWidth, BIB_LAYOUT.profilePictureHeight] })]);
    const runs = await drawnRuns(() => renderBibSheet({ ...base, design: design({ showProfile: true, profileSource: "picture" }) }));
    expect(runs.find((run) => run.text === "Distanță: 21,0 km")?.x).toBeCloseTo(left + BIB_LAYOUT.profileChartWidth + BIB_LAYOUT.profileTextGap, 5);
    expect(runs.some((run) => run.text === "Start")).toBe(false);

    const across = (await images({ ...base, design: design({ showProfile: true, profileSource: "picture", showProfileFigures: false }) })).filter(
      (call) => call.fit?.[1] === BIB_LAYOUT.profilePictureHeight,
    );
    expect(across).toEqual([expect.objectContaining({ x: left, fit: [BIB_CARD.width - 2 * BIB_LAYOUT.inset, BIB_LAYOUT.profilePictureHeight] })]);
    const noFigures = await drawnRuns(() => renderBibSheet({ ...base, design: design({ showProfile: true, profileSource: "picture", showProfileFigures: false }) }));
    expect(noFigures.some((run) => run.text.startsWith("Distanță"))).toBe(false);
  });

  it("draws the GPX's line across the whole strip with the figures off, «Sosire» at its new right end", async () => {
    const left = BIB_MARGIN + BIB_LAYOUT.inset;
    const runs = await drawnRuns(() =>
      renderBibSheet({ rows: [{ bibNumber: 7, registeredName: "Alergător Unu" }], ...SHEET, profile: DRAWING, design: design({ showProfile: true, showProfileFigures: false }) }),
    );
    const finish = runs.find((run) => run.text === "Sosire")!;
    expect(finish.x! + (await widthOf("Sosire"))).toBeCloseTo(left + bibProfileChartWidth(false), 1);
    expect(runs.some((run) => run.text.startsWith("Distanță"))).toBe(false);
  });

  it("draws the picture in the bib's picture too, and only the picture: no line, no marks", async () => {
    const element = bibExtrasBlock({
      row: bibProfileRow(design({ showProfile: true, profileSource: "picture" }), { profile: null, profileFigures: null }, true),
      picture: { src: "data:image/png;base64,AAAA", width: 800, height: 60 },
      emergency: null,
      turn: { block: false, profile: false, phone: false },
      ink: "#000001",
    }) as ReactElement<{ children: ReactElement[] }>;
    const markup = JSON.stringify(element, (key, value) => (key === "_owner" || key === "_store" ? undefined : value));
    expect(markup).toContain('"data-testid":"bib-profile-picture"');
    expect(markup).toContain(`"width":${(BIB_CARD.width - 2 * BIB_LAYOUT.inset) * (990 / 595.28)}`);
    expect(markup).not.toContain("bib-checkpoint-mark");
    expect(markup).not.toContain('"data-testid":"bib-profile"');
  });

  it("changes the picture's bytes between the GPX line and the club's picture", async () => {
    const draw = (overrides: Partial<BibDesign>) =>
      renderBibImage({
        bibNumber: 7,
        registeredName: "Alergător Unu",
        ...SHEET,
        design: design({ showProfile: true, ...overrides }),
        profile: DRAWING,
        pictures: { profile: { src: `data:image/png;base64,${profilePng.toString("base64")}`, width: 800, height: 60 } },
      }).then(async (response) => Buffer.from(await response.arrayBuffer()));
    expect((await draw({})).equals(await draw({ profileSource: "picture" }))).toBe(false);
  });
});

/** The width of a run in the sheet's regular type, as pdfkit measures it. */
async function widthOf(text: string): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("body", await readFile(path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Regular.ttf")));
  return doc.font("body").fontSize(BIB_LAYOUT.profileLabelSize).widthOfString(text);
}

describe("§759 the profile turned for the runner, and with the phone as one block", () => {
  const rows = [{ bibNumber: 7, registeredName: "Alergător Unu" }];
  const phone = { showEmergency: true, emergencyPhone: PHONE_A };
  /** Where the block under the name starts on the upper bib: the region's foot less the rows. */
  const blockTop = (extras: number) => {
    const footer = BIB_LAYOUT.footerHeight + BIB_LAYOUT.sponsorHeight * 0;
    return BIB_MARGIN + BIB_CARD.height - footer - extras;
  };

  it("decides what turns: the block when both are drawn and turned, else each row alone", () => {
    expect(bibExtrasTurn({ profile: true, profileTurned: true, phone: true, phoneTurned: true })).toEqual({ block: true, profile: false, phone: false });
    expect(bibExtrasTurn({ profile: true, profileTurned: true, phone: true, phoneTurned: false })).toEqual({ block: false, profile: true, phone: false });
    expect(bibExtrasTurn({ profile: true, profileTurned: false, phone: true, phoneTurned: true })).toEqual({ block: false, profile: false, phone: true });
    expect(bibExtrasTurn({ profile: true, profileTurned: true, phone: false, phoneTurned: true })).toEqual({ block: false, profile: true, phone: false });
    expect(bibExtrasTurn({ profile: false, profileTurned: true, phone: true, phoneTurned: true })).toEqual({ block: false, profile: false, phone: true });
    expect(bibExtrasTurn({ profile: false, profileTurned: true, phone: false, phoneTurned: true })).toEqual({ block: false, profile: false, phone: false });
  });

  it("turns profile and phone on the sheet as one block, about the block's own centre", async () => {
    const extras = bibExtrasHeight(true, true);
    const calls = await rotations({ rows, ...SHEET, profile: DRAWING, emergencyLabel: "Urgențe", design: design({ showProfile: true, profileOrientation: "turned", ...phone, emergencyUpsideDown: true }) });
    expect(calls).toHaveLength(1);
    expect(calls[0].angle).toBe(180);
    expect(calls[0].origin[0]).toBeCloseTo(BIB_MARGIN + BIB_CARD.width / 2, 5);
    expect(calls[0].origin[1]).toBeCloseTo(blockTop(extras) + extras / 2, 5);
  });

  it("turns the profile alone about its row's centre when the phone reads the right way up, and the phone alone the other way round", async () => {
    const extras = bibExtrasHeight(true, true);
    const profileOnly = await rotations({ rows, ...SHEET, profile: DRAWING, emergencyLabel: "Urgențe", design: design({ showProfile: true, profileOrientation: "turned", ...phone, emergencyUpsideDown: false }) });
    expect(profileOnly).toHaveLength(1);
    expect(profileOnly[0].origin[1]).toBeCloseTo(blockTop(extras) + BIB_LAYOUT.profileHeight / 2, 5);
    const phoneOnly = await rotations({ rows, ...SHEET, profile: DRAWING, emergencyLabel: "Urgențe", design: design({ showProfile: true, profileOrientation: "normal", ...phone, emergencyUpsideDown: true }) });
    expect(phoneOnly).toHaveLength(1);
    expect(phoneOnly[0].origin[1]).toBeCloseTo(blockTop(extras) + BIB_LAYOUT.profileHeight + BIB_LAYOUT.emergencyHeight / 2, 5);
    const neither = await rotations({ rows, ...SHEET, profile: DRAWING, emergencyLabel: "Urgențe", design: design({ showProfile: true, ...phone, emergencyUpsideDown: false }) });
    expect(neither).toHaveLength(0);
  });

  it("turns the whole block in the picture's markup — the profile, its figures and the phone inside one rotated box", () => {
    const row = bibProfileRow(design({ showProfile: true }), { profile: DRAWING, profileFigures: null }, false);
    const block = bibExtrasBlock({ row, picture: null, emergency: { text: `Urgențe: ${PHONE_A}`, size: 9 }, turn: bibExtrasTurn({ profile: true, profileTurned: true, phone: true, phoneTurned: true }), ink: "#000001" }) as ReactElement<{
      style: Record<string, unknown>;
      "data-turn": string;
      children: Array<ReactElement<{ style?: Record<string, unknown>; "data-testid"?: string }>>;
    }>;
    expect(block.props["data-turn"]).toBe("block");
    expect(block.props.style.transform).toBe("rotate(180deg)");
    const [profileRow, phoneRow] = block.props.children;
    // The profile first and the phone under it, as drawn — the turn puts the phone above it on the paper.
    expect(profileRow.props["data-testid"]).toBe("bib-profile-row");
    expect(phoneRow.props["data-testid"]).toBe("bib-emergency");
    expect(phoneRow.props.style?.transform).toBeUndefined();
    const markup = JSON.stringify(profileRow, (key, value) => (key === "_owner" || key === "_store" ? undefined : value));
    expect(markup).toContain("Diferență de nivel");
  });

  it("turns only the profile's row in the picture when the phone reads the right way up", () => {
    const row = bibProfileRow(design({ showProfile: true }), { profile: DRAWING, profileFigures: null }, false);
    const block = bibExtrasBlock({ row, picture: null, emergency: { text: `Urgențe: ${PHONE_A}`, size: 9 }, turn: bibExtrasTurn({ profile: true, profileTurned: true, phone: true, phoneTurned: false }), ink: "#000001" }) as ReactElement<{
      style: Record<string, unknown>;
      "data-turn": string;
      children: Array<ReactElement<{ style?: Record<string, unknown>; "data-testid"?: string }>>;
    }>;
    expect(block.props["data-turn"]).toBe("profile");
    expect(block.props.style.transform).toBeUndefined();
    expect(block.props.children[0].props.style?.transform).toBe("rotate(180deg)");
    expect(block.props.children[1].props.style?.transform).toBeUndefined();
  });

  it("changes the picture's bytes when the profile turns, and again when the phone turns with it", async () => {
    const draw = (overrides: Partial<BibDesign>) =>
      renderBibImage({ bibNumber: 7, registeredName: "Alergător Unu", ...SHEET, emergencyLabel: "Urgențe", design: design({ showProfile: true, ...phone, ...overrides }), profile: DRAWING }).then(
        async (response) => Buffer.from(await response.arrayBuffer()),
      );
    const upright = await draw({ emergencyUpsideDown: false });
    const profileTurned = await draw({ profileOrientation: "turned", emergencyUpsideDown: false });
    const block = await draw({ profileOrientation: "turned", emergencyUpsideDown: true });
    expect(upright.equals(profileTurned)).toBe(false);
    expect(profileTurned.equals(block)).toBe(false);
  });

  it("measures the checkpoints' crowding in the chart's own width: a strip without figures keeps marks a narrow one drops", () => {
    const points = parseGpxProfile(track())!.points;
    const close = [
      { km: 50, kinds: ["WATER"], cutoffClock: null },
      { km: 51.3, kinds: ["FOOD"], cutoffClock: null },
    ];
    const say = { startWord: "Start", finishWord: "Sosire", showTimes: false, label: () => "km" };
    expect(bibCheckpointMarks({ checkpoints: close, routeKm: 100, points, ...say })?.marks).toHaveLength(1);
    expect(bibCheckpointMarks({ checkpoints: close, routeKm: 100, points, ...say, chartWidth: bibProfileChartWidth(false) })?.marks).toHaveLength(2);
  });
});

describe("§759 «Eticheta telefonului» and two numbers on one line", () => {
  it("prints the club's label, each number with its own name, one line, «/» between", () => {
    const line = bibEmergencyLine(
      design({ showEmergency: true, emergencyLabel: "Număr de urgență", emergencyPhoneLabel: "Coordonator", emergencyPhone: PHONE_A, emergencyPhone2Label: "Medic", emergencyPhone2: PHONE_B }),
      "Urgențe",
    );
    expect(line).toBe(`Număr de urgență: Coordonator ${PHONE_A} / Medic ${PHONE_B}`);
    // A number without a name prints alone; the second alone prints alone; none prints no line.
    expect(bibEmergencyLine(design({ showEmergency: true, emergencyPhone: PHONE_A, emergencyPhone2: PHONE_B }), "Urgențe")).toBe(`Urgențe: ${PHONE_A} / ${PHONE_B}`);
    expect(bibEmergencyLine(design({ showEmergency: true, emergencyPhone2: PHONE_B, emergencyPhone2Label: "Medic" }), "Emergency")).toBe(`Emergency: Medic ${PHONE_B}`);
    expect(bibEmergencyLine(design({ showEmergency: true, emergencyPhoneLabel: "Coordonator" }), "Urgențe")).toBeNull();
    expect(bibEmergencyLine(design({ showEmergency: false, emergencyPhone: PHONE_A }), "Urgențe")).toBeNull();
  });

  it("prints that line on the sheet and in the picture, the same words", async () => {
    const chosen = design({ showEmergency: true, emergencyLabel: "Urgențe traseu", emergencyPhoneLabel: "Coordonator", emergencyPhone: PHONE_A, emergencyPhone2Label: "Medic", emergencyPhone2: PHONE_B });
    const expected = `Urgențe traseu: Coordonator ${PHONE_A} / Medic ${PHONE_B}`;
    const runs = await drawnRuns(() => renderBibSheet({ rows: [{ bibNumber: 7, registeredName: "Alergător Unu" }], ...SHEET, emergencyLabel: "Urgențe", design: chosen }));
    expect(runs.filter((run) => run.text === expected)).toHaveLength(1);
    const element = bibExtrasBlock({ row: null, picture: null, emergency: bibEmergencyFit(expected, bibFooterWidth), turn: bibExtrasTurn({ profile: false, profileTurned: false, phone: true, phoneTurned: true }), ink: "#000001" }) as ReactElement<{
      children: Array<ReactElement<{ children: string; style: Record<string, unknown> }> | null>;
    }>;
    const phoneRow = element.props.children[1]!;
    expect(phoneRow.props.children).toBe(expected);
    expect(phoneRow.props.style.transform).toBe("rotate(180deg)");
  });

  it("fits a long line to the card by its size, and cuts it only past the smallest", () => {
    const short = bibEmergencyFit(`Urgențe: ${PHONE_A}`, bibFooterWidth);
    expect(short.size).toBe(BIB_LAYOUT.emergencySize);
    const long = `Număr de urgență pe traseul de munte: Coordonatorul cursei ${PHONE_B} / Medicul punctului de prim ajutor de la cabană ${PHONE_B}`;
    // Too wide at the line's own size, narrow enough for the smallest: the case a shrink is for.
    expect(bibFooterWidth(long) * BIB_LAYOUT.emergencySize).toBeGreaterThan(BIB_EMERGENCY_WIDTH);
    expect(bibFooterWidth(long) * BIB_LAYOUT.emergencyMinSize).toBeLessThanOrEqual(BIB_EMERGENCY_WIDTH);
    const fitted = bibEmergencyFit(long, bibFooterWidth);
    expect(fitted.text).toBe(long);
    expect(fitted.size).toBeLessThan(BIB_LAYOUT.emergencySize);
    expect(bibFooterWidth(fitted.text) * fitted.size).toBeLessThanOrEqual(BIB_EMERGENCY_WIDTH);
    const tooLong = bibEmergencyFit(`${long} ${long}`, bibFooterWidth);
    expect(tooLong.size).toBe(BIB_LAYOUT.emergencyMinSize);
    expect(tooLong.text.endsWith("…")).toBe(true);
    expect(bibFooterWidth(tooLong.text) * tooLong.size).toBeLessThanOrEqual(BIB_EMERGENCY_WIDTH);
  });

  it("takes its height from the number's area once, whatever it says", () => {
    expect(bibNumberArea({ footer: 22, name: 44, sponsors: 0, stripe: 0, extras: bibExtrasHeight(true, true) })).toBe(BIB_CARD.height - BIB_LAYOUT.bandHeight - 22 - 44 - BIB_LAYOUT.profileHeight - BIB_LAYOUT.emergencyHeight);
  });
});

describe("§759 the extras for a picture of the profile", () => {
  beforeEach(() => {
    clearBibProfileCache();
    stored.get.mockReset();
    stored.get.mockResolvedValue(new TextEncoder().encode(track()));
  });
  const ticks = { showProfile: true, showEmergency: false, showDistance: false, profileSource: "picture" } as const;

  it("says the event's typed figures beside the picture, with no GPX read", async () => {
    const extras = await loadBibExtras({ routeGpx: null, distanceMeters: 21_000, elevationGainMeters: 640 }, ticks, "ro");
    expect(extras.profile).toBeNull();
    expect(extras.profileFigures).toEqual({ distance: "Distanță: 21,0 km", gain: "Diferență de nivel: +640 m" });
    expect(stored.get).not.toHaveBeenCalled();
  });

  it("fills what the club left empty from the GPX, says nothing it does not know, and nothing at all with the figures off", async () => {
    const withGpx = await loadBibExtras({ routeGpx: { key: "route/a.gpx" } as never, distanceMeters: null, elevationGainMeters: null }, ticks, "ro");
    expect(withGpx.profileFigures?.distance).toMatch(/^Distanță: /);
    expect(withGpx.profileFigures?.gain).toMatch(/^Diferență de nivel: \+/);
    const distanceOnly = await loadBibExtras({ routeGpx: null, distanceMeters: 5_000, elevationGainMeters: null }, ticks, "ro");
    expect(distanceOnly.profileFigures).toEqual({ distance: "Distanță: 5,0 km", gain: null });
    expect((await loadBibExtras({ routeGpx: null, distanceMeters: null, elevationGainMeters: null }, ticks, "ro")).profileFigures).toBeNull();
    expect((await loadBibExtras({ routeGpx: null, distanceMeters: 5_000, elevationGainMeters: 100 }, { ...ticks, showProfileFigures: false }, "ro")).profileFigures).toBeNull();
  });

  it("never reads the checkpoints for a picture: the marks are drawn on the GPX's line only", () => {
    expect(bibNeedsCheckpoints({ showProfile: true, showCheckpoints: true, profileSource: "picture" })).toBe(false);
    expect(bibNeedsCheckpoints({ showProfile: true, showCheckpoints: true, profileSource: "gpx" })).toBe(true);
  });
});

describe("§759 every new key changes the picture's address and the desk's stamp", () => {
  const changes: Array<Partial<BibDesign>> = [
    { profileSource: "picture" },
    { profileImageSrc: "/api/media/local/3f2a1b4c-0000-4000-8000-000000000000/web.webp" },
    { showProfileFigures: false },
    { profileOrientation: "turned" },
    { emergencyLabel: "Număr de urgență" },
    { emergencyPhoneLabel: "Coordonator" },
    { emergencyPhone2: PHONE_B },
    { emergencyPhone2Label: "Medic" },
  ];

  it("gives the bibs page's picture a new address for each", () => {
    const base = bibPictureStamp([DEFAULT_BIB_DESIGN]);
    for (const change of changes) expect(bibPictureStamp([design(change)]), JSON.stringify(change)).not.toBe(base);
  });

  it("hashes the whole stored design, so the desk's address follows every key, and starts with the drawing's version", () => {
    const query = new PgDialect().sqlToQuery(BIB_STAMP);
    expect(query.params[0]).toBe(String(BIB_DRAWING_VERSION));
    expect(query.sql).toContain('"events"."bib_design"::text');
  });
});
