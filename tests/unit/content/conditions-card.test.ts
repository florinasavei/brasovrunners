import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import { healthNoteSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";

/**
 * §557 — «Condiții de participare» inside «Program, regulament și declarație» (the owner, 2026-09-29:
 * «trebuie să am o bifă și pentru acele informații medicale … deci e mai bine să avem o bifă în
 * backoffice la Condiții de participare»): a closed fold with a glyph, its line «Informații medicale:
 * da» / «nu», holding one tick and one sentence that names the days from the retention constant —
 * and the tick only where registration happens on the site (§111).
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

const { default: ConditionsBox } = await import("@/modules/content/events/ui/boxes/ConditionsBox");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  askHealthNote: false,
} as unknown as EditableEvent;

async function render(event: EditableEvent | null, mayEditSettings = true) {
  const element = await ConditionsBox({ event, mayEditSettings });
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element as ReactElement),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The `<details id="box-conditions">` element's markup, up to its own summary's end. */
function card(html: string): string {
  const start = html.indexOf('id="box-conditions"');
  expect(start, "the conditions card is drawn").toBeGreaterThan(-1);
  const open = html.lastIndexOf("<details", start);
  return html.slice(open, html.indexOf("</summary>", start) + "</summary>".length);
}

describe("§557 the «Condiții de participare» card", () => {
  it("is a closed fold with a glyph and «Informații medicale: nu» on an event that does not ask it", async () => {
    const html = await render(RACE);
    const head = card(html);
    expect(head).not.toMatch(/<details[^>]*\sopen/);
    expect(head).toContain("Condiții de participare");
    expect(head).toContain("Informații medicale: nu");
    expect(head).toContain('data-testid="MedicalServicesIcon"');
    expect(html).toContain('name="event.askHealthNote"');
    expect(html).not.toMatch(/<input[^>]*name="event.askHealthNote"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="event.askHealthNote.present"[^>]*value="1"/);
    expect(html).toContain(`se șterg la ${RETENTION_PERIODS.identityAndHealthDaysAfterEvent} zile după eveniment.`);
  });

  it("says «Informații medicale: da» and starts ticked on an event that asks it", async () => {
    const html = await render({ ...RACE, askHealthNote: true } as EditableEvent);
    expect(card(html)).toContain("Informații medicale: da");
    expect(html).toMatch(/<input[^>]*name="event.askHealthNote"[^>]*checked/);
  });

  it("keeps the tick in the document but says a group run has no form to ask it on (§111)", async () => {
    const html = await render({ ...RACE, type: "GROUP_RUN", registrationMode: "NONE" } as EditableEvent);
    expect(html).toContain('name="event.askHealthNote"');
    expect(html).toContain('data-testid="conditions-not-registering"');
    // Its line leaves the note out, as the outer card's does: there is no form to ask it on.
    expect(html).not.toContain("Informații medicale: ");
  });

  it("leaves the note out of its line on an event registering elsewhere (§111)", async () => {
    const html = await render({ ...RACE, registrationMode: "EXTERNAL", askHealthNote: true } as EditableEvent);
    expect(html).not.toContain("Informații medicale: ");
    expect(html).toContain('data-testid="conditions-not-here"');
  });

  it("is its heading and its line alone for a reader who may not change the event (§542)", async () => {
    const html = await render({ ...RACE, askHealthNote: true } as EditableEvent, false);
    expect(html).toContain("Informații medicale: da");
    expect(html).not.toContain('name="event.askHealthNote"');
  });

  it("names its words in both languages, plainly", () => {
    const roWords = ro.Admin.editor.boxes.summary as unknown as SummaryWords;
    const enWords = en.Admin.editor.boxes.summary as unknown as SummaryWords;
    expect(healthNoteSummary(roWords, true)).toBe("Informații medicale: da");
    expect(healthNoteSummary(roWords, false)).toBe("Informații medicale: nu");
    expect(healthNoteSummary(enWords, true)).toBe("Medical information: yes");
    expect(healthNoteSummary(enWords, false)).toBe("Medical information: no");
    expect(ro.Admin.editor.boxes.conditions.title).toBe("Condiții de participare");
    expect(en.Admin.editor.boxes.conditions.title).toBe("Participation conditions");
    expect(ro.Admin.editor.askHealthNote).toBe("Informații medicale");
    expect(en.Admin.editor.askHealthNote).toBe("Medical information");
    const sentences = [
      ro.Admin.editor.askHealthNoteHelp,
      en.Admin.editor.askHealthNoteHelp,
      ro.Admin.editor.boxes.conditions.onlyHere,
      en.Admin.editor.boxes.conditions.onlyHere,
      ro.Admin.editor.boxes.conditions.onlyRegisteringTypes,
      en.Admin.editor.boxes.conditions.onlyRegisteringTypes,
    ];
    for (const sentence of sentences) {
      expect(sentence.length).toBeLessThanOrEqual(200);
      expect(sentence).not.toMatch(/platform|de obicei|usually/i);
    }
    // The days are the retention constant's, never typed into the sentence.
    for (const help of [ro.Admin.editor.askHealthNoteHelp, en.Admin.editor.askHealthNoteHelp]) {
      expect(help).toContain("{days}");
      expect(help).not.toMatch(/\d/);
    }
    expect(PANEL_GLYPHS.conditions).toBeDefined();
  });
});
