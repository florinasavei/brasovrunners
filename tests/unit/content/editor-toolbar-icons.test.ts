import { readFileSync } from "node:fs";
import path from "node:path";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import TableRowsIcon from "@mui/icons-material/TableRows";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import LegalBodyEditor from "@/modules/legal-documents/ui/LegalBodyEditor";
import ToolbarButton, { TOOLBAR_GLYPH_PX } from "@/shared/ui/ToolbarButton";

/**
 * BR-REQ-050-03 criterion 17 and BR-REQ-053-02 criterion 23 (§361) — every button on the two
 * text editors' toolbars wears a Material glyph, one size and one colour, with its full name as
 * its accessible name and its tooltip. The owner, of `/admin/legal`'s "🖼": "I hate this image
 * icon!"
 *
 * The toolbars are rendered as the server renders them, which is what a first paint shows. The
 * two floating bars — over a selection, over a table — only exist once Tiptap has a DOM, which
 * this suite (Node, no jsdom) has not; their buttons are read from the source instead, where each
 * is one `<ToolbarButton … />` element.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const catalogue = JSON.parse(read("messages/ro.json")) as {
  Admin: { richText: Record<string, string>; legal: { editor: Record<string, string> } };
};

const RICH_TEXT = "src/modules/content/rich-text/ui/RichTextEditor.tsx";
const LEGAL = "src/modules/legal-documents/ui/LegalBodyEditor.tsx";

/**
 * What the toolbars drew before §361. A character is whatever the reader's font makes of it: an
 * emoji is a tiny grey picture, a broken box on one machine, and an arrow or a box-drawing
 * character reads as noise.
 */
const OLD_GLYPHS = ["¶", "🔗", "🖼", "↶", "↷", "•—", "❝", "⊞", "+↓", "+→", "−↓", "−→", "↕", "▦", "▩", "▤", "▢", "⊟"];
/** The letters that were a whole button's face, and are glyphs now. */
const OLD_LETTERS = ["B", "I", "H", "1."];
/** The faces that stay words: a heading level is read faster as its name than as a picture. */
const WORD_FACES = ["H2", "H3", "Text"];

/** The catalogue's words for a namespace, through the same function the forms call. */
const rt = Object.assign((key: string) => catalogue.Admin.richText[key], {
  raw: (key: string) => catalogue.Admin.richText[key],
});
const RICH_LABELS = richTextEditorLabels(rt as unknown as Parameters<typeof richTextEditorLabels>[0]);
/** The legal form hands the editor its `editor.*` words one by one; they are the same keys. */
const LEGAL_LABELS = catalogue.Admin.legal.editor as ComponentProps<typeof LegalBodyEditor>["labels"];

type RenderedButton = { attributes: string; label: string; inner: string; face: string };

/** Every `<button>` in a server render, with its accessible name and what a reader sees on it. */
function buttons(html: string): RenderedButton[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => {
    const attributes = match[1];
    const inner = match[2];
    const face = inner
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    return { attributes, label: attributes.match(/aria-label="([^"]*)"/)?.[1] ?? "", inner, face };
  });
}

function renderRichText(features?: { media?: boolean; tables?: boolean }) {
  return renderToStaticMarkup(
    createElement(RichTextEditor, {
      name: "translations.ro.body",
      initialBody: null,
      label: "Text",
      accessibleSuffix: "Română",
      labels: RICH_LABELS,
      ...(features ? { features } : {}),
    }),
  );
}

function renderLegal() {
  return renderToStaticMarkup(
    createElement(LegalBodyEditor, {
      name: "roBody",
      initialText: "## Secțiunea 1\n\nUn paragraf.",
      label: "Textul documentului",
      accessibleSuffix: "RO",
      help: "Ajutor.",
      labels: LEGAL_LABELS,
    }),
  );
}

/**
 * The CSS rule behind a glyph's class. Emotion writes a class's `<style>` once, beside the first
 * element that wears it, so the rule is looked up in the whole render rather than in the button.
 */
function ruleOf(html: string, className: string): string {
  const escaped = className.replace(/[-]/g, "\\-");
  return html.match(new RegExp(`\\.${escaped}\\{([^}]*)\\}`))?.[1] ?? "";
}

