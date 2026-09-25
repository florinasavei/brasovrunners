import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { DatePickerInput } from "@/shared/forms/pickers/DateField";
import PickerProvider from "@/shared/forms/pickers/PickerProvider";

/**
 * `DatePickerInput` — the date picker a page gets once the island runs — rendered on the
 * backoffice's own `PickerProvider` (`DECISIONS.md` §345, §303). `TimeField` no longer has a
 * running-island half of its own to test here: since §345 was amended (2026-09-25) it is the
 * platform's own `<input type="time">` from the first paint, server-rendered and
 * client-rendered alike (`pickers-js-off.test.ts` covers it, both languages).
 *
 * Two things, read from the markup, in both languages of the backoffice:
 *
 * - **What the form posts** is the hidden input under the field's name, in the service's shape
 *   (`2026-09-30`); the picker's own input carries no name, so nothing else posts.
 * - **What a person reads** is the sections, one `spinbutton` each, in the format's order — day,
 *   month, year — and the picker's own input's value, which spells them with their separators
 *   (`30.09.2026`).
 *
 * `pickers-js-off.test.ts` is the other branch of `DateField`: the scriptless box a page gets
 * before the island runs, or without JavaScript. A controlled `initial` moved after the first
 * render (the programme's rows following the start date) needs a browser, not a server render:
 * `cms-publish.spec.ts` checks it on a full page load of both pages that carry it.
 */

function render(locale: "ro" | "en", node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      // The children go in as `createElement`'s third argument, which the props type cannot see
      // (`pickers-js-off.test.ts`'s own workaround for the same provider).
      { locale, messages: {} } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      createElement(PickerProvider, null, node),
    ),
  );
}

/** The text of every `role="spinbutton"` element, in document order: the picker's sections. */
function sections(html: string): string[] {
  return [...html.matchAll(/<[^>]*role="spinbutton"[^>]*>([^<]*)</g)].map((match) => match[1]);
}

/** The `<input>` tags carrying `name="<name>"`: what the form would post under that name. */
function namedInputs(html: string, name: string): string[] {
  return [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes(`name="${name}"`));
}

const dateInput = (initial: string) =>
  createElement(DatePickerInput, {
    id: "start-date",
    name: "event.startsAtDate",
    label: "Începutul evenimentului",
    initial,
    required: true,
    error: false,
    refusal: "Data nu este completă.",
    clearable: false,
  });

describe.each(["ro", "en"] as const)("DatePickerInput, once the island runs (%s)", (locale) => {
  it("posts YYYY-MM-DD under the field's name, from one hidden input and nothing else", () => {
    const posted = namedInputs(render(locale, dateInput("2026-09-30")), "event.startsAtDate");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('type="hidden"');
    expect(posted[0]).toContain('value="2026-09-30"');
  });

  it("shows day, month and year, in that order, as 30.09.2026", () => {
    const html = render(locale, dateInput("2026-09-30"));
    expect(sections(html)).toEqual(["30", "09", "2026"]);
    expect(html).toContain('value="30.09.2026"');
  });

  it("posts nothing for an empty box", () => {
    const posted = namedInputs(render(locale, dateInput("")), "event.startsAtDate");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('value=""');
  });
});
