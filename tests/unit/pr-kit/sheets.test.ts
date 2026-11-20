import { describe, expect, it } from "vitest";
import { codeMatrix } from "@/modules/pr-kit/draw";
import { STICKER_SHEET_KEYS } from "@/modules/pr-kit/domain/kit";
import {
  A4_MM,
  type Box,
  codeStickerLayout,
  contains,
  logoStickerLayout,
  overlaps,
  QUIET_ZONE_MODULES,
  quietZone,
  SHEET_MARGIN_MM,
  SMALLEST_CODE_MODULES,
  STICKER_SHEETS,
  sheetCells,
  sheetGrid,
  stickerCount,
} from "@/modules/pr-kit/domain/sheets";

/**
 * §1015 — «PR Kit» → «Autocolante»: the six A4 sheets' geometry, as the owner approved them on 2026-11-20, without drawing one.
 *
 * Every sticker lies inside the page's margins (9 mm left and right, 8 mm top and bottom); the cells tile the grid with nothing
 * between them; and on the two sheets with a code, the code's **quiet zone — four modules on every side — lies inside its
 * sticker and touches nothing else drawn there** (the logo, the address), for every code an address can make: the smallest code,
 * 21 modules, needs the widest zone, so it is checked from 21 modules up, and with the codes real addresses make. The logo is
 * fitted inside its box by its own proportion, so a squarer lockup — a fork's — stays inside the sticker too.
 */

/** This club's lockup, its drawing's height over its width (`public/brand/kit/`), and a square one, as a fork might bring. */
const ASPECTS = { lockup: 1162.459 / 2853.918, square: 1 };

const sheets = STICKER_SHEET_KEYS.map((key) => STICKER_SHEETS[key]);

describe("§1015 the sticker sheets' geometry", () => {
  it("holds the six sheets, named by their counts", () => {
    expect(sheets.map((sheet) => [sheet.key, stickerCount(sheet), sheet.cols, sheet.rows])).toEqual([
      ["qr-12", 12, 3, 4],
      ["qr-24", 24, 3, 8],
      ["logo-12", 12, 2, 6],
      ["logo-24", 24, 3, 8],
      ["logo-40", 40, 4, 10],
      ["logo-12-primary", 12, 2, 6],
    ]);
    expect(sheets.map((sheet) => sheet.layout)).toEqual(["qr-upright", "qr-landscape", "logo", "logo", "logo", "logo"]);
    expect(sheets.map((sheet) => sheet.ground)).toEqual(["paper", "paper", "paper", "paper", "paper", "primary"]);
  });

  it("lays the grid inside the page's margins, 9 mm at the sides and 8 mm at the top and the foot", () => {
    expect(SHEET_MARGIN_MM).toEqual({ x: 9, y: 8 });
    expect(sheetGrid()).toEqual({ x: 9, y: 8, width: A4_MM.width - 18, height: A4_MM.height - 16 });
  });

  for (const sheet of sheets) {
    it(`${sheet.key}: every sticker inside the margins, the cells tiling the grid edge to edge`, () => {
      const page: Box = { x: SHEET_MARGIN_MM.x, y: SHEET_MARGIN_MM.y, width: A4_MM.width - 2 * SHEET_MARGIN_MM.x, height: A4_MM.height - 2 * SHEET_MARGIN_MM.y };
      const cells = sheetCells(sheet);
      expect(cells).toHaveLength(stickerCount(sheet));
      for (const cell of cells) expect(contains(page, cell), JSON.stringify(cell)).toBe(true);
      // No two stickers share an area, and together they cover the grid: the cut between two is one line.
      for (let a = 0; a < cells.length; a += 1) for (let b = a + 1; b < cells.length; b += 1) expect(overlaps(cells[a], cells[b])).toBe(false);
      const area = cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
      expect(area).toBeCloseTo(page.width * page.height, 6);
    });
  }

  for (const sheet of sheets.filter((candidate) => candidate.layout !== "logo")) {
    it(`${sheet.key}: the code's quiet zone of ${QUIET_ZONE_MODULES} modules lies inside every sticker and clear of the logo and the address, from ${SMALLEST_CODE_MODULES} modules up`, () => {
      for (const [name, aspect] of Object.entries(ASPECTS)) {
        for (const cell of sheetCells(sheet)) {
          const layout = codeStickerLayout(sheet, cell, aspect);
          for (const part of [layout.logo, layout.code, layout.address.box]) expect(contains(cell, part), `${name}: ${JSON.stringify(part)}`).toBe(true);
          for (let modules = SMALLEST_CODE_MODULES; modules <= 177; modules += 4) {
            const zone = quietZone(layout.code, modules);
            expect(contains(cell, zone), `${name}, ${modules} modules: the zone crosses the cut`).toBe(true);
            expect(overlaps(zone, layout.logo), `${name}, ${modules} modules: the logo is in the zone`).toBe(false);
            expect(overlaps(zone, layout.address.box), `${name}, ${modules} modules: the address is in the zone`).toBe(false);
          }
          expect(overlaps(layout.logo, layout.address.box)).toBe(false);
        }
      }
    });
  }

  it("draws the codes the approved sheets drew: 34 mm upright, 24 mm lying down, error correction M", () => {
    expect([STICKER_SHEETS["qr-12"], STICKER_SHEETS["qr-24"]].map((sheet) => (sheet.layout === "logo" ? null : sheet.code))).toEqual([34, 24]);
    // An address a club's site really has makes a code of 25 or 29 modules; its zone holds on both sheets.
    for (const url of ["https://example.org", "https://qa.example-club.org", "http://localhost:47821"]) {
      const { size } = codeMatrix(url, "M");
      expect(size).toBeGreaterThanOrEqual(SMALLEST_CODE_MODULES);
      for (const key of ["qr-12", "qr-24"] as const) {
        const sheet = STICKER_SHEETS[key];
        for (const cell of sheetCells(sheet)) {
          const layout = codeStickerLayout(sheet, cell, ASPECTS.lockup);
          expect(contains(cell, quietZone(layout.code, size)), `${key}, ${url}`).toBe(true);
        }
      }
    }
  });

  for (const sheet of sheets.filter((candidate) => candidate.layout === "logo")) {
    it(`${sheet.key}: the logo stands inside every sticker, whatever its proportion`, () => {
      for (const [name, aspect] of Object.entries(ASPECTS)) {
        for (const cell of sheetCells(sheet)) {
          const logo = logoStickerLayout(sheet, cell, aspect);
          expect(contains(cell, logo), `${name}: ${JSON.stringify(logo)}`).toBe(true);
          expect(logo.height / logo.width).toBeCloseTo(aspect, 9);
          // Centred in its sticker.
          expect(logo.x - cell.x).toBeCloseTo(cell.x + cell.width - (logo.x + logo.width), 9);
          expect(logo.y - cell.y).toBeCloseTo(cell.y + cell.height - (logo.y + logo.height), 9);
        }
      }
    });
  }

  it("draws the logo stickers at the approved widths: 78, 52 and 39 mm", () => {
    const widths = (["logo-12", "logo-24", "logo-40", "logo-12-primary"] as const).map((key) => {
      const sheet = STICKER_SHEETS[key];
      return logoStickerLayout(sheet, sheetCells(sheet)[0], ASPECTS.lockup).width;
    });
    expect(widths).toEqual([78, 52, 39, 78]);
  });

  it("makes every code of an address from qrcode's matrix, the version's modules on a side", () => {
    expect(codeMatrix("https://example.org", "M").size).toBe(25);
    expect(codeMatrix("x", "M").size).toBe(SMALLEST_CODE_MODULES);
  });
});
