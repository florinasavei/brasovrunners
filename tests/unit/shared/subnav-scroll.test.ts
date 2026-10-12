import { describe, expect, it } from "vitest";
import { centredScrollLeft, currentInView } from "@/shared/ui/subnav-scroll";

/** §NNN — the measurement is against the row's own rect, so a page gutter cannot move it. */
describe("SubNav current entry measurement (§NNN)", () => {
  // A 288-px row at x=16 (the page gutter), its content 783 px wide, scrolled 0.
  const row = { left: 16, right: 304 };

  it("an entry inside the row is in view, whatever the gutter", () => {
    expect(currentInView(row, { left: 20, right: 120 })).toBe(true);
    expect(currentInView({ left: 0, right: 288 }, { left: 4, right: 104 })).toBe(true);
  });

  it("an entry past either edge is not, beyond one pixel of slack", () => {
    expect(currentInView(row, { left: 250, right: 350 })).toBe(false);
    expect(currentInView(row, { left: -40, right: 40 })).toBe(false);
    expect(currentInView(row, { left: 250, right: 305 })).toBe(true);
  });

  it("centres from the rect difference plus the current scrollLeft", () => {
    // entry 100 wide at page x=420 (row-relative 404): centre -> 404 - (288-100)/2 = 310
    expect(centredScrollLeft(row, { left: 420, right: 520 }, 0, 288)).toBe(310);
    // already scrolled 100: the entry sits 100 px further left on screen, same result
    expect(centredScrollLeft(row, { left: 320, right: 420 }, 100, 288)).toBe(310);
  });
});
