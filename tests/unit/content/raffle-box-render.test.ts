import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";

/**
 * §984, BR-REQ-050-02 — the raffle's settings in the event editor, rendered (the owner, 2026-11-18: «trebuie să bifez acolo cine se
 * poate înscrie: doar alergătorii și elitele și voluntarii» and «Vreau să pot bifa asta: tombolă din oficiu vs tombolă cu înscriere
 * separată»): under «Avem tombolă», in «Numere de concurs», «Cine poate participa la tombolă» — «Alergătorii», «Elitele»,
 * «Voluntarii», each ticked by default and posted with its marker —, «Cum participă» — «Din oficiu» by default or «Cu înscriere
 * separată», a native select that always posts one of its two — and «Înscrierile la tombolă sunt deschise», unticked by default.
 * What the saved event says is what the boxes say. In both languages. The saving is `tests/integration/cms/raffle-settings.test.ts`.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Admin" }),
    getLocale: async () => state.locale,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href }, children as string), getPathname: () => "/ro/evenimente/x" };
});
// The bib's design reads the club's settings from the database; not what this reads.
vi.mock("@/modules/content/events/ui/BibDesignPanel", () => ({ default: () => null }));
vi.mock("@/modules/media/storage", async (importOriginal) => ({ ...(await importOriginal<object>()), isStorageConfigured: () => false }));

const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  timezone: "Europe/Bucharest",
  startsAt: new Date("2026-11-21T08:00:00Z"),
  capacity: 150,
  minAge: 14,
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  bibStartNumber: 1,
  bibColour: null,
  bibDesign: null,
  declarationDocumentId: "22222222-2222-2222-2222-222222222222",
  reminderHoursBefore: null,
  kitShirt: false,
  hasRaffle: true,
  raffleRunners: true,
  raffleElites: true,
  raffleVolunteers: true,
  raffleSignUp: false,
  raffleSignUpOpen: false,
  participantListVisibility: "HIDDEN",
  scheduleItems: null,
  costType: "FREE",
  featured: false,
  isSpecial: false,
  coverMediaAssetId: null,
} as unknown as EditableEvent;

const language = (locale: "ro" | "en"): LanguageEntry => ({
  translation: { ...blankTranslation(locale), title: locale === "ro" ? "Crosul Tâmpei" : "Tampa Cross", excerpt: "x", slug: locale === "ro" ? "crosul-tampei" : "tampa-cross" },
  mayEdit: true,
  label: locale === "ro" ? "Română" : "English",
});
const declarations = [{ id: "22222222-2222-2222-2222-222222222222", key: "EVENT_DECLARATION_ROAD" as const, version: 3, title: "Declarație" }];

async function box(event: EditableEvent, locale: "ro" | "en" = "ro"): Promise<string> {
  state.locale = locale;
  const { NextIntlClientProvider } = await import("next-intl");
  const element = (await RegistrationBox({
    event,
    mayEditSettings: true,
    languages: [language("ro"), language("en")],
    declarations,
    locale,
    clubDeadlines: { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 },
    heading: "6",
  })) as ReactElement;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

/** The raffle's settings block, from its own test id to the end of its markup. */
function settingsOf(markup: string): string {
  const at = markup.indexOf('data-testid="raffle-settings"');
  expect(at, "the raffle's settings are drawn").toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf("<", at));
}
/** The `<input>` tag posting `name`. */
function inputOf(markup: string, name: string): string {
  const match = new RegExp(`<input\\b[^>]*\\sname="${name.replace(/\./g, "\\.")}"[^>]*>`).exec(markup);
  expect(match, `${name} is posted`).not.toBeNull();
  return match?.[0] ?? "";
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const checked = (tag: string) => /\schecked(=|\s|\/|>)/.test(tag);

describe("§984 BR-REQ-050-02 «Avem tombolă» and the raffle's settings beside it", () => {
  it("asks who may take part — the three groups ticked by default, each with its marker — how, and whether the sign-ups are open", async () => {
    const settings = settingsOf(await box(RACE));
    const text = words(settings);
    for (const sentence of [ro.Admin.editor.raffle.who, ro.Admin.editor.raffle.runners, ro.Admin.editor.raffle.elites, ro.Admin.editor.raffle.volunteers, ro.Admin.editor.raffle.how, ro.Admin.editor.raffle.open]) {
      expect(text).toContain(sentence);
    }
    for (const group of ["raffleRunners", "raffleElites", "raffleVolunteers"]) {
      expect(checked(inputOf(settings, `event.${group}`)), group).toBe(true);
      expect(inputOf(settings, `event.${group}.present`)).toMatch(/value="1"/);
    }
    // «Cum»: the two answers, «Din oficiu» chosen; the open tick unticked, with its marker.
    const select = /<select\b[^>]*name="event\.raffleSignUp"[^>]*>([\s\S]*?)<\/select>/.exec(settings);
    expect(select, "«Cum» is a native select").not.toBeNull();
    expect([...(select?.[1] ?? "").matchAll(/<option\b[^>]*value="([^"]+)"/g)].map((m) => m[1])).toEqual(["false", "true"]);
    expect(select?.[1]).toMatch(/<option[^>]*value="false"[^>]*selected/);
    expect(words(select?.[1] ?? "")).toBe(`${ro.Admin.editor.raffle.howAutomatic} ${ro.Admin.editor.raffle.howSignUp}`);
    expect(checked(inputOf(settings, "event.raffleSignUpOpen"))).toBe(false);
    expect(inputOf(settings, "event.raffleSignUpOpen.present")).toMatch(/value="1"/);
  });

  it("draws what the saved event says", async () => {
    const settings = settingsOf(await box({ ...RACE, raffleElites: false, raffleSignUp: true, raffleSignUpOpen: true } as EditableEvent));
    expect(checked(inputOf(settings, "event.raffleRunners"))).toBe(true);
    expect(checked(inputOf(settings, "event.raffleElites"))).toBe(false);
    expect(checked(inputOf(settings, "event.raffleVolunteers"))).toBe(true);
    expect(/<select\b[^>]*name="event\.raffleSignUp"[^>]*>([\s\S]*?)<\/select>/.exec(settings)?.[1]).toMatch(/<option[^>]*value="true"[^>]*selected/);
    expect(checked(inputOf(settings, "event.raffleSignUpOpen"))).toBe(true);
  });

  it("keeps the settings under «Avem tombolă» while it is unticked too — hidden, still posted", async () => {
    const markup = await box({ ...RACE, hasRaffle: false } as EditableEvent);
    expect(checked(inputOf(markup, "event.hasRaffle"))).toBe(false);
    const settings = settingsOf(markup);
    expect(checked(inputOf(settings, "event.raffleRunners"))).toBe(true);
  });

  it("speaks English on the English editor", async () => {
    const text = words(settingsOf(await box(RACE, "en")));
    for (const sentence of [en.Admin.editor.raffle.who, en.Admin.editor.raffle.runners, en.Admin.editor.raffle.elites, en.Admin.editor.raffle.volunteers, en.Admin.editor.raffle.how, en.Admin.editor.raffle.howAutomatic, en.Admin.editor.raffle.howSignUp, en.Admin.editor.raffle.open]) {
      expect(text).toContain(sentence);
    }
    expect(text).not.toContain(ro.Admin.editor.raffle.who);
  });
});
