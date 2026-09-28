import type { RichTextDoc } from "../domain/schema";

/**
 * Fills a rich-text box from outside it (§464): a `window` event naming the box by its form
 * name, taken by the mounted editor or the unmounted fold (`LazyRichTextEditor`). Nothing is
 * saved. The event carries the pressing form, since «Echipa» repeats the same names per card (§482).
 */
export const RICH_TEXT_FILL_EVENT = "br:rich-text-fill";

export type RichTextFillDetail = { name: string; doc: RichTextDoc; form?: HTMLFormElement | null };

export function fillRichText(name: string, doc: RichTextDoc, form: HTMLFormElement | null = null): void {
  window.dispatchEvent(new CustomEvent<RichTextFillDetail>(RICH_TEXT_FILL_EVENT, { detail: { name, doc, form } }));
}

/** Same name and, when the press named a form, that form; an unattached box takes any fill. */
export function fillIsFor(detail: RichTextFillDetail | null | undefined, name: string, box: HTMLInputElement | null): boolean {
  if (!detail || detail.name !== name) return false;
  if (!detail.form || !box) return true;
  return box.form === detail.form;
}
