import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlyphChip from "@/modules/events/ui/GlyphChip";

/**
 * Found by re-review (`DECISIONS.md` §394): MUI's `sx` runs `width`, `height` and `margin`
 * through its spacing transform, which turns a number in `(0, 1]` into a *percentage* rather
 * than treating it as a raw pixel value — `width: 1` became `width:100%`, not `width:1px`, so
 * the chip's screen-reader-only suffix span was sized like ordinary content, a full chip wide
 * and tall, rather than clipped to a single, invisible pixel.
 */

/** One declaration of a CSS rule body, e.g. `width` out of `width:1px;height:1px;`. */
function declaration(rule: string, property: string): string | undefined {
  return rule.match(new RegExp(`(?:^|;)${property}:([^;]+)`))?.[1];
}

/** The rule Emotion wrote for a class, wherever in the render its `<style>` stands. */
function ruleOf(html: string, className: string): string {
  return html.match(new RegExp(`\\.${className.replace(/-/g, "\\-")}\\{([^}]*)\\}`))?.[1] ?? "";
}

function render(): string {
  return renderToStaticMarkup(
    createElement(GlyphChip, {
      glyph: "cost:PAID",
      label: "Cu taxă",
      srSuffix: "banii merg la organizator, nu la club",
    }),
  );
}

describe("GlyphChip's screen-reader-only suffix is clipped to a pixel, not sized to a percentage", () => {
  const html = render();

  it("renders the suffix span, hidden from sighted visitors but present in the markup", () => {
    expect(html).toContain("banii merg la organizator, nu la club");
  });

  it("gives the suffix span pixel width, height and margin — never MUI's spacing-scale percentage", () => {
    // The suffix span, MUI's `Box` as a `<span>`: its own class among the ones MUI adds.
    const match = html.match(/<span class="MuiBox-root (css-[\w-]+)"> — banii merg la organizator, nu la club<\/span>/);
    expect(match, "the suffix span is in the render").not.toBeNull();
    const rule = ruleOf(html, match![1]);
    expect(rule, "the span's own rule is in the render").not.toBe("");
    expect(declaration(rule, "width")).toBe("1px");
    expect(declaration(rule, "height")).toBe("1px");
    expect(declaration(rule, "margin")).toBe("-1px");
    // The bug this guards against: MUI's sizingTransform turning `1` into `100%`.
    expect(declaration(rule, "width")).not.toBe("100%");
    expect(declaration(rule, "height")).not.toBe("100%");
  });
});
