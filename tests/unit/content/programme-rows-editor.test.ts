import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { RiskMark } from "@/modules/content/events/ui/boxes/box-kit";
import ro from "../../../messages/ro.json";

/**
 * §NNN (BR-REQ-050-02 criterion 13, building on §117, §362, §398) — the owner, 2026-09-25, of the
 * editor's «Programul zilei și ce să aduci»: "This is super ugly and inconsistent."
 *
 * The box is rendered to the HTML the server sends, because what is being fixed is the markup:
 * - how the rows work is the compact «i» help fold (§398's `Panel variant="help"`), closed, not a
 *   paragraph standing over the rows; with people registered the sentence about them joins it;
 * - one grid per row, a named group, its boxes in reading order — when, where, what in Romanian,
 *   what in English — and the bin last;
 * - the spare line opens on the event's start date, not on an empty box that a calendar opens on
 *   today, and on nothing on the create page, where the start is not typed yet.
 *
 * The layout by the list's own width (the container query) is CSS, which a server render cannot
 * measure; `tests/e2e/cms-publish.spec.ts` measures it on a phone and on a desktop.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

// The per-language notes are async Server Components inside a render prop; a string renderer cannot
// wait for them, and they are not what this is about.
vi.mock("@/modules/content/events/ui/boxes/TextBoxes", () => ({ LanguageTabs: () => null }));
vi.mock("@/modules/content/events/ui/TranslationFields", () => ({ ProgrammeTextFields: () => null }));

const { default: ProgrammeBox } = await import("@/modules/content/events/ui/boxes/ProgrammeBox");

const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

const EVENT = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  // 00:30 on the 10th in Brașov, still the 9th in UTC: the start date is the event's zone's.
  startsAt: new Date("2027-05-09T21:30:00.000Z"),
  scheduleItems: null,
  translations: [],
} as unknown as EditableEvent;

const WITH_ROWS = {
  ...EVENT,
  scheduleItems: [{ startsAt: "2027-05-10T07:00:00.000Z", endsAt: null, label: { ro: "Startul", en: "The start" }, place: "Cortul" }],
} as unknown as EditableEvent;

const RISK: RiskMark = { count: 23, chip: "23 înscriși" };

async function box(event: EditableEvent | null, risk: RiskMark | null = null): Promise<string> {
  const element = (await ProgrammeBox({ event, mayEditSettings: true, risk, languages: [] })) as ReactElement;
  return markup(
    renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>,
        element,
      ),
    ),
  );
}

/** The `value` of the one input posted under `name`. */
function valueOf(html: string, name: string): string | undefined {
  const tag = html.match(new RegExp(`<input\\b[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`))?.[0];
  return tag?.match(/\svalue="([^"]*)"/)?.[1] ?? (tag ? "" : undefined);
}

describe("BR-REQ-050-02 criterion 13 — the programme's help is the compact «i» fold (§398, §NNN)", () => {
  it("folds the explanation under one closed line with the «i», before the rows", async () => {
    const html = await box(EVENT);
    const fold = html.match(/<details[^>]*data-testid="programme-help"[^>]*>/)?.[0];
    expect(fold, "a help fold").toBeDefined();
    expect(fold).not.toMatch(/\sopen/);
    const help = html.slice(html.indexOf('data-testid="programme-help"'));
    expect(help.slice(0, help.indexOf("</summary>"))).toContain(ro.Admin.editor.programmeHelpSummary);
    expect(help.slice(0, help.indexOf("</summary>"))).toContain('data-testid="InfoOutlinedIcon"');
    expect(html.indexOf(ro.Admin.editor.programmeHelp)).toBeGreaterThan(html.indexOf('data-testid="programme-help"'));
    expect(html.indexOf(ro.Admin.editor.programmeHelp)).toBeLessThan(html.indexOf('name="event.schedule[0].date"'));
  });

  it("with people registered: the box stays amber with the count, and the sentence about them is in the fold, not an amber box", async () => {
    const html = await box(EVENT, RISK);
    expect(html).toContain("23 înscriși");
    expect(html).not.toContain('data-testid="risk-line"');
    const help = html.slice(html.indexOf('data-testid="programme-help"'), html.indexOf('name="event.schedule[0].date"'));
    expect(help).toContain('data-testid="programme-risk"');
    expect(help).toContain(ro.Admin.editor.risk.programme.slice(0, 40));
    expect(await box(EVENT)).not.toContain('data-testid="programme-risk"');
  });
});

describe("BR-REQ-050-02 criterion 13 — one grid per row, in reading order (§NNN)", () => {
  it("draws each row as a named group whose boxes read when, where, what (română), what (engleză), and the bin last", async () => {
    const html = await box(WITH_ROWS);
    const start = html.indexOf('role="group" aria-label="Rândul 1"');
    expect(start).toBeGreaterThan(-1);
    const row = html.slice(start);
    const order = ["date", "time", "endTime", "place", "ro", "en"].map((field) => row.indexOf(`name="event.schedule[0].${field}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(row.indexOf('aria-label="Șterge rândul 1"')).toBeGreaterThan(order[order.length - 1]);
    // The row as it was stored, in the event's zone.
    expect(valueOf(html, "event.schedule[0].date")).toBe("2027-05-10");
    expect(valueOf(html, "event.schedule[0].time")).toBe("10:00");
    expect(valueOf(html, "event.schedule[0].place")).toBe("Cortul");
  });

  it("adds a row with the same text button as the editor's other lists", async () => {
    const html = await box(WITH_ROWS);
    const add = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Adaugă un rând<\/button>/)?.[0] ?? "";
    expect(add).toContain('type="button"');
    expect(add).toContain("MuiButton-text");
    expect(add).toContain('data-testid="AddIcon"');
  });
});

describe("BR-REQ-050-02 criterion 13 — a row's default day is the event's start date (§NNN)", () => {
  it("opens the spare line on the event's start date, in the event's zone", async () => {
    expect(valueOf(await box(EVENT), "event.schedule[0].date")).toBe("2027-05-10");
  });

  it("opens it empty on the create page, where the start date is not typed yet", async () => {
    expect(valueOf(await box(null), "event.schedule[0].date")).toBe("");
  });
});
