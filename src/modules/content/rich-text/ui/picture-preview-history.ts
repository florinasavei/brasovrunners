/**
 * The browser history behind a description picture's large preview (§NNN, `PictureLightbox`).
 *
 * The preview is a layer over the page, not a page, so a phone's Back gesture must close it
 * rather than leave the event. Opening pushes one entry with the page's own address; Back pops it
 * and the page hears `popstate` on an entry that is no longer the preview's, which is the signal
 * to close. Closing by the ✕, Escape or a tap removes that entry again (`history.back()`), so the
 * preview never leaves a dead step in the history behind it.
 *
 * The pushed state is the current one with a flag added, never a bare object: the App Router keeps
 * its own fields in `history.state`, and an entry without them is one it reloads the page on when
 * the reader comes Forward onto it.
 *
 * No React and no DOM here — only the slice of `History` it touches — so the rules are tested in
 * Node (`tests/unit/content/picture-lightbox.test.ts`) without a browser environment.
 */

export const PREVIEW_STATE_KEY = "brPicturePreview";

export type PreviewHistory = Pick<History, "state" | "pushState" | "back">;

/** Whether a history state is the one an open preview pushed. */
export function isPreviewEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[PREVIEW_STATE_KEY] === true;
}

/** On open: one entry on top of the page's own, same address, the router's fields kept. */
export function pushPreviewEntry(history: PreviewHistory): void {
  if (isPreviewEntry(history.state)) return;
  const current = typeof history.state === "object" && history.state !== null ? history.state : {};
  history.pushState({ ...current, [PREVIEW_STATE_KEY]: true }, "");
}

/**
 * On a close the reader asked for in the preview itself (✕, Escape, a tap): take the entry back
 * off, but only while it is still on top — after a Back gesture it already is gone, and a second
 * `back()` would leave the page.
 */
export function leavePreviewEntry(history: PreviewHistory): boolean {
  if (!isPreviewEntry(history.state)) return false;
  history.back();
  return true;
}

/** The `popstate` listener while the preview is open: closes it once its entry is gone. */
export function previewPopListener(history: PreviewHistory, close: () => void): () => void {
  return () => {
    if (!isPreviewEntry(history.state)) close();
  };
}
