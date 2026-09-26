/**
 * What the send button's list of what is missing says (§NNN), apart from the island that draws it
 * so the naming rules can be tested without a browser: a control is read through the few members
 * listed in `WatchedControl`, which a plain object can stand in for.
 */

/** A form control as the watcher reads it: its own validity and its own labels. */
export type WatchedControl = Pick<Element, "getAttribute" | "closest" | "id"> & {
  validity?: ValidityState;
  willValidate?: boolean;
  labels?: ArrayLike<{ textContent: string | null }> | null;
};

/** One entry of the list of what is missing: what it is called, and where it is. */
export type MissingControl = { key: string; label: string; id: string | null };

/** Whether the browser would refuse this control on a press: `willValidate` false (a disabled fieldset) is never refused. */
export function isRefused(control: WatchedControl): boolean {
  return control.willValidate !== false && control.validity !== undefined && !control.validity.valid;
}

/**
 * A control's name for a person: its `<label>` without MUI's " *", or its `aria-label`; a box
 * inside a language tab says which language, or "Titlu" would not say which of two titles.
 */
export function labelOf(control: WatchedControl): string | null {
  const text = control.labels?.[0]?.textContent?.replace(/\s*\*\s*$/, "").trim() || control.getAttribute("aria-label");
  const language = control.closest("[data-language]")?.getAttribute("data-language");
  return text ? (language ? `${language}: ${text}` : text) : null;
}

/**
 * The refused controls as a list: one entry per posted name (a phone's digits and its country,
 * a group of boxes, are one question), named by the caller's short name for it first. Controls
 * the browser would not refuse are skipped here too, so a caller may pass the whole form.
 */
export function missingControls(controls: readonly WatchedControl[], names: Readonly<Record<string, string>>): MissingControl[] {
  const seen = new Set<string>();
  const entries: MissingControl[] = [];
  for (const control of controls) {
    if (!isRefused(control)) continue;
    const name = control.getAttribute("name") ?? "";
    const label = (name && names[name]) || labelOf(control);
    const key = name || control.id || label;
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, label, id: control.id || null });
  }
  return entries;
}

export function sameEntries(a: readonly MissingControl[], b: readonly MissingControl[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.key === b[index].key && entry.label === b[index].label && entry.id === b[index].id);
}
