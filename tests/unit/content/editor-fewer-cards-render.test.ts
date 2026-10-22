import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";

/**
 * §760 — the event editor in fewer cards, rendered: the cards are the HTML the server sends, so what
 * is pinned here is what the markup holds — each named card a `<details>` inside its card's, with its
 * id, closed by default, its heading a level below, and the parent's closed line short.
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
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href }, children as string), getPathname: () => "/ro/evenimente/x" };
});

// The bib's design reads the club's settings from the database; not what this reads.
vi.mock("@/modules/content/events/ui/BibDesignPanel", () => ({ default: () => null }));
// A picture store on or off per test; with one on, the event has no cover, so nothing asks the database.
const storage = vi.hoisted(() => ({ configured: false }));
vi.mock("@/modules/media/storage", async (importOriginal) => ({ ...(await importOriginal<object>()), isStorageConfigured: () => storage.configured }));

const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");
const { default: KindBox } = await import("@/modules/content/events/ui/boxes/KindBox");
const { TitleSummaryBox } = await import("@/modules/content/events/ui/boxes/TextBoxes");

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
  declarationDocumentId: null,
  reminderHoursBefore: null,
  kitShirt: false,
  participantListVisibility: "HIDDEN",
  scheduleItems: null,
  costType: "FREE",
  featured: false,
  isSpecial: false,
  coverMediaAssetId: null,
} as unknown as EditableEvent;

const language = (locale: "ro" | "en", slug = true): LanguageEntry => ({
  translation: {
    ...blankTranslation(locale),
    title: locale === "ro" ? "Crosul Tâmpei" : "Tampa Cross",
    excerpt: locale === "ro" ? "Un cros pe Tâmpa." : "A cross on Tâmpa.",
    slug: slug ? (locale === "ro" ? "crosul-tampei" : "tampa-cross") : "",
  },
  mayEdit: true,
  label: locale === "ro" ? "Română" : "English",
});

async function html(element: ReactElement): Promise<string> {
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** The opening tag of the `<details>` whose id is given, and its own heading's tag name. */
function fold(markup: string, id: string): { open: boolean; heading: string; at: number } {
  const at = markup.indexOf(`id="${id}"`);
  expect(at, `#${id} is drawn`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<", at);
  const tag = markup.slice(start, markup.indexOf(">", at) + 1);
  expect(tag.startsWith("<details"), `#${id} is a fold`).toBe(true);
  const heading = /<(h[2-5])\b/.exec(markup.slice(at))?.[1] ?? "";
  return { open: /\sopen(=|\s|>)/.test(tag), heading, at };
}

/** The closed line of the `<details>` whose id is given: its summary's text. */
function line(markup: string, id: string): string {
  const at = markup.indexOf(`id="${id}"`);
  const summary = markup.slice(markup.indexOf("<summary", at), markup.indexOf("</summary>", at));
  return summary.replace(/<[^>]+>/g, "");
}

const deadlines = { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 };
const declarations = [{ id: "22222222-2222-2222-2222-222222222222", key: "EVENT_DECLARATION_ROAD" as const, version: 3, title: "Declarație" }];

describe("§760 «Participare, înscrieri și regulament»", () => {
  it("holds what were cards 6 and 9 as closed named cards, in the order a registration happens", async () => {
    const markup = await html(
      (await RegistrationBox({
        event: { ...RACE, declarationDocumentId: declarations[0].id } as EditableEvent,
        mayEditSettings: true,
        languages: [language("ro"), language("en")],
        declarations,
        locale: "ro",
        clubDeadlines: deadlines,
        heading: "6 · Participare, înscrieri și regulament — apare pe pagină",
      })) as ReactElement,
    );
    const outer = fold(markup, "box-registration");
    expect(outer.heading).toBe("h2");
    expect(markup).toContain("6 · Participare, înscrieri și regulament — apare pe pagină");
    const ids = ["box-registration-window", "box-confirmation", "box-reminder", "box-rules", "box-declaration", "box-schedule", "box-kit", "box-bibs", "box-start-list"];
    const cards = ids.map((id) => fold(markup, id));
    // Inside the card, in that order, each closed, each a level below.
    expect(cards.map((card) => card.at)).toEqual([...cards.map((card) => card.at)].sort((a, b) => a - b));
    for (const [index, card] of cards.entries()) {
      expect(card.at, ids[index]).toBeGreaterThan(outer.at);
      expect(card.open, ids[index]).toBe(false);
      expect(card.heading, ids[index]).toBe("h3");
    }
    // The fields are the ones both cards posted, once each.
    for (const name of ["event.registrationMode", "event.capacity", "event.minAge", "event.declarationDocumentId", "event.askHealthNote", "event.kitShirt", "event.bibStartNumber", "event.participantListVisibility"]) {
      expect(markup.split(`name="${name}"`).length - 1, name).toBe(1);
    }
    // No sentence sending the reader to another card.
    expect(markup).not.toContain('data-testid="declaration-moved"');
  });

  it("says the registration, the programme, the rules and the age, briefly, on its closed line", async () => {
    const markup = await html(
      (await RegistrationBox({
        event: { ...RACE, declarationDocumentId: declarations[0].id } as EditableEvent,
        mayEditSettings: true,
        languages: [language("ro"), language("en")],
        declarations,
        locale: "ro",
        clubDeadlines: deadlines,
      })) as ReactElement,
    );
    const closed = line(markup, "box-registration");
    expect(closed).toContain("Participare, înscrieri și regulament");
    expect(closed).toContain("150");
    expect(closed).toContain("v3");
    expect(closed).toContain("regulamentul:");
    expect(closed).toContain("14");
    expect(closed.length).toBeLessThan(260);
    // No medical information asked: said, as old card 9's line said it (§557).
    expect(closed).toContain(ro.Admin.editor.boxes.summary.health.notAsked);
    expect(closed).toContain(ro.Admin.editor.boxes.summary.registration.listHidden);
  });

  it("keeps old card 9's disclosures on its closed line: the waiting list public too, and the medical question asked", async () => {
    const markup = await html(
      (await RegistrationBox({
        event: { ...RACE, declarationDocumentId: declarations[0].id, participantListVisibility: "NAMES", waitlistPublic: true, askHealthNote: true } as EditableEvent,
        mayEditSettings: true,
        languages: [language("ro"), language("en")],
        declarations,
        locale: "ro",
        clubDeadlines: deadlines,
      })) as ReactElement,
    );
    const closed = line(markup, "box-registration");
    expect(closed).toContain(ro.Admin.editor.boxes.summary.registration.listShownWithWaitlist);
    expect(closed).toContain(ro.Admin.editor.boxes.summary.health.asked);
    // Not for a group run: no form, no medical question.
    const groupRun = await html(
      (await RegistrationBox({
        event: { ...RACE, type: "GROUP_RUN", registrationMode: "NONE", askHealthNote: true } as EditableEvent,
        mayEditSettings: true,
        languages: [language("ro"), language("en")],
        declarations,
        locale: "ro",
        clubDeadlines: deadlines,
      })) as ReactElement,
    );
    expect(line(groupRun, "box-registration")).not.toContain(ro.Admin.editor.boxes.summary.health.asked);
  });

  it("opens itself while a race registering here has no declaration, and keeps its cards for a reader", async () => {
    const missing = await html(
      (await RegistrationBox({ event: RACE, mayEditSettings: true, languages: [language("ro"), language("en")], declarations, locale: "ro", clubDeadlines: deadlines })) as ReactElement,
    );
    expect(fold(missing, "box-registration").open).toBe(true);
    const reader = await html(
      (await RegistrationBox({ event: RACE, mayEditSettings: false, languages: [language("ro"), language("en")], declarations, locale: "ro", clubDeadlines: deadlines })) as ReactElement,
    );
    expect(reader).toContain(ro.Admin.editor.boxes.settingsReadOnly);
    // The rules' texts stay the reader's to write in the languages they may; the settings are their lines.
    expect(reader).toContain('id="box-rules"');
    expect(reader).toContain('id="box-start-list"');
    expect(reader).not.toContain('name="event.capacity"');
  });
});

/** The markup of «Regulamentul» (`#box-rules`): from its opening tag to the declaration card that follows it. */
function rulesCard(markup: string): string {
  const start = markup.indexOf('id="box-rules"');
  expect(start, "#box-rules is drawn").toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf("<details", start), markup.indexOf('id="box-declaration"', start));
}

