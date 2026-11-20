import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { type SummaryWords, raffleSummary } from "@/modules/content/events/ui/box-summaries";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";
import { raffleSettingsMoved, type RaffleSettingsRow } from "@/modules/volunteers/domain/raffle";
import { revealField } from "@/shared/forms/ActionFormIsland";
import { type Recall, RecallProvider } from "@/shared/forms/recall";
import type { FoldNode } from "@/shared/ui/fold";

/**
 * §NNN, BR-REQ-050-02 — «Tombolă», a folded section of the event editor's race numbers' card (the owner, 2026-11-20: «plus că aici ar
 * trebui să fie o secțiune colapsată cu „Tombola”»; his other half, «vreau să le dau automat numere și voluntarilor», is the volunteers'
 * V series, numbered at «Confirmă»), rendered to the HTML the server sends:
 *
 * - every raffle box — «Avem tombolă», «Cine poate participa la tombolă» and its three ticks, «Cum participă», «Înscrierile la tombolă
 *   sunt deschise» — inside one level-4 fold `#box-raffle` of «Numere de concurs (BIB)», closed on arrival, with the same names and
 *   markers as before (the save is `tests/integration/cms/raffle-settings.test.ts`, unchanged);
 * - its bar's line: «nu avem», or who takes part and how, in both languages;
 * - open by itself right after the save that moved its boxes (`raffleSaved`), with the cards around it, and around a refused box — and
 *   which save that is (`raffleSettingsMoved`);
 * - nothing about the volunteers' numbers: no line under «Voluntarii», no way to a numbers form, since every confirmed volunteer wears
 *   a V number by themselves.
 *
 * The page's flag, the save's answer and the tab's way in are `tests/integration/volunteers/raffle-fold.test.ts`.
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

type Extra = Pick<Parameters<typeof RegistrationBox>[0], "raffleSaved">;

/** The box as the server streams it: inside a kept form's recall when one is given, with or without Emotion's styles. */
async function render(event: EditableEvent, options: { locale?: "ro" | "en"; extra?: Extra; recall?: Recall; styles?: boolean } = {}): Promise<string> {
  const locale = options.locale ?? "ro";
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
    ...options.extra,
  })) as ReactElement;
  const inner = options.recall ? createElement(RecallProvider, { value: options.recall } as ComponentProps<typeof RecallProvider>, element) : element;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>, inner));
  await stream.allReady;
  const html = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return options.styles ? html : html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** The opening tag of the fold whose id is given: open or not, its heading's level, and where it is. */
function fold(markup: string, id: string): { open: boolean; heading: string; at: number } {
  const at = markup.indexOf(`id="${id}"`);
  expect(at, `#${id} is drawn`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<", at);
  const tag = markup.slice(start, markup.indexOf(">", at) + 1);
  expect(tag.startsWith("<details"), `#${id} is a fold`).toBe(true);
  return { open: /\sopen(=|\s|>)/.test(tag), heading: /<(h[2-5])\b/.exec(markup.slice(at))?.[1] ?? "", at };
}

/** The fold's whole markup, from its `<details …>` to its own `</details>`, the folds inside it counted. */
function foldMarkup(markup: string, id: string): string {
  const start = markup.lastIndexOf("<details", markup.indexOf(`id="${id}"`));
  const tags = /<(\/?)details\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return markup.slice(start, match.index + match[0].length);
  }
  throw new Error(`#${id} never closes`);
}

const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The fold's closed line: its summary's own words (its heading and its aside). */
const bar = (markup: string, id: string) => {
  const own = foldMarkup(markup, id);
  return own.slice(own.indexOf("<summary"), own.indexOf("</summary>")).replace(/<[^>]+>/g, "");
};

/** Every name the raffle's boxes post — the markers and the select included — exactly as §984 drew them. */
const RAFFLE_NAMES = [
  "event.hasRaffle",
  "event.hasRaffle.present",
  "event.raffleRunners",
  "event.raffleRunners.present",
  "event.raffleElites",
  "event.raffleElites.present",
  "event.raffleVolunteers",
  "event.raffleVolunteers.present",
  "event.raffleSignUp",
  "event.raffleSignUpOpen",
  "event.raffleSignUpOpen.present",
];
const posted = (markup: string) => [...markup.matchAll(/<(?:input|textarea|select)\b[^>]*?\sname="([^"]+)"/g)].map((match) => match[1]);

/**
 * The element as `revealField` reads it — the box a refusal named, inside the folds the markup puts it in — so the proof walks the same
 * chain `ActionForm` hands it (`event-list-row-folds.test.ts`'s shape).
 */
