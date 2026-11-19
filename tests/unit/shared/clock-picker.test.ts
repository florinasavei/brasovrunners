import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import "dayjs/locale/en-gb";
import "dayjs/locale/ro";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClockPanel } from "@/shared/forms/pickers/ClockPicker";
import { type ClockTime, isMidnight, MIDNIGHT, writeBox } from "@/shared/forms/pickers/clock-values";

/**
 * §NNN, BR-REQ-050-02, §439 — the clock picker «Clasament» opens beside «Timp» and «Timp cip», drawn on the server: its inside
 * (`ClockPanel`, the part both of its shapes draw) under a Day.js adapter, read from the markup.
 *
 * - **24 hours, never AM/PM, whatever the adapter's language.** Day.js's `en` (US English) is a 12-hour locale: without
 *   `ampm={false}` MUI X would draw 1 to 12 and an AM/PM column. Under it, and under the backoffice's own `en-gb` and `ro`, the
 *   clock has three columns — hours 00 to 23, minutes and seconds 00 to 59, every one of them — and no AM or PM anywhere.
 * - **It opens at the box's time**: the selected hour, minute and second are the ones it was given; «OK» waits at 0:00:00.
 * - **It is loaded on the first press only** (source-level, like `pickers-backoffice-only.test.ts`): no file imports it but
 *   the host, and the host does it with a dynamic `import()`; MUI X's clock is imported by the picker alone, and neither the
 *   host nor the lines import MUI X or Day.js.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const WORDS = { help: "Zecimile (mm:ss.t) se scriu în căsuță; „OK” pune secunde întregi.", ok: "OK", cancel: "Anulează" };

function draw(adapterLocale: "en" | "en-gb" | "ro", initial: ClockTime, inDialog = false): string {
  const panel = createElement(ClockPanel, { initial, words: WORDS, titleId: "time-picker-title", title: "Timp: #101 Ana Popescu", inDialog, onPick: () => {}, onCancel: () => {} });
  // The provider's children go in as `createElement`'s third argument, which its props type cannot see.
  return renderToStaticMarkup(createElement(LocalizationProvider, { dateAdapter: AdapterDayjs, adapterLocale } as unknown as ComponentProps<typeof LocalizationProvider>, panel));
}

/** The columns, in order: each `role="listbox"` and the visible labels of its options. */
function columns(html: string): string[][] {
  return html
    .split(/<ul[^>]*role="listbox"/)
    .slice(1)
    .map((column) => [...column.split("</ul>")[0].matchAll(/<li[^>]*role="option"[^>]*>([^<]*)/g)].map((match) => match[1]));
}

/** The selected option's label in each column. */
function selected(html: string): string[] {
  return html
    .split(/<ul[^>]*role="listbox"/)
    .slice(1)
    .map((column) => /<li[^>]*aria-selected="true"[^>]*>([^<]*)/.exec(column.split("</ul>")[0])?.[1] ?? "");
}

const twoDigits = (count: number) => Array.from({ length: count }, (_, index) => String(index).padStart(2, "0"));
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

describe.each(["en", "en-gb", "ro"] as const)("§NNN the clock, under Day.js %s", (adapterLocale) => {
  it("has three columns: hours 00 to 23, minutes and seconds 00 to 59, one step each, and no AM/PM", () => {
    const html = draw(adapterLocale, { hours: 13, minutes: 5, seconds: 9 });
    expect(columns(html)).toEqual([twoDigits(24), twoDigits(60), twoDigits(60)]);
    expect(text(html)).not.toMatch(/\b[ap]\.?m\.?\b/i);
    expect(html).not.toMatch(/meridiem/i);
  });

  it("opens at the time it is given, selected in each column", () => {
    expect(selected(draw(adapterLocale, { hours: 13, minutes: 5, seconds: 9 }))).toEqual(["13", "05", "09"]);
    expect(selected(draw(adapterLocale, { hours: 1, minutes: 23, seconds: 45 }))).toEqual(["01", "23", "45"]);
    expect(selected(draw(adapterLocale, MIDNIGHT))).toEqual(["00", "00", "00"]);
  });
});

