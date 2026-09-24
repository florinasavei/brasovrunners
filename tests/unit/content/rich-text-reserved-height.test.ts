import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";

/**
 * BR-REQ-050-03, BR-REQ-080-01 — the rich-text editor's writing area has its height from the
 * first paint, so nothing under it moves when Tiptap mounts (found by CI on BR-V1.80, §362's
 * batch).
 *
 * Tiptap builds its editor in the browser only, after hydration. Until then the writing area was
 * an empty `div`: on `/admin/emails` the buttons under each message's editor stood 272 pixels
 * higher than they would a moment later, and a press in that moment landed on the gap and did
 * nothing — `email-copy-fields.spec.ts` pressed "Înlocuiește cu câmpurile" into it, and no request
 * left the page.
 *
 * The render here is the server's, which is the first paint: what stands in for the writing area
 * there must be as tall as the writing area Tiptap puts in its place.
 */
const catalogue = JSON.parse(readFileSync(path.join(process.cwd(), "messages/ro.json"), "utf8")) as {
  Admin: { richText: Record<string, string> };
};
const rt = Object.assign((key: string) => catalogue.Admin.richText[key], {
  raw: (key: string) => catalogue.Admin.richText[key],
});
const LABELS = richTextEditorLabels(rt as unknown as Parameters<typeof richTextEditorLabels>[0]);

function render(): string {
  return renderToStaticMarkup(
    createElement(RichTextEditor, {
      name: "body",
      initialBody: null,
      label: "Paragrafe",
      accessibleSuffix: "Română",
      labels: LABELS,
      features: { media: false, tables: false },
    }),
  );
}

/** One declaration of a CSS rule body, e.g. `min-height` out of `min-height:240px;padding:16px;`. */
function declaration(rule: string, property: string): string | undefined {
  return rule.match(new RegExp(`(?:^|;)${property}:([^;]+)`))?.[1];
}

/** The rule Emotion wrote for a class, wherever in the render its `<style>` stands. */
function ruleOf(html: string, className: string): string {
  return html.match(new RegExp(`\\.${className.replace(/-/g, "\\-")}\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("BR-REQ-050-03 the writing area is as tall before Tiptap mounts as after", () => {
  const html = render();
  const reserved = html.match(/<div([^>]*)data-testid="rich-text-reserved"([^>]*)><\/div>/);

  it("stands an empty box in for the writing area in the first paint, hidden from a screen reader", () => {
    expect(reserved, "the stand-in is in the server's HTML").not.toBeNull();
    expect(`${reserved?.[1]}${reserved?.[2]}`).toContain('aria-hidden="true"');
    // Nothing a reader could land on: no text, no focusable element inside it.
    expect(reserved?.[0]).not.toMatch(/tabindex|contenteditable/);
  });

  it("gives the stand-in exactly the writing area's minimum height and padding", () => {
    const className = `${reserved?.[1]}${reserved?.[2]}`.match(/class="[^"]*\b(css-[\w-]+)"/)?.[1] ?? "";
    const standIn = ruleOf(html, className);
    // The writing area's rule, keyed under its container: `.css-… .tiptap{…}`.
    const writingArea = html.match(/\.tiptap\{([^}]*)\}/)?.[1] ?? "";
    expect(writingArea, "the writing area's own rule is in the render").not.toBe("");
    expect(declaration(standIn, "min-height")).toBe("240px");
    expect(declaration(standIn, "min-height")).toBe(declaration(writingArea, "min-height"));
    expect(declaration(standIn, "padding")).toBeDefined();
    expect(declaration(standIn, "padding")).toBe(declaration(writingArea, "padding"));
  });
});
