import { describe, expect, it } from "vitest";
import {
  A4_PAGE,
  BIB_CARD,
  BIB_IMAGE,
  BIB_IMAGE_SCALE,
  BIB_MARGIN,
  BIB_PAPER,
  bibNumberPoints,
} from "@/modules/registrations/bib-geometry";
import { BIB_SHEET_CUT, bibSheetSlots } from "@/modules/registrations/bibs-pdf";

/**
 * §338 — the owner, 2026-09-23: "they will be printed on an A4 page so we gonna have 2 per
 * page, basically their format is A5". Every bib is an A5 sheet lying on its side, half of the
 * A4 portrait page exactly, and the picture is the same paper at a screen's size.
 */
describe("§338 the bib's geometry", () => {
  it("is A5 landscape, exactly half of the A4 page — 210 × 148.5 mm, 1:√2", () => {
    expect(BIB_PAPER.width).toBe(A4_PAGE.width);
    expect(BIB_PAPER.height).toBe(A4_PAGE.height / 2);
    expect(BIB_PAPER.width / BIB_PAPER.height).toBeCloseTo(Math.SQRT2, 3);
  });

  it("cuts the page exactly half-way down: the upper bib's foot, the lower bib's top", () => {
    expect(BIB_SHEET_CUT).toBe(A4_PAGE.height / 2);
    expect(BIB_SHEET_CUT).toBe(BIB_PAPER.height);
  });

  it("lays two bibs per page, the upper half then the lower — an odd count's last page keeps its lower half empty", () => {
    const slots = bibSheetSlots(5);
    expect(slots.map((s) => s.page)).toEqual([0, 0, 1, 1, 2]);
    expect(slots.map((s) => s.y)).toEqual([0, BIB_PAPER.height, 0, BIB_PAPER.height, 0]);
    // Page 2 carries only one slot: nothing is drawn in its lower half.
    expect(slots.filter((s) => s.page === 2)).toHaveLength(1);
    for (const slot of slots) {
      expect(slot.width).toBe(BIB_PAPER.width);
      expect(slot.height).toBe(BIB_PAPER.height);
    }
  });

  it("centres every bib alone on its own page with `one`, not stacked in the upper half", () => {
    const slots = bibSheetSlots(3, "one");
    expect(slots.map((s) => s.page)).toEqual([0, 1, 2]);
    // Centred vertically on the A4 page, not at the top: the same gap above the bib as below it.
    const centred = (A4_PAGE.height - BIB_PAPER.height) / 2;
    expect(slots.every((s) => s.y === centred)).toBe(true);
    expect(centred).toBeGreaterThan(0);
    expect(slots.every((s) => s.width === BIB_PAPER.width && s.height === BIB_PAPER.height)).toBe(true);
  });

  it("the picture is the paper's own proportion, √2 — not a card sized by eye", () => {
    expect(BIB_IMAGE.width / BIB_IMAGE.height).toBeCloseTo(Math.SQRT2, 3);
    expect(BIB_IMAGE_SCALE).toBe(BIB_IMAGE.width / BIB_PAPER.width);
    // Every length on the paper reaches the same pixel through this one factor.
    expect(BIB_MARGIN * BIB_IMAGE_SCALE).toBeCloseTo((BIB_IMAGE.width - BIB_CARD.width * BIB_IMAGE_SCALE) / 2, 6);
  });

  it("the card sits inside the paper's white margin on all four sides", () => {
    expect(BIB_CARD.width).toBe(BIB_PAPER.width - 2 * BIB_MARGIN);
    expect(BIB_CARD.height).toBe(BIB_PAPER.height - 2 * BIB_MARGIN);
  });

  it("shrinks the number for four and five digits, so it still fits across the card", () => {
    expect(bibNumberPoints("999", 1)).toBeGreaterThan(bibNumberPoints("9999", 1));
    expect(bibNumberPoints("9999", 1)).toBeGreaterThan(bibNumberPoints("99999", 1));
    // The club's scale multiplies whatever digit count already decided.
    expect(bibNumberPoints("123", 1.2)).toBeCloseTo(bibNumberPoints("123", 1) * 1.2, 0);
  });
});
