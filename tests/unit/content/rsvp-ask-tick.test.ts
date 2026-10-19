import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";

/**
 * §823 — the event editor's tick «Trimite întrebarea „Vii?” înainte de acest eveniment», rendered: under «Acceptă răspunsuri „Vin!”»,
 * a real tick box (never a toggle button), on by default, with the marker that tells the server the form carried it, shown only while
 * «Acceptă răspunsuri» is ticked (hidden, never removed — `OnlyWhenTicked`) and only on an event one simply turns up to.
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin" }),
    getLocale: async () => lang.current,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href }, children as string), getPathname: () => "/ro/evenimente/x" };
});
vi.mock("@/modules/content/events/ui/BibDesignPanel", () => ({ default: () => null }));

const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");

const RUN = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  registrationMode: "NONE",
  timezone: "Europe/Bucharest",
  startsAt: new Date("2026-11-22T08:00:00Z"),
  capacity: null,
  minAge: 0,
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  bibStartNumber: 1,
  bibColour: null,
  bibDesign: null,
  declarationDocumentId: null,
  reminderHoursBefore: null,
  kitShirt: false,
  participantListVisibility: "HIDDEN",
  scheduleItems: null,
  costType: "FREE",
  featured: false,
  isSpecial: false,
  coverMediaAssetId: null,
  rsvpEnabled: true,
  rsvpAskEnabled: true,
} as unknown as EditableEvent;

const language = (locale: "ro" | "en"): LanguageEntry => ({
  translation: { ...blankTranslation(locale), title: locale === "ro" ? "Alergarea de duminică" : "Sunday run", slug: locale === "ro" ? "alergare" : "run" },
  mayEdit: true,
  label: locale === "ro" ? "Română" : "English",
});

async function render(event: EditableEvent, locale: "ro" | "en" = "ro"): Promise<string> {
  lang.current = locale;
  const messages = locale === "ro" ? ro : en;
  const { NextIntlClientProvider } = await import("next-intl");
  const element = (await RegistrationBox({
    event,
    mayEditSettings: true,
    languages: [language("ro"), language("en")],
    declarations: [],
    locale,
    clubDeadlines: { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 },
    heading: "6 · Participare",
  })) as ReactElement;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale, messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const tickOf = (markup: string) => /<input\b[^>]*name="event\.rsvpAskEnabled"[^>]*>/.exec(markup)?.[0] ?? "";

/** Whether the block that carries the tick is the hidden one (`ShownWhen` marks a block it hides with `data-hidden-block`). */
function hidden(markup: string): boolean {
  const at = markup.indexOf('data-testid="rsvp-ask-enabled"');
  expect(at, "the tick's block is drawn").toBeGreaterThan(-1);
  const inner = markup.lastIndexOf("<div", at);
  const wrapper = markup.slice(markup.lastIndexOf("<div", inner - 1), inner);
  return wrapper.includes("data-hidden-block");
}

describe("§823 the editor's tick for the «Vii?» question", () => {
  it("draws a real tick box with the marker, checked by default, under «Acceptă răspunsuri „Vin!”»", async () => {
    const markup = await render({ ...RUN, rsvpAskEnabled: undefined } as unknown as EditableEvent);
    expect(markup).toContain('<input type="hidden" name="event.rsvpAskEnabled.present" value="1"/>');
    const tick = tickOf(markup);
    expect(tick).toContain('type="checkbox"');
    expect(tick).toMatch(/\schecked(=|\s|\/|>)/);
    expect(markup).toContain(ro.Admin.editor.rsvpAskEnabled);
    expect(markup).toContain(ro.Admin.editor.rsvpAskEnabledHelp);
    // After the tick it hangs under, never before it.
    expect(markup.indexOf('name="event.rsvpEnabled"')).toBeLessThan(markup.indexOf('name="event.rsvpAskEnabled"'));
    // A tick box, not a button with a toggle glyph (the owner's rule).
    expect(markup).not.toMatch(/<button[^>]*rsvpAskEnabled/);
  });

  it("draws it unchecked for an event whose club unticked it, and checked for one that kept it", async () => {
    expect(tickOf(await render({ ...RUN, rsvpAskEnabled: false } as EditableEvent))).not.toMatch(/\schecked(=|\s|\/|>)/);
    expect(tickOf(await render({ ...RUN, rsvpAskEnabled: true } as EditableEvent))).toMatch(/\schecked(=|\s|\/|>)/);
  });

  it("shows it while «Acceptă răspunsuri» is ticked and hides it, still in the document, while it is not", async () => {
    expect(hidden(await render({ ...RUN, rsvpEnabled: true } as EditableEvent))).toBe(false);
    const off = await render({ ...RUN, rsvpEnabled: false } as EditableEvent);
    expect(hidden(off)).toBe(true);
    // Hidden, never removed: a form saved while it is hidden still posts the club's answer.
    expect(tickOf(off)).toContain('type="checkbox"');
  });

  it("says it in English too, with the same names posted", async () => {
    const markup = await render(RUN, "en");
    expect(markup).toContain(en.Admin.editor.rsvpAskEnabled);
    expect(markup).toContain('name="event.rsvpAskEnabled.present"');
    expect(en.Admin.editor.rsvpAskEnabledHelp.length).toBeLessThanOrEqual(200);
    expect(ro.Admin.editor.rsvpAskEnabledHelp.length).toBeLessThanOrEqual(200);
  });
});
