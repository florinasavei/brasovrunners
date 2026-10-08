/**
 * What «Copiază» does, apart from React (§552, §674): the clipboard when the browser lends it, and
 * otherwise the text selected in its box, so a long-press or Ctrl+C takes it from there.
 *
 * The clipboard API is missing on a page served over plain HTTP, in an old browser and in a webview
 * that refuses it, and it rejects when the page has no focus or the permission is denied. Either
 * way the press still does something a person can see: the box's text is selected whole.
 */
export type CopyOutcome = "copied" | "selected" | "none";

/** The one thing the fallback needs of the box: an `<input>` (or anything with its `select`). */
export type SelectableBox = { focus: () => void; select: () => void; setSelectionRange?: (start: number, end: number) => void; value?: string };

export async function copyText(
  text: string,
  box: SelectableBox | null,
  clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<CopyOutcome> {
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // Refused: the selection below, as if there were no clipboard.
    }
  }
  if (!box) return "none";
  box.focus();
  box.select();
  // iOS Safari ignores select() on a read-only input; the range call selects it there.
  if (box.setSelectionRange && typeof box.value === "string") box.setSelectionRange(0, box.value.length);
  return "selected";
}
