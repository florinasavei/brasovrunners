import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { PublicVolunteerRole, VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §821 — what the club and the volunteer see of the public list: the «Voluntari» card's tick «Lista voluntarilor e publică pe pagina
 * evenimentului» (a real tick box in its own form, the sentence and the link to the legal texts while the notice does not describe the list),
 * the organizers' record of a person's own tick in «Adaugă» and «Modifică» (a `CheckboxField`, drawn while the notice describes the list or the
 * person is ticked already), the chip «Vrea pe lista publică» on a ticked person's row, and the public form's tick «Vreau să apar pe lista publică a
 * voluntarilor» with its one help line — off by default, drawn only where the offer says so. Both languages.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

// The dialogs' road line (§NNN) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg?: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "object"
        ? createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Admin" })
        : createTranslator({ locale, messages: messages[locale], namespace: arg as "Admin" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href: typeof href === "string" ? href : "/" }, children as string),
    getPathname: () => "/",
  };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
// Every action of the card is a no-op, by the names the actions file exports (the actions are proved in tests/integration/volunteers/).
vi.mock("@/app/[locale]/admin/events/[id]/volunteer-actions", async () => {
  const noop = async () => {};
  const { readFileSync: read } = await import("node:fs");
  const source = read("src/app/[locale]/admin/events/[id]/volunteer-actions.ts", "utf8");
  return Object.fromEntries([...source.matchAll(/export async function (\w+)/g)].map((match) => [match[1], noop]));
});
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: () => element("div", { "data-testid": "public-flash" }) };
});

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");
const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";

const para = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });
const docOf = (...lines: string[]) => ({ type: "doc" as const, content: lines.map(para) });
const ROLE: VolunteerRole = {
  id: WATER,
  eventId: EVENT,
  nameRo: "Punct de apă",
  nameEn: "Water point",
  needed: 3,
  descriptionRo: "Stai la km 5.",
  descriptionEn: "Stand at km 5.",
  descriptionRoJson: docOf("Stai la km 5."),
  descriptionEnJson: docOf("Stand at km 5."),
  colour: null,
  categoryId: null,
  position: 0,
  createdAt: new Date("2026-10-14T08:00:00Z"),
};

const person = (over: Partial<VolunteerItem>): VolunteerItem => ({
  id: "55555555-5555-4555-8555-555555555555",
  eventId: EVENT,
  roleIds: [],
  choiceIds: [WATER],
  name: "Maria Test",
  email: "maria@example.test",
  phone: "+40712345678",
  state: "REGISTERED",
  source: "PUBLIC",
  message: null,
  note: null,
  age: null,
  dateOfBirth: null,
  sex: null,
  city: null,
  volunteeredBefore: false,
  clubMember: false,
  listOptIn: false,
  shirtSize: null,
  createdAt: new Date("2026-10-14T09:00:00Z"),
  updatedAt: new Date("2026-10-14T09:00:00Z"),
  agreementAcceptedAt: null,
  agreementMethod: null,
  agreementVersion: null,
  agreementRoleName: null,
  agreementLocale: null,
  agreementEventDate: null,
  agreementEventLocation: null,
  locale: "ro",
  agreementTokenExpiresAt: null,
  agreementRequestedAt: null,
  guardianName: null,
  guardianEmail: null,
  guardianAcceptedAt: null,
  guardianMethod: null,
  guardianVersion: null,
  guardianTokenExpiresAt: null,
  guardianRequestedAt: null,
  ...over,
});

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

async function drawCard(over: Record<string, unknown> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: true,
    volunteersShirts: false,
    volunteersShowCounts: false,
    // The way in (lane «Cine se poate oferi»): anyone, no invitation — the card draws its choice beside the ticks.
    access: "ANYONE",
    invitations: [],
    eventDay: "2026-11-21",
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: null,
    roles: [ROLE],
    categories: [],
    standings: [{ roleIds: [ROLE.id], needed: ROLE.needed, taken: 0, confirmed: 0, free: ROLE.needed }],
    volunteers: [person({})],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: new Date("2026-10-14T10:00:00Z"),
    ...over,
  } as unknown as ComponentProps<typeof VolunteersCard>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

