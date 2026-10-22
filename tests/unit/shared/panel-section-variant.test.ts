import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Panel from "@/shared/ui/Panel";

/**
 * The editor's two shapes for a part inside a card (the owner, 2026-10-21, of the backoffice: «not
 * consistent at all»; `Panel`'s doc and `EventEditorLayout`'s say the rule). A part a person may skip
 * is a fold at the next level; a part the event needs is `Panel variant="section"` at the next level —
 * its glyph and its heading, then its boxes, no fold and no frame. Neither a bold caption over a
 * divider nor a bordered box drawn by hand is a third shape.
 */
const markup = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

describe("Panel's section variant: a part the event needs", () => {
  it("is an open <section> named by its heading, at the level asked, with the glyph before the words", () => {
    const html = markup(
      renderToStaticMarkup(createElement(Panel, { variant: "section", glyph: "place", level: 3, id: "box-place", title: "Locul" }, createElement("input", { name: "x" }))),
    );
    expect(html.startsWith("<section")).toBe(true);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).toMatch(/<section[^>]*id="box-place"[^>]*aria-labelledby="box-place-heading"/);
    expect(html).toMatch(/<h3[^>]*id="box-place-heading"[^>]*>[\s\S]*?data-testid="PlaceIcon"[\s\S]*?Locul<\/h3>/);
    expect(html).toContain('name="x"');
  });

  it("takes the heading of the level it is at, as a fold there does", () => {
    for (const [level, tag] of [[3, "h3"], [4, "h4"], [5, "h5"]] as const) {
      const section = markup(renderToStaticMarkup(createElement(Panel, { variant: "section", glyph: "print", level, title: "T" }, "x")));
      const fold = markup(renderToStaticMarkup(createElement(Panel, { glyph: "print", collapsible: true, level, title: "T" }, "x")));
      expect(section).toContain(`<${tag}`);
      expect(fold).toContain(`<${tag}`);
    }
  });

  it("keeps its intro under the heading and its aside on the heading's line", () => {
    const html = markup(renderToStaticMarkup(createElement(Panel, { variant: "section", glyph: "print", level: 5, title: "Tipărește", aside: "12", intro: "De la / Până la" }, "x")));
    expect(html).toMatch(/<h5[^>]*>[\s\S]*Tipărește[\s\S]*12[\s\S]*<\/h5>/);
    expect(html.indexOf("De la / Până la")).toBeGreaterThan(html.indexOf("</h5>"));
  });
});

describe("the event editor's cards draw no third shape", () => {
  const dir = "src/modules/content/events/ui";
  // The three lists of row folds (wave 2) and the two cards with shapes of their own are not this rule's.
  const OWN = new Set(["LinkRowsEditor.tsx", "CoHostRowsEditor.tsx", "ScheduleRowsEditor.tsx", "CheckpointsCard.tsx"]);
  const files = [...readdirSync(dir).map((name) => join(dir, name)), ...readdirSync(join(dir, "boxes")).map((name) => join(dir, "boxes", name))]
    .filter((file) => file.endsWith(".tsx") && !OWN.has(basename(file)));

  it("finds the boxes it is about", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain(join(dir, "boxes", "WhenBox.tsx"));
  });

  it("has no hand-drawn part heading and no static boxed card inside a card", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // A caption that heads a part: `Typography … component="h3|h4|h5"` with a subtitle's type.
      expect(text, file).not.toMatch(/variant="subtitle[12]"\s+component="h[3-6]"|component="h[3-6]"\s+variant="subtitle[12]"/);
      // A boxed static card at level 3 or deeper: a part is a fold or a section, never a frame.
      expect(text, file).not.toMatch(/<Panel\b[^>]*\blevel=\{[345]\}[^>]*\bstatic\b|<Panel\b[^>]*\bstatic\b[^>]*\blevel=\{[345]\}/);
    }
  });

  it("draws «Data și ora» and «Locul» as open sections, the time zone as a fold", () => {
    const when = readFileSync(join(dir, "boxes", "WhenBox.tsx"), "utf8");
    expect(when).toMatch(/<Panel variant="section" glyph="when" level=\{3\} id="box-when-date"/);
    expect(when).toMatch(/<Panel variant="section" glyph="place" level=\{3\} id="box-place"/);
    expect(when).toMatch(/<Panel glyph="timezone" collapsible level=\{3\} id="box-timezone"/);
  });
});
