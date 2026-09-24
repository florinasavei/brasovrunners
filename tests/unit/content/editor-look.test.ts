import { readFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { editorLook, sameEditorLook } from "@/modules/content/rich-text/ui/editor-look";

/**
 * BR-REQ-041-01 (§371) — the rich-text editor's island re-renders on what it draws, not on every
 * transaction. Leaving the box to press "Salvează" is a blur, and Tiptap answers a blur (and a
 * focus) with a transaction that changes nothing on screen; re-rendering the toolbar for it was a
 * tenth of a second inside the press on a phone (`tests/e2e/perf/inp.spec.ts`).
 *
 * Real ProseMirror states, from a two-node schema with one mark: a blur keeps the look, and each of
 * the three things the island is drawn from — the text, the caret, the mark the next letter takes
 * — changes it.
 */
const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
  marks: { bold: {} },
});

function start(): EditorState {
  return EditorState.create({ schema, doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Ne vedem la start")])]) });
}

describe("BR-REQ-041-01 the rich-text island's look (§371)", () => {
  it("is the same after a blur and after a focus: the transactions Tiptap sends for them change nothing drawn", () => {
    const state = start();
    const blurred = state.apply(state.tr.setMeta("blur", { event: null }).setMeta("addToHistory", false));
    const focused = blurred.apply(blurred.tr.setMeta("focus", { event: null }).setMeta("addToHistory", false));
    expect(blurred).not.toBe(state);
    expect(sameEditorLook(editorLook(blurred), editorLook(state))).toBe(true);
    expect(sameEditorLook(editorLook(focused), editorLook(state))).toBe(true);
  });

  it("changes with the text, the caret and the mark the next letter takes", () => {
    const state = start();
    const typed = state.apply(state.tr.insertText("!", 18));
    expect(sameEditorLook(editorLook(typed), editorLook(state))).toBe(false);

    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(sameEditorLook(editorLook(moved), editorLook(state))).toBe(false);

    const bold = state.apply(state.tr.addStoredMark(schema.marks.bold.create()));
    expect(sameEditorLook(editorLook(bold), editorLook(state))).toBe(false);
  });

  it("is nothing before the editor exists, and the first editor is a change", () => {
    expect(editorLook(null)).toBeNull();
    expect(sameEditorLook(null, null)).toBe(true);
    expect(sameEditorLook(editorLook(start()), null)).toBe(false);
  });

  it("is what the island subscribes with — and it no longer re-renders on every transaction", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/content/rich-text/ui/RichTextEditor.tsx"), "utf8");
    expect(source).toContain("shouldRerenderOnTransaction: false");
    expect(source).toMatch(/useEditorState\(\{ editor, selector: \(\{ editor: current \}\) => editorLook\(current\?\.state\), equalityFn: sameEditorLook \}\)/);
  });
});
