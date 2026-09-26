import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { RecallProvider } from "@/shared/forms/recall";
import { DATE_PATTERN, TIME_PATTERN } from "@/shared/forms/pickers/wall-values";

/**
 * `DateField` and `TimeField` without JavaScript (`DECISIONS.md` §345, §315, and §345's time
 * amendment): what a browser with the picker's script never run receives.
 *
 * `DateField`'s scriptless box is what `DatePickerInput` replaces once the island runs —
 * `useIslandRunning` reports `false` under `renderToStaticMarkup` the same way it does on a real
 * server render (`useSyncExternalStore`'s server snapshot), so this exercises the exact branch a
 * JavaScript-off request gets, not a stand-in for it. `TimeField` has no island to swap out any
 * more: since §400 and §439 it renders a typed 24-hour text box the same way with or without
 * JavaScript, so this is simply what it always renders.
 */
const ROOT = path.resolve(__dirname, "../../..");
const messages = JSON.parse(readFileSync(path.join(ROOT, "messages/en.json"), "utf8")) as { Admin: { pickers: Record<string, string> } };

function renderField(node: ReactNode, recall?: { values: Record<string, string[]> | null; fields?: string[] }): string {
  const withRecall = recall
    ? createElement(
        RecallProvider,
        {
          value: { values: recall.values, fields: recall.fields ?? [], generation: recall.values ? 1 : 0, fieldError: "Verifică acest câmp." },
        } as unknown as ComponentProps<typeof RecallProvider>,
        node,
      )
    : node;
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      // The children go in as `createElement`'s third argument, which the props type cannot see
      // (`form-recall.test.ts`'s own workaround for the same shape of provider).
      { locale: "en", messages: { Admin: { pickers: messages.Admin.pickers } } } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      withRecall,
    ),
  );
}

describe("DateField without JavaScript", () => {
  it("is a plain text input posting under the field's own name, with the YYYY-MM-DD pattern", () => {
    const html = renderField(createElement(DateField, { name: "event.startsAtDate", label: "Începe", defaultValue: "2026-11-21" }));
    expect(html).toContain('name="event.startsAtDate"');
    expect(html).toContain('value="2026-11-21"');
    expect(html).toContain(`pattern="${DATE_PATTERN}"`);
    // No picker script ran, so this is an ordinary MUI TextField, not the DatePicker's markup —
    // which would carry a calendar button and its own aria wiring.
    expect(html).not.toContain("aria-label");
  });

  it("carries no value for an empty box, and the placeholder still says the shape", () => {
    const html = renderField(createElement(DateField, { name: "takenOn", label: "Data" }));
    expect(html).toContain('name="takenOn"');
    expect(html).toContain('value=""');
    expect(html).toContain(`placeholder="${messages.Admin.pickers.datePlaceholder}"`);
  });

  it("brings back a refused submit's value rather than the page's own default", () => {
    const html = renderField(createElement(DateField, { name: "repeat.until", label: "Până la", defaultValue: "2026-01-01" }), {
      values: { "repeat.until": ["2026-12-25"] },
    });
    expect(html).toContain('value="2026-12-25"');
    expect(html).not.toContain('value="2026-01-01"');
  });

  it("follows a controlled `value` over both the default and the recalled one", () => {
    const html = renderField(
      createElement(DateField, { name: "event.schedule[0].date", label: "Data", defaultValue: "2026-01-01", value: "2026-09-30" }),
      { values: { "event.schedule[0].date": ["2026-12-25"] } },
    );
    expect(html).toContain('value="2026-09-30"');
  });

  it("marks itself when the refusal named this box", () => {
    const html = renderField(createElement(DateField, { name: "takenOn", label: "Data" }), {
      values: { takenOn: [""] },
      fields: ["takenOn"],
    });
    expect(html).toMatch(/Verifică acest câmp\./);
  });
});

describe("TimeField, a typed box on the 24-hour clock (§439)", () => {
  it("is a text box that shows and posts HH:mm under the field's own name — never the browser's AM/PM time control", () => {
    const html = renderField(createElement(TimeField, { name: "event.startsAtTime", label: "Ora", defaultValue: "19:00" }));
    expect(html).toContain('name="event.startsAtTime"');
    // `type="time"` is drawn in the browser's locale: "07:00 PM" on an English Chrome (§400).
    expect(html).not.toContain('type="time"');
    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('maxLength="5"');
    expect(html).toContain('value="19:00"');
    expect(html).toContain(`pattern="${TIME_PATTERN}"`);
    expect(html).toContain(`placeholder="${messages.Admin.pickers.timePlaceholder}"`);
    expect(html).not.toMatch(/[AP]M\b/);
  });

  it("brings back a refused submit's value rather than the page's own default", () => {
    const html = renderField(createElement(TimeField, { name: "event.startsAtTime", label: "Ora", defaultValue: "09:00" }), {
      values: { "event.startsAtTime": ["18:30"] },
    });
    expect(html).toContain('value="18:30"');
    expect(html).not.toContain('value="09:00"');
  });

  it("carries a clear button by default for an optional box, and none for a required one", () => {
    const optional = renderField(createElement(TimeField, { name: "event.schedule[0].endTime", label: "Ora de final", defaultValue: "10:00" }));
    expect(optional).toContain(`aria-label="${messages.Admin.pickers.clearTime}"`);

    const required = renderField(createElement(TimeField, { name: "event.startsAtTime", label: "Ora", defaultValue: "09:00", required: true }));
    expect(required).not.toContain(`aria-label="${messages.Admin.pickers.clearTime}"`);
  });

  it("drops a caller's own clear button when clearable is turned off (WallTimeField's time half)", () => {
    const html = renderField(createElement(TimeField, { name: "event.startsAtTime", label: "Ora", defaultValue: "09:00", clearable: false }));
    expect(html).not.toContain(`aria-label="${messages.Admin.pickers.clearTime}"`);
  });

  it("carries no AccessTime adornment and no rule about a browser picker indicator", () => {
    const html = renderField(createElement(TimeField, { name: "event.startsAtTime", label: "Ora", defaultValue: "19:00" }));
    expect(html).not.toContain('data-testid="AccessTimeIcon"');
    expect(html).not.toContain("calendar-picker-indicator");
  });
});
