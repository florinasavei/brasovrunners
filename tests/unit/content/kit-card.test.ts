import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import { kitSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";

/**
 * §NNN — «Kit de participare» in card 6 «Participanți și înscrieri» (the owner, 2026-09-29: «o
 * subsecțiune cu kit de participare, și doar dacă e bifat tricoul să avem alegerea mărimii în
 * formular»): a fold of its own with a glyph, closed by default, its line «Tricou: da» / «Tricou:
 * nu», holding one tick and one sentence — and only where registration happens on the site, inside
 * the block a group run never shows (§111).
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href }, children as string), getPathname: () => "/" };
});

// The bib's design reads the club's settings from the database; not what this reads.
vi.mock("@/modules/content/events/ui/BibDesignPanel", () => ({ default: () => null }));

const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  timezone: "Europe/Bucharest",
  startsAt: new Date("2026-11-21T08:00:00Z"),
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  bibStartNumber: 1,
  bibColour: null,
  bibDesign: null,
  declarationDocumentId: null,
  reminderHoursBefore: null,
  kitShirt: false,
} as unknown as EditableEvent;

async function render(event: EditableEvent | null) {
  const element = await RegistrationBox({
    event,
    mayEditSettings: true,
    declarations: [],
    bibCounts: null,
    locale: "ro",
    now: new Date("2026-10-01T08:00:00Z"),
    clubDeadlines: { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 },
  } as Parameters<typeof RegistrationBox>[0]);
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element as ReactElement),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The `<details id="box-kit">` element's markup, up to its own summary's end. */
function kitCard(html: string): string {
  const start = html.indexOf('id="box-kit"');
  expect(start, "the kit card is drawn").toBeGreaterThan(-1);
  const open = html.lastIndexOf("<details", start);
  return html.slice(open, html.indexOf("</summary>", start) + "</summary>".length);
}

describe("§NNN the race kit card", () => {
  it("is a closed fold with a glyph and «Tricou: nu» on an event without a shirt", async () => {
    const html = await render(RACE);
    const card = kitCard(html);
    expect(card).not.toMatch(/<details[^>]*\sopen/);
    expect(card).toContain("Kit de participare");
    expect(card).toContain("Tricou: nu");
    expect(card).toContain('data-testid="CheckroomIcon"');
    expect(html).toContain('name="event.kitShirt"');
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="event.kitShirt.present"[^>]*value="1"/);
    expect(html).toContain("Dacă e bifat, formularul cere mărimea tricoului.");
  });

  it("says «Tricou: da» and starts ticked on an event with a shirt", async () => {
    const html = await render({ ...RACE, kitShirt: true } as EditableEvent);
    expect(kitCard(html)).toContain("Tricou: da");
    expect(html).toMatch(/<input[^>]*name="event.kitShirt"[^>]*checked/);
  });

  it("sits inside the on-site registration block, which a group run never shows (§111)", async () => {
    const html = await render({ ...RACE, type: "GROUP_RUN", registrationMode: "NONE" } as EditableEvent);
    // The card is in the document, hidden with its block, so a switch back finds the tick.
    const kit = html.indexOf('id="box-kit"');
    const capacity = html.indexOf('name="event.capacity"');
    const bibs = html.indexOf('id="box-bibs"');
    expect(kit).toBeGreaterThan(capacity);
    expect(kit).toBeLessThan(bibs);
    expect(html).toContain('data-testid="group-run-no-registration"');
  });

  it("names its words in both languages, plainly", () => {
    const roWords = ro.Admin.editor.boxes.summary as unknown as SummaryWords;
    const enWords = en.Admin.editor.boxes.summary as unknown as SummaryWords;
    expect(kitSummary(roWords, true)).toBe("Tricou: da");
    expect(kitSummary(roWords, false)).toBe("Tricou: nu");
    expect(kitSummary(enWords, true)).toBe("T-shirt: yes");
    expect(kitSummary(enWords, false)).toBe("T-shirt: no");
    expect(ro.Admin.editor.boxes.kit.title).toBe("Kit de participare");
    expect(en.Admin.editor.boxes.kit.title).toBe("Race kit");
    expect(ro.Admin.editor.kitShirt).toBe("Tricou");
    expect(en.Admin.editor.kitShirt).toBe("T-shirt");
    for (const help of [ro.Admin.editor.kitShirtHelp, en.Admin.editor.kitShirtHelp]) {
      expect(help.length).toBeLessThanOrEqual(200);
      expect(help).not.toMatch(/platform|de obicei|usually/i);
    }
    expect(PANEL_GLYPHS.kit).toBeDefined();
  });
});
