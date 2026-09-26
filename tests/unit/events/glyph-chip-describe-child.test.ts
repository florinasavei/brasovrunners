import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlyphChip from "@/modules/events/ui/GlyphChip";

/**
 * Found by re-review (`DECISIONS.md` §NNN): the night pill's tooltip and its `srSuffix` are the
 * same sentence — "Soarele apune la 16:42" — so `describeChild`'s `aria-describedby`, wired while
 * the tooltip is open, made a screen reader hear it twice: once as part of the chip's own name
 * (`srSuffix`) and once again as the tooltip's description. `GlyphChip` now leaves `describeChild`
 * off exactly when the two strings match, and only then — every other chip's tooltip keeps
 * describing it as before.
 */

function render(props: Parameters<typeof GlyphChip>[0]): string {
  return renderToStaticMarkup(createElement(GlyphChip, props));
}

describe("GlyphChip drops the redundant description when srSuffix repeats the tooltip", () => {
  it("carries no aria-label and no aria-describedby when the two sentences match — the chip's own name (with the suffix) is the only place the sentence sits", () => {
    const html = render({ glyph: "night", label: "Noapte", tooltip: "Soarele apune la 16:42", srSuffix: "Soarele apune la 16:42" });
    // The word itself, and the hidden suffix, both still reach a screen reader through the chip's
    // own accessible name.
    expect(html).toContain(">Noapte<");
    expect(html).toContain("Soarele apune la 16:42");
    // MUI's `describeChild={false}` sets `aria-label` to the tooltip whenever it is a plain
    // string, which would silently replace "Noapte" with the sunset sentence — the very bug this
    // fix must not reintroduce.
    expect(html).not.toContain('aria-label="Soarele apune la 16:42"');
    expect(html).not.toContain("aria-describedby");
  });

  it("keeps describing the chip when the tooltip says something the suffix does not (or there is no suffix)", () => {
    // The external-organizer cost pill: a tooltip of its own, no `srSuffix` — unrelated to this
    // fix, and its own `aria-label` fallback (MUI's `describeChild={true}` default) never applies.
    const html = render({ glyph: "cost:PAID", label: "Cu taxă", tooltip: "Plata la organizator" });
    expect(html).toContain(">Cu taxă<");
    // `describeChild` stayed on: MUI still sets the native, pre-hydration `title` attribute this
    // path relies on, which only exists when the tooltip's `title` is a plain string.
    expect(html).toContain('title="Plata la organizator"');
  });
});
