import { expect, type Locator } from "@playwright/test";

/**
 * A text editor's floating bar — over a selection, over a table (`RichTextEditor`, §273, §274) —
 * by the attribute its `Paper` wears. On the `Paper` and not on Tiptap's `BubbleMenu`, because
 * nothing passed to `BubbleMenu` beyond the plugin's own props reaches a production build (§NNN).
 * Scoped to one editor, since each language's editor has bars of its own.
 */
export function floatingBar(editor: Locator, kind: "selection" | "table"): Locator {
  return editor.locator(`[data-floating-bar="${kind}"]`);
}

/**
 * Every button on a floating bar shows its glyph (§NNN; the owner, 2026-09-24, of the bar over a
 * selection: "I can't see these buttons in the rich text editor" — three empty buttons).
 *
 * The glyph is drawn (a box of its own), in a colour that is neither nothing nor the bar's own
 * surface, and — the one that failed — **nothing is painted over it**: the point at its centre
 * belongs to its own button. §361 lifted the bars above the editor's sticky toolbar through
 * `BubbleMenu`'s `style`, which only `next dev` kept; in the built page the toolbar sat on top of
 * the bar, and only the bottoms of its buttons showed under it. A bounding box and a colour were
 * right all along — the hit test is what sees the toolbar.
 */
export async function expectBarGlyphsVisible(bar: Locator) {
  await expect(bar).toBeVisible();
  const faces = await bar.evaluate((paper) => {
    const surface = getComputedStyle(paper).backgroundColor;
    return [...paper.querySelectorAll("button")].map((button) => {
      const label = button.getAttribute("aria-label") ?? "";
      const glyph = button.querySelector("svg");
      if (!glyph) return { label, glyph: false, width: 0, height: 0, fill: "", surface, visibility: "", opacity: "", onTop: false };
      const box = glyph.getBoundingClientRect();
      const style = getComputedStyle(glyph);
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        label,
        glyph: true,
        width: box.width,
        height: box.height,
        fill: style.fill,
        surface,
        visibility: style.visibility,
        opacity: style.opacity,
        onTop: hit !== null && button.contains(hit),
      };
    });
  });
  expect(faces.length).toBeGreaterThan(0);
  for (const face of faces) {
    expect(face.glyph, face.label).toBe(true);
    expect(face.width, face.label).toBeGreaterThan(0);
    expect(face.height, face.label).toBeGreaterThan(0);
    expect(face.visibility, face.label).toBe("visible");
    expect(Number(face.opacity), face.label).toBeGreaterThan(0);
    expect(face.fill, face.label).not.toMatch(/^(none|transparent|rgba\(\d+, \d+, \d+, 0\))$/);
    expect(face.fill, face.label).not.toBe(face.surface);
    expect(face.onTop, `${face.label}: something is drawn over the glyph`).toBe(true);
  }
}
