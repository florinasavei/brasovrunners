import { describe, expect, it } from "vitest";
import { FILTER_BUTTON_SX, FILTER_CHIP_HEIGHT, FILTER_OPTION_SX } from "@/modules/events/ui/filter-chip-sx";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * BR-REQ-041-01 criterion 6 — the listing's «Filtre» button and its boxes are small chips inside a
 * thumb-sized target (§424, amending §413; the owner, 2026-09-26: "Butonul de filtre e mult prea mare").
 * The e2e spec measures the rendered heights; this holds the two numbers apart in the source.
 */
describe("the filter button and its boxes: a small pill, a 44-pixel target", () => {
  it("the pill is MUI's small chip height, 24 pixels, well under the tap target", () => {
    expect(FILTER_CHIP_HEIGHT).toBe(24);
    expect(FILTER_CHIP_HEIGHT).toBeLessThan(TAP_TARGET.minHeight);
  });

  it("the <summary> keeps the 44-pixel target and draws no border of its own; the pill inside it does", () => {
    expect(FILTER_BUTTON_SX.minHeight).toBe(44);
    expect("border" in FILTER_BUTTON_SX).toBe(false);
    expect(FILTER_BUTTON_SX["& > span"].height).toBe(FILTER_CHIP_HEIGHT);
    expect(FILTER_BUTTON_SX["& > span"].border).toBe(1);
    expect(FILTER_BUTTON_SX["& > span"].fontSize).toBe("0.8125rem");
    expect(FILTER_BUTTON_SX["& > span > svg"].fontSize).toBe(16);
  });

  it("each box's <label> keeps the 44-pixel target around a pill of the same small size as the button", () => {
    expect(FILTER_OPTION_SX.minHeight).toBe(44);
    expect(FILTER_OPTION_SX["& > span"].height).toBe(FILTER_CHIP_HEIGHT);
    expect(FILTER_OPTION_SX["& > span"].fontSize).toBe(FILTER_BUTTON_SX["& > span"].fontSize);
    expect(FILTER_OPTION_SX["& > span > svg"].fontSize).toBe(16);
  });
});
