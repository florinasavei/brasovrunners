import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { PublicVolunteerRole, VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §904 — «Are kit» (the owner, 2026-11-03: «ar trebui să număr pe header câți au kit, deci trebuie încă un field de „are kit"») as the
 * event editor's «Voluntari» card draws it: a `CheckboxField` in «Adaugă un voluntar» (off) and in a person's «Modifică» (as saved),
 * drawn whatever the privacy notice names — it is the club's own mark, not the person's answer; the chip «Are kit» on a ticked person's
 * row; «Cu kit: N» on the card's closed line — the ticked who are not cancelled, said once there is any; never a box of the public form;
 * and «Are kit» among what «Toate datele unei persoane» lists of an offer. Both languages.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

// The dialogs' road line (§841) reads the club's roads once per request: no database here.
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
const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";

const ROLE: VolunteerRole = {
  id: WATER,
  eventId: EVENT,
  nameRo: "Punct de apă",
  nameEn: "Water point",
  needed: 3,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  colour: null,
  categoryId: null,
  position: 0,
  createdAt: new Date("2026-10-14T08:00:00Z"),
};

let counter = 0;
const person = (over: Partial<VolunteerItem>): VolunteerItem => {
  counter += 1;
  return {
    id: `55555555-5555-4555-8555-${String(counter).padStart(12, "0")}`,
    eventId: EVENT,
    roleIds: [WATER],
    choiceIds: [WATER],
    name: `Maria Test ${counter}`,
    email: `maria.${counter}@example.test`,
    phone: "+40712345678",
    state: "CONFIRMED",
    source: "PUBLIC",
    message: null,
    age: null,
    dateOfBirth: null,
    sex: null,
    city: null,
    volunteeredBefore: false,
    clubMember: false,
    listOptIn: false,
    hasKit: false,
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
  };
};

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

async function drawCard(over: Record<string, unknown> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const volunteers = (over.volunteers as VolunteerItem[] | undefined) ?? [person({})];
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: true,
    volunteersShirts: false,
    volunteersShowCounts: false,
    access: "ANYONE",
    invitations: [],
    eventDay: "2026-11-21",
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: null,
    roles: [ROLE],
    categories: [],
    standings: [{ roleIds: [ROLE.id], needed: ROLE.needed, taken: 0, confirmed: 0, free: ROLE.needed }],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: new Date("2026-10-14T10:00:00Z"),
    ...over,
    volunteers,
  } as unknown as ComponentProps<typeof VolunteersCard>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

async function drawBox(language: "ro" | "en" = "ro") {
  locale = language;
  const role: PublicVolunteerRole = {
    id: ROLE.id,
    nameRo: ROLE.nameRo,
    nameEn: ROLE.nameEn,
    descriptionRo: null,
    descriptionEn: null,
    descriptionRoJson: null,
    descriptionEnJson: null,
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
    shirts: true,
    showCounts: false,
    eventDay: "2026-11-21",
    profile: true,
    minors: false,
    listTick: true,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: new Date("2026-10-14T10:00:00Z"),
    attempt: "attempt",
  } as unknown as ComponentProps<typeof VolunteerBox>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

const tagOf = (page: string, name: string) => new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`).exec(page)?.[0] ?? "";
const addFormOf = (page: string) => /data-testid="volunteer-add"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
/** The card's closed line: its own `<summary>`, the first of the page (the help of the box names «Cu kit» too, further down). */
const closedLineOf = (page: string) => /<summary[\s\S]*?<\/summary>/.exec(page)?.[0] ?? "";
/** One person's block on the card: from their row to the next row (or the end). */
const rowOf = (page: string, id: string) => new RegExp(`data-volunteer-id="${id}"[\\s\\S]*?(?=data-testid="volunteer-row"|$)`).exec(page)?.[0] ?? "";

describe("§904 «Are kit» in the card's forms", () => {
  it("is a box of «Adaugă un voluntar», off, with its words and its one help line", async () => {
    const add = addFormOf(await drawCard({ volunteers: [] }));
    expect(add).toContain("Are kit");
    expect(add).toContain("Bifează dacă persoana primește kitul de voluntar.");
    expect(tagOf(add, "hasKit")).toContain('type="checkbox"');
    expect(tagOf(add, "hasKit")).not.toContain("checked");
  });

  it("is a box of a person's «Modifică», as saved — ticked for a person who has one, empty for one who has not", async () => {
    const ticked = person({ hasKit: true });
    const unticked = person({});
    const page = await drawCard({ volunteers: [ticked, unticked] });
    expect(tagOf(rowOf(page, ticked.id), "hasKit")).toContain("checked");
    expect(tagOf(rowOf(page, unticked.id), "hasKit")).toContain('type="checkbox"');
    expect(tagOf(rowOf(page, unticked.id), "hasKit")).not.toContain("checked");
  });

  it("is drawn whatever the notice names — the club's own mark, not an answer of the person's", async () => {
    const page = await drawCard({ profileDescribed: false, listDescribed: false, volunteers: [person({ hasKit: true })] });
    expect(page).toContain('data-testid="volunteer-kit-field"');
    expect(tagOf(page, "hasKit")).toContain('type="checkbox"');
  });

  it("marks a ticked person's row with the chip «Are kit», in words and a glyph, and an unticked one not at all", async () => {
    const ticked = person({ hasKit: true });
    const page = await drawCard({ volunteers: [ticked, person({})] });
    expect(page.match(/data-testid="volunteer-kit"/g)).toHaveLength(1);
    expect(rowOf(page, ticked.id)).toContain('data-testid="volunteer-kit"');
    expect(page).toContain("CheckroomIcon");
    expect(await drawCard({ volunteers: [person({ hasKit: true })] }, "en")).toContain("Has a kit");
  });

  it("is never a box of the public form, in either language", async () => {
    expect(await drawBox()).not.toContain('name="hasKit"');
    expect(await drawBox("en")).not.toContain('name="hasKit"');
  });
});

describe("§904 «Cu kit: N» on the card's closed line", () => {
  it("counts the ticked who are not cancelled, beside the card's other figures", async () => {
    const page = await drawCard({ volunteers: [person({ hasKit: true }), person({ hasKit: true, state: "REGISTERED" }), person({ hasKit: true, state: "CANCELLED", roleIds: [] }), person({})] });
    // «0 din 3 · 1 de confirmat · Cu kit: 2»: the card's own figures first, the kits last.
    expect(closedLineOf(page)).toMatch(/de confirmat · Cu kit: 2</);
    expect(closedLineOf(await drawCard({ volunteers: [person({ hasKit: true })] }, "en"))).toContain("With a kit: 1");
  });

  it("says nothing of kits while nobody is ticked, or only a cancelled person is", async () => {
    expect(closedLineOf(await drawCard({ volunteers: [person({})] }))).not.toContain("kit");
    expect(closedLineOf(await drawCard({ volunteers: [person({ hasKit: true, state: "CANCELLED", roleIds: [] })] }))).not.toContain("kit");
  });

  it("is said even before the event has a role", async () => {
    const page = await drawCard({ roles: [], standings: [], volunteers: [person({ hasKit: true, roleIds: [], choiceIds: [] })] });
    expect(closedLineOf(page)).toContain("Încă niciun rol · Cu kit: 1");
  });
});

describe("§904 «Toate datele unei persoane» lists «Are kit» among what is kept about an offer", () => {
  it("adds «Are kit» to the offer's line when the row holds it, and nothing when it does not", async () => {
    const base = { age: null, dateOfBirth: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null, guardianName: null, guardianEmail: null, guardianAcceptedAt: null, guardianMethod: null };
    locale = "ro";
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, hasKit: true } })) as ReactElement))).toBe("<p> · Are kit</p>");
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, hasKit: false } })) as ReactElement))).toBe("<p></p>");
    locale = "en";
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, hasKit: true } })) as ReactElement))).toBe("<p> · Has a kit</p>");
  });
});
