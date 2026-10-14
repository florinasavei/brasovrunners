"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * The form a box belongs to when it is drawn inside another form's markup (§NNN).
 *
 * HTML forms cannot nest, so a card with a save of its own that must stand *inside* a card of the
 * event editor's one save form — «Puncte de control» inside «Traseul» — keeps its `<form>` element
 * beside the save form and gives each of its boxes and buttons the `form` attribute naming it: the
 * browser then posts each box with the form it names, and never with the form around it
 * (`FormData`, `form.elements` and the browser's own validation all follow the attribute). This is
 * how every house primitive learns the name without each caller threading it: `DetachedFields`
 * provides it, and `RecallField`, `NeverKeptField`, `RecallHidden`, `RecallCheckbox`, `RecallRadio`,
 * `CheckboxField`, `TimeField` and `SubmitButton` write it on their own control. A plain `<input>`
 * written by a Server Component inside the fields writes `form=` itself.
 *
 * `pending` is the detached form's own request in flight: a submit button inside the save form's
 * markup would otherwise read the save form's status (`useFormStatus` reads the form around it in
 * the tree), so «Salvează punctele» would turn into «Se salvează…» when the event is saved and
 * never when the points are.
 *
 * `null` — the default — is a box that belongs to the form around it, which is every box but these.
 */
export type FormOwner = { id: string; pending: boolean };

const FormOwnerContext = createContext<FormOwner | null>(null);

export function FormOwnerProvider({ value, children }: { value: FormOwner; children: ReactNode }) {
  return <FormOwnerContext.Provider value={value}>{children}</FormOwnerContext.Provider>;
}

/** The form this box posts with when it is not the one around it, or `null`. */
export function useFormOwner(): FormOwner | null {
  return useContext(FormOwnerContext);
}