describe("§NNN the picker's words and buttons", () => {
  const button = (html: string, testId: string) => new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";

  it("says its one line of help and names whose time it is", () => {
    for (const inDialog of [false, true]) {
      const html = draw("ro", { hours: 0, minutes: 45, seconds: 12 }, inDialog);
      expect(html).toContain('data-testid="time-picker-help"');
      expect(text(html)).toContain("Zecimile (mm:ss.t) se scriu în căsuță");
      expect(html).toMatch(/id="time-picker-title"[^>]*>Timp: #101 Ana Popescu</);
      expect(text(html)).toContain("Anulează");
    }
  });

  it("lets «OK» go only once a time is picked: 0:00:00 is no race time", () => {
    expect(button(draw("ro", MIDNIGHT), "time-picker-ok")).toMatch(/\sdisabled(=""|\s|>)/);
    expect(button(draw("ro", { hours: 0, minutes: 0, seconds: 1 }), "time-picker-ok")).not.toMatch(/\sdisabled/);
    expect(button(draw("ro", MIDNIGHT), "time-picker-cancel")).not.toMatch(/\sdisabled/);
    for (const testId of ["time-picker-ok", "time-picker-cancel"]) expect(button(draw("ro", MIDNIGHT), testId)).toContain('type="button"');
    expect(isMidnight(MIDNIGHT)).toBe(true);
    expect(isMidnight({ hours: 0, minutes: 0, seconds: 1 })).toBe(false);
  });
});

describe("§NNN writeBox: a picked or normalized time reaches the box as typing would", () => {
  it("sets the value, then an input and a change event that bubble — and nothing for a box that already holds it", () => {
    const heard: Array<{ type: string; bubbles: boolean }> = [];
    const box = { value: "12345", dispatchEvent: (event: Event) => heard.push({ type: event.type, bubbles: event.bubbles }) > 0 };
    expect(writeBox(box, "1:23:45")).toBe(true);
    expect(box.value).toBe("1:23:45");
    expect(heard).toEqual([
      { type: "input", bubbles: true },
      { type: "change", bubbles: true },
    ]);
    expect(writeBox(box, "1:23:45")).toBe(false);
    expect(heard).toHaveLength(2);
  });
});

describe("§NNN the picker is loaded on the first press, and only there", () => {
  function sources(directory: string): string[] {
    return readdirSync(path.join(ROOT, directory)).flatMap((entry) => {
      const relative = `${directory}/${entry}`;
      if (statSync(path.join(ROOT, relative)).isDirectory()) return sources(relative);
      return /\.(ts|tsx)$/.test(entry) ? [relative] : [];
    });
  }
  const SRC = sources("src").map((file) => ({ file, text: read(file) }));

  it("is imported by the host alone, and dynamically: no file imports it statically", () => {
    const naming = SRC.filter(({ text: source }) => /["'](?:\.\/|@\/shared\/forms\/pickers\/)ClockPicker["']/.test(source)).map(({ file }) => file);
    expect(naming).toEqual(["src/shared/forms/pickers/ClockPickerHost.tsx"]);
    const host = read("src/shared/forms/pickers/ClockPickerHost.tsx");
    expect(host).toMatch(/lazy\(\(\) => import\("\.\/ClockPicker"\)\)/);
    expect(host).not.toMatch(/^import[^;]*from "\.\/ClockPicker";/m);
  });

  it("is the one file of the clock to import MUI X's clock; the host and the lines import no MUI X and no Day.js", () => {
    const clockImporters = SRC.filter(({ text: source }) => source.includes("@mui/x-date-pickers/MultiSectionDigitalClock")).map(({ file }) => file);
    expect(clockImporters).toEqual(["src/shared/forms/pickers/ClockPicker.tsx"]);
    for (const file of ["src/shared/forms/pickers/ClockPickerHost.tsx", "src/shared/forms/pickers/clock-values.ts", "src/modules/results/ui/ResultRows.tsx", "src/modules/results/domain/result-time.ts"]) {
      expect(read(file), file).not.toMatch(/from "(?:@mui\/x-date-pickers[^"]*|dayjs[^"]*)"/);
    }
  });

  it("pins the 24-hour clock where the clock is drawn, and picks every minute and every second", () => {
    const picker = read("src/shared/forms/pickers/ClockPicker.tsx");
    expect(picker).toContain("ampm={false}");
    expect(picker).toMatch(/views=\{VIEWS\}/);
    expect(picker).toMatch(/const VIEWS = \["hours", "minutes", "seconds"\] as const;/);
    expect(picker).toMatch(/const EVERY_ONE = \{ hours: 1, minutes: 1, seconds: 1 \} as const;/);
  });
});