async function drawBox(over: Record<string, unknown> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const role: PublicVolunteerRole = {
    id: ROLE.id,
    nameRo: ROLE.nameRo,
    nameEn: ROLE.nameEn,
    descriptionRo: ROLE.descriptionRo,
    descriptionEn: ROLE.descriptionEn,
    descriptionRoJson: ROLE.descriptionRoJson,
    descriptionEnJson: ROLE.descriptionEnJson,
    needed: 3,
    taken: 0,
    free: 3,
    categoryId: null,
  };
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    eventTitle: "Crosul de toamnă",
    whenInSentence: "sâmbătă, 21 nov. 2026, la 09:00",
    sent: null,
    roles: [role],
    shirts: false,
    showCounts: false,
    eventDay: "2026-11-21",
    profile: true,
    minors: false,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: new Date("2026-10-14T10:00:00Z"),
    attempt: "attempt",
    ...over,
  } as unknown as ComponentProps<typeof VolunteerBox>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

const formOf = (page: string, testid: string) => new RegExp(`<form[^>]*data-testid="${testid}"[\\s\\S]*?</form>`).exec(page)?.[0] ?? "";
const tagOf = (page: string, name: string) => new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`).exec(page)?.[0] ?? "";

describe("§821 the club's tick — «Lista voluntarilor e publică pe pagina evenimentului»", () => {
  it("is a plain form whose submit is the checkbox (the house's TickButton): role, state, words, the state it wants posted — off by default", async () => {
    const page = await drawCard({ volunteersListPublic: false, listDescribed: true });
    const form = formOf(page, "volunteer-list-form");
    expect(form).toContain('type="submit"');
    expect(form).toContain('role="checkbox"');
    expect(form).toContain('aria-checked="false"');
    expect(form).toContain("Lista voluntarilor e publică pe pagina evenimentului");
    expect(form).toContain('name="on" value="1"');
    expect(form).toMatch(/<button[^>]*data-testid="volunteer-list-tick"/);
    // One help line under it, naming what the page then shows and what it never does.
    expect(form).toContain("Adresa și telefonul nu apar niciodată.");
    // Never a toggle button: no verb that flips it.
    expect(form).not.toMatch(/Pornește|Oprește/);
  });

  it("draws ticked, and posts the other state, when it is on", async () => {
    const form = formOf(await drawCard({ volunteersListPublic: true, listDescribed: true }), "volunteer-list-form");
    expect(form).toContain('aria-checked="true"');
    expect(form).toContain('name="on" value="0"');
  });

  it("says the card is not shown — with the way to the legal texts — while the notice does not describe the list, ticked or not, and nothing once it does", async () => {
    expect(await drawCard({ volunteersListPublic: true, listDescribed: true })).not.toContain('data-testid="volunteer-list-notice-off"');
    expect(await drawCard({ volunteersListPublic: false, listDescribed: true })).not.toContain('data-testid="volunteer-list-notice-off"');
    expect(await drawCard({ volunteersListPublic: false, listDescribed: false })).toContain('data-testid="volunteer-list-notice-off"');
    const page = await drawCard({ volunteersListPublic: true, listDescribed: false });
    const alert = /<div[^>]*data-testid="volunteer-list-notice-off"[\s\S]*?<\/a>/.exec(page)?.[0] ?? "";
    expect(alert).toContain("nota de confidențialitate în vigoare nu descrie lista publică a voluntarilor");
    expect(alert).toContain("<a");
    expect(alert).toContain("Documente legale");
  });

  it("says the same in English", async () => {
    const page = await drawCard({ volunteersListPublic: true, listDescribed: false }, "en");
    expect(page).toContain("The volunteers&#x27; list is public on the event&#x27;s page");
    expect(page).toContain("does not describe the public list of volunteers");
    expect(page).toContain("Legal documents");
  });

  it("is saved by the card's own action and travels in no other form: the source has no editor-save field for it", () => {
    const source = readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8");
    expect(source).toContain("switchVolunteersListAction");
    expect(source).toContain("TickButton");
    expect(readFileSync("src/modules/content/events/fields.ts", "utf8")).not.toMatch(/volunteersListPublic/);
  });
});

describe("§821 the organizers' record of a person's tick", () => {
  it("is a box in «Adaugă un voluntar» while the notice describes the list, with its sentence, off by default", async () => {
    const page = await drawCard({ listDescribed: true, volunteers: [] });
    const add = /data-testid="volunteer-add"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(add).toContain("Vrea să apară pe lista publică a voluntarilor");
    expect(add).toContain("Bifează doar dacă persoana ți-a spus că vrea, de preferat în scris.");
    expect(tagOf(add, "listOptIn")).toContain('type="checkbox"');
    expect(tagOf(add, "listOptIn")).not.toContain("checked");
  });

  it("is not drawn while the notice is silent and nobody is ticked — the service refuses a new tick all the same", async () => {
    const page = await drawCard({ listDescribed: false, volunteers: [person({})] });
    expect(page).not.toContain('name="listOptIn"');
    expect(page).not.toContain('data-testid="volunteer-list-optin-field"');
  });

  it("stays on a ticked person's «Modifică» even when the notice is silent, so it can be cleared, with the sentence that says so", async () => {
    const page = await drawCard({ listDescribed: false, volunteers: [person({ listOptIn: true })] });
    expect(tagOf(page, "listOptIn")).toContain("checked");
    expect(page).toContain("Nota în vigoare nu descrie lista publică: nu se mai poate bifa. Poți doar s-o debifezi.");
  });

  it("marks a ticked person's row «Vrea pe lista publică», in words and a glyph, and an unticked one not at all", async () => {
    const ticked = await drawCard({ listDescribed: true, volunteers: [person({ listOptIn: true })] });
    expect(ticked).toMatch(/data-testid="volunteer-on-list"[^>]*>|<[^>]*data-testid="volunteer-on-list"/);
    expect(ticked).toContain("Vrea pe lista publică");
    expect(ticked).toContain("HowToRegIcon");
    const unticked = await drawCard({ listDescribed: true, volunteers: [person({ listOptIn: false })] });
    expect(unticked).not.toContain("volunteer-on-list");
    const english = await drawCard({ listDescribed: true, volunteers: [person({ listOptIn: true })] }, "en");
    expect(english).toContain("Wants to be on the public list");
    expect(english).toContain("Wants to appear on the public list of volunteers");
  });
});

describe("§821 «Toate datele unei persoane» says the tick among what is kept", () => {
  it("adds «Vrea pe lista publică» to the offer's line when the row holds the tick, and nothing when it does not", async () => {
    const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");
    const base = { age: null, dateOfBirth: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null, guardianName: null, guardianEmail: null, guardianAcceptedAt: null, guardianMethod: null };
    locale = "ro";
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, listOptIn: true } })) as ReactElement))).toBe("<p> · Vrea pe lista publică</p>");
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, listOptIn: false } })) as ReactElement))).toBe("<p></p>");
    // A caller that predates the tick draws what it always drew.
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: base })) as ReactElement))).toBe("<p></p>");
    locale = "en";
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, listOptIn: true } })) as ReactElement))).toBe("<p> · Wants to be on the public list</p>");
  });
});

describe("§821 the public form's tick — «Vreau să apar pe lista publică a voluntarilor»", () => {
  it("is an optional box with its one help line, off by default, where the offer asks it", async () => {
    const page = await drawBox({ listTick: true });
    const box = /data-testid="volunteer-list-optin"[\s\S]*?<\/div>\s*<\/div>/.exec(page)?.[0] ?? page;
    expect(page).toContain('data-testid="volunteer-list-optin"');
    expect(page).toContain("Vreau să apar pe lista publică a voluntarilor");
    expect(page).toContain("Pagina evenimentului arată doar numele tău și rolul dat de organizatori, după ce te confirmă.");
    expect(page).toContain("Poți cere oricând, în scris, să fii scos de pe ea.");
    expect(tagOf(page, "listOptIn")).toContain('type="checkbox"');
    expect(tagOf(page, "listOptIn")).not.toContain("required");
    expect(tagOf(page, "listOptIn")).not.toContain("checked");
    expect(box).toBeTruthy();
  });

  it("is not drawn unless the offer says so: the club's tick off, or a notice that is silent", async () => {
    const page = await drawBox({});
    expect(page).not.toContain('name="listOptIn"');
    expect(page).not.toContain("volunteer-list-optin");
    expect(await drawBox({ listTick: false })).not.toContain('name="listOptIn"');
  });

  it("is drawn in both modes of the form — with the profile's boxes and with §758's age tick — and before the consent", async () => {
    for (const profile of [true, false]) {
      const page = await drawBox({ listTick: true, profile });
      expect(page, String(profile)).toContain('name="listOptIn"');
      expect(page.indexOf('name="listOptIn"'), String(profile)).toBeLessThan(page.indexOf('name="consent"'));
    }
  });

  it("says it in English", async () => {
    const page = await drawBox({ listTick: true }, "en");
    expect(page).toContain("I want to appear on the public list of volunteers");
    expect(page).toContain("The event page shows only your name and the role the organizers give you, once they confirm you.");
  });
});
