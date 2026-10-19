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

type AskSettings = ComponentProps<typeof RegistrationBox>["rsvpAsk"];

async function render(event: EditableEvent, locale: "ro" | "en" = "ro", rsvpAsk?: AskSettings): Promise<string> {
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
    ...(rsvpAsk ? { rsvpAsk } : {}),
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
    expect(markup).toContain(helpOf(markup));
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
  });
});

/** The text of the help the block draws under the tick, as the browser reads it (markup tags and entities gone). */
function helpOf(markup: string): string {
  const at = markup.indexOf('data-testid="rsvp-ask-help"');
  expect(at, "the tick's help is drawn").toBeGreaterThan(-1);
  const open = markup.indexOf(">", at) + 1;
  return decode(markup.slice(open, markup.indexOf("</p>", open)));
}

const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const settingsOf = (markup: string): string => {
  const at = markup.indexOf('data-testid="rsvp-ask-settings"');
  expect(at, "the settings links are drawn").toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf("</p>", at));
};

/** Whether the question's tick is drawn disabled, and whether a hidden field carries its answer in its place. */
const disabled = (markup: string) => /\sdisabled(=|\s|\/|>)/.test(tickOf(markup));
const carried = (markup: string) => /<input type="hidden" name="event\.rsvpAskEnabled" value="on"\/>/.test(markup);

describe("§823 the tick says what it does, in the club's own numbers", () => {
  it("names the email, the buttons, who gets it, when and from what hour — with the platform's defaults when the page says nothing", async () => {
    expect(ro.Admin.editor.rsvpAskEnabled).toBe("Trimite emailul „Vii?” înainte de această dată");
    expect(en.Admin.editor.rsvpAskEnabled).toBe("Send the “Coming?” email before this date");
    expect(helpOf(await render(RUN))).toBe(
      "Cu bifa, abonații newsletterului la „Întrebarea «Vii?» înaintea alergărilor” sau la „Toate noutățile” primesc cu o zi înainte de start, la 08:00, un email „Vii mâine la …?” cu butoanele „Vin” și „Nu vin”. Debifat, emailul nu pleacă pentru această dată; răspunsurile din pagină merg oricum.",
    );
    expect(helpOf(await render(RUN, "en"))).toBe(
      "Ticked, the newsletter's subscribers to “The ‘Coming?’ question before runs” or to “All the news” get, one day before the start, at 08:00, an email “Coming to … tomorrow?” with the buttons “I'm coming” and “I'm not coming”. Unticked, the email is not sent for this date; answers on the page still work.",
    );
  });

  it("reads the club's days and hour: three days says «poimâine»'s successor «peste 3 zile», and the hour is the club's", async () => {
    const markup = await render(RUN, "ro", { daysBefore: 3, hour: 17, audience: "SUBSCRIBERS" });
    expect(helpOf(markup)).toContain("primesc cu 3 zile înainte de start, la 17:00, un email „Vii peste 3 zile la …?”");
    expect(helpOf(await render(RUN, "ro", { daysBefore: 2, hour: 8, audience: "SUBSCRIBERS" }))).toContain("cu 2 zile înainte de start, la 08:00, un email „Vii poimâine la …?”");
    expect(helpOf(await render(RUN, "en", { daysBefore: 3, hour: 17, audience: "SUBSCRIBERS" }))).toContain("get, 3 days before the start, at 17:00, an email “Coming to … in 3 days?”");
  });

  it("says who by the club's choice in «Emailuri»: the subscribers, the earlier answerers, or both", async () => {
    const both = helpOf(await render(RUN, "ro", { daysBefore: 1, hour: 8, audience: "BOTH" }));
    expect(both).toContain("abonații newsletterului la „Întrebarea «Vii?» înaintea alergărilor” sau la „Toate noutățile” și cei care au răspuns „Vin!” la o dată anterioară a seriei primesc");
    const answerers = helpOf(await render(RUN, "ro", { daysBefore: 1, hour: 8, audience: "ANSWERERS" }));
    expect(answerers).toContain("Cu bifa, cei care au răspuns „Vin!” la o dată anterioară a aceleiași serii primesc");
    expect(answerers).not.toContain("newsletter");
    expect(helpOf(await render(RUN, "en", { daysBefore: 1, hour: 8, audience: "BOTH" }))).toContain("and those who answered “I'm coming!” at an earlier date of the series get");
  });

  it("with zero days says the email is off in «Termene», draws the tick disabled and still carries its answer", async () => {
    const off = await render(RUN, "ro", { daysBefore: 0, hour: 8, audience: "SUBSCRIBERS" });
    expect(helpOf(off)).toBe(ro.Admin.editor.rsvpAskEnabledHelpOff);
    expect(helpOf(off)).toContain("Setări → „Termene”");
    expect(disabled(off)).toBe(true);
    // Ticked on the event: the hidden field posts what the box would, so a save never unticks it.
    expect(carried(off)).toBe(true);
    // Unticked on the event: nothing is posted, as the box would post nothing.
    expect(carried(await render({ ...RUN, rsvpAskEnabled: false } as EditableEvent, "ro", { daysBefore: 0, hour: 8, audience: "SUBSCRIBERS" }))).toBe(false);
    // With days, the box is live and nothing stands in for it.
    const on = await render(RUN);
    expect(disabled(on)).toBe(false);
    expect(carried(on)).toBe(false);
    expect(helpOf(await render(RUN, "en", { daysBefore: 0, hour: 8, audience: "SUBSCRIBERS" }))).toBe(en.Admin.editor.rsvpAskEnabledHelpOff);
  });

  it("links «Termene» and «Emailuri» from the tick, and the first tick's help names the email only as a thing to tick below", async () => {
    const links = settingsOf(await render(RUN));
    expect(links).toContain("Schimbă în Setări:");
    expect(links).toContain('href="/admin/settings/deadlines"');
    expect(links).toContain('href="/admin/settings/emails"');
    expect(ro.Admin.editor.rsvpEnabledHelp).toContain("și, dacă bifezi mai jos, un email înainte");
    expect(en.Admin.editor.rsvpEnabledHelp).toContain("if you tick below, an email before");
  });
});
