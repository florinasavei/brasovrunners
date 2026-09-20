import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPTION_GLYPH_SX,
  OPTION_LABEL_SX,
  OPTION_ROW_SX,
  SELECT_WITH_GLYPHS_SX,
} from "@/shared/ui/select-option";

/**
 * BR-REQ-050-02 criterion 21 — the answers for sex carry a glyph and every country its flag
 * (`DECISIONS.md` §171), and the chosen one is readable where it is actually read: in the
 * closed field.
 *
 * The owner saw "acest inputuri sunt super descentrate". The cause is a MUI mechanism rather
 * than a stray margin: `SelectInput` renders the closed value by reusing the matching
 * `MenuItem`'s **children** (`displaySingle = child.props.children`) inside `.MuiSelect-select`
 * — the item's own `sx` never travels with them. A row declared only on the item is therefore
 * laid out only in the popup, and in the field the glyph falls back to sitting on the text's
 * baseline (and a flag, which is `display: block`, takes a line of its own).
 *
 * So the row is declared twice, and these are the assertions that keep the two halves the same
 * row — and that keep the second half from being forgotten the next time a select gets marks.
 */
const SOURCE_ROOT = path.join(process.cwd(), "src");

describe("BR-REQ-050-02 an option's glyph is laid out in the menu and in the closed field", () => {
  it("lays the row out as a centred flex row with a gap", () => {
    expect(OPTION_ROW_SX.display).toBe("flex");
    expect(OPTION_ROW_SX.alignItems).toBe("center");
    expect(OPTION_ROW_SX.gap).toBe(1);
  });

  it("gives the closed field the very same row", () => {
    // Not a copy: the same object, so the popup and the field cannot drift apart.
    expect(SELECT_WITH_GLYPHS_SX["& .MuiSelect-select"]).toBe(OPTION_ROW_SX);
  });

  it("addresses the closed field by the slot class MUI puts on it", () => {
    // `.MuiSelect-select` is the div that holds the reused children. A descendant selector is
    // one class more specific than the styles MUI puts on the element itself.
    expect(Object.keys(SELECT_WITH_GLYPHS_SX)).toEqual(["& .MuiSelect-select"]);
  });

  it("keeps the input's own line box, so a select with marks is as tall as one without", () => {
    // `.MuiSelect-select` has `min-height: 1.4375em` and the outlined input's padding is drawn
    // around exactly that. A taller line box moves the value off the field's centre, which is
    // the complaint this test exists for.
    expect(OPTION_ROW_SX.lineHeight).toBe("1.4375em");
  });

  it("gives the mark a fixed box, so every label starts at the same x", () => {
    // A flag is 20×15 and an icon 20×20; without a box of its own the labels of two hundred
    // countries would each start wherever their flag ended.
    expect(OPTION_GLYPH_SX.width).toBe(20);
    expect(OPTION_GLYPH_SX.height).toBe(20);
    expect(OPTION_GLYPH_SX.flex).toBe("0 0 auto");
    expect(OPTION_GLYPH_SX.display).toBe("inline-flex");
    expect(OPTION_GLYPH_SX.alignItems).toBe("center");
    expect(OPTION_GLYPH_SX.justifyContent).toBe("center");
  });

  it("puts the ellipsis on the words, which a flex container cannot do for its items", () => {
    // `.MuiSelect-select` truncates with `text-overflow`; that stops working the moment the
    // box becomes a flex container, so the label carries the truncation itself.
    expect(OPTION_LABEL_SX.overflow).toBe("hidden");
    expect(OPTION_LABEL_SX.textOverflow).toBe("ellipsis");
    expect(OPTION_LABEL_SX.whiteSpace).toBe("nowrap");
    expect(OPTION_LABEL_SX.minWidth).toBe(0);
  });

  it("styles the closed field wherever it styles the menu row", () => {
    // The regression this fix is: the row was laid out on the `MenuItem` alone. Any file that
    // lays out an option must also hand the closed field the same row, or the next select
    // with marks starts off-centre exactly like these two did.
    const files = sourceFiles(SOURCE_ROOT).filter((file) =>
      readFileSync(file, "utf8").includes("OPTION_ROW_SX"),
    );

    // The styles themselves, and the one page that uses them.
    expect(files.length).toBeGreaterThanOrEqual(2);

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(`ui${path.sep}select-option.ts`)) continue;
      expect(
        text.includes("SELECT_WITH_GLYPHS_SX"),
        `${path.relative(process.cwd(), file)} lays out the menu row but not the closed field`,
      ).toBe(true);
    }
  });
});

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}
