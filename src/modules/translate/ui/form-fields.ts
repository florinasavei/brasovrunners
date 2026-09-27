import { isRichTextEmpty, type RichTextDoc, readRichText } from "@/modules/content/rich-text/domain/schema";
import { fillRichText } from "@/modules/content/rich-text/ui/fill-event";
import { charactersToSend } from "../domain/budget";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "../domain/fields";
import type { TranslateRefusal } from "../service";
import type { TranslateAction } from "./TranslateProvider";

/**
 * The boxes of a form, as «Tradu din română» reads and fills them (`DECISIONS.md` §464).
 *
 * Browser-only, and by name: the editor's boxes are uncontrolled inputs posting under the names
 * `admin/actions.ts` reads (§315), so the form itself is the one place that knows what is typed
 * in every box right now — the Romanian one beside a button, and the English one it fills. A
 * rich text is its hidden box (the mounted editor's or the shut fold's), holding the document as
 * JSON; it is filled through `fillRichText`, never by writing the hidden box, so the editor and
 * the box never disagree.
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

/** The Romanian box beside an English one, by the three ways the forms spell a pair. */
export function romanianBoxOf(form: HTMLFormElement | null, englishName: string): Box | null {
  for (const candidate of romanianTwinCandidates(englishName)) {
    const box = boxNamed(form, candidate);
    if (box) return box;
  }
  return null;
}

export type BoxValue = { kind: "text"; text: string } | { kind: "rich"; doc: RichTextDoc };

/** What a box holds now, read the way the save will read it. */
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
 * A plain box set as if typed: through the element's own value setter, so React's and MUI's
 * listeners see a change, then `input` and `change`, which the form's tab marks, the "identical
 * in both languages" warning and the character counters already listen to (§350, §354).
 */
export function writePlainBox(box: Box, text: string): void {
  const prototype = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(box, text);
  else box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * One translated answer, put in its English box. English often runs longer than Romanian: an
 * answer past the box's `maxLength` is cut to it (the box could not hold more, and the save's own
 * ceiling is the same), and the answer is `true` so the press can say which box lost its ending.
 */
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
 * Every English box of the form «Copiază și tradu tot» may fill: on the allowlist, not switched
 * off, not a visible box a hidden block made read-only (§350: what is hidden is not asked), and
 * with a Romanian twin that has words in it. In the form's own order, each once.
 */
export function englishBoxesToTranslate(form: HTMLFormElement): string[] {
  const names: string[] = [];
  for (const element of Array.from(form.elements)) {
    if (!isBox(element) || !element.name || names.includes(element.name)) continue;
    if (!isTranslatableEnglishField(element.name) || element.disabled) continue;
    if (element.type !== "hidden" && element.readOnly) continue;
    const romanian = romanianBoxOf(form, element.name);
    if (!romanian || isEmptyValue(readBox(element.name, romanian))) continue;
    names.push(element.name);
  }
  return names;
}

/**
 * The English boxes among `names` that already hold words — the ones «Copiază și tradu tot» would
 * replace, and so the only reason it asks before it runs (§464, §482). Empty boxes are simply
 * filled: one press, no question.
 */
export function englishBoxesWithWords(form: HTMLFormElement | null, names: readonly string[]): string[] {
  return names.filter((name) => {
    const box = boxNamed(form, name);
    return box !== null && !isEmptyValue(readBox(name, box));
  });
}

/**
 * What the press sends: each named English box's Romanian twin as it is now, the empty ones
 * skipped — the request `service.ts` reads, in the form's order.
 */
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

/**
 * «Copiază și tradu tot», read before it runs (§482): every English box it may fill, the ones among
 * them that already hold words, and the characters the whole press and the empty boxes alone
 * would send (`charactersToSend`, the service's own count). The button asks when `replaced` is not
 * empty or `characters` passes `ASK_ABOVE_CHARACTERS`; otherwise one press does it.
 */
export type TranslateAllPlan = { names: string[]; replaced: string[]; empty: string[]; characters: number; emptyCharacters: number };

export function planTranslateAll(form: HTMLFormElement | null): TranslateAllPlan {
  const names = form ? englishBoxesToTranslate(form) : [];
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

export type TranslateBoxesResult =
  | { kind: "nothing" }
  | { kind: "refused"; reason: TranslateRefusal; remainingToday?: number; remainingCredit?: number }
  | { kind: "done"; count: number; cut: string[] };

/**
 * One press, without React: read the Romanian twins, ask the action once, put every answer in its
 * English box. Nothing is submitted — the boxes change as if typed, and the ordinary save stores
 * them (§352). The provider refuses a request whole (the budget, the month's quota, the key, a
 * timeout), so an answer either fills every box it names or none; there is no half-translated form.
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

/** The words a person reads for a box: its label, or a rich text's fold title, or its name. */
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
