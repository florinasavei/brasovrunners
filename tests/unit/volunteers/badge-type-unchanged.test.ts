import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BadgeDesign, type BadgeFaceRole, badgeWords, DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { type BadgeImagePicture, badgeImageLayout, badgeMarkup } from "@/modules/volunteers/badges/badge-image";
import { type BadgeRole, badgePrintEntries } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";

/**
 * §962 — the badges the volunteer's type does not touch print what they printed before it (BR-REQ-050-02): a role under no category, a
 * badge «fără rol» and the one badge for everyone (§783). `__snapshots__/badge-drawing-before-type.json` was written by this very file from
 * the code as it stood before a role's category reached its badge (baseline `BR-V4.52-2026-11-17`); every case is drawn again here and held
 * to it whole — the layout's numbers, the picture's markup (what Satori draws, `badge-image.tsx`) and every call the sheet makes to pdfkit
 * (what the PDF holds, `badges-pdf.ts`), each kept as the SHA-256 of its data beside the lines it prints, in words. A role under none is drawn
 * twice, in the shape callers handed before (no `category` at all) and in the shape they hand now (`category: null`), and once more through
 * the print's own entries (`badgePrintEntries`): all three are the drawing of before. Only APIs that existed before are called, so the file
 * writes the same snapshot on the old code (`vitest run -u` there).
 *
 * `BADGE_SAMPLE_DIR=<folder>` writes each case's whole drawing there, as data, to compare by eye.
 */

const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const EN = { label: "VOLUNTEER", name: "Name:", phoneLabel: "Coordinator" };
const wordsOf = (design: BadgeDesign, locale: "ro" | "en") => badgeWords(design, locale, "Brașov Trail Race", locale === "ro" ? RO : EN);
const AT = new Date("2026-11-17T08:00:00.000Z");

const PER_ROLE: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, mode: "perRole" };
const EXTRAS: BadgeDesign = {
  ...PER_ROLE,
  showPhone: true,
  phone: "0712 345 678",
  showFreeText: true,
  freeTextRo: "Hidratează-te la fiecare punct",
  freeTextEn: "Drink at every point",
  showMarker: true,
  markerLabelRo: "Tură",
  markerLabelEn: "Shift",
};

type Role = { name: string; colour: string | null; phone: string | null };
type Case = { design: BadgeDesign; locale: "ro" | "en"; role: Role | null };

/** The badges that keep their drawing: a role under no category on every kind of size, the badges «fără rol», the one badge. */
const CASES: Record<string, Case> = {
  "per role, 90 × 35, a role under no category": { design: PER_ROLE, locale: "ro", role: { name: "Punct de apă", colour: "#c62828", phone: null } },
  "per role, 90 × 35, every row ticked, a role under no category, in English": { design: EXTRAS, locale: "en", role: { name: "Water point", colour: null, phone: null } },
  "per role, 60 × 30, a role under no category": {
    design: { ...PER_ROLE, size: "custom", customWidthMm: 60, customHeightMm: 30 },
    locale: "ro",
    role: { name: "Marshal pe traseu", colour: "#6a1b9a", phone: null },
  },
  "per role, 90 × 35, a long role under no category, cut": {
    design: PER_ROLE,
    locale: "ro",
    role: { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: null, phone: null },
  },
  "per role, 200 × 100, the telephone's blank row, a long role under no category, shrunk": {
    design: { ...PER_ROLE, size: "custom", customWidthMm: 200, customHeightMm: 100, showPhone: true },
    locale: "ro",
    role: { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: null, phone: null },
  },
  "per role, 100 × 40, a badge «fără rol»": { design: { ...EXTRAS, size: "strip100" }, locale: "ro", role: null },
  "one badge for everyone, its own colour and a telephone, in English": {
    design: { ...DEFAULT_BADGE_DESIGN, singleColour: "#c62828", showPhone: true, phone: "0712 345 678" },
    locale: "en",
    role: null,
  },
  "one badge for everyone, the platform's design": { design: DEFAULT_BADGE_DESIGN, locale: "ro", role: null },
};

/**
 * A React tree as plain data — what Satori draws: each element's type, its props but the children, and its children, the empty ones
 * (null, undefined, a boolean) left out as React leaves them out, so a slot that draws nothing is no part of the drawing.
 */
function tree(node: ReactNode): unknown {
  if (Array.isArray(node)) return node.filter((child) => child !== null && child !== undefined && typeof child !== "boolean").map(tree);
  if (!isValidElement(node)) return node ?? null;
  const { children, ...props } = node.props as { children?: ReactNode } & Record<string, unknown>;
  return { type: typeof node.type === "string" ? node.type : "fragment", props, children: tree(children) };
}

