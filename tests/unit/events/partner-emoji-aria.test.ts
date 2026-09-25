import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `PartnerEmoji`'s `aria-hidden` default, matching `SvgIcon`'s own: hidden from assistive
 * technology unless the caller names it with `aria-label` or `role` — the gap the review found,
 * where `GlyphChip` drew the emoji with nothing set and a screen reader read "handshake" ahead
 * of the chip's own label.
 */
vi.mock("@mui/material/Tooltip", async () => {
  const react = await import("react");
  return {
    default: ({ title, children }: { title: React.ReactNode; children: React.ReactElement }) =>
      react.createElement("span", { "data-tooltip": "" }, react.createElement("span", { "data-tooltip-title": "" }, title), children),
  };
});

const { default: PartnerEmoji } = await import("@/modules/events/ui/PartnerEmoji");
const { default: PartnerMark } = await import("@/modules/events/ui/PartnerMark");
const { default: GlyphChip } = await import("@/modules/events/ui/GlyphChip");

describe("PartnerEmoji — aria-hidden defaults like SvgIcon", () => {
  it("is aria-hidden by default, with no aria-label or role", () => {
    const html = renderToStaticMarkup(createElement(PartnerEmoji));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain('role="img"');
  });

  it("is not hidden once the caller gives it an aria-label", () => {
    const html = renderToStaticMarkup(createElement(PartnerEmoji, { "aria-label": "Colaborare" }));
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).toContain('aria-label="Colaborare"');
  });

  it("is not hidden once the caller gives it a role", () => {
    const html = renderToStaticMarkup(createElement(PartnerEmoji, { role: "img" }));
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).toContain('role="img"');
  });

  it("still honours an explicit aria-hidden from the caller, either way", () => {
    const shown = renderToStaticMarkup(createElement(PartnerEmoji, { "aria-hidden": false }));
    expect(shown).toContain('aria-hidden="false"');
    const hidden = renderToStaticMarkup(createElement(PartnerEmoji, { "aria-label": "x", "aria-hidden": true }));
    expect(hidden).toContain('aria-hidden="true"');
  });

  it("draws hidden inside GlyphChip, which names no aria-label or role of its own", () => {
    const html = renderToStaticMarkup(createElement(GlyphChip, { glyph: "partner", label: "Colaborare" }));
    expect(html).toContain('aria-hidden="true"');
  });

  it("is exposed by PartnerMark, which sets its own label", () => {
    const html = renderToStaticMarkup(createElement(PartnerMark, { text: "Colaborare" }));
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('aria-label="Colaborare"');
    expect(html).toContain('role="img"');
  });
});

describe("PartnerEmoji — gray ink (§379)", () => {
  it("carries a grayscale filter on the emoji span, one value in light and another under [data-dark]", () => {
    const html = renderToStaticMarkup(createElement(PartnerEmoji));
    expect(html).toContain('data-testid="PartnerEmoji"');
    expect(html).toMatch(/filter:grayscale\(1\) brightness\(0\.55\)/);
    expect(html).toMatch(/\[data-dark\] \.css-\S+\{[^}]*filter:grayscale\(1\) brightness\(1\.55\)/);
  });
});
