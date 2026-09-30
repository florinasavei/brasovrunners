/**
 * What a translate press tells the page once its answers are in their English boxes (§572).
 *
 * The press that fills the English (`translateBoxes` — «Copiază și tradu tot», «Tradu cardul») sits
 * above the language tabs, or at the end of their row, and does not know which strip, if any, holds
 * the boxes it filled. So it announces the names it filled on `window`, with the form that pressed,
 * and every `LocaleTabPanels` holding one of those boxes in its English panel answers: the English tab
 * comes forward and wears «tradus — verifică» until the person types in it. The owner, 2026-09-29:
 * «partea bilingvă trebuie să fie per tabs» — a translation the reader cannot see behind the Romanian
 * tab is one they do not read before «Salvează».
 *
 * Nothing is saved by the event, and nothing but the strips listens to it.
 */
export const TRANSLATED_EVENT = "br:translated";

export type TranslatedDetail = { names: readonly string[]; form: HTMLFormElement | null };

export function announceTranslated(names: readonly string[], form: HTMLFormElement | null): void {
  if (names.length === 0 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TranslatedDetail>(TRANSLATED_EVENT, { detail: { names, form } }));
}

/** The part of a box this needs: which form it posts in (`null` outside one). */
export type PostingBox = { form: HTMLFormElement | null };

/**
 * Whether a translation landed in a panel: one of the filled names is a box the panel holds (`find`,
 * the panel's own lookup by name), posting in the form that pressed — «Echipa» has one form per card,
 * each posting the same names (§482), so a name alone would bring every card's English forward.
 */
export function translatedInto(detail: TranslatedDetail | null | undefined, find: (name: string) => PostingBox | null): boolean {
  if (!detail || detail.names.length === 0) return false;
  return detail.names.some((name) => {
    const box = find(name);
    if (!box) return false;
    return !detail.form || !box.form || box.form === detail.form;
  });
}
