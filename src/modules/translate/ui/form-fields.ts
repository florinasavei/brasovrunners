import { isRichTextEmpty, type RichTextDoc, readRichText } from "@/modules/content/rich-text/domain/schema";
import { fillRichText } from "@/modules/content/rich-text/ui/fill-event";
import { charactersToSend } from "../domain/budget";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "../domain/fields";
import type { TranslateRefusal } from "../service";
import type { TranslateAction } from "./TranslateProvider";

/**
 * A form's boxes as «Tradu din română» reads and fills them (`DECISIONS.md` §464). Browser-only,
 * by name: the boxes are uncontrolled (§315), so the form is the one source of what is typed. A
 * rich text is filled through `fillRichText`, never by writing its hidden box, so editor and box
 * never disagree.
 */

type Box = HTMLInputElement | HTMLTextAreaElement;

function isBox(element: unknown): element is Box {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

/** The box posting under `name`: in the form when there is one, else anywhere on the page. */
export function boxNamed(form: HTMLFormElement | null, name: string): Box | null {
  const scoped = form?.elements.namedItem(name);
  if (isBox(scoped)) return scoped;
  if (scoped && "length" in scoped) {
    const first = Array.from(scoped as RadioNodeList).find(isBox);
    if (first) return first;
  }
  const loose = document.querySelector(`[name="${CSS.escape(name)}"]`);
  return isBox(loose) ? loose : null;
}

export function romanianBoxOf(form: HTMLFormElement | null, englishName: string): Box | null {
  for (const candidate of romanianTwinCandidates(englishName)) {
    const box = boxNamed(form, candidate);
    if (box) return box;
  }
  return null;
}

export type BoxValue = { kind: "text"; text: string } | { kind: "rich"; doc: RichTextDoc };

/** Read the way the save reads it. */
export function readBox(name: string, box: Box): BoxValue {
  if (!isRichTextField(name)) return { kind: "text", text: box.value };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(box.value);
  } catch {
    parsed = null;
  }
  return { kind: "rich", doc: readRichText(parsed) };
}

export function isEmptyValue(value: BoxValue): boolean {
  return value.kind === "text" ? value.text.trim() === "" : isRichTextEmpty(value.doc);
}

/**
 * Set as if typed: the native value setter so React/MUI see a change, then `input` and `change`
 * for the tab marks, the same-words warning and the counters (§350, §354).
 */