/** The assertions every toolbar button answers, whichever editor it is on. */
function expectGlyphFaces(rendered: RenderedButton[], html: string) {
  expect(rendered.length).toBeGreaterThan(0);
  const glyphClasses = new Set<string>();
  for (const button of rendered) {
    // Named, and by its full name rather than by a character somebody has to decode.
    expect(button.label, button.attributes).not.toBe("");
    // The tooltip carries the name now; a native `title` beside it would show a second one.
    expect(button.attributes, button.label).not.toMatch(/\btitle=/);
    expect(OLD_GLYPHS, button.label).not.toContain(button.face);
    expect(OLD_LETTERS, button.label).not.toContain(button.face);
    if (WORD_FACES.includes(button.face)) {
      expect(button.inner, button.label).not.toContain("<svg");
    } else {
      // A glyph and nothing else: no word beside it, and decoration to a screen reader, which
      // hears the button's name instead.
      expect(button.face, button.label).toBe("");
      expect(button.inner, button.label).toMatch(/<svg\b[^>]*aria-hidden="true"/);
      const glyphClass = button.inner.match(/<svg class="[^"]*\b(css-[\w-]+)"/)?.[1];
      expect(glyphClass, button.label).toBeDefined();
      glyphClasses.add(glyphClass as string);
    }
  }
  // One size and one colour for every glyph: they all wear the same class, and that class draws
  // them at the toolbar's size in the button's own colour.
  expect([...glyphClasses]).toHaveLength(1);
  const rule = ruleOf(html, [...glyphClasses][0]);
  expect(rule).toContain(`font-size:${TOOLBAR_GLYPH_PX}px`);
  expect(rule).not.toMatch(/(^|;)color:/);
}

describe("§361 the pages' editor wears Material glyphs", () => {
  it("draws every toolbar button as a glyph, except the two heading levels", () => {
    const html = renderRichText();
    const rendered = buttons(html);
    // Bold, italic, H2, H3, two lists, quote, three alignments, table, link, picture, gallery,
    // film, undo, redo, preview.
    expect(rendered.map((button) => button.label)).toEqual([
      RICH_LABELS.bold,
      RICH_LABELS.italic,
      RICH_LABELS.heading2,
      RICH_LABELS.heading3,
      RICH_LABELS.bulletList,
      RICH_LABELS.orderedList,
      RICH_LABELS.quote,
      RICH_LABELS.align.left,
      RICH_LABELS.align.center,
      RICH_LABELS.align.right,
      RICH_LABELS.table,
      RICH_LABELS.link,
      RICH_LABELS.image,
      RICH_LABELS.imageFromGallery,
      RICH_LABELS.youtube,
      RICH_LABELS.undo,
      RICH_LABELS.redo,
      RICH_LABELS.preview,
    ]);
    expectGlyphFaces(rendered, html);
    expect(rendered.filter((button) => WORD_FACES.includes(button.face)).map((button) => button.face)).toEqual(["H2", "H3"]);
    // The three media buttons were words ("Imagine", "Din galerie", "YouTube") and are glyphs.
    for (const word of [RICH_LABELS.imageShort, RICH_LABELS.imageFromGalleryShort, RICH_LABELS.youtubeShort]) {
      expect(rendered.map((button) => button.face)).not.toContain(word);
    }
  });

  it("keeps the email body's shorter toolbar the same way (§270)", () => {
    const html = renderRichText({ media: false, tables: false });
    const rendered = buttons(html);
    expect(rendered).toHaveLength(14);
    expectGlyphFaces(rendered, html);
  });

  it("builds the two floating bars from the same button, every one a glyph", () => {
    const source = read(RICH_TEXT);
    const elements = [...source.matchAll(/<ToolbarButton\b([\s\S]*?)\/>/g)].map((match) => match[1]);
    // Sixteen on the toolbar (the three alignments are one element in a loop), ten on the
    // table's bar, three over a selection.
    expect(elements).toHaveLength(29);
    for (const props of elements) {
      const text = props.match(/\btext="([^"]*)"/)?.[1];
      if (text !== undefined) expect(["H2", "H3"], props).toContain(text);
      else expect(props, props).toMatch(/\bicon=\{\w+(\[\w+\])?\}/);
    }
    // The four table verbs: the rows or the columns, with a plus or a minus in the corner.
    expect(source.match(/\bmark="add"/g)).toHaveLength(2);
    expect(source.match(/\bmark="remove"/g)).toHaveLength(2);
    // Nothing else draws a button any more.
    expect(source).not.toMatch(/function Control\b|<Control\b/);
  });

  it("lifts both floating bars above the sticky toolbar, on the Paper it renders (§363)", () => {
    // The table's bar sat under the toolbar's `zIndex: 2` whenever the table was at the top of
    // the body, and every table verb with it (§361); the bar over a selection on the first lines
    // showed the bottoms of three empty buttons (§363). The order is on each bar's own `Paper`.
    const source = read(RICH_TEXT);
    expect(source).toContain('const FLOATING_BAR_SX = { position: "relative", zIndex: 3 } as const;');
    const papers = [...source.matchAll(/<BubbleMenu\b[\s\S]*?<\/BubbleMenu>/g)].map(
      (menu) => menu[0].match(/<Paper\b[^>]*>/)?.[0] ?? "",
    );
    expect(papers).toHaveLength(2);
    for (const paper of papers) expect(paper).toContain("...FLOATING_BAR_SX");
    expect(papers.map((paper) => paper.match(/data-floating-bar="(\w+)"/)?.[1])).toEqual(["table", "selection"]);
  });

  it("gives BubbleMenu only the plugin's own props — the rest never reaches a production build (§363)", () => {
    // Tiptap 3.31 copies `style`, `data-*` and `aria-*` onto the bar through a helper the
    // production minifier deletes as dead code: `style={{ zIndex: 3 }}` worked under `next dev`
    // and was nowhere in the built page. Whatever a bar needs goes on what it renders instead.
    const PLUGIN_PROPS = ["editor", "pluginKey", "shouldShow", "options", "updateDelay", "resizeDelay", "appendTo", "getReferencedVirtualElement"];
    const opening = [...read(RICH_TEXT).matchAll(/<BubbleMenu\b([^>]*)>/g)].map((match) => match[1]);
    expect(opening).toHaveLength(2);
    for (const props of opening) {
      const names = [...props.matchAll(/([\w-]+)=/g)].map((match) => match[1]);
      expect(names.length, props).toBeGreaterThan(0);
      for (const name of names) expect(PLUGIN_PROPS, props).toContain(name);
    }
  });
});

