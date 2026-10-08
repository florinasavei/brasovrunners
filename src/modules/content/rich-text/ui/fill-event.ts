import type { RichTextDoc } from "../domain/schema";

/**
 * How a rich-text box is filled from outside it (`DECISIONS.md` §464, «Tradu din română»).
 *
 * A rich text is an island — a Tiptap editor once its fold has opened, a hidden box holding the
 * stored document until then (`LazyRichTextEditor`, §96) — and neither is a value a button
 * elsewhere in the form can set. So the button announces the document on `window`, naming the
 * box by its form name, and whichever of the two holds that name takes it: the mounted editor
 * through `setContent` (the hidden value and the tab marks follow as for typing), the unmounted
 * fold by posting it and mounting from it. Nothing is saved by the event.
 *
 * **In the form that pressed** (§482). «Echipa» is one form per card, and every card posts its
 * English words as `bioEnBody`: a name alone would fill every card's English with one person's
 * translation. The event carries the form the button sits in, and a box in another form ignores it.
 */
export const RICH_TEXT_FILL_EVENT = "br:rich-text-fill";

export type RichTextFillDetail = { name: string; doc: RichTextDoc; form?: HTMLFormElement | null };

export function fillRichText(name: string, doc: RichTextDoc, form: HTMLFormElement | null = null): void {
  window.dispatchEvent(new CustomEvent<RichTextFillDetail>(RICH_TEXT_FILL_EVENT, { detail: { name, doc, form } }));
}

/**
 * Whether a fill is meant for the box posting under `name` through `box` (its hidden input): the
 * same name, and — when the press named its form — that form. A box not yet attached takes it, as
 * a fill with no form does everywhere (the event editor is one form).
 */
export function fillIsFor(detail: RichTextFillDetail | null | undefined, name: string, box: HTMLInputElement | null): boolean {
  if (!detail || detail.name !== name) return false;
  if (!detail.form || !box) return true;
  return box.form === detail.form;
}

/**
 * «Înlocuiește» on a picture in a text reaches every box of the same form (§673): the Romanian
 * text and its English copy name the same stored picture, and a picture replaced in one language
 * and left in the other would show the old photograph on the other language's page. The box that
 * replaced announces the old address and the new picture; every box of that form — a mounted
 * editor, or a fold not opened yet — changes each image carrying the old address, keeping its own
 * description and caption. Nothing is saved by the event.
 */
export const RICH_TEXT_PICTURE_REPLACED_EVENT = "br:rich-text-picture-replaced";

export type PictureReplacedDetail = {
  oldSrc: string;
  picture: { src: string; width: number; height: number };
  form?: HTMLFormElement | null;
};

export function announcePictureReplaced(detail: PictureReplacedDetail): void {
  window.dispatchEvent(new CustomEvent<PictureReplacedDetail>(RICH_TEXT_PICTURE_REPLACED_EVENT, { detail }));
}

/** Whether a replace is meant for the box posting through `box`: the same form, when both are known. */
export function replacementIsFor(detail: PictureReplacedDetail | null | undefined, box: HTMLInputElement | null): boolean {
  if (!detail || !detail.oldSrc) return false;
  if (!detail.form || !box) return true;
  return box.form === detail.form;
}
