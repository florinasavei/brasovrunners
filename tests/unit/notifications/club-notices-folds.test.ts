import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §NNN — «Copiile clubului» on «Setări» → «Emailuri» is three nested folds under
 * one form and one Save (the owner, 2026-09-29: «și aici trebuie să fie mai multe acordeoane
 * nested»): the signed declarations, the confirmation notice, the club's copy of the emails to
 * participants — each closed with a glyph and a summary line, open for the card's save, a
 * refusal or (the declarations) idle copies.
 */
const panel = readFileSync(path.join(process.cwd(), "src/modules/notifications/ui/ClubNoticesPanel.tsx"), "utf8");
const folds = (catalogue: typeof ro) => catalogue.Admin.emails.clubNotices.folds;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("§NNN the club's copies as three nested folds", () => {
  it("draws three level-3 folds, each with a glyph, a summary and its own test id, in the page's order", () => {
    const ids = ["club-notices-declarations", "club-notices-confirmations", "club-notices-participants"];
    const at = ids.map((id) => panel.indexOf(`data-testid="${id}"`));
    for (const [index, position] of at.entries()) expect(position, ids[index]).toBeGreaterThan(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(panel.match(/level=\{3\}/g)).toHaveLength(3);
    for (const glyph of ["declaration", "confirmation", "copy"]) expect(panel).toContain(`<Panel glyph="${glyph}"`);
    // Every box sits in the fold it is about, before the next fold starts.
    const box = (name: string) => panel.indexOf(`name="${name}"`);
    expect(box("declarationsTo")).toBeGreaterThan(at[0]!);
    expect(box("declarationsBcc")).toBeLessThan(panel.indexOf("const confirmationsFold"));
    expect(box("confirmationsTo")).toBeGreaterThan(panel.indexOf("const confirmationsFold"));
    expect(box("confirmationsTo")).toBeLessThan(panel.indexOf("const participantsFold"));
    expect(box("participantsBcc")).toBeGreaterThan(panel.indexOf("const participantsFold"));
  });

  it("keeps one form and one Save under the folds", () => {
    expect(panel.match(/<ActionForm/g)).toHaveLength(1);
    expect(panel.match(/<GlyphSubmitButton/g)).toHaveLength(1);
    const form = panel.slice(panel.indexOf("<ActionForm"));
    expect(form.indexOf("{participantsFold}")).toBeLessThan(form.indexOf("<GlyphSubmitButton"));
  });

  it("opens a fold for the card's save and a refusal, the declarations one for idle copies too", () => {
    expect(panel).toContain("openWhen={{ saved, refused, attention: idleDeclarationCopies }}");
    expect(panel.match(/openWhen=\{\{ saved, refused \}\}/g)).toHaveLength(2);
  });

  it("says each fold's title and summary in both languages, with the same placeholders", () => {
    for (const catalogue of [ro, en]) {
      const words = folds(catalogue);
      for (const text of [
        words.count,
        words.countNone,
        words.declarations.title,
        words.declarations.aside,
        words.declarations.asideNoCopies,
        words.declarations.asideNone,
        words.confirmations.title,
        words.participants.title,
      ]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text.length).toBeLessThanOrEqual(200);
      }
    }
    expect(placeholders(folds(ro).declarations.aside)).toEqual(placeholders(folds(en).declarations.aside));
    expect(placeholders(folds(ro).declarations.asideNoCopies)).toEqual(["to"]);
    expect(placeholders(folds(ro).count)).toEqual(placeholders(folds(en).count));
    expect(folds(ro).declarations.title).toBe("Declarațiile semnate");
    expect(folds(ro).confirmations.title).toBe("Anunțul de confirmare");
    expect(folds(ro).participants.title).toBe("Copia clubului la emailurile către participanți");
  });
});
