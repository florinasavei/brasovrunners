import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSwipe, swipeAxis } from "@/modules/events/domain/calendar-swipe";

/**
 * `DECISIONS.md` §NNN — the calendar swipes between months on a touch screen, like Google
 * Calendar: a drag to the left is the next month, to the right the previous one, and nothing
 * short, slow or diagonal steps at all.
 */
describe("the calendar's swipe", () => {
  const width = 360;

  it("reads a drag to the left as the next month and to the right as the previous one", () => {
    expect(readSwipe({ dx: -120, dy: 5, ms: 300, width })).toBe("next");
    expect(readSwipe({ dx: 120, dy: -5, ms: 300, width })).toBe("previous");
  });

  it("needs a fifth of the width, or 48 pixels on a narrow box, from a slow drag", () => {
    // A fifth of 360 is 72.
    expect(readSwipe({ dx: -71, dy: 0, ms: 1000, width })).toBeNull();
    expect(readSwipe({ dx: -72, dy: 0, ms: 1000, width })).toBe("next");
    // Never less than 48, however narrow.
    expect(readSwipe({ dx: -47, dy: 0, ms: 1000, width: 100 })).toBeNull();
    expect(readSwipe({ dx: -48, dy: 0, ms: 1000, width: 100 })).toBe("next");
  });

  it("takes a quick flick from a shorter drag, but not a twitch", () => {
    expect(readSwipe({ dx: -40, dy: 0, ms: 80, width })).toBe("next");
    expect(readSwipe({ dx: 40, dy: 0, ms: 80, width })).toBe("previous");
    // Fast, but under thirty pixels: a tap that slid.
    expect(readSwipe({ dx: -25, dy: 0, ms: 20, width })).toBeNull();
    // Thirty pixels, slowly: not a flick and not far.
    expect(readSwipe({ dx: -40, dy: 0, ms: 400, width })).toBeNull();
  });

  it("leaves a diagonal or vertical drag to the page's scroll", () => {
    expect(readSwipe({ dx: -120, dy: 90, ms: 300, width })).toBeNull();
    expect(readSwipe({ dx: -10, dy: 200, ms: 300, width })).toBeNull();
  });

  it("decides the axis only once the finger has moved past the slop", () => {
    expect(swipeAxis(3, 4)).toBeNull();
    expect(swipeAxis(12, 3)).toBe("x");
    expect(swipeAxis(-3, 12)).toBe("y");
  });

  it("wraps the month in the swipe, which goes where the arrows go", () => {
    const root = path.resolve(__dirname, "../../..");
    const read = (file: string) => readFileSync(path.join(root, file), "utf8");
    const section = read("src/modules/events/ui/CalendarSection.tsx");
    const header = read("src/modules/events/ui/CalendarHeader.tsx");
    const swipe = read("src/modules/events/ui/CalendarSwipe.tsx");
    // One function draws both the arrows' addresses and the swipe's.
    expect(header).toContain("calendarStepHrefs({ view, query, locale, pathname })");
    expect(section).toMatch(/<CalendarSwipe previousHref=\{steps\.previous\} nextHref=\{steps\.next\}>\s*<EventCalendar/);
    // Touch only, the vertical scroll left to the browser, and the reader kept where they are.
    expect(swipe).toContain('event.pointerType === "mouse"');
    expect(swipe).toContain('touchAction: "pan-y pinch-zoom"');
    expect(swipe).toContain("scroll: false");
  });
});
