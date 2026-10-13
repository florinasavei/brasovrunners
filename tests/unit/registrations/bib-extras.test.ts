import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibDesign, bibEmergencyLine, DEFAULT_BIB_DESIGN, readBibDesign } from "@/modules/registrations/bib-design";
import { bibDesignSearchParams, type BibDesignFormValues, bibDesignValuesFromQuery } from "@/modules/registrations/bib-design-query";
import { BIB_LAYOUT, bibExtrasHeight } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import {
  type BibProfileDrawing,
  bibProfileDrawing,
  bibProfileFigures,
  bibProfilePaths,
  parseGpxProfile,
  PROFILE_POINTS,
} from "@/modules/registrations/bib-profile";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §NNN, BR-REQ-038-01 — the sponsors' band's place («Jos de tot» by default), «Profilul traseului»,
 * «Telefon pentru urgențe» and the stamp that keeps a cached picture honest. The sheet is checked
 * through what pdfkit is asked to draw (text runs, images, lines), the picture through its bytes.
 */

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });

/** A made-up track: 41 points a hundred metres apart or so, 600 m up to 800 m and down to 700 m. */
function track(options: { withElevation?: boolean; points?: number; step?: number } = {}): string {
  const { withElevation = true, points = 41, step = 0.001 } = options;
  const body = Array.from({ length: points }, (_, i) => {
    const ele = i <= points / 2 ? 600 + (200 * i) / (points / 2) : 800 - (100 * (i - points / 2)) / (points / 2);
    return `<trkpt lat="45.6000" lon="${(25.5 + i * step).toFixed(5)}">${withElevation ? `<ele>${ele.toFixed(1)}</ele>` : ""}</trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${body}</trkseg></trk></gpx>`;
}

const DRAWING: BibProfileDrawing = bibProfileDrawing(
  parseGpxProfile(track())!,
  {},
  "ro",
  (key, values) =>
    ({ start: "Start", finish: "Sosire", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key],
);

const SHEET = {
  eventTitle: "Crosul Brașov Runners",
  eventDate: "21 noiembrie 2026",
  generatedAt: new Date("2026-10-10T12:00:00Z"),
  replyTo: "club@example.test",
};

afterEach(() => vi.restoreAllMocks());

describe("§NNN the design's new keys", () => {
  it("reads an old design as it printed before, the sponsors' place aside", () => {
    const old = readBibDesign({ showName: false, sponsorImageSrc: null });
    expect(old.sponsorPlace).toBe("bottom");
    expect(old.showProfile).toBe(false);
    expect(old.showEmergency).toBe(false);
    expect(old.emergencyPhone).toBe("");
    expect(DEFAULT_BIB_DESIGN.sponsorPlace).toBe("bottom");
  });

  it("keeps a stored «Deasupra subsolului», and reads anything else as «Jos de tot»", () => {
    expect(readBibDesign({ sponsorPlace: "above" }).sponsorPlace).toBe("above");
    expect(readBibDesign({ sponsorPlace: "top" }).sponsorPlace).toBe("bottom");
    expect(readBibDesign({ sponsorPlace: 3 }).sponsorPlace).toBe("bottom");
  });

  it("keeps a phone as typed, spaces made one, and drops what is not a phone", () => {
    expect(readBibDesign({ emergencyPhone: "  0722   000 000 " }).emergencyPhone).toBe("0722 000 000");
    expect(readBibDesign({ emergencyPhone: "+40 722 000 000" }).emergencyPhone).toBe("+40 722 000 000");
    expect(readBibDesign({ emergencyPhone: "call the organizers" }).emergencyPhone).toBe("");
    expect(readBibDesign({ emergencyPhone: "123" }).emergencyPhone).toBe("");
    expect(readBibDesign({ emergencyPhone: "0".repeat(40) }).emergencyPhone).toBe("");
  });

  it("says the line only while ticked and typed", () => {
    expect(bibEmergencyLine({ showEmergency: true, emergencyPhone: "0722 000 000" }, "Urgențe")).toBe("Urgențe: 0722 000 000");
    expect(bibEmergencyLine({ showEmergency: false, emergencyPhone: "0722 000 000" }, "Urgențe")).toBeNull();
    expect(bibEmergencyLine({ showEmergency: true, emergencyPhone: "" }, "Urgențe")).toBeNull();
  });

  it("travels in the preview's address and back", () => {
    const values = { ...DEFAULT_BIB_DESIGN, sponsorPlace: "above", showProfile: true, showEmergency: true, emergencyPhone: "0722 000 000" } as BibDesignFormValues;
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(values)))).toMatchObject({
      sponsorPlace: "above",
      showProfile: true,
      showEmergency: true,
      emergencyPhone: "0722 000 000",
    });
  });

  it("writes memberMark=1 only when ticked, and a missing key reads false", () => {
    const base = { ...DEFAULT_BIB_DESIGN } as BibDesignFormValues;
    expect(bibDesignSearchParams(base).has("memberMark")).toBe(false);
    const on = { ...base, member: { ...base.member, mark: true } };
    expect(bibDesignSearchParams(on).get("memberMark")).toBe("1");
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(base))).member.mark).toBe(false);
  });
});

