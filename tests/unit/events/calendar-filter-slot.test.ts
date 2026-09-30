import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@mui/material/styles";
import CalendarFilterSlot from "@/modules/events/ui/CalendarFilterSlot";
import { theme } from "@/theme/theme";

/**
 * BR-REQ-041-01 criterion 12 (§NNN, amending §413) — the calendar's controls do not move when the
 * month changes, so the «Filtre» slot above them is the same box in every month.
 *
 * Found by `event-pages.spec.ts` on 2026-09-30, the last day of a month whose one remaining event
 * offered nothing to filter: the static calendar had no panel, the next month's had one, and the
 * arrows moved 44 px on a phone and 60 on a desktop. Rendered to HTML the way the server sends it,
 * with Emotion's styles beside it: the panel is always in the markup, and held only by
 * `visibility: hidden` — which keeps its box — never by `display: none` or by leaving it out.
 */

const ROOT = path.resolve(__dirname, "../../..");

async function render(element: ReturnType<typeof createElement>): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

const cssOnly = (html: string) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
const markupOnly = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

const slot = (shown: boolean) =>
  createElement(
    ThemeProvider,
    { theme } as unknown as ComponentProps<typeof ThemeProvider>,
    createElement(CalendarFilterSlot, { shown }, createElement("details", { "data-testid": "listing-filters" }, createElement("summary", null, "Filtre"))),
  );

describe("BR-REQ-041-01 criterion 12: the calendar's filter slot does not depend on the month", () => {
  it("renders the panel, visible, when the month has something to offer", async () => {
    const html = await render(slot(true));
    expect(markupOnly(html)).toContain('data-testid="listing-filters"');
    expect(markupOnly(html)).not.toContain("data-held");
    expect(cssOnly(html)).not.toContain("visibility:hidden");
  });

  it("still renders the panel when there is nothing to offer, holding its box unseen", async () => {
    const html = await render(slot(false));
    // The same markup, so the same height at every width.
    expect(markupOnly(html)).toContain('data-testid="listing-filters"');
    expect(markupOnly(html)).toContain('data-held="true"');
    expect(cssOnly(html)).toContain("visibility:hidden");
    // Never a rule that takes the box away.
    expect(cssOnly(html)).not.toContain("display:none");
  });

  it("is the one way the calendar page draws its panel", () => {
    const page = readFileSync(path.join(ROOT, "src/app/[locale]/calendar/page.tsx"), "utf8");
    expect(page).toMatch(/<CalendarFilterSlot shown=\{[^}]*offersAnything\(offer\)/);
    // The panel inside the slot is the one whose form and chips go to the period's own path.
    expect(page).toMatch(/<CalendarFilterSlot shown=\{[^}]*\}>\s*<ListingFilterPanel\b[^>]*\bpath=\{periodPath\}[^>]*\/>\s*<\/CalendarFilterSlot>/);
    // The conditional render §413 had is gone: a `&&` in front of the panel would drop the box again.
    expect(page).not.toMatch(/&&\s*\(\s*<Box[^>]*>\s*<ListingFilterPanel/);
  });

  it("is the page every period's path and both live twins render, with no panel of their own", () => {
    // A period at its own path (`/ro/calendar/2026-10`, `/ro/calendar/2026-10/list`, `/ro/calendar/2026`)
    // is `calendar/[...period]/page.tsx`, which renders the bare calendar's page with the path's segments;
    // the live twins, which answer a filter, render those two. None of them draws a panel or a slot, so
    // the slot above is the one rule at every address a month or a year can have.
    const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
    const renders: Record<string, RegExp> = {
      "src/app/[locale]/calendar/[...period]/page.tsx": /<CalendarPage [^>]*period=\{period\}/,
      "src/app/[locale]/live/calendar/page.tsx": /<CalendarPage [^>]*query=\{searchParams\}/,
      "src/app/[locale]/live/calendar/[...period]/page.tsx": /<CalendarPeriodPage [^>]*query=\{searchParams\}/,
    };
    expect(read("src/app/[locale]/calendar/[...period]/page.tsx")).toMatch(/import CalendarPage from "\.\.\/page";/);
    expect(read("src/app/[locale]/live/calendar/[...period]/page.tsx")).toMatch(/import CalendarPeriodPage from "\.\.\/\.\.\/\.\.\/calendar\/\[\.\.\.period\]\/page";/);
    for (const [file, render] of Object.entries(renders)) {
      const source = read(file);
      expect(source, file).toMatch(render);
      expect(source, file).not.toContain("ListingFilterPanel");
      expect(source, file).not.toContain("CalendarFilterSlot");
    }
  });
});