/** Every `name="…"` a form control in the markup posts, in document order. */
function postedNames(markup: string): string[] {
  return [...markup.matchAll(/<(?:input|textarea|select)\b[^>]*?\sname="([^"]+)"/g)].map((match) => match[1]);
}

describe("§799 «Condiții de participare» inside «Regulamentul»", () => {
  const registration = async (event: EditableEvent, mayEditSettings = true) =>
    html(
      (await RegistrationBox({
        event,
        mayEditSettings,
        languages: [language("ro"), language("en")],
        declarations,
        locale: "ro",
        clubDeadlines: deadlines,
      })) as ReactElement,
    );

  it("is a group at the foot of the rules card, under the minimum age and outside the language tabs", async () => {
    const rules = rulesCard(await registration({ ...RACE, declarationDocumentId: declarations[0].id } as EditableEvent));
    const group = rules.indexOf('data-testid="conditions-group"');
    expect(group, "the group is inside #box-rules").toBeGreaterThan(-1);
    // After the tabs and the minimum age: the tick is not translated text.
    expect(group).toBeGreaterThan(rules.indexOf('name="event.minAge"'));
    expect(group).toBeGreaterThan(rules.lastIndexOf('name="rules"'));
    // A level-4 heading with the glyph before the words: a fold, an optional part (the editor's two shapes), as «Clubul pe lista publică».
    const section = rules.slice(rules.lastIndexOf("<details", group));
    expect(section).toMatch(/<h4\b[^>]*>(?:<svg[^>]*data-testid="MedicalServicesIcon")/);
    expect(section.indexOf("Condiții de participare")).toBeGreaterThan(section.indexOf('data-testid="MedicalServicesIcon"'));
    expect(section).toContain('name="event.askHealthNote"');
    expect(section).toContain(`se șterg la ${RETENTION_PERIODS.identityAndHealthDaysAfterEvent} zile după eveniment.`);
    // Unticked at the start; its marker posts with it.
    expect(section).not.toMatch(/<input[^>]*name="event.askHealthNote"[^>]*checked/);
    expect(section).toMatch(/<input[^>]*type="hidden"[^>]*name="event.askHealthNote.present"[^>]*value="1"/);
  });

  it("says «Informații medicale: da/nu» last on the rules card's closed line, and starts ticked when asked", async () => {
    const asked = rulesCard(await registration({ ...RACE, askHealthNote: true, declarationDocumentId: declarations[0].id } as EditableEvent));
    expect(asked).toMatch(/<input[^>]*name="event.askHealthNote"[^>]*checked/);
    expect(line(asked, "box-rules")).toMatch(/vârsta minimă 14 ani · Informații medicale: da$/);
    const unticked = rulesCard(await registration({ ...RACE, declarationDocumentId: declarations[0].id } as EditableEvent));
    expect(line(unticked, "box-rules")).toMatch(/vârsta minimă 14 ani · Informații medicale: nu$/);
  });

  it("leaves the health words off the closed line, and says why, where there is no form to ask it on (§111)", async () => {
    const groupRun = rulesCard(await registration({ ...RACE, type: "GROUP_RUN", registrationMode: "NONE", askHealthNote: true } as EditableEvent));
    expect(line(groupRun, "box-rules")).not.toContain("Informații medicale");
    expect(groupRun).toContain('data-testid="conditions-not-registering"');
    const elsewhere = rulesCard(await registration({ ...RACE, registrationMode: "EXTERNAL", askHealthNote: true } as EditableEvent));
    expect(line(elsewhere, "box-rules")).not.toContain("Informații medicale");
    expect(elsewhere).toContain('data-testid="conditions-not-here"');
    // Hidden, never removed: the tick stays in the document for a form that switches the mode back.
    expect(elsewhere).toContain('name="event.askHealthNote"');
  });

  it("is its heading and its line alone for a reader who may not change the event (§542)", async () => {
    const rules = rulesCard(await registration({ ...RACE, askHealthNote: true } as EditableEvent, false));
    expect(rules).toContain('data-testid="conditions-group"');
    expect(rules).toContain("Informații medicale: da");
    expect(rules).not.toContain('name="event.askHealthNote"');
  });

  it("leaves no card of its own, and posts the two names it always posted, once each", async () => {
    const markup = await registration({ ...RACE, declarationDocumentId: declarations[0].id } as EditableEvent);
    expect(markup).not.toContain('id="box-conditions"');
    const names = postedNames(markup);
    expect(names.filter((name) => name === "event.askHealthNote")).toHaveLength(1);
    expect(names.filter((name) => name === "event.askHealthNote.present")).toHaveLength(1);
    // The tick sits between the minimum age and the declaration's choice, in the rules card.
    expect(names.indexOf("event.minAge")).toBeLessThan(names.indexOf("event.askHealthNote.present"));
    expect(names.indexOf("event.askHealthNote.present")).toBeLessThan(names.indexOf("event.askHealthNote"));
    expect(names.indexOf("event.askHealthNote")).toBeLessThan(names.indexOf("event.declarationDocumentId"));
  });

  it("posts exactly the names the editor posted before the move, for a race registering on the site", async () => {
    // Taken from the editor as it was before the move (BR-V3.48): the same controls, only the tick's place in the
    // document changed. A name added or lost here is a field the server reads differently.
    const before = [
      "event.askHealthNote", "event.askHealthNote.present", "event.bibStartNumber", "event.capacity", "event.confirmationDeadlineDaysBefore",
      "event.confirmationOpensDaysBefore", "event.declarationDocumentId", "event.externalProvider", "event.externalRegistrationUrl", "event.hiddenList.present",
      "event.hiddenListBibStart", "event.hiddenListCounted", "event.hiddenListEnabled", "event.hiddenListPublic", "event.kitShirt", "event.kitShirt.present",
      "event.minAge", "event.participantCountPublic", "event.participantCountPublic.present", "event.participantListVisibility", "event.publicListClub",
      "event.publicListClub", "event.publicListClub", "event.registrationClosesAtDate", "event.registrationClosesAtTime", "event.registrationMode",
      "event.registrationOpensAtDate", "event.registrationOpensAtTime", "event.registrationOpensSoon", "event.registrationOpensSoon.present",
      "event.reminderHoursBefore", "event.rsvpAskEnabled", "event.rsvpAskEnabled.present", "event.rsvpEnabled", "event.rsvpEnabled.present", "event.schedule[0].date", "event.schedule[0].en", "event.schedule[0].endTime", "event.schedule[0].place",
      "event.schedule[0].ro", "event.schedule[0].time", "event.waitlistAutoOffer", "event.waitlistCapacity", "event.waitlistCountPublic",
      "event.waitlistCountPublic.present", "event.waitlistMode", "event.waitlistPublic", "translations.en.checklist", "translations.en.rules",
      "translations.en.schedule", "translations.ro.checklist", "translations.ro.rules", "translations.ro.schedule",
    ];
    const markup = await registration({ ...RACE, declarationDocumentId: declarations[0].id } as EditableEvent);
    expect([...postedNames(markup)].sort()).toEqual(before);
  });
});

