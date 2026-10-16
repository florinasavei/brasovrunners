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
 * §557, moved in §799 — «Condiții de participare» as a group inside «Regulamentul» (the owner,
 * 2026-10-16: «cardul ăsta ar trebui mutat în ăsta»): a level-4 boxed section with a glyph, holding
 * one tick — «Informații medicale» — and one sentence that names the days from the retention
 * constant, and the tick only where registration happens on the site (§111). The rules card's own
 * line and the whole editor are pinned in `editor-fewer-cards-render.test.ts`.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

const { default: ConditionsGroup, asksHealthNoteOnForm } = await import("@/modules/content/events/ui/boxes/ConditionsGroup");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  askHealthNote: false,
} as unknown as EditableEvent;

async function render(event: EditableEvent | null, mayEditSettings = true) {
  const element = await ConditionsGroup({ event, mayEditSettings });
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element as ReactElement),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§799 the «Condiții de participare» group", () => {
  it("is a boxed section, not a fold, with a level-4 heading and a glyph before the words", async () => {
    const html = await render(RACE);
    expect(html).toMatch(/^<section[^>]*data-testid="conditions-group"/);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain('id="box-conditions"');
    const heading = /<h4\b[^>]*>(.*?)<\/h4>/.exec(html)?.[1] ?? "";
    expect(heading).toContain('data-testid="MedicalServicesIcon"');
    expect(heading.indexOf("Condiții de participare")).toBeGreaterThan(heading.indexOf("MedicalServicesIcon"));
  });

  it("holds the unticked tick, its marker and the days on an event that does not ask the note", async () => {
    const html = await render(RACE);
    expect(html).toContain('name="event.askHealthNote"');
    expect(html).not.toMatch(/<input[^>]*name="event.askHealthNote"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="event.askHealthNote.present"[^>]*value="1"/);
    expect(html).toContain(`se șterg la ${RETENTION_PERIODS.identityAndHealthDaysAfterEvent} zile după eveniment.`);
  });

  it("starts ticked on an event that asks it", async () => {
    const html = await render({ ...RACE, askHealthNote: true } as EditableEvent);
    expect(html).toMatch(/<input[^>]*name="event.askHealthNote"[^>]*checked/);
  });

  it("keeps the tick in the document but says a group run has no form to ask it on (§111)", async () => {
    const html = await render({ ...RACE, type: "GROUP_RUN", registrationMode: "NONE" } as EditableEvent);
    expect(html).toContain('name="event.askHealthNote"');
    expect(html).toContain('data-testid="conditions-not-registering"');
  });

  it("says the note is for events registering on the site on an event registering elsewhere (§111)", async () => {
    const html = await render({ ...RACE, registrationMode: "EXTERNAL", askHealthNote: true } as EditableEvent);
    expect(html).toContain('data-testid="conditions-not-here"');
  });

  it("is its heading and its line alone for a reader who may not change the event (§542)", async () => {
    const html = await render({ ...RACE, askHealthNote: true } as EditableEvent, false);
    expect(html).toContain("Informații medicale: da");
    expect(html).not.toContain('name="event.askHealthNote"');
    // Where there is no form, a reader gets the heading alone.
    const none = await render({ ...RACE, type: "GROUP_RUN", registrationMode: "NONE", askHealthNote: true } as EditableEvent, false);
    expect(none).not.toContain("Informații medicale");
  });

  it("asks the form only for a type that takes registrations, registering on the site", () => {
    expect(asksHealthNoteOnForm(RACE)).toBe(true);
    expect(asksHealthNoteOnForm({ ...RACE, registrationMode: "EXTERNAL" } as EditableEvent)).toBe(false);
    expect(asksHealthNoteOnForm({ ...RACE, registrationMode: "NONE" } as EditableEvent)).toBe(false);
    expect(asksHealthNoteOnForm({ ...RACE, type: "GROUP_RUN" } as EditableEvent)).toBe(false);
    // A new event is a group run with no registration.
    expect(asksHealthNoteOnForm(null)).toBe(false);
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