function refusedInside(markup: string, name: string): { node: HTMLElement; folds: FoldNode[] } {
  const at = markup.indexOf(`name="${name}"`);
  expect(at, `${name} is in the markup`).toBeGreaterThan(-1);
  const stack: boolean[] = [];
  for (const match of markup.slice(0, at).matchAll(/<(\/?)details\b[^>]*>/g)) {
    if (match[1] === "/") stack.pop();
    else stack.push(/\sopen(=""|\s|>)/.test(match[0]));
  }
  let parent: FoldNode | null = null;
  const chain: FoldNode[] = [];
  for (const open of stack) {
    const node: FoldNode = { tagName: "DETAILS", open, parentElement: parent };
    chain.push(node);
    parent = node;
  }
  return { node: { tagName: "SELECT", parentElement: parent, dispatchEvent: () => true } as unknown as HTMLElement, folds: chain };
}

const SETTINGS: RaffleSettingsRow = { hasRaffle: true, raffleRunners: true, raffleElites: true, raffleVolunteers: true, raffleSignUp: false, raffleSignUpOpen: false };

describe("§NNN BR-REQ-050-02 «Tombolă»: one fold of «Numere de concurs (BIB)» for everything about the raffle", () => {
  it("holds «Avem tombolă» and every setting under it, closed on arrival, a level-4 fold inside the race numbers' card", async () => {
    const markup = await render(RACE);
    const raffle = fold(markup, "box-raffle");
    expect(raffle.open).toBe(false);
    expect(raffle.heading).toBe("h4");
    // Inside «Numere de concurs (BIB)», itself closed, under the first number's box.
    const bibs = foldMarkup(markup, "box-bibs");
    expect(bibs).toContain('id="box-raffle"');
    expect(fold(markup, "box-bibs").open).toBe(false);
    expect(bibs.indexOf('name="event.bibStartNumber"')).toBeLessThan(bibs.indexOf('id="box-raffle"'));
    // Its heading wears the raffle's own glyph, the wrapped prize, before its title.
    const own = foldMarkup(markup, "box-raffle");
    expect(own).toMatch(/<h4\b[^>]*><svg[^>]*data-testid="RedeemIcon"/);
    expect(words(own)).toContain(`${ro.Admin.editor.raffle.title} `);
    // Every raffle box is inside it, once, by the name §984 gave it — and none outside it.
    const inside = posted(own);
    for (const name of RAFFLE_NAMES) expect(inside.filter((one) => one === name), name).toHaveLength(1);
    const outside = posted(markup.replace(own, ""));
    for (const name of RAFFLE_NAMES) expect(outside, name).not.toContain(name);
    // «Avem tombolă» first, then the settings under it, as they were.
    expect(inside.indexOf("event.hasRaffle")).toBeLessThan(inside.indexOf("event.raffleRunners"));
    expect(own).toContain('data-testid="raffle-settings"');
  });

  it("keeps every name the editor posted: the save reads the same boxes (`editor-fewer-cards-render.test.ts` lists them all)", async () => {
    const names = posted(await render(RACE));
    for (const name of RAFFLE_NAMES) expect(names.filter((one) => one === name), name).toHaveLength(1);
  });

  it("says on its bar «nu avem» while there is no raffle, else who takes part and how — in Romanian", async () => {
    const title = ro.Admin.editor.raffle.title;
    expect(bar(await render({ ...RACE, hasRaffle: false } as EditableEvent), "box-raffle")).toBe(`${title}nu avem`);
    expect(bar(await render(RACE), "box-raffle")).toBe(`${title}Alergători, elite, voluntari · din oficiu`);
    expect(bar(await render({ ...RACE, raffleElites: false, raffleVolunteers: false, raffleSignUp: true } as EditableEvent), "box-raffle")).toBe(`${title}Alergători · cu înscriere separată`);
    expect(bar(await render({ ...RACE, raffleRunners: false, raffleElites: false } as EditableEvent), "box-raffle")).toBe(`${title}Voluntari · din oficiu`);
    expect(bar(await render({ ...RACE, raffleRunners: false, raffleElites: false, raffleVolunteers: false } as EditableEvent), "box-raffle")).toBe(`${title}Nicio grupă bifată · din oficiu`);
  });

  it("says it in English on the English editor", async () => {
    const title = en.Admin.editor.raffle.title;
    expect(title).toBe("Raffle");
    expect(bar(await render({ ...RACE, hasRaffle: false } as EditableEvent, { locale: "en" }), "box-raffle")).toBe(`${title}none`);
    expect(bar(await render(RACE, { locale: "en" }), "box-raffle")).toBe(`${title}Runners, elites, volunteers · automatically`);
    expect(bar(await render({ ...RACE, raffleRunners: false, raffleSignUp: true } as EditableEvent, { locale: "en" }), "box-raffle")).toBe(`${title}Elites, volunteers · with a separate sign-up`);
  });

  it("reads its line from the saved event alone, the same function on create, where there is no raffle yet", () => {
    const roWords = ro.Admin.editor.boxes.summary as unknown as SummaryWords;
    expect(raffleSummary(roWords, null, "ro")).toBe("nu avem");
    expect(raffleSummary(roWords, { ...RACE, raffleSignUpOpen: true } as EditableEvent, "ro")).toBe("Alergători, elite, voluntari · din oficiu");
    expect(raffleSummary(en.Admin.editor.boxes.summary as unknown as SummaryWords, { ...RACE, raffleElites: false } as EditableEvent, "en")).toBe("Runners, volunteers · automatically");
  });

  it("opens by itself right after the save that moved its boxes, with «Numere de concurs (BIB)» and the card around it", async () => {
    const saved = await render(RACE, { extra: { raffleSaved: true } });
    for (const id of ["box-registration", "box-bibs", "box-raffle"]) expect(fold(saved, id).open, id).toBe(true);
    // The race numbers' other folds stay as they were: only the raffle's own save opened anything.
    expect(fold(saved, "box-kit").open).toBe(false);
    const plain = await render(RACE, { extra: { raffleSaved: false } });
    for (const id of ["box-registration", "box-bibs", "box-raffle"]) expect(fold(plain, id).open, id).toBe(false);
  });

  it("opens around a box a refusal names: every fold «Cum participă» sits in, with scripts on and off", async () => {
    const markup = await render(RACE);
    // With scripts on, `ActionForm` hands the refused box to `revealField`, which opens the card, the race numbers and «Tombolă».
    const { node, folds } = refusedInside(markup, "event.raffleSignUp");
    expect(folds).toHaveLength(3);
    expect(folds.every((one) => !one.open)).toBe(true);
    revealField(node);
    expect(folds.every((one) => one.open)).toBe(true);
    // With scripts off, the refused post renders the page afresh, the box marked as the refusal named it inside the closed fold — whose
    // body the backoffice fold shows while a named box is inside it (`BOXED_DISCLOSURE_SX`).
    const refused = await render(RACE, { recall: { values: { "event.raffleSignUp": ["maybe"] }, fields: ["event.raffleSignUp"], generation: 1, fieldError: "Verifică acest câmp." }, styles: true });
    expect(fold(refused, "box-raffle").open).toBe(false);
    const own = foldMarkup(refused, "box-raffle");
    expect(own).toMatch(/<select\b[^>]*aria-invalid="true"[^>]*name="event\.raffleSignUp"|<select\b[^>]*name="event\.raffleSignUp"[^>]*aria-invalid="true"/);
    expect(refused).toContain(":not([open]):has([aria-invalid='true'])::details-content");
  });
});

