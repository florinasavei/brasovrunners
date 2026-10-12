import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCROLL_ROW_SX } from "@/shared/ui/scroll-row";

/**
 * §720 amended: every sideways-scrolling row of chips shows that it scrolls. The shared style
 * keeps a visible scrollbar in palette-variable colours (no literal, §694) and masks an edge only
 * through the attributes `ScrollRow` sets while there is more to see.
 */
const ROOT = path.resolve(__dirname, "../../..");

describe("SCROLL_ROW_SX", () => {
  const text = JSON.stringify(SCROLL_ROW_SX);

  it("scrolls sideways with a thin, visible scrollbar", () => {
    expect(SCROLL_ROW_SX.overflowX).toBe("auto");
    expect(SCROLL_ROW_SX.scrollbarWidth).toBe("thin");
    expect(text).not.toContain("none");
    expect(SCROLL_ROW_SX["&::-webkit-scrollbar"]).toEqual({ height: 6 });
  });

  it("takes every colour from the palette's variables, never a literal", () => {
    expect(SCROLL_ROW_SX.scrollbarColor).toBe("var(--mui-palette-text-secondary) var(--mui-palette-divider)");
    expect(SCROLL_ROW_SX["&::-webkit-scrollbar-thumb"].backgroundColor).toBe("var(--mui-palette-text-secondary)");
    expect(SCROLL_ROW_SX["&::-webkit-scrollbar-track"].backgroundColor).toBe("var(--mui-palette-divider)");
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|hsl\(/);
  });

  it("fades an edge only while the row can scroll that way", () => {
    expect(SCROLL_ROW_SX["&[data-more-end]"].maskImage).toContain("transparent");
    expect(SCROLL_ROW_SX["&[data-more-start]"].maskImage).toContain("transparent");
    // No mask on the row itself: nothing fades when everything fits.
    expect(Object.keys(SCROLL_ROW_SX)).not.toContain("maskImage");
  });

  it("is what the calendar's kind chips use, with no 32-pixel override left", () => {
    const chips = readFileSync(path.join(ROOT, "src/modules/events/ui/KindChips.tsx"), "utf8");
    expect(chips).toContain('import ScrollRow from "@/shared/ui/ScrollRow"');
    expect(chips).not.toContain("scrollbarWidth");
    expect(chips).not.toMatch(/height: 32/);
  });
});