/** What a call's argument is, as data: a number or a word as it is, the bytes of a font or a picture named, an option's own values. */
function plain(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return "[bytes]";
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) return `[${(value as object).constructor?.name ?? "object"}]`;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
}

/** Every drawing call the sheet makes to pdfkit, in order, with its arguments. */
const DRAWING = ["addPage", "text", "font", "fontSize", "fillColor", "rect", "fill", "moveTo", "lineTo", "stroke", "lineWidth", "strokeOpacity", "strokeColor", "dash", "undash", "image", "save", "restore", "clip"] as const;

async function sheetCalls(render: () => Promise<Buffer>): Promise<unknown[]> {
  const calls: unknown[] = [];
  const prototype = PDFDocument.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of DRAWING) {
    const original = prototype[name];
    vi.spyOn(prototype, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      calls.push([name, ...args.map(plain)]);
      return original.apply(this, args);
    });
  }
  try {
    await render();
  } finally {
    vi.restoreAllMocks();
  }
  return calls;
}

const sheetOf = (design: BadgeDesign, locale: "ro" | "en", entries: Parameters<typeof renderBadgeSheet>[0]["entries"]) =>
  sheetCalls(() => renderBadgeSheet({ design, locale, words: wordsOf(design, locale), entries, eventTitle: "Brașov Trail Race", generatedAt: AT }));

