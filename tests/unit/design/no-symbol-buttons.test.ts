import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-060-01 (the backoffice's verbs); `DECISIONS.md` §NNN — a button says what it does in
 * words. The owner, 2026-10-11, of the arrow on a card in «Echipa»: «Nu înțeleg ce face butonul ăsta
 * cu săgeata, are nevoie de vreun tooltip». A bare «↓» is a symbol the reader must interpret, a
 * phone has no hover to explain it, and a tooltip alone would leave the button itself mute: the
 * words are on the button, the glyph before them is the registry's, the tooltip says what changes.
 *
 * What this refuses, in every source file under `src/`: a `label` or `pendingLabel` that is a
 * string literal with no letter in it («↑», «×», «+»), and a native button or MUI `Button` whose
 * only content is such a symbol. A label that is a translated key is not a literal and is the
 * catalogue's business: `tests/unit/i18n` holds every key to both languages.
 */
const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/** A literal that says nothing in words: at least one character, none of them a letter or a digit. */
const SYMBOL_ONLY = String.raw`[^\p{L}\p{N}"{}<>]{1,3}`;
const LABEL_LITERAL = new RegExp(String.raw`\b(?:label|pendingLabel)="(${SYMBOL_ONLY})"`, "u");
const BUTTON_CONTENT = new RegExp(String.raw`<(?:Button|button|IconButton)\b[^>]*>\s*(${SYMBOL_ONLY})\s*</`, "u");

function symbolOnlyButtons(source: string): string[] {
  const found: string[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const label = LABEL_LITERAL.exec(line);
    if (label) found.push(`${index + 1}: ${label[0]}`);
  });
  // Buttons whose content is on the next line: look at the tag and what follows it as one string.
  const flat = source.replace(/\r\n/g, "\n");
  for (const match of flat.matchAll(new RegExp(BUTTON_CONTENT.source, "gu"))) found.push(`button content «${match[1]}»`);
  return found;
}

describe("a button says what it does in words (§NNN)", () => {
  it("no source file writes a symbol-only label or a symbol-only button", () => {
    const offenders = sourceFiles(path.join(ROOT, "src")).flatMap((file) => {
      const found = symbolOnlyButtons(readFileSync(file, "utf8"));
      return found.map((what) => `${path.relative(ROOT, file).replace(/\\/g, "/")} ${what}`);
    });
    expect(offenders).toEqual([]);
  });

  it("the tripwire itself sees an arrow, a cross and a plus, and lets words through", () => {
    expect(symbolOnlyButtons('<SubmitButton label="↓" pendingLabel="↓" />')).not.toEqual([]);
    expect(symbolOnlyButtons('<SubmitButton label="×" pendingLabel="Se salvează…" />')).not.toEqual([]);
    expect(symbolOnlyButtons('<Button type="submit">\n  ↑\n</Button>')).not.toEqual([]);
    expect(symbolOnlyButtons('<Button>+</Button>')).not.toEqual([]);
    expect(symbolOnlyButtons('<SubmitButton label={t("team.moveUpWord")} pendingLabel="Salvează…" />')).toEqual([]);
    expect(symbolOnlyButtons("<Button>Mai sus</Button>")).toEqual([]);
  });

  it("the moves wear a glyph, words and a tooltip: the team card, the boxes, the FAQ, the codes, the shop, the list", () => {
    const sites = [
      "src/app/[locale]/admin/pages/team/page.tsx",
      "src/app/[locale]/admin/pages/team/BoxesCard.tsx",
      "src/app/[locale]/admin/pages/faq/page.tsx",
      "src/app/[locale]/admin/pages/members/CodesCard.tsx",
      "src/modules/club-todo/ui/ClubTodoPanel.tsx",
      "src/modules/content/shop/ui/ProductList.tsx",
      "src/modules/content/shop/ui/ProductPicturesCard.tsx",
    ];
    for (const site of sites) {
      const source = readFileSync(path.join(ROOT, site), "utf8");
      for (const icon of ["moveUp", "moveDown"]) {
        const tag = new RegExp(String.raw`<GlyphSubmitButton icon="${icon}"[^>]*>`).exec(source)?.[0] ?? "";
        expect(tag, `${site} ${icon}`).toContain("tooltip={t(");
        expect(tag, `${site} ${icon}`).toContain(`${icon}Word`);
      }
    }
  });
});
