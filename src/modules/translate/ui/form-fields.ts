import { isRichTextEmpty, type RichTextDoc, readRichText } from "@/modules/content/rich-text/domain/schema";
import { fillRichText } from "@/modules/content/rich-text/ui/fill-event";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "../domain/fields";

/**
 * The boxes of a form, as «Tradu din română» reads and fills them (`DECISIONS.md` §NNN).
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

/** One translated answer, put in its English box. */
export function fillBox(form: HTMLFormElement | null, name: string, value: BoxValue): void {
  if (value.kind === "rich") {
    fillRichText(name, value.doc);
    return;
  }
  const box = boxNamed(form, name);
  if (box) writePlainBox(box, box.maxLength > 0 ? value.text.slice(0, box.maxLength) : value.text);
}

/**
 * Every English box of the form «Tradu tot din română» may fill: on the allowlist, not switched
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

/** The words a person reads for a box: its label, or a rich text's fold title, or its name. */
export function labelOfBox(form: HTMLFormElement | null, name: string): string {
  if (isRichTextField(name)) {
    const summary = document.querySelector(`[data-rich-text-fold="${CSS.escape(name)}"] > summary`);
    const own = summary
      ? Array.from(summary.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim()
      : "";
    if (own) return own;
    const label = document.querySelector(`[data-rich-text="${CSS.escape(name)}"] > span`)?.textContent?.trim();
    if (label) return label;
  }
  const box = boxNamed(form, name);
  const text = box?.labels?.[0]?.textContent?.replace(/\s*\*\s*$/, "").trim();
  return text || name;
}