describe("§NNN the profile from a GPX", () => {
  it("reduces the track to a few dozen points with its distance and gain", () => {
    const profile = parseGpxProfile(track())!;
    expect(profile.points).toHaveLength(PROFILE_POINTS);
    expect(profile.points[0][0]).toBe(0);
    expect(profile.points[PROFILE_POINTS - 1][0]).toBe(1);
    for (const [x, y] of profile.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // 40 steps of 0.001° of longitude at 45.6° N: about 3.1 km; the climb is 200 m, give or take the smoothing.
    expect(profile.distanceMeters).toBeGreaterThan(3000);
    expect(profile.distanceMeters).toBeLessThan(3200);
    expect(profile.gainMeters).toBeGreaterThan(180);
    expect(profile.gainMeters).toBeLessThanOrEqual(205);
  });

  it("has none without elevation, with one point, or for a few steps", () => {
    expect(parseGpxProfile(track({ withElevation: false }))).toBeNull();
    expect(parseGpxProfile(track({ points: 1 }))).toBeNull();
    expect(parseGpxProfile(track({ points: 3, step: 0.00001 }))).toBeNull();
    expect(parseGpxProfile("<gpx></gpx>")).toBeNull();
  });

  it("reads a route's points when the file has no track", () => {
    const route = track().replaceAll("trkpt", "rtept");
    expect(parseGpxProfile(route)?.points).toHaveLength(PROFILE_POINTS);
  });

  it("lets the figures the club typed win over the file's", () => {
    const computed = { distanceMeters: 3100, gainMeters: 200 };
    expect(bibProfileFigures(computed, { distanceMeters: 12_400, elevationGainMeters: 640 })).toEqual({ distanceMeters: 12_400, gainMeters: 640 });
    expect(bibProfileFigures(computed, { distanceMeters: null, elevationGainMeters: null })).toEqual(computed);
    // A typed flat route is a typed figure: a gain of 0 is kept.
    expect(bibProfileFigures(computed, { distanceMeters: 0, elevationGainMeters: 0 })).toEqual({ distanceMeters: 3100, gainMeters: 0 });
    const say = (key: string, values?: { km?: string; m?: string }) => (key === "distance" ? `D ${values?.km}` : key === "gain" ? `G ${values?.m}` : key);
    const words = bibProfileDrawing(parseGpxProfile(track())!, { distanceMeters: 12_400, elevationGainMeters: 1240 }, "ro", say);
    expect(words.distance).toBe("D 12,4");
    expect(words.gain).toMatch(/^G 1.?240$/);
    expect(bibProfileDrawing(parseGpxProfile(track())!, { distanceMeters: 12_400 }, "en", say).distance).toBe("D 12.4");
  });

  it("gives the picture's path as data", () => {
    const paths = bibProfilePaths(DRAWING.points, 250, 24);
    expect(paths.line.startsWith("M0.00 ")).toBe(true);
    expect(paths.line.split("L")).toHaveLength(PROFILE_POINTS);
    expect(paths.area.endsWith("Z")).toBe(true);
  });
});

/** What the sheet asks pdfkit to draw for one number: the images, and every text run. */
async function sheet(overrides: { design: BibDesign; profile?: BibProfileDrawing | null; sponsors?: Buffer | null; emergencyLabel?: string }) {
  const images: Array<{ x: number; y: number; fit: boolean }> = [];
  const image = PDFDocument.prototype.image;
  vi.spyOn(PDFDocument.prototype, "image").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    const options = args[3] as { fit?: unknown } | undefined;
    images.push({ x: args[1] as number, y: args[2] as number, fit: options?.fit !== undefined });
    return (image as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  let lines = 0;
  const lineTo = PDFDocument.prototype.lineTo;
  vi.spyOn(PDFDocument.prototype, "lineTo").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    lines++;
    return (lineTo as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  const runs = await drawnRuns(() =>
    renderBibSheet({
      ...SHEET,
      rows: [{ bibNumber: 101, registeredName: "Alergător Unu" }],
      design: overrides.design,
      profile: overrides.profile,
      emergencyLabel: overrides.emergencyLabel ?? "Urgențe",
      pictures: { sponsors: overrides.sponsors ?? null },
    }),
  );
  vi.restoreAllMocks();
  return { runs, sponsorImage: images.find((entry) => entry.fit), lines };
}

const sponsorsPng = () => sharp({ create: { width: 800, height: 80, channels: 3, background: "#2255ee" } }).png().toBuffer();

describe("§NNN the sponsors' band's place on the sheet", () => {
  it("is the card's last row with «Jos de tot», under the small print", async () => {
    const drawn = await sheet({ design: design({ sponsorPlace: "bottom" }), sponsors: await sponsorsPng() });
    const footer = drawn.runs.find((run) => run.text.includes("club@example.test"))!;
    expect(drawn.sponsorImage).toBeDefined();
    expect(drawn.sponsorImage!.y).toBeGreaterThan(footer.y!);
    // The last row: the picture ends inside the card's foot (the paper's 421 less the 18-point margin).
    expect(drawn.sponsorImage!.y + BIB_LAYOUT.sponsorPicture).toBeLessThanOrEqual(421 - 18);
  });

  it("is above the small print with «Deasupra subsolului», as it was", async () => {
    const drawn = await sheet({ design: design({ sponsorPlace: "above" }), sponsors: await sponsorsPng() });
    const footer = drawn.runs.find((run) => run.text.includes("club@example.test"))!;
    expect(drawn.sponsorImage!.y).toBeLessThan(footer.y!);
  });

  it("moves the small print up by the strip's height at the bottom, and nowhere without a strip", async () => {
    const png = await sponsorsPng();
    const footerY = async (place: "bottom" | "above", sponsors: Buffer | null) =>
      (await sheet({ design: design({ sponsorPlace: place }), sponsors })).runs.find((run) => run.text.includes("club@example.test"))!.y!;
    expect(await footerY("above", png)).toBeGreaterThan(await footerY("bottom", png));
    expect(await footerY("above", null)).toBe(await footerY("bottom", null));
  });
});

describe("§NNN «Profilul traseului» on the sheet", () => {
  it("is drawn when ticked and read, with its distance, gain, start and finish", async () => {
    const on = await sheet({ design: design({ showProfile: true }), profile: DRAWING });
    const off = await sheet({ design: design({ showProfile: false }), profile: DRAWING });
    const texts = on.runs.map((run) => run.text);
    expect(texts).toEqual(expect.arrayContaining([DRAWING.start, DRAWING.finish, DRAWING.distance, DRAWING.gain]));
    expect(DRAWING.distance).toMatch(/^Distanță: 3,1 km$/);
    // Vector paths: the area's and the line's points, on top of everything else the number draws.
    expect(on.lines - off.lines).toBe(2 * PROFILE_POINTS);
    expect(off.runs.map((run) => run.text)).not.toContain(DRAWING.distance);
  });

  it("is not drawn without a GPX, ticked or not", async () => {
    const drawn = await sheet({ design: design({ showProfile: true }), profile: null });
    const plain = await sheet({ design: design({ showProfile: false }), profile: null });
    expect(drawn.runs.map((run) => run.text)).not.toContain("Start");
    expect(drawn.lines).toBe(plain.lines);
  });

  it("never covers the number or the name: its row sits under the name's strip", async () => {
    const on = await sheet({ design: design({ showProfile: true }), profile: DRAWING });
    const off = await sheet({ design: design({ showProfile: false }), profile: DRAWING });
    const run = (runs: typeof on.runs, text: string) => runs.find((entry) => entry.text === text)!;
    // The name below the number moves up by the row's height; the number's area gives it up.
    expect(run(off.runs, "Alergător Unu").y! - run(on.runs, "Alergător Unu").y!).toBe(BIB_LAYOUT.profileHeight);
    expect(run(on.runs, DRAWING.start).y!).toBeGreaterThan(run(on.runs, "Alergător Unu").y! + BIB_LAYOUT.nameSize);
  });
});

describe("§NNN «Telefon pentru urgențe» on the sheet", () => {
  it("prints «Urgențe: …» when ticked and typed, and nothing otherwise", async () => {
    const on = await sheet({ design: design({ showEmergency: true, emergencyPhone: "0722 000 000" }) });
    expect(on.runs.map((run) => run.text)).toContain("Urgențe: 0722 000 000");
    const unticked = await sheet({ design: design({ showEmergency: false, emergencyPhone: "0722 000 000" }) });
    expect(unticked.runs.map((run) => run.text).some((text) => text.includes("0722"))).toBe(false);
    const empty = await sheet({ design: design({ showEmergency: true, emergencyPhone: "" }) });
    expect(empty.runs.map((run) => run.text).some((text) => text.includes("Urgențe"))).toBe(false);
  });

  it("sits at the same fixed place on every number of the page", async () => {
    const runs = await drawnRuns(() =>
      renderBibSheet({
        ...SHEET,
        rows: [
          { bibNumber: 101, registeredName: "A" },
          { bibNumber: 102, registeredName: "B" },
        ],
        design: design({ showEmergency: true, emergencyPhone: "0722 000 000" }),
        emergencyLabel: "Urgențe",
      }),
    );
    const lines = runs.filter((run) => run.text === "Urgențe: 0722 000 000");
    expect(lines).toHaveLength(2);
    expect(lines[0].x).toBe(lines[1].x);
    // The lower number is the upper one a half page down.
    expect(lines[1].y! - lines[0].y!).toBeCloseTo(841.89 / 2, 2);
  });

  it("takes its row from the number's area, and only when drawn", () => {
    expect(bibExtrasHeight(false, false)).toBe(0);
    expect(bibExtrasHeight(true, false)).toBe(BIB_LAYOUT.profileHeight);
    expect(bibExtrasHeight(false, true)).toBe(BIB_LAYOUT.emergencyHeight);
    expect(bibExtrasHeight(true, true)).toBe(BIB_LAYOUT.profileHeight + BIB_LAYOUT.emergencyHeight);
  });
});

describe("§NNN the picture follows the same settings", () => {
  const picture = (overrides: Partial<BibDesign>, extra: { profile?: BibProfileDrawing | null; sponsors?: { src: string; width: number; height: number } | null } = {}) =>
    renderBibImage({
      bibNumber: 101,
      registeredName: "Alergător Unu",
      eventTitle: "Crosul Brașov Runners",
      eventDate: "21 noiembrie 2026",
      bandColour: null,
      design: design(overrides),
      replyTo: "club@example.test",
      profile: extra.profile,
      emergencyLabel: "Urgențe",
      pictures: { sponsors: extra.sponsors ?? null },
    }).then(async (response) => Buffer.from(await response.arrayBuffer()));

  it("moves the sponsors' strip only when there is one, as the sheet does", async () => {
    const png = await sponsorsPng();
    const sponsors = { src: `data:image/png;base64,${png.toString("base64")}`, width: 800, height: 80 };
    expect((await picture({ sponsorPlace: "bottom" }, { sponsors })).equals(await picture({ sponsorPlace: "above" }, { sponsors }))).toBe(false);
    expect((await picture({ sponsorPlace: "bottom" })).equals(await picture({ sponsorPlace: "above" }))).toBe(true);
  });

  it("draws the profile only when ticked and read", async () => {
    const plain = await picture({});
    expect((await picture({ showProfile: true }, { profile: DRAWING })).equals(plain)).toBe(false);
    expect((await picture({ showProfile: false }, { profile: DRAWING })).equals(plain)).toBe(true);
    expect((await picture({ showProfile: true }, { profile: null })).equals(plain)).toBe(true);
  });

  it("draws the emergency line only when ticked and typed", async () => {
    const plain = await picture({});
    expect((await picture({ showEmergency: true, emergencyPhone: "0722 000 000" })).equals(plain)).toBe(false);
    expect((await picture({ showEmergency: false, emergencyPhone: "0722 000 000" })).equals(plain)).toBe(true);
    expect((await picture({ showEmergency: true, emergencyPhone: "" })).equals(plain)).toBe(true);
  });
});

describe("§NNN the picture's stamp follows each new key", () => {
  const stamp = (overrides: Partial<BibDesign>) => bibPictureStamp([design(overrides)]);
  it("changes with the place, the profile tick, the phone tick and the phone", () => {
    const base = stamp({});
    expect(stamp({ sponsorPlace: "above" })).not.toBe(base);
    expect(stamp({ showProfile: true })).not.toBe(base);
    expect(stamp({ showEmergency: true })).not.toBe(base);
    expect(stamp({ showEmergency: true, emergencyPhone: "0722 000 000" })).not.toBe(stamp({ showEmergency: true }));
    expect(stamp({})).toBe(base);
  });
});
