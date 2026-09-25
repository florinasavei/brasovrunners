import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BOXED_DISCLOSURE_SX, DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * `DECISIONS.md` §269 and its follow-up — every fold in the backoffice is a box, drawn by one
 * object.
 *
 * The owner, looking at the bib-design panel and the event editor: "toate aceste acordeoane din
 * zona de backoffice trebuie sa fie mai 'boxed'". The folds had been styled in nine places by
 * hand — some with a border, some without, one at 36 pixels, one with no marker — so the same
 * gesture looked different on every screen. `BOXED_DISCLOSURE_SX` is the one look, and this
 * test is what keeps a screen from growing its own `"& > summary": { cursor: "pointer" }` again.
 *
 * Half of it is a source assertion, because a `<details>` is a Server Component with nothing to
 * call: the thing being pinned is which object each fold spreads, and that is exactly what
 * drifts on the next screen somebody adds.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

/** Every `.tsx` under a directory, recursively, as repository-relative paths. */
const tsxUnder = (relative: string): string[] =>
  readdirSync(path.join(ROOT, relative), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));

/** The backoffice: the admin routes and the modules that render only there. */
const BACKOFFICE = [
  ...tsxUnder("src/app/[locale]/admin"),
  ...tsxUnder("src/modules/content/events/ui"),
  ...tsxUnder("src/modules/notifications/ui"),
  ...tsxUnder("src/modules/contact/ui"),
  "src/modules/content/rich-text/ui/LazyRichTextEditor.tsx",
  "src/modules/registrations/ui/DeskRow.tsx",
  "src/shared/ui/Panel.tsx",
];

/** Public pages and the components that render on them: not in scope, and they must not change. */
const PUBLIC = [
  ...tsxUnder("src/app/[locale]/events"),
  ...tsxUnder("src/modules/events/ui"),
  "src/modules/registrations/ui/RegistrationSteps.tsx",
  "src/modules/content/rich-text/ui/RichTextVideo.tsx",
  "src/shared/ui/SiteFooter.tsx",
];

const count = (source: string, needle: RegExp) => (source.match(needle) ?? []).length;