export function writePlainBox(box: Box, text: string): void {
  const prototype = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(box, text);
  else box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

/** An answer past the box's `maxLength` (the save's ceiling too) is cut; `true` means it was, so the press can say so. */
export function fillBox(form: HTMLFormElement | null, name: string, value: BoxValue): boolean {
  if (value.kind === "rich") {
    // In this form only: «Echipa» has a `bioEnBody` in every card's form (§482).
    fillRichText(name, value.doc, form);
    return false;
  }
  const box = boxNamed(form, name);
  if (!box) return false;
  const cut = box.maxLength > 0 && value.text.length > box.maxLength;
  writePlainBox(box, cut ? value.text.slice(0, box.maxLength) : value.text);
  return cut;
}

/**
 * English boxes to fill: allowlisted, enabled, not a visible read-only box (§350), with a
 * Romanian twin that has words; in form order, each once. `within` narrows to one card (§514);
 * the twin is still looked up in the whole form, where the save reads it.
 */
export function englishBoxesToTranslate(form: HTMLFormElement, within?: ParentNode | null): string[] {
  const names: string[] = [];
  const elements: unknown[] = within
    ? Array.from(within.querySelectorAll("input[name], textarea[name]")).filter((element) => isBox(element) && element.form === form)
    : Array.from(form.elements);
  for (const element of elements) {
    if (!isBox(element) || !element.name || names.includes(element.name)) continue;
    if (!isTranslatableEnglishField(element.name) || element.disabled) continue;
    if (element.type !== "hidden" && element.readOnly) continue;
    const romanian = romanianBoxOf(form, element.name);
    if (!romanian || isEmptyValue(readBox(element.name, romanian))) continue;
    names.push(element.name);
  }
  return names;
}

/** Boxes a press would overwrite — the reason it asks first (§464, §482). */
export function englishBoxesWithWords(form: HTMLFormElement | null, names: readonly string[]): string[] {
  return names.filter((name) => {
    const box = boxNamed(form, name);
    return box !== null && !isEmptyValue(readBox(name, box));
  });
}

/** The request `service.ts` reads: each English box's Romanian twin, empties skipped. */
export type ClubTextItem = { field: string; kind: "text"; text: string } | { field: string; kind: "rich"; doc: RichTextDoc };

export function collectItems(form: HTMLFormElement | null, englishNames: readonly string[]): ClubTextItem[] {
  const items: ClubTextItem[] = [];
  for (const name of englishNames) {
    const romanian = romanianBoxOf(form, name);
    if (!romanian) continue;
    const value = readBox(name, romanian);
    if (isEmptyValue(value)) continue;
    items.push(value.kind === "text" ? { field: name, kind: "text", text: value.text } : { field: name, kind: "rich", doc: value.doc });
  }
  return items;
}

/** The press, planned (§482): it asks first when `replaced` is non-empty or `characters` passes `ASK_ABOVE_CHARACTERS`. */
export type TranslateAllPlan = { names: string[]; replaced: string[]; empty: string[]; characters: number; emptyCharacters: number };

export function planTranslateAll(form: HTMLFormElement | null, within?: ParentNode | null): TranslateAllPlan {
  const names = form ? englishBoxesToTranslate(form, within) : [];
  const replaced = englishBoxesWithWords(form, names);
  const empty = names.filter((name) => !replaced.includes(name));
  return {
    names,
    replaced,
    empty,
    characters: charactersToSend(collectItems(form, names)),
    emptyCharacters: charactersToSend(collectItems(form, empty)),
  };
}

/** The nearest `Panel` (`<details>` or `<section>`), so boxes outside the language tabs come too (§514). */
export function cardOf(element: Element): Element {
  return element.closest("details, section") ?? element;
}

/**
 * The `Panel` heading's own text for the done toast (§514), without its aside `<span>`; null
 * outside a card, where the toast uses the whole editor's sentence.
 */
export function cardTitleOf(card: Element): string | null {
  const heading =
    card.tagName === "DETAILS"
      ? card.querySelector(":scope > summary h2, :scope > summary h3, :scope > summary h4")
      : card.tagName === "SECTION"
        ? card.querySelector(":scope > h2, :scope > h3, :scope > h4")
        : null;
  if (!heading) return null;
  const own = Array.from(heading.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
  return own.length > 0 ? own : null;
}

export type TranslateBoxesResult =
  | { kind: "nothing" }
  | { kind: "refused"; reason: TranslateRefusal; remainingToday?: number; remainingCredit?: number }
  | { kind: "done"; count: number; cut: string[] };

/**
 * One press without React. Nothing is submitted; the ordinary save stores the boxes (§352). A
 * refusal is whole, so a form is never half translated.
 */
export async function translateBoxes(form: HTMLFormElement | null, englishNames: readonly string[], action: TranslateAction): Promise<TranslateBoxesResult> {
  const items = collectItems(form, englishNames);
  if (items.length === 0) return { kind: "nothing" };
  const outcome = await action({ items });
  if (!outcome.ok) return { kind: "refused", reason: outcome.reason, remainingToday: outcome.remainingToday, remainingCredit: outcome.remainingCredit };
  const cut: string[] = [];
  for (const item of outcome.items) {
    const value: BoxValue = item.kind === "text" ? { kind: "text", text: item.text } : { kind: "rich", doc: item.doc };
    if (fillBox(form, item.field, value)) cut.push(labelOfBox(form, item.field));
  }
  return { kind: "done", count: items.length, cut };
}

/** A rich text's fold title, else the box's label, else its name. */
export function labelOfBox(form: HTMLFormElement | null, name: string): string {
  if (isRichTextField(name)) {
    const scope: ParentNode = form ?? document;
    const summary = scope.querySelector(`[data-rich-text-fold="${CSS.escape(name)}"] > summary`);
    const own = summary
      ? Array.from(summary.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim()
      : "";
    if (own) return own;
    const label = scope.querySelector(`[data-rich-text="${CSS.escape(name)}"] > span`)?.textContent?.trim();
    if (label) return label;
  }
  const box = boxNamed(form, name);
  const text = box?.labels?.[0]?.textContent?.replace(/\s*\*\s*$/, "").trim();
  return text || name;
}
