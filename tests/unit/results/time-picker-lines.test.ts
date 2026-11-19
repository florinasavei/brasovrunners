import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { type RegisteredLine, RegisteredResultLines, type ResultWords, TypedResultLines } from "@/modules/results/ui/ResultRows";
import ClockPickerHost, { CLOCK_BUTTON_CLASS } from "@/shared/forms/pickers/ClockPickerHost";
import { RecallProvider } from "@/shared/forms/recall";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-041-01 criterion 6 — «Clasament»'s lines under the page's one clock picker, as the server draws them:
 *
 * - beside «Timp» and «Timp cip» of every line — a registered runner's, a typed runner's, the blank one — a button
 *   (`type="button"`, so it never posts or submits) named with whose time it is, «Alege timpul: #101 Ana Popescu» and
 *   «Alege timpul cip: …», wearing the class the host's `<noscript>` rule hides;
 * - the two time boxes open a decimal keypad; the note and the race number keep theirs;
 * - what the form posts is unchanged: the same names, the same values, nothing named by the buttons;
 * - without the host — a line drawn alone — no button at all, the boxes as they are.
 */
const words = (catalogue: typeof ro): ResultWords => {
  const results = catalogue.Admin.results;
  return {
    time: results.col.time,
    status: results.col.status,
    chip: results.col.chip,
    note: results.col.note,
    bib: results.col.bib,
    name: results.col.name,
    sex: results.col.sex,
    birthDate: results.col.birthDate,
    place: results.col.place,
    timePlaceholder: results.timePlaceholder,
    birthDatePlaceholder: results.birthDatePlaceholder,
    statusOptions: [{ value: "", label: results.status.none }],
    sexOptions: [{ value: "", label: results.col.sexNone }],
    deleteFor: results.deleteFor,
    pickTime: results.pickTime,
    pickChip: results.pickChip,
    delete: results.delete,
    present: results.present,
    nameless: results.nameless,
    addRow: results.addRow,
    typedRow: results.typedRow,
    agreed: results.agreed,
    agreedHelp: results.agreedHelp,
    noPlace: results.noPlace,
    noPlaceSettled: results.noPlaceSettled,
    outOfRanking: results.outOfRanking,
  };
};
const pickerWords = (catalogue: typeof ro) => ({ help: catalogue.Admin.results.picker.help, ok: catalogue.Admin.results.picker.ok, cancel: catalogue.Admin.results.picker.cancel });

const line: RegisteredLine = {
  bibNumber: 101,
  name: "Ana Popescu",
  present: true,
  publicLine: "Pe site: cu numele",
  values: { time: "0:50:00", status: "FINISHED", chip: "0:49:58", note: "bine" },
  place: { overall: "1", detail: "" },
  hasResult: true,
};

const hosted = (catalogue: typeof ro, node: ReactNode) => renderToStaticMarkup(createElement(ClockPickerHost, { words: pickerWords(catalogue) } as ComponentProps<typeof ClockPickerHost>, node));

/** Every `<button>` opening tag that wears the clock's class. */
const clockButtons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes(`class="${CLOCK_BUTTON_CLASS}"`));
const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** The `<input>` named `name`. */
const input = (html: string, name: string) => new RegExp(`<input[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`).exec(html)?.[0] ?? "";
/** Every name a control posts under, in order. */
const postedNames = (html: string) => [...html.matchAll(/<(?:input|select|textarea|button)\b[^>]*\sname="([^"]*)"/g)].map((match) => match[1]);