/** One badge drawn both ways: its layout, its picture's markup and its sheet's calls. */
async function drawingOf(design: BadgeDesign, locale: "ro" | "en", role: Parameters<typeof badgeMarkup>[0]["role"]) {
  const input = { design, locale, words: wordsOf(design, locale), role };
  return { layout: plain(badgeImageLayout(input)), picture: tree(badgeMarkup(input, "logo")), sheet: await sheetOf(design, locale, [{ role, count: 1 }]) };
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The lines a layout prints, in words: each one's text and size, top to bottom — what the snapshot says a person would read. */
function linesOf(layout: unknown): string[] {
  const drawn = layout as Record<string, { text?: string; size?: number; label?: { text: string; size: number } | null } | null>;
  const line = (entry: { text?: string; size?: number } | null | undefined) => (entry?.text !== undefined && entry.size !== undefined ? [`${entry.text} @ ${entry.size.toFixed(2)}`] : []);
  return [...["title", "label", "roleLine", "freeLine", "name"].flatMap((key) => line(drawn[key])), ...line(drawn.marker?.label), ...line(drawn.phoneLine)];
}

/** What the snapshot keeps of a drawing: its lines in words and a fingerprint of each whole part. */
const kept = (drawing: Awaited<ReturnType<typeof drawingOf>>) => ({
  lines: linesOf(drawing.layout),
  layout: sha256(drawing.layout),
  picture: sha256(drawing.picture),
  sheet: sha256(drawing.sheet),
});

/** A role of the print's list under no category, as `listBadgeRoles` reads it. */
const roleUnderNone = (role: Role): BadgeRole => ({
  id: "00000000-0000-4000-8000-000000000001",
  nameRo: role.name,
  nameEn: role.name,
  needed: 1,
  assigned: 0,
  colour: role.colour,
  position: 0,
  createdAt: AT,
  categoryId: null,
  categoryRo: null,
  categoryEn: null,
  categoryPhone: null,
});

afterEach(() => vi.restoreAllMocks());

describe("§962 the badges with no type draw what they drew before it", () => {
  it("holds every case to the drawing written before the change, a role under none in each shape callers hand it", async () => {
    const drawings: Record<string, ReturnType<typeof kept>> = {};
    const whole: Record<string, unknown> = {};
    for (const [name, { design, locale, role }] of Object.entries(CASES)) {
      const before = await drawingOf(design, locale, role);
      drawings[name] = kept(before);
      whole[name] = before;
      if (role === null) continue;
      // The shape a caller hands now, for a role under no category, and the print's own entry for it: the same drawing.
      expect(await drawingOf(design, locale, { ...role, category: null }), `${name}, category: null`).toEqual(before);
      const [entry] = badgePrintEntries([roleUnderNone(role)], { roles: new Map([["00000000-0000-4000-8000-000000000001", { count: 1, spares: 0 }]]), none: 0 }, locale);
      expect(await sheetOf(design, locale, [entry]), `${name}, from the print's entries`).toEqual(before.sheet);
    }
    const folder = process.env.BADGE_SAMPLE_DIR;
    if (folder) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "badge-drawing-whole.json"), `${JSON.stringify(whole, null, 2)}\n`);
    }
    await expect(`${JSON.stringify(drawings, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/badge-drawing-before-type.json");
  }, 60_000);

  /**
   * «Logo-ul clubului jos, ca filigran» off — the choice of every design that never made it — draws every case as before, byte for byte
   * in the layout, the picture and the sheet's calls: chosen off, and absent from a design stored before the choice (§965).
   */
  it("draws the same with the club's logo as a watermark off: chosen off, or absent from a design saved before the choice (§965)", async () => {
    const drawings: Record<string, ReturnType<typeof kept>> = {};
    for (const [name, { design, locale, role }] of Object.entries(CASES)) {
      const chosenOff = await drawingOf({ ...design, footerLogo: "off" }, locale, role);
      // As stored before the choice existed: the key absent, read back by the one forgiving reader.
      const stored: Record<string, unknown> = { ...design };
      delete stored.footerLogo;
      expect(await drawingOf(readBadgeDesign(stored), locale, role), `${name}, saved before the choice`).toEqual(chosenOff);
      drawings[name] = kept(chosenOff);
    }
    await expect(`${JSON.stringify(drawings, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/badge-drawing-before-type.json");
  }, 60_000);

  /**
   * «Spațiul pentru nume (% din înălțime)» at its default — 43, the choice of every design that never made it — draws every case as before,
   * byte for byte in the layout, the picture and the sheet's calls: chosen 43, and absent from a design stored before the key (§NNN).
   */
  it("draws the same with the space for the name at its default: chosen 43, or absent from a design saved before the key (§NNN)", async () => {
    const drawings: Record<string, ReturnType<typeof kept>> = {};
    for (const [name, { design, locale, role }] of Object.entries(CASES)) {
      const chosen = await drawingOf({ ...design, nameSpacePct: 43 }, locale, role);
      expect(await drawingOf(readBadgeDesign(withoutNameSpace(design)), locale, role), `${name}, saved before the key`).toEqual(chosen);
      drawings[name] = kept(chosen);
    }
    await expect(`${JSON.stringify(drawings, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/badge-drawing-before-type.json");
  }, 60_000);
});

/** A design as stored before «Spațiul pentru nume» existed: the key absent (§NNN). */
function withoutNameSpace(design: BadgeDesign): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...design };
  delete stored.nameSpacePct;
  return stored;
}

/** One badge of the grid below: a design, the badge's language, its role, and the club's picture across the header when it has one. */
type GridCase = { design: BadgeDesign; locale: "ro" | "en"; role: BadgeFaceRole | null; headerPicture?: BadgeImagePicture };

/** The longest category the event's editor keeps (80 characters, §962): under the role's name where «VOLUNTAR · …» does not fit. */
const LONGEST_CATEGORY = "Activități de start și sosire, punctele de hidratare și de control de pe traseul";

/** The badges of the grid: both modes, a role under none, beside and under a category, cut, «fără rol», every row ticked, the watermark, a picture. */
const GRID_CASES: Record<string, GridCase> = {
  "the one badge, the platform's design": { design: DEFAULT_BADGE_DESIGN, locale: "ro", role: null },
  "the one badge, its own colour, every row ticked, the club's logo strong at its foot, no line, in English": {
    design: { ...EXTRAS, mode: "single", singleColour: "#6a1b9a", footerLogo: "strong", writingLine: false },
    locale: "en",
    role: null,
  },
  "per role, a role under no category": { design: PER_ROLE, locale: "ro", role: { name: "Punct de apă", colour: "#c62828", phone: null } },
  "per role, a category beside «VOLUNTAR»": { design: PER_ROLE, locale: "ro", role: { name: "Foto/Video", colour: null, phone: null, category: "Pe Traseu" } },
  "per role, the longest category, under the role's name where it must": {
    design: PER_ROLE,
    locale: "ro",
    role: { name: "Direcționare", colour: "#6a1b9a", phone: null, category: LONGEST_CATEGORY },
  },
  "per role, a long role cut, in English": {
    design: PER_ROLE,
    locale: "en",
    role: { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: null, phone: null },
  },
  "per role, a badge «fără rol», every row ticked": { design: EXTRAS, locale: "ro", role: null },
  "per role, every row ticked, the telephone of the role's category": {
    design: { ...EXTRAS, phone: "" },
    locale: "ro",
    role: { name: "Marshal", colour: null, phone: "0722 111 222", category: "Pe Traseu" },
  },
  "per role, the telephone's blank row, the club's logo faint": {
    design: { ...PER_ROLE, showPhone: true, footerLogo: "faint" },
    locale: "ro",
    role: { name: "Masă", colour: "#c62828", phone: null },
  },
  "per role, the club's picture across the header, in English": {
    design: { ...PER_ROLE, headerImageSrc: "/api/media/00000000-0000-4000-8000-000000000abc/web.webp", headerImageCrop: { x: 0.1, y: 0.2, w: 0.6, h: 0.3 } },
    locale: "en",
    role: { name: "Guidance", colour: null, phone: null, category: "On the route" },
    headerPicture: { src: "picture", width: 1600, height: 900 },
  },
  "per role, no logo, no title, the club's own word, a category": {
    design: { ...PER_ROLE, showLogo: false, showTitle: false, labelRo: "Staff", labelEn: "Staff", footerLogo: "medium" },
    locale: "en",
    role: { name: "Photo/Video", colour: "#c62828", phone: null, category: "On the route" },
  },
};

/** Every size «Altă dimensiune» allows in 10 mm steps, the tallest (287 mm) among them, and the two strips. */
const GRID_WIDTHS = Array.from({ length: 15 }, (_, index) => 60 + 10 * index);
const GRID_HEIGHTS = [...Array.from({ length: 26 }, (_, index) => 30 + 10 * index), 287];
const GRID_SIZES: Array<Pick<BadgeDesign, "size" | "customWidthMm" | "customHeightMm">> = [
  { size: "strip90", customWidthMm: 90, customHeightMm: 35 },
  { size: "strip100", customWidthMm: 90, customHeightMm: 35 },
  ...GRID_WIDTHS.flatMap((width) => GRID_HEIGHTS.map((height) => ({ size: "custom" as const, customWidthMm: width, customHeightMm: height }))),
];
/** The sheet is drawn for fewer of them: pdfkit is slow, and the sheet draws the layout the picture draws. */
const SHEET_SIZES: Array<Pick<BadgeDesign, "size" | "customWidthMm" | "customHeightMm">> = [
  GRID_SIZES[0],
  GRID_SIZES[1],
  { size: "custom", customWidthMm: 60, customHeightMm: 30 },
  { size: "custom", customWidthMm: 90, customHeightMm: 100 },
  { size: "custom", customWidthMm: 90, customHeightMm: 130 },
  { size: "custom", customWidthMm: 200, customHeightMm: 287 },
];
const SHEET_CASES = ["the one badge, the platform's design", "per role, every row ticked, the telephone of the role's category", "per role, the telephone's blank row, the club's logo faint"];

/**
 * The fingerprints of the grid as the base drew it, before the space for the name existed (baseline `BR-V4.56-2026-11-17` with taller
 * badges): written by this very test on that code, which ignores the key, so it reads the same there whichever design it is handed.
 */
const GRID_BEFORE = {
  drawings: "452ba1ccf9205640fd2f6c0ec88ae4795e69e0a5db05a8a08a562c56ea05fc99",
  sheets: "b104bc06be74f999db3fff7b6fade177166ef6a0dfc4d4d906babad9c57ec5b9",
};

/** The grid's layouts and pictures, and its sheets, each as one SHA-256, every badge drawn from the design `designOf` hands. */
async function gridFingerprints(designOf: (design: BadgeDesign) => BadgeDesign): Promise<{ drawings: string; sheets: string }> {
  const drawings = createHash("sha256");
  for (const [name, gridCase] of Object.entries(GRID_CASES)) {
    for (const size of GRID_SIZES) {
      const design = designOf({ ...gridCase.design, ...size });
      const input = { design, locale: gridCase.locale, words: wordsOf(design, gridCase.locale), role: gridCase.role, headerPicture: gridCase.headerPicture ?? null };
      drawings.update(JSON.stringify([name, size, plain(badgeImageLayout(input)), tree(badgeMarkup(input, "logo"))]));
    }
  }
  const sheets = createHash("sha256");
  for (const name of SHEET_CASES) {
    const gridCase = GRID_CASES[name];
    for (const size of SHEET_SIZES) {
      const design = designOf({ ...gridCase.design, ...size });
      sheets.update(JSON.stringify([name, size, await sheetOf(design, gridCase.locale, [{ role: gridCase.role, count: 2 }])]));
    }
  }
  return { drawings: drawings.digest("hex"), sheets: sheets.digest("hex") };
}

describe("§NNN the space for the name at its default is the badge of before, at every size", () => {
  it("draws every size the bounds allow, in 10 mm steps, as the base drew it: the key at 43, and absent from a design saved before it", async () => {
    expect(await gridFingerprints((design) => ({ ...design, nameSpacePct: 43 }))).toEqual(GRID_BEFORE);
    expect(await gridFingerprints((design) => readBadgeDesign(withoutNameSpace(design)))).toEqual(GRID_BEFORE);
  }, 240_000);
});
