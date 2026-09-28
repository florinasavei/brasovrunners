import type { EditorState } from "@tiptap/pm/state";

/**
 * What the editor's island draws from (§371): the document, the selection and the stored marks.
 * ProseMirror state is immutable and a transaction that changes none of them keeps the same
 * objects, so identity comparison says in constant time whether anything needs redrawing.
 */
export type EditorLook = { doc: unknown; selection: unknown; marks: unknown } | null;

/** The three parts of `state` the island draws, or `null` before the editor exists. */
export function editorLook(state: EditorState | null | undefined): EditorLook {
  return state ? { doc: state.doc, selection: state.selection, marks: state.storedMarks } : null;
}

export function sameEditorLook(next: EditorLook, previous: EditorLook | null): boolean {
  if (next === previous) return true;
  if (next === null || previous === null) return false;
  return next.doc === previous.doc && next.selection === previous.selection && next.marks === previous.marks;
}