describe("§361 the legal documents' editor wears Material glyphs", () => {
  it("draws the link, the picture, undo and redo as glyphs, and the heading and the paragraph as words", () => {
    const html = renderLegal();
    const rendered = buttons(html);
    expect(rendered.map((button) => button.label)).toEqual([
      LEGAL_LABELS.heading,
      LEGAL_LABELS.paragraph,
      LEGAL_LABELS.link,
      LEGAL_LABELS.image,
      LEGAL_LABELS.undo,
      LEGAL_LABELS.redo,
    ]);
    expectGlyphFaces(rendered, html);
    expect(rendered.map((button) => button.face)).toEqual(["H2", "Text", "", "", "", ""]);
  });

  it("is a named toolbar, like the pages' editor", () => {
    expect(renderLegal()).toContain('role="toolbar" aria-label="Textul documentului — RO"');
  });

  it("has a word for the paragraph button in both languages", () => {
    const english = JSON.parse(read("messages/en.json")) as typeof catalogue;
    expect(catalogue.Admin.legal.editor.paragraphShort).toBe("Text");
    expect(english.Admin.legal.editor.paragraphShort).toBe("Text");
  });
});

describe("§361 one button, one family of glyphs", () => {
  it("wraps every button in a non-interactive tooltip that says its name", () => {
    // Non-interactive, so a tooltip over the next button in a wrapped row never takes its click.
    expect(read("src/shared/ui/ToolbarButton.tsx")).toMatch(/<Tooltip title=\{label\} disableInteractive>/);
  });

  it("draws a glyph with its badge, pressed or not, at the one size", () => {
    const plain = renderToStaticMarkup(
      createElement(ToolbarButton, { label: "Îngroșat", icon: FormatBoldIcon, active: true, onClick: () => {} }),
    );
    expect(plain).toContain('aria-label="Îngroșat"');
    expect(plain).toContain('aria-pressed="true"');
    expect(plain.match(/<svg\b/g)).toHaveLength(1);

    const badged = renderToStaticMarkup(
      createElement(ToolbarButton, { label: "Adaugă un rând", icon: TableRowsIcon, mark: "add", active: false, onClick: () => {} }),
    );
    expect(badged).toContain('aria-pressed="false"');
    expect(badged.match(/<svg\b/g)).toHaveLength(2);
    expect(badged).toContain('data-mark="add"');
  });

  it("imports one file per glyph, from the default family, and never the barrel", () => {
    for (const file of [RICH_TEXT, LEGAL, "src/shared/ui/ToolbarButton.tsx"]) {
      const source = read(file);
      const glyphs = [...source.matchAll(/from "(@mui\/icons-material[^"]*)"/g)].map((match) => match[1]);
      expect(glyphs.length, file).toBeGreaterThan(0);
      for (const from of glyphs) {
        expect(from, file).toMatch(/^@mui\/icons-material\/[A-Z]\w+$/);
        // One family: the filled glyphs the rest of the backoffice wears (§318).
        expect(from, file).not.toMatch(/(Outlined|Rounded|Sharp|TwoTone)$/);
      }
    }
  });

  it("leaves none of the old characters in either editor's code", () => {
    for (const file of [RICH_TEXT, LEGAL]) {
      // Comments may still say what the buttons used to be; the code may not draw it.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const glyph of OLD_GLYPHS) expect(code, `${file}: ${glyph}`).not.toContain(glyph);
    }
  });
});