describe("§NNN BR-REQ-050-02 the save that opens «Tombolă»: one that moved a raffle setting", () => {
  it("is any of the six settings moved, and never a save that wrote them as they were", () => {
    expect(raffleSettingsMoved(SETTINGS, { ...SETTINGS })).toBe(false);
    for (const column of ["hasRaffle", "raffleRunners", "raffleElites", "raffleVolunteers", "raffleSignUp", "raffleSignUpOpen"] as const) {
      expect(raffleSettingsMoved(SETTINGS, { ...SETTINGS, [column]: !SETTINGS[column] }), column).toBe(true);
    }
  });

  it("reads the raffle's columns alone: anything else on the row moving opens nothing", () => {
    // Whole rows, as the save hands them over: the other columns ride along and are never read.
    const before = { ...SETTINGS, capacity: 100, title: "Crosul" };
    const after = { ...before, capacity: 150, title: "Crosul Tâmpei" };
    expect(raffleSettingsMoved(before, after)).toBe(false);
  });
});

describe("§NNN BR-REQ-050-02 nothing in the fold about the volunteers' numbers: each confirmed volunteer wears a V number by themselves", () => {
  it("draws «Voluntarii» with its tick and its help alone — no count, no way to a numbers form — in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      const own = foldMarkup(await render(RACE, { locale }), "box-raffle");
      expect(own, locale).toContain('name="event.raffleVolunteers"');
      expect(words(own), locale).toContain((locale === "ro" ? ro : en).Admin.editor.raffle.volunteersHelp);
      expect(own, locale).not.toContain('data-testid="raffle-volunteers-without-number"');
      expect(own, locale).not.toContain("#box-volunteer-numbers");
      expect(words(own), locale).not.toMatch(/Numerele voluntarilor încep de la|Volunteers' numbers start at|nu au număr|have no number/);
    }
  });

  it("keeps no words for such a line in either catalogue", () => {
    for (const catalogue of [ro, en]) {
      expect(Object.keys(catalogue.Admin.raffle)).not.toContain("volunteersWithoutNumber");
      expect(Object.keys(catalogue.Admin.raffle)).not.toContain("volunteersWithoutNumberLink");
    }
  });
});
