import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecallProvider } from "@/shared/forms/recall";
import { type ResultWords, type TypedLine, TypedResultLines } from "@/modules/results/ui/ResultRows";

/**
 * §NNN, BR-REQ-050-02 — the typed line's agreement tick comes back as it was posted after a refused save (§315): an unticked box posts
 * nothing, so «not posted» is «unticked», never the stored state — and a refusal that names the tick's line leaves the others as they were.
 */
const words: ResultWords = {
  time: "Timp",
  status: "Stare",
  chip: "Timp cip",
  note: "Notă",
  bib: "Nr.",
  name: "Nume",
  sex: "Sex",
  birthDate: "Data nașterii",
  place: "Loc",
  timePlaceholder: "h:mm:ss",
  birthDatePlaceholder: "ZZ.LL.AAAA",
  statusOptions: [{ value: "", label: "Din timp" }],
  sexOptions: [{ value: "", label: "Nespecificat" }],
  deleteFor: "Șterge: {runner}",
  delete: "Șterge",
  present: "Prezent",
  nameless: "Fără nume",
  addRow: "Adaugă",
  typedRow: "Alergător neînscris",
  agreed: "A acceptat să apară cu numele în clasament",
  agreedHelp: "Bifezi doar dacă persoana ți-a spus-o.",
  noPlace: "fără loc încă",
  noPlaceSettled: "fără loc",
};
const stored = (agreed: boolean, bib: string, name: string): TypedLine => ({
  values: { bib, name, sex: "", birthDate: "", time: "0:42:00", status: "FINISHED", chip: "", note: "" },
  agreed,
  publicLine: "Pe site: Participant #900",
  place: null,
  hasResult: true,
});

const draw = (lines: TypedLine[], posted: Record<string, string[]> | null): string => {
  const island = createElement(TypedResultLines, { lines, words });
  return renderToStaticMarkup(posted ? createElement(RecallProvider, { value: { values: posted, fields: [], generation: 1, fieldError: "" } } as unknown as ComponentProps<typeof RecallProvider>, island) : island);
};
const tick = (html: string, name: string) => new RegExp(`<input[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`).exec(html)?.[0] ?? "";
const isChecked = (tag: string) => /\schecked(=|\s|\/|>)/.test(tag);

describe("§NNN the typed line's tick, before and after a refusal", () => {
  it("draws the stored state when no save was refused", () => {
    const html = draw([stored(true, "900", "Ion Vasile"), stored(false, "901", "Maria Pop")], null);
    expect(isChecked(tick(html, "n[0].agreed"))).toBe(true);
    expect(isChecked(tick(html, "n[1].agreed"))).toBe(false);
    // The blank line at the end is drawn unticked.
    expect(isChecked(tick(html, "n[2].agreed"))).toBe(false);
  });

  it("draws what was posted after a refusal: a ticked box comes back ticked, and a box that posted nothing comes back unticked", () => {
    const posted = { "n[0].bib": ["900"], "n[0].name": ["Ion Vasile"], "n[1].bib": ["901"], "n[1].name": ["Maria Pop"], "n[1].agreed": ["on"], "n[2].bib": ["902"], "n[2].name": ["Ana"] };
    const html = draw([stored(true, "900", "Ion Vasile"), stored(false, "901", "Maria Pop")], posted);
    // Line 0 was stored ticked and the form posted it unticked: the refusal does not put the stored tick back.
    expect(isChecked(tick(html, "n[0].agreed"))).toBe(false);
    expect(isChecked(tick(html, "n[1].agreed"))).toBe(true);
    expect(isChecked(tick(html, "n[2].agreed"))).toBe(false);
  });

  it("draws a line added by a CSV import, or by a refused press, with its tick as posted", () => {
    const posted = { "n[0].bib": ["900"], "n[0].name": [""], "n[0].agreed": ["on"] };
    const html = draw([], posted);
    expect(isChecked(tick(html, "n[0].agreed"))).toBe(true);
  });
});