describe("§760 «Ce fel de eveniment» holds «Evidențiere pe site»", () => {
  it("draws it as its last named card, closed, and names its marks on the closed line while one is on", async () => {
    const plain = await html((await KindBox({ event: RACE, mayEditSettings: true, languages: [language("ro"), language("en")] })) as ReactElement);
    const promotion = fold(plain, "box-promotion");
    expect(promotion.open).toBe(false);
    expect(promotion.heading).toBe("h3");
    expect(promotion.at).toBeGreaterThan(fold(plain, "box-cost").at);
    expect(line(plain, "box-kind")).not.toContain("Eveniment principal");
    const featured = await html(
      (await KindBox({ event: { ...RACE, featured: true, isSpecial: true } as EditableEvent, mayEditSettings: true, languages: [language("ro"), language("en")] })) as ReactElement,
    );
    expect(line(featured, "box-kind")).toContain("Eveniment principal · Ediție specială");
    expect(featured).toMatch(/<input[^>]*name="event.featured"[^>]*checked/);
  });
});

describe("§760 «Titlu și rezumat» holds the page's address and «Copertă»", () => {
  it("draws both as closed named cards after the title's tabs, and says the cover on its line", async () => {
    const markup = await html(
      (await TitleSummaryBox({ languages: [language("ro"), language("en")], creating: false, event: RACE, mayEditSettings: true, slugLocked: false })) as ReactElement,
    );
    const outer = fold(markup, "box-title");
    const address = fold(markup, "box-address");
    const cover = fold(markup, "box-cover");
    expect(outer.open).toBe(false);
    expect(address.at).toBeGreaterThan(markup.indexOf('id="title-tab-ro"'));
    expect(cover.at).toBeGreaterThan(address.at);
    for (const card of [address, cover]) {
      expect(card.open).toBe(false);
      expect(card.heading).toBe("h3");
    }
    expect(markup.split('name="translations.ro.slug"').length - 1).toBe(1);
  });

  it("says the cover on its line only where a cover can be chosen, as «De făcut» asks for one", async () => {
    const titleBox = async () =>
      html((await TitleSummaryBox({ languages: [language("ro"), language("en")], creating: false, event: RACE, mayEditSettings: true, slugLocked: false })) as ReactElement);
    // No media store (local, CI): the card says so inside, and the closed line promises nothing.
    storage.configured = false;
    expect(line(await titleBox(), "box-title")).not.toContain("copertă:");
    storage.configured = true;
    try {
      expect(line(await titleBox(), "box-title")).toContain("copertă: lipsește");
    } finally {
      storage.configured = false;
    }
  });

  it("tells a reader who may not change the settings, inside «Copertă», that they are not theirs", async () => {
    const markup = await html(
      (await TitleSummaryBox({ languages: [language("ro"), language("en")], creating: false, event: RACE, mayEditSettings: false, slugLocked: false })) as ReactElement,
    );
    const cover = markup.slice(fold(markup, "box-cover").at);
    expect(cover).toContain(ro.Admin.editor.boxes.settingsReadOnly);
    expect(cover).not.toContain('name="event.coverAssetId"');
  });

  it("names a missing address on its own line and opens for it, as the address card did", async () => {
    const markup = await html(
      (await TitleSummaryBox({ languages: [language("ro"), language("en", false)], creating: false, event: RACE, mayEditSettings: true, slugLocked: false })) as ReactElement,
    );
    expect(fold(markup, "box-title").open).toBe(true);
    expect(markup).toMatch(/data-testid="required-titleSummary"[^>]*>[^<]*(<[^>]+>)*[^<]*lipsesc: [^<]*Adresa paginii \(EN\)/);
  });
});