describe("§269 the backoffice fold is a box", () => {
  const summary = BOXED_DISCLOSURE_SX["& > summary"];
  const openSummary = BOXED_DISCLOSURE_SX["&[open] > summary"];

  it("draws a hairline box in theme tokens, with the surface behind it", () => {
    expect(BOXED_DISCLOSURE_SX.border).toBe(1);
    expect(BOXED_DISCLOSURE_SX.borderColor).toBe("divider");
    expect(BOXED_DISCLOSURE_SX.borderRadius).toBe(1);
    expect(BOXED_DISCLOSURE_SX.bgcolor).toBe("background.paper");
    // Horizontal padding on the box: the body's text never touches the border.
    expect(BOXED_DISCLOSURE_SX.px).toBeGreaterThan(0);
  });

  it("keeps the summary a control: marker, pointer, 44 pixels, and a wash behind it", () => {
    // Everything §164 asked for, still there — the box is added, not traded for the marker.
    // The marker is drawn by the summary itself since §325: a flex row with the arrow on the
    // heading's line, the browser's own marker hidden (a block heading used to drop under it).
    expect(summary.display).toBe("flex");
    expect(summary.alignItems).toBe("center");
    expect(summary.listStyle).toBe("none");
    expect(summary["&::-webkit-details-marker"]).toEqual({ display: "none" });
    expect(summary["&::before"]).toMatchObject({ content: '""', borderColor: "transparent transparent transparent currentColor" });
    expect(summary.cursor).toBe("pointer");
    expect(summary.minHeight).toBe(TAP_TARGET.minHeight);
    expect(summary.minHeight).toBeGreaterThanOrEqual(44);
    expect(summary["&:hover"]).toEqual({ textDecoration: "underline" });
    expect(summary["&:focus-visible"]).toEqual({ textDecoration: "underline" });
    // The bar: a theme token, so the dark scheme follows without a second rule.
    expect(summary.bgcolor).toBe("action.hover");
    // The wash reaches the border: the summary undoes exactly the padding the box added, and
    // pads itself back, so the text and the body's text line up.
    expect(summary.mx).toBe(-BOXED_DISCLOSURE_SX.px);
    expect(summary.px).toBe(BOXED_DISCLOSURE_SX.px);
    // The arrow turns a quarter when the fold is open, from the <details> itself.
    expect((BOXED_DISCLOSURE_SX as Record<string, unknown>)["&[open] > summary::before"]).toEqual({ transform: "rotate(90deg)" });
  });

  it("keeps the box when open: square shoulders, a rule under the summary, room for the body", () => {
    expect(openSummary.borderBottomLeftRadius).toBe(0);
    expect(openSummary.borderBottomRightRadius).toBe(0);
    expect(openSummary.borderBottom).toBe(1);
    expect(openSummary.borderColor).toBe("divider");
    expect(openSummary.mb).toBeGreaterThan(0);
    expect(BOXED_DISCLOSURE_SX["&[open]"].pb).toBeGreaterThan(0);
    // And a closed fold is exactly its summary: no bottom padding waits under it.
    expect("pb" in BOXED_DISCLOSURE_SX).toBe(false);
    expect("py" in BOXED_DISCLOSURE_SX).toBe(false);
  });

  it("names no colour of its own — hex lives in brand.ts and nowhere else", () => {
    expect(JSON.stringify(BOXED_DISCLOSURE_SX)).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(read("src/shared/ui/disclosure.ts")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("leaves the public fold as it was: no border, the same summary", () => {
    // The public fold has no box — and turns its drawn arrow when open, like every fold (§325).
    expect(DISCLOSURE_SX).toEqual({ "& > summary": DISCLOSURE_SUMMARY_SX, "&[open] > summary::before": { transform: "rotate(90deg)" } });
    expect("border" in DISCLOSURE_SX).toBe(false);
    expect("bgcolor" in DISCLOSURE_SUMMARY_SX).toBe(false);
  });
});

/**
 * A fold is a `<details>` a screen draws itself, or `RecallDetails` (`shared/forms/recall.tsx`,
 * §315): the same element inside a kept form, which opens itself after a refusal and takes its
 * look from the screen's `sx` — so the screen is where the shared object has to be spread.
 */
const FOLD = /component="details"|<RecallDetails\b/;

describe("§269 every fold in the backoffice spreads the one object", () => {
  const folds = BACKOFFICE.filter((file) => FOLD.test(read(file)));

  it("finds the folds it is about", () => {
    // The event editor's long texts, the bib design, the SEO fields, the series scope, the
    // repeat help, the type help; the registrations screen's batch verbs and the erase panel;
    // the guide; the desk's how-to and its bib picture; the tasks' steps; the series dates on
    // the events list; and `Panel` itself. The email previews were a fold the page drew by hand
    // until §336 made them `Panel`s inside a `Panel` — they are counted as `Panel` now.
    // Since the editor's boxes (§350) every box and card of the event editor — the bib design
    // among them — is a `Panel`, counted as `Panel`; the series scope's two folds are its own.
    expect(folds.length).toBeGreaterThanOrEqual(10);
    expect(folds).toContain("src/shared/ui/Panel.tsx");
    expect(folds).toContain("src/modules/content/rich-text/ui/LazyRichTextEditor.tsx");
    expect(folds).toContain("src/modules/content/events/ui/SeriesScope.tsx");
    expect(read("src/modules/content/events/ui/BibDesignPanel.tsx")).toContain("<Panel collapsible level={4}");
    // The card of messages draws no fold of its own: every card in it is `Panel`.
    expect(read("src/modules/notifications/ui/ParticipantEmailsPanel.tsx")).not.toMatch(FOLD);
  });

  /**
   * `Panel`'s `help` variant (§NNN; the owner, on "Ce înseamnă fiecare tip?": "ar trebui să fie
   * un card mai mic") is a deliberate second kind of fold — a small clickable line, no card, no
   * border, so it never spreads `BOXED_DISCLOSURE_SX`. One `component="details"` in `Panel.tsx`
   * is this variant's, counted here rather than folded into the boxed-fold rule the rest of the
   * file still keeps.
   */
  const UNBOXED_FOLDS: Record<string, number> = { "src/shared/ui/Panel.tsx": 1 };

  for (const file of folds) {
    it(`${file} draws every <details> with BOXED_DISCLOSURE_SX and none by hand`, () => {
      const source = read(file);
      expect(source, "imports the shared object").toMatch(/import \{[^}]*\bBOXED_DISCLOSURE_SX\b[^}]*\} from "(@\/shared\/ui\/disclosure|\.\/disclosure)"/);
      // One spread per boxed fold: the count of `component="details"` equals the count of the
      // object reaching an `sx`, minus this file's own deliberately unboxed folds (above) — a
      // spread into one, or handed over whole. Comments and the import do not count, and a fold
      // styled by hand shows up here as one use too few.
      const details = count(source, new RegExp(FOLD.source, "g")) - (UNBOXED_FOLDS[file] ?? 0);
      const uses = count(source, /(?:\.\.\.|sx=\{)BOXED_DISCLOSURE_SX\b/g);
      expect(uses, `${details} boxed fold(s), ${uses} spread(s)`).toBe(details);
      // No fold writes its own summary rule any more: pointer, height and marker come from
      // the object, and a one-off here is how the screens came to disagree.
      expect(source).not.toMatch(/"& > summary": \{ cursor/);
      expect(source).not.toMatch(/"& > summary": \{ \.\.\.DISCLOSURE_SUMMARY_SX/);
      // The public object is not the backoffice one.
      expect(source).not.toMatch(/\bDISCLOSURE_SX\b/);
    });
  }

  it("keeps the deliberate colours: erase is red and the batch cancel amber, on the same box", () => {
    const detail = read("src/app/[locale]/admin/registrations/[id]/page.tsx");
    expect(detail).toMatch(/\.\.\.BOXED_DISCLOSURE_SX,[^}]*borderColor: "error\.light"/);
    const list = read("src/app/[locale]/admin/registrations/(list)/page.tsx");
    expect(list).toMatch(/\.\.\.BOXED_DISCLOSURE_SX,[^}]*borderColor: "warning\.light"/);
  });

  it("changes nothing on a public page", () => {
    for (const file of PUBLIC) {
      expect(read(file), file).not.toMatch(/\bBOXED_DISCLOSURE_SX\b/);
    }
  });
});

/**
 * §350 — the event editor's boxes: cards within cards, named properly (the owner), so `Panel`
 * takes a heading level, a tone, a badge and a frame that never folds. Rendered the way the
 * server sends it.
 */
describe("§350 Panel's levels, tones, badge and static frame", () => {
  const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  const panel = (props: Record<string, unknown>) =>
    markup(renderToStaticMarkup(createElement(Panel, { title: "Numere de concurs (BIB)", ...props } as unknown as ComponentProps<typeof Panel>, "corpul")));

  it("puts an h2, h3 or h4 inside the summary, so the heading list has the shape of the screen", () => {
    expect(panel({ collapsible: true })).toMatch(/<summary[^>]*><h2/);
    expect(panel({ collapsible: true, level: 3 })).toMatch(/<summary[^>]*><h3/);
    expect(panel({ collapsible: true, level: 4 })).toMatch(/<summary[^>]*><h4/);
  });

  it("draws the badge as a chip beside the title, readable while the fold is shut", () => {
    const html = panel({ collapsible: true, badge: "23 înscriși" });
    expect(html).toContain("23 înscriși");
    expect(html).toMatch(/MuiChip/);
  });

  it("renders a static box as a section with a heading and no toggle at all", () => {
    const html = panel({ collapsible: true, static: true });
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).toMatch(/<section[^>]*>[\s\S]*<h2/);
  });

  it("colours a risk box amber and a danger box red, in theme tokens, on the same box", () => {
    const source = read("src/shared/ui/Panel.tsx");
    expect(source).toMatch(/tone === "risk"\) return \{ borderColor: "warning\.main"/);
    expect(source).toMatch(/tone === "danger"\) return \{ borderColor: "error\.main"/);
    // A risk box and a plain one render different classes: the tone reaches the frame.
    expect(panel({ collapsible: true, tone: "risk" })).not.toBe(panel({ collapsible: true }));
  });

  it("pads a nested card a step narrower on a phone, so three levels still fit at 320 pixels", () => {
    const source = read("src/shared/ui/Panel.tsx");
    expect(source).toContain("const NESTED_PADDING = { xs: 1.5, sm: 2 } as const;");
    expect(source).toContain('mx: { xs: -1.5, sm: -2 }');
  });
});
