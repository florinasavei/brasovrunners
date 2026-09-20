import { describe, expect, it } from "vitest";
import { hasReachedEnd, SCROLL_END_TOLERANCE_PX } from "@/modules/registrations/domain/read-gate";

/**
 * `DECISIONS.md` §195 — when somebody may say they have read the race's conditions.
 *
 * The assertions that matter are the ones about being *wrong*: a gate that traps a person who
 * has read the text is worse than no gate at all, because the person cannot register and cannot
 * see why.
 */
describe("§195 the read gate", () => {
  it("waits while there is text below the fold", () => {
    expect(hasReachedEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 2000 })).toBe(false);
    expect(hasReachedEnd({ scrollTop: 800, clientHeight: 400, scrollHeight: 2000 })).toBe(false);
  });

  it("opens at the end", () => {
    expect(hasReachedEnd({ scrollTop: 1600, clientHeight: 400, scrollHeight: 2000 })).toBe(true);
  });

  it("opens immediately when the text is shorter than its box", () => {
    // A short set of rules on a tall screen: there is no scroll to perform, so a gate that
    // waited for one could never be passed.
    expect(hasReachedEnd({ scrollTop: 0, clientHeight: 600, scrollHeight: 400 })).toBe(true);
  });

  it("forgives the last pixel, which browsers disagree about", () => {
    // Zoom, device pixel ratio and an overlay scrollbar each land this a pixel or two short
    // while the reader is looking at the final line.
    const short = { scrollTop: 1600 - SCROLL_END_TOLERANCE_PX + 1, clientHeight: 400, scrollHeight: 2000 };
    expect(hasReachedEnd(short)).toBe(true);
  });

  it("does not forgive a page's worth", () => {
    expect(hasReachedEnd({ scrollTop: 1200, clientHeight: 400, scrollHeight: 2000 })).toBe(false);
  });

  it("waits when nothing has been measured yet", () => {
    expect(hasReachedEnd(null)).toBe(false);
  });
});
