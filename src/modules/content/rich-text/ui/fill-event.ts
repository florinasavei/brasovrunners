import type { RichTextDoc } from "../domain/schema";

/**
 * How a rich-text box is filled from outside it (`DECISIONS.md` §NNN, «Tradu din română»).
 *
 * A rich text is an island — a Tiptap editor once its fold has opened, a hidden box holding the
 * stored document until then (`LazyRichTextEditor`, §96) — and neither is a value a button
 * elsewhere in the form can set. So the button announces the document on `window`, naming the
 * box by its form name, and whichever of the two holds that name takes it: the mounted editor
 * through `setContent` (the hidden value and the tab marks follow as for typing), the unmounted
 * fold by posting it and mounting from it. Nothing is saved by the event.
 */
export const RICH_TEXT_FILL_EVENT = "br:rich-text-fill";

export type RichTextFillDetail = { name: string; doc: RichTextDoc };

export function fillRichText(name: string, doc: RichTextDoc): void {
  window.dispatchEvent(new CustomEvent<RichTextFillDetail>(RICH_TEXT_FILL_EVENT, { detail: { name, doc } }));
}
