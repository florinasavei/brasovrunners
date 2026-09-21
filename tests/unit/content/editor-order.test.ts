import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §260 — the language panel of the event editor, in the order somebody writes in
 * and with every long text behind a fold.
 *
 * The owner asked for both in one breath: "partea de rezumat si descoere completa trebuie sa gie
 * in acordeoane colapsabile" and "si prima oara vad rezumat, apoi descriere full, asta e flow-ul
 * logic". §170 had put the description first and the summary under it, on the reasoning that the
 * description is what the writer came for — the cost was a panel two screens tall with two
 * Tiptap instances mounted before anybody typed anything, and a required field below the fold.
 *
 * This is a source assertion because there is nothing to call: the panel is a Server Component
 * that renders whatever it is handed, and the thing being pinned is the order and the shape of
 * the five editors on it, which is exactly the kind of thing that drifts back on the next change.
 */
const SOURCE = readFileSync(
  path.join(process.cwd(), "src/modules/content/events/ui/TranslationFieldsForm.tsx"),
  "utf8",
);

const at = (field: string) => {
  const index = SOURCE.indexOf(`name={name("${field}")}`);
  expect(index, `${field} is not on the panel at all`).toBeGreaterThan(-1);
  return index;
};

describe("§260 the event editor's language panel", () => {
  it("asks for the title, then the summary, then the full description", () => {
    // The visitor's order: the card, the hero and every share carry the summary, and the
    // description is what somebody reads after deciding to look.
    expect(at("title")).toBeLessThan(at("excerptBody"));
    expect(at("excerptBody")).toBeLessThan(at("body"));
  });

  it("keeps the rules and the programme after the description, as they were", () => {
    expect(at("body")).toBeLessThan(at("rules"));
    expect(at("rules")).toBeLessThan(at("schedule"));
    // "What to bring" and the folded search-engine fields stay last.
    expect(at("schedule")).toBeLessThan(at("checklist"));
    expect(at("checklist")).toBeLessThan(SOURCE.indexOf("editor.seoSection"));
  });

  it("mounts no rich-text editor until its fold is opened", () => {
    // Five editors a language, ten on the page. `LazyRichTextEditor` posts the stored document
    // from a hidden field until it is opened, so a save that never opened a section never
    // changes it — which is also why the eager component must not come back by accident.
    expect(SOURCE).not.toMatch(/<RichTextEditor\b/);
    expect(SOURCE).not.toMatch(/from "@\/modules\/content\/rich-text\/ui\/RichTextEditor"/);
    expect(SOURCE.match(/<LazyRichTextEditor\b/g)).toHaveLength(4);
  });

  it("says on the summary's fold that it is required before publication", () => {
    // What §170 was protecting: an empty `excerpt` is what refuses publication
    // (`REQUIRED_PUBLIC_TRANSLATION_FIELDS`), and a fold can hide that it is empty. The hint on
    // the closed fold is the answer, so the organizer is told before the save, not by it.
    const hint = SOURCE.indexOf(`emptyHint={t("editor.excerptEmpty")}`);
    expect(hint).toBeGreaterThan(-1);
    expect(hint).toBeGreaterThan(at("excerptBody"));
    expect(hint).toBeLessThan(at("body"));
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const messages = JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8"));
      expect(messages.Admin.editor.excerptEmpty, `${file}`).toBeTruthy();
      expect(messages.Admin.editor.bodyEmpty, `${file}`).toBeTruthy();
    }
  });
});
