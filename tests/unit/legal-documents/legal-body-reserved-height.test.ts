import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LegalBodyEditor from "@/modules/legal-documents/ui/LegalBodyEditor";

/**
 * BR-REQ-053-02 — the legal document editor's writing area has its size from the first paint, so
 * nothing under it moves when Tiptap mounts (§369; the defect §362's addendum fixed in the pages'
 * editor, `content/rich-text-reserved-height.test.ts`).
 *
 * Tiptap builds its editor in the browser only, after hydration. Until then the legal editor's
 * writing area was an empty `div`, zero pixels tall, and the moment the editor mounted the English
 * box and "Salvează" under it moved down by the whole text — the declaration runs to thousands of
 * pixels. The stand-in is therefore the text itself, drawn with the editor's own box and rules.
 *
 * The render here is the server's, which is the first paint.
 */
const catalogue = JSON.parse(readFileSync(path.join(process.cwd(), "messages/ro.json"), "utf8")) as {
  Admin: { legal: { editor: Record<string, string> } };
};
const LABELS = catalogue.Admin.legal.editor as ComponentProps<typeof LegalBodyEditor>["labels"];

const TEXT = [
  "## Declarație pe propria răspundere",
  "Subsemnatul {{participant}} declar că [am citit regulamentul](https://example.org/regulament).",
  "Strada Exemplu 1\nBrașov",
  "![Harta traseului](https://example.org/harta.png)",
  "## Riscuri",
  "Îmi asum responsabilitatea.",
].join("\n\n");

function render(initialText: string): string {
  return renderToStaticMarkup(
    createElement(LegalBodyEditor, {
      name: "roBody",
      initialText,
      label: "Textul documentului",
      accessibleSuffix: "RO",
      help: "Ajutor.",
      labels: LABELS,
    }),
  );
}

/** The stand-in element, whole: `<div … data-testid="legal-body-reserved">…</div>`, with its opening tag's attributes. */
function standIn(html: string): { attributes: string; inner: string } | null {
  const match = html.match(/<div([^>]*data-testid="legal-body-reserved"[^>]*)>([\s\S]*?)<\/div>/);
  return match ? { attributes: match[1], inner: match[2] } : null;
}

/** One declaration of a CSS rule body, e.g. `min-height` out of `min-height:280px;padding-left:8px;`. */
function declaration(rule: string, property: string): string | undefined {
  return rule.match(new RegExp(`(?:^|;)${property}:([^;]+)`))?.[1];
}

/** The rule Emotion wrote for a selector, wherever in the render its `<style>` stands. */
function ruleOf(html: string, selector: string): string {
  const escaped = selector.replace(/[-.]/g, (character) => `\\${character}`);
  return html.match(new RegExp(`${escaped}\\{([^}]*)\\}`))?.[1] ?? "";
}

/** The writing area's rule, keyed under its container: `.css-… .tiptap{…}` (and `.tiptap p{…}` for a nested one). */
function tiptapRule(html: string, nested = ""): string {
  const escaped = nested ? ` ${nested}` : "";
  return html.match(new RegExp(`\\.css-[\\w-]+ \\.tiptap${escaped}\\{([^}]*)\\}`))?.[1] ?? "";
}

const BOX = ["min-height", "padding-left", "padding-right", "padding-top", "padding-bottom"];

describe("BR-REQ-053-02 the legal editor's writing area is as tall before Tiptap mounts as after", () => {
  it("stands a box in for the writing area in the first paint, hidden from a screen reader, with nothing to focus or press", () => {
    for (const text of ["", TEXT]) {
      const found = standIn(render(text));
      expect(found, "the stand-in is in the server's HTML").not.toBeNull();
      expect(found?.attributes).toContain('aria-hidden="true"');
      expect(found?.inner).not.toMatch(/<button|<input|tabindex|contenteditable|href=/);
      // Never mistaken for the editor: the e2e specs and the page's own rules find the editor by `.tiptap`.
      expect(found?.attributes).not.toMatch(/\btiptap\b|ProseMirror/);
    }
  });

  it("gives the stand-in exactly the writing area's minimum height and padding", () => {
    const html = render("");
    const className = standIn(html)?.attributes.match(/class="[^"]*\b(css-[\w-]+)"/)?.[1] ?? "";
    expect(className).not.toBe("");
    const own = ruleOf(html, `.${className}`);
    const writingArea = tiptapRule(html);
    expect(writingArea, "the writing area's own rule is in the render").not.toBe("");
    expect(declaration(own, "min-height")).toBe("280px");
    for (const property of BOX) {
      expect(declaration(own, property), property).toBeDefined();
      expect(declaration(own, property), property).toBe(declaration(writingArea, property));
    }
  });

  it("draws the stored text in it with the writing area's own rules, so it is as tall as the text", () => {
    const html = render(TEXT);
    const found = standIn(html);
    const className = found?.attributes.match(/class="[^"]*\b(css-[\w-]+)"/)?.[1] ?? "";
    // The headings, the paragraphs, a link's words with no address, the author's line break and the picture.
    expect(found?.inner).toContain("<h2>Declarație pe propria răspundere</h2>");
    expect(found?.inner).toContain("<h2>Riscuri</h2>");
    expect(found?.inner).toContain("<p>Subsemnatul {{participant}} declar că <a>am citit regulamentul</a>.</p>");
    expect(found?.inner).toContain("<p>Strada Exemplu 1<br/>Brașov</p>");
    expect(found?.inner).toContain('<img src="https://example.org/harta.png" alt="Harta traseului"/>');
    expect(found?.inner).toContain("<p>Îmi asum responsabilitatea.</p>");
    // Each kind of thing is drawn by the same declarations the editor's own are.
    for (const element of ["p", "h2", "a", "img"]) {
      const editorRule = tiptapRule(html, element);
      expect(editorRule, element).not.toBe("");
      expect(ruleOf(html, `.${className} ${element}`), element).toBe(editorRule);
    }
  });

  it("keeps an empty document one line, as ProseMirror does", () => {
    expect(standIn(render(""))?.inner).toBe("<p><br/></p>");
  });

  it("still posts the text it was handed, whether or not the editor ever mounts", () => {
    expect(render(TEXT)).toMatch(/<input type="hidden"[^>]* name="roBody" value="## Declarație pe propria răspundere/);
  });
});
