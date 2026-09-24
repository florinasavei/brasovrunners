import type { EditorState } from "@tiptap/pm/state";

/**
 * What the rich-text editor's island is drawn from (§371): the document, the selection and the
 * marks the next letter will carry. The toolbar's pressed buttons, the picture's panel and the
 * table's bar all read one of the three; nothing it draws reads whether the box has focus.
 *
 * ProseMirror's state is immutable, and a transaction that changes none of the three keeps the
 * very same objects — a focus, a blur, a plugin's own bookkeeping — so comparing them by identity
 * says whether the island has anything new to draw, in constant time, however long the text.
 */
export type EditorLook = { doc: unknown; selection: unknown; marks: unknown } | null;

/** The three parts of `state` the island draws, or `null` before the editor exists. */
export function editorLook(state: EditorState | null | undefined): EditorLook {
  return state ? { doc: state.doc, selection: state.selection, marks: state.storedMarks } : null;
}

/** Whether two looks draw the same island: the same three objects, or both absent. */
export function sameEditorLook(next: EditorLook, previous: EditorLook | null): boolean {
  if (next === previous) return true;
  if (next === null || previous === null) return false;
  return next.doc === previous.doc && next.selection === previous.selection && next.marks === previous.marks;
}