describe.each([
  ["ro", ro],
  ["en", en as unknown as typeof ro],
] as const)("§NNN the clock buttons beside «Timp» and «Timp cip» (%s)", (_locale, catalogue) => {
  const resultWords = words(catalogue);

  it("draws one beside each time box of a registered runner's line, named with whose time it is, 44 pixels by the list's rule", () => {
    const html = hosted(catalogue, createElement(RegisteredResultLines, { lines: [line], words: resultWords }));
    const buttons = clockButtons(html);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((tag) => attribute(tag, "aria-label"))).toEqual([resultWords.pickTime.replace("{runner}", "#101 Ana Popescu"), resultWords.pickChip.replace("{runner}", "#101 Ana Popescu")]);
    expect(buttons.map((tag) => attribute(tag, "data-testid"))).toEqual(["result-time-pick", "result-chip-pick"]);
    for (const tag of buttons) {
      expect(attribute(tag, "type")).toBe("button");
      expect(attribute(tag, "aria-haspopup")).toBe("dialog");
      expect(attribute(tag, "name")).toBeUndefined();
      // The button draws its glyph (§521).
    }
    expect(html).toMatch(/<button[^>]*class="clock-pick"[^>]*><svg/);
    // The list's one rule gives the button its 44 pixels: written once, for the class.
    expect(html).toMatch(/\.clock-pick\{[^}]*width:44px;height:44px/);
  });

  it("draws them on a typed runner's line, and on the blank line at the end", () => {
    const html = renderToStaticMarkup(
      createElement(
        ClockPickerHost,
        { words: pickerWords(catalogue) } as ComponentProps<typeof ClockPickerHost>,
        createElement(TypedResultLines, {
          lines: [{ values: { bib: "900", name: "Ion Vasile", sex: "", birthDate: "", time: "0:42:00", status: "FINISHED", chip: "", note: "" }, agreed: false, publicLine: "Pe site: Participant #900", place: null, hasResult: true }],
          words: resultWords,
        }),
      ),
    );
    const labels = clockButtons(html).map((tag) => attribute(tag, "aria-label"));
    const runner = (index: number) => `${resultWords.typedRow} ${index}`;
    expect(labels).toEqual([
      resultWords.pickTime.replace("{runner}", runner(1)),
      resultWords.pickChip.replace("{runner}", runner(1)),
      resultWords.pickTime.replace("{runner}", runner(2)),
      resultWords.pickChip.replace("{runner}", runner(2)),
    ]);
  });

  it("gives the two time boxes a decimal keypad, and leaves the note and the race number theirs", () => {
    const html = hosted(catalogue, createElement(RegisteredResultLines, { lines: [line], words: resultWords }));
    expect(attribute(input(html, "r[101].time"), "inputMode") ?? attribute(input(html, "r[101].time"), "inputmode")).toBe("decimal");
    expect(attribute(input(html, "r[101].chip"), "inputMode") ?? attribute(input(html, "r[101].chip"), "inputmode")).toBe("decimal");
    expect(input(html, "r[101].note")).not.toMatch(/inputmode=/i);
    const typed = hosted(catalogue, createElement(TypedResultLines, { lines: [], words: resultWords }));
    expect(attribute(input(typed, "n[0].bib"), "inputMode") ?? attribute(input(typed, "n[0].bib"), "inputmode")).toBe("numeric");
    expect(attribute(input(typed, "n[0].time"), "inputMode") ?? attribute(input(typed, "n[0].time"), "inputmode")).toBe("decimal");
  });

  it("posts what it posted before: the same names, the same values, the buttons naming nothing", () => {
    const html = hosted(catalogue, createElement(RegisteredResultLines, { lines: [line], words: resultWords }));
    expect(postedNames(html)).toEqual(["r[101].time", "r[101].status", "r[101].chip", "r[101].note", "bibNumber"]);
    expect(attribute(input(html, "r[101].time"), "value")).toBe("0:50:00");
    expect(attribute(input(html, "r[101].chip"), "value")).toBe("0:49:58");
    expect(attribute(input(html, "r[101].time"), "placeholder")).toBe("h:mm:ss");
    expect(attribute(input(html, "r[101].time"), "maxLength") ?? attribute(input(html, "r[101].time"), "maxlength")).toBe("14");
  });

  it("brings a refused save's typed text back into the box, the button beside it", () => {
    const posted = { "r[101].time": ["12345"], "r[101].chip": [""] };
    const html = hosted(
      catalogue,
      createElement(
        RecallProvider,
        { value: { values: posted, fields: ["r[101].time"], generation: 2, fieldError: "Verifică" } } as unknown as ComponentProps<typeof RecallProvider>,
        createElement(RegisteredResultLines, { lines: [line], words: resultWords }),
      ),
    );
    expect(attribute(input(html, "r[101].time"), "value")).toBe("12345");
    expect(attribute(input(html, "r[101].time"), "aria-invalid")).toBe("true");
    expect(clockButtons(html)).toHaveLength(2);
  });
});

describe("§NNN without the page's host, and without scripts", () => {
  it("draws no button for a line drawn alone, its boxes as they are", () => {
    const html = renderToStaticMarkup(createElement(RegisteredResultLines, { lines: [line], words: words(ro) }));
    expect(clockButtons(html)).toEqual([]);
    expect(attribute(input(html, "r[101].time"), "value")).toBe("0:50:00");
  });

  it("hides every clock button with the host's one <noscript> rule", () => {
    const html = hosted(ro, createElement(RegisteredResultLines, { lines: [line], words: words(ro) }));
    expect(html.match(/<noscript>/g)).toHaveLength(1);
    expect(html).toContain(`<noscript><style>.${CLOCK_BUTTON_CLASS}{display:none!important}</style></noscript>`);
    // Nothing of the picker itself is drawn before a press: no clock, no dialog.
    expect(html).not.toContain("time-picker");
    expect(html).not.toContain('role="listbox"');
  });
});
