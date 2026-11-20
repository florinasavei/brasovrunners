import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { VolunteerPersonContext } from "@/modules/volunteers/ui/VolunteerPerson";
import type { VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §983 — «Prezent» on a volunteer (the owner, 2026-11-18, three days before the race: «La voluntari trebuie să trec prezent/absent ca
 * să pot face tombola doar pentru cei prezenți») as the server draws the person's block: on the person's own page a ticked person
 * wears the chip «Prezent» among their chips — in words and a glyph, never a colour alone — and an absent one none; the event
 * editor's «Voluntari» card keeps its rows as they were, ticked or not; and «Toate datele unei persoane» adds «Prezent» to the offer's
 * line when the row holds it. Both languages. The list's tick and the person page's are `tests/integration/volunteers/present-screens.test.ts`.
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
const { default: VolunteerPerson } = await import("@/modules/volunteers/ui/VolunteerPerson");
const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-21T07:30:00Z");

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
    volunteerNumber: null,
    checkpointId: null,
    raceDayDecision: null,
    inRaffle: true,
    present: false,
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

const contextFor = (language: "ro" | "en", returnTo?: string): VolunteerPersonContext => ({
  locale: language,
  eventId: EVENT,
  roles: [ROLE],
  categories: [],
  standings: [{ roleId: ROLE.id, needed: 3, taken: 1, confirmed: 1, free: 2 }],
  volunteersShirts: false,
  profileDescribed: true,
  minorsOpen: false,
  listDescribed: true,
  eventDay: "2026-11-21",
  agreementInForce: true,
  agreementNoticeDescribes: true,
  agreementDocumentIds: {},
  agreementEvent: {},
  now: NOW,
  ...(returnTo ? { returnTo } : {}),
});

/** The person's block as their own page draws it (`as="section"`), inside the providers the page has. */
async function drawPage(one: VolunteerItem, language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteerPerson({ person: one, context: contextFor(language, `/${language}/admin/volunteers/${one.id}`), as: "section" })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

/** The event editor's «Voluntari» card, its rows drawn as the card draws them (`as="li"`). */
async function drawCard(volunteers: VolunteerItem[], language: "ro" | "en" = "ro") {
  locale = language;
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
    standings: [{ roleId: ROLE.id, needed: 3, taken: volunteers.length, confirmed: volunteers.length, free: 3 - volunteers.length }],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: NOW,
    volunteers,
  } as unknown as ComponentProps<typeof VolunteersCard>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

/** The chip, as `StatusChip` draws it: its test id, and the words inside it. */
const chipOf = (page: string) => /<div\b[^>]*data-testid="volunteer-present"[\s\S]*?<\/div>/.exec(page)?.[0] ?? "";

describe("§983 «Prezent» among the person's chips on their own page", () => {
  it("draws the chip «Prezent» for a person ticked present — the words and the person-with-tick glyph — and nothing for one absent", async () => {
    const ticked = person({ present: true });
    const page = await drawPage(ticked);
    expect(page.match(/data-testid="volunteer-present"/g)).toHaveLength(1);
    const chip = chipOf(page);
    expect(chip).toContain(">Prezent<");
    // The desk's «Prezent la …» glyph (`checkedIn`): the state is said by the words and the glyph, never by a colour alone.
    expect(chip).toContain("HowToRegIcon");
    expect(page).toContain('data-testid="volunteer-claims"');

    const absent = await drawPage(person({ present: false }));
    expect(absent).not.toContain('data-testid="volunteer-present"');
    // Nothing else of the person's says it: no «Absent» chip, no claims row drawn for a person with nothing to claim.
    expect(absent).not.toContain('data-testid="volunteer-claims"');
  });

  it("draws it beside the person's other chips, the number first, for a cancelled person too — the tick stands in any state", async () => {
    const page = await drawPage(person({ present: true, volunteerNumber: 7, hasKit: true }));
    const claims = /data-testid="volunteer-claims"[\s\S]*$/.exec(page)?.[0] ?? "";
    // §1023: the number is the V number, «Nr. V007».
    expect(claims).toContain("Nr. V007");
    expect(claims.indexOf('data-testid="volunteer-number"')).toBeLessThan(claims.indexOf('data-testid="volunteer-present"'));
    expect(claims.indexOf('data-testid="volunteer-present"')).toBeLessThan(claims.indexOf('data-testid="volunteer-kit"'));
    expect(await drawPage(person({ present: true, state: "CANCELLED", roleIds: [] }))).toContain('data-testid="volunteer-present"');
  });

  it("says it in English to an English reader", async () => {
    const page = await drawPage(person({ present: true }), "en");
    expect(chipOf(page)).toContain(">Present<");
    expect(page).not.toContain(">Prezent<");
  });
});

describe("§983 the event editor's «Voluntari» card is left as it was", () => {
  it("draws no «Prezent» chip on a row, ticked or not, in either language", async () => {
    const ticked = person({ present: true, hasKit: true });
    for (const language of ["ro", "en"] as const) {
      const page = await drawCard([ticked, person({})], language);
      // The row is drawn — with its kit — and says nothing of the presence: the card is not where it is worked.
      expect(page).toContain(`data-volunteer-id="${ticked.id}"`);
      expect(page).toContain('data-testid="volunteer-kit"');
      expect(page).not.toContain('data-testid="volunteer-present"');
      expect(page).not.toContain(`>${messages[language].Admin.volunteers.presence.chip}<`);
    }
  });
});

describe("§983 «Toate datele unei persoane» lists «Prezent» among what is kept about an offer", () => {
  it("adds «Prezent» to the offer's line when the row holds it, and nothing when it does not — both languages", async () => {
    const base = { age: null, dateOfBirth: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null, guardianName: null, guardianEmail: null, guardianAcceptedAt: null, guardianMethod: null };
    locale = "ro";
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, present: true } })) as ReactElement))).toBe("<p> · Prezent</p>");
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, present: false } })) as ReactElement))).toBe("<p></p>");
    // Beside the kit, in the line's own order.
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, hasKit: true, inRaffle: false, present: true } })) as ReactElement))).toBe(
      "<p> · Are kit · Nu participă la tombolă · Prezent</p>",
    );
    locale = "en";
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...base, present: true } })) as ReactElement))).toBe("<p> · Present</p>");
  });
});
