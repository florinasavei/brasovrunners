import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCROLL_BAR_SX, SCROLL_ROW_SX, watchScrollRow } from "@/shared/ui/scroll-row";

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
    // The browser's bar is hidden only while the drawn one is up (`data-drawn-bar`, set by the island), never otherwise.
    const { "&[data-drawn-bar]": drawn, ...rest } = SCROLL_ROW_SX;
    expect(JSON.stringify(rest)).not.toContain("none");
    expect(drawn.scrollbarWidth).toBe("none");
    expect(text).toContain("thin");
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

describe("watchScrollRow", () => {
  type Cb = () => void;
  const resizes: FakeResize[] = [];
  const mutations: FakeMutation[] = [];
  class FakeResize {
    observed: unknown[] = [];
    disconnected = false;
    constructor(public cb: Cb) {
      resizes.push(this);
    }
    observe(t: unknown) {
      this.observed.push(t);
    }
    disconnect() {
      this.disconnected = true;
      this.observed = [];
    }
  }
  class FakeMutation {
    disconnected = false;
    options: unknown;
    constructor(public cb: Cb) {
      mutations.push(this);
    }
    observe(_t: unknown, options: unknown) {
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const makeEl = () => {
    const attrs = new Set<string>();
    return {
      attrs,
      scrollLeft: 0,
      scrollWidth: 300,
      clientWidth: 200,
      children: [{}, {}] as unknown[],
      toggleAttribute(name: string, force?: boolean) {
        if (force) attrs.add(name);
        else attrs.delete(name);
        return !!force;
      },
      addEventListener() {},
      removeEventListener() {},
    };
  };

  it("follows the row's children: more chips turn the cue on, fewer turn it off", () => {
    resizes.length = 0;
    mutations.length = 0;
    const el = makeEl();
    el.scrollWidth = 200;
    const stop = watchScrollRow(el, FakeResize as never, FakeMutation as never);
    expect(el.attrs.has("data-more-end")).toBe(false);
    expect(mutations[0]?.options).toEqual({ childList: true });

    // A soft navigation adds a chip: the row now overflows, and the new child is observed.
    el.children = [{}, {}, {}];
    el.scrollWidth = 320;
    mutations[0].cb();
    expect(el.attrs.has("data-more-end")).toBe(true);
    expect(resizes[0].observed).toHaveLength(4); // the row and its three children

    // Chips removed again: nothing left to see, the cue goes.
    el.children = [{}];
    el.scrollWidth = 200;
    mutations[0].cb();
    expect(el.attrs.has("data-more-end")).toBe(false);
    expect(resizes[0].observed).toHaveLength(2);

    stop();
    expect(resizes[0].disconnected).toBe(true);
    expect(mutations[0].disconnected).toBe(true);
  });

  it("works without either observer", () => {
    const el = makeEl();
    watchScrollRow(el)();
    expect(el.attrs.has("data-more-end")).toBe(true);
  });
  it("draws its own bar while the row overflows, the thumb the share on screen at the scroll's place, and hides the browser's", () => {
    const el = makeEl(); // 300 wide, 200 on screen
    const props = new Map<string, string>();
    const barAttrs = new Set<string>();
    const bar = {
      toggleAttribute(name: string, force?: boolean) {
        if (force) barAttrs.add(name);
        else barAttrs.delete(name);
        return !!force;
      },
      style: { setProperty: (name: string, value: string) => void props.set(name, value) },
    };
    const stop = watchScrollRow(el, undefined, undefined, bar);
    expect(barAttrs.has("data-shown")).toBe(true);
    expect(el.attrs.has("data-drawn-bar")).toBe(true);
    expect(props.get("--scroll-thumb-size")).toBe("66.67%");
    expect(props.get("--scroll-thumb-pos")).toBe("0.00%");
    // Scrolled to the end: the thumb sits at the track's end.
    el.scrollLeft = 100;
    stop();
    watchScrollRow(el, undefined, undefined, bar);
    expect(props.get("--scroll-thumb-pos")).toBe("33.33%");
    // Everything fits: no bar, and the browser's own comes back.
    el.scrollWidth = 200;
    el.scrollLeft = 0;
    watchScrollRow(el, undefined, undefined, bar);
    expect(barAttrs.has("data-shown")).toBe(false);
    expect(el.attrs.has("data-drawn-bar")).toBe(false);
    // Hidden until shown; the thumb from the two variables; the theme's colours, no literal.
    expect(SCROLL_BAR_SX.display).toBe("none");
    expect(SCROLL_BAR_SX["&[data-shown]"]).toEqual({ display: "block" });
    expect(SCROLL_BAR_SX["& > span"].width).toBe("var(--scroll-thumb-size, 100%)");
    expect(SCROLL_ROW_SX["&[data-drawn-bar]"].scrollbarWidth).toBe("none");
  });
});
