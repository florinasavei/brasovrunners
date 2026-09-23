import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOXED_DISCLOSURE_SX, DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";
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
    expect(summary.listStyle).toBe("revert");
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
    // With the marker inside its own box, or the negative margin would put it outside the border.
    expect(summary.listStylePosition).toBe("inside");
    // Never `display: flex`: Chrome and Safari drop the marker when it is.
    expect("display" in summary).toBe(false);
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
    expect(DISCLOSURE_SX).toEqual({ "& > summary": DISCLOSURE_SUMMARY_SX });
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
    // the email previews; the guide; the desk's how-to and its bib picture; the tasks' steps;
    // the series dates on the events list; and `Panel` itself.
    expect(folds.length).toBeGreaterThanOrEqual(15);
    expect(folds).toContain("src/shared/ui/Panel.tsx");
    expect(folds).toContain("src/modules/content/rich-text/ui/LazyRichTextEditor.tsx");
    expect(folds).toContain("src/modules/content/events/ui/BibDesignPanel.tsx");
  });

  for (const file of folds) {
    it(`${file} draws every <details> with BOXED_DISCLOSURE_SX and none by hand`, () => {
      const source = read(file);
      expect(source, "imports the shared object").toMatch(/import \{[^}]*\bBOXED_DISCLOSURE_SX\b[^}]*\} from "(@\/shared\/ui\/disclosure|\.\/disclosure)"/);
      // One spread per fold: the count of `component="details"` equals the count of the object
      // reaching an `sx` — spread into one, or handed over whole. Comments and the import do
      // not count, and a fold styled by hand shows up here as one use too few.
      const details = count(source, new RegExp(FOLD.source, "g"));
      const uses = count(source, /(?:\.\.\.|sx=\{)BOXED_DISCLOSURE_SX\b/g);
      expect(uses, `${details} fold(s), ${uses} spread(s)`).toBe(details);
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
