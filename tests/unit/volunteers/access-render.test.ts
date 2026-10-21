import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { VolunteerInvitationItem } from "@/modules/volunteers/invitations";
import type { PublicVolunteerRole, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §820 — «Cine se poate oferi» as the server draws it: the card's radio group (three native radios, one help line each, its own
 * «Salvează»), the «Invitații» fold (the box of addresses, the club's line, the language, «Trimite invitațiile», the list with
 * «Retrimite» and «Retrage» on an open row alone), the event page's box in the members' words, and the form's locked boxes for a
 * signed-in member and for an emailed invitation. Both languages. The rules are `access-domain.test.ts`; the pages are
 * `access-page.test.ts`.
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
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ accept }: { accept: readonly string[] }) => element("div", { "data-testid": "public-flash", "data-accepts": accept.join(",") }) };
});
vi.mock("@/shared/ui/ButtonLink", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ children, ...props }: Record<string, unknown>) => element("a", { "data-testid": props["data-testid"], href: JSON.stringify(props.href) }, children as never) };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/app/[locale]/admin/events/[id]/volunteer-actions", () => {
  const noop = async () => {};
  return Object.fromEntries(
    [
      "addVolunteerAction",
      "addVolunteerCategoryAction",
      "assignVolunteerAction",
      "unassignVolunteerAction",
      "deleteVolunteerAction",
      "deleteVolunteerCategoryAction",
      "deleteVolunteerRoleAction",
      "editVolunteerAction",
      "editVolunteerCategoryAction",
      "moveVolunteerCategoryAction",
      "saveVolunteerCategoryContactAction",
      "saveVolunteerRolesAction",
      "recordPaperVolunteerAgreementAction",
      "recordPaperVolunteerGuardianAction",
      "requestVolunteerAgreementAction",
      "requestVolunteerGuardianAction",
      "setVolunteerStateAction",
      "switchVolunteersAction",
      "switchVolunteersShirtsAction",
      "switchVolunteersCountsAction",
      "switchVolunteersListAction",
      "switchVolunteersButtonAction",
      "switchVolunteersAccessAction",
      "sendVolunteerInvitationsAction",
      "resendVolunteerInvitationAction",
      "withdrawVolunteerInvitationAction",
    ].map((name) => [name, noop]),
  );
});
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");
const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");
const { default: VolunteerCallout } = await import("@/modules/volunteers/ui/VolunteerCallout");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-19T10:00:00Z");
const HOUR = 60 * 60_000;
const EVENT_DAY = "2026-11-21";

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

const invitation = (over: Partial<VolunteerInvitationItem> = {}): VolunteerInvitationItem => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eventId: EVENT,
  deliveryEmail: "ioana@example.test",
  canonicalEmail: "ioana@example.test",
  canonicalizationVersion: 2,
  locale: "ro",
  tokenHash: null,
  messageRo: null,
  messageEn: null,
  invitedByStaffUserId: null,
  sentAt: new Date(NOW.getTime() - 2 * HOUR),
  resentAt: null,
  usedAt: null,
  volunteerId: null,
  withdrawnAt: null,
  withdrawnByStaffUserId: null,
  expiresAt: new Date(NOW.getTime() + 24 * HOUR),
  invitedByName: "Ana Admin",
  ...over,
});

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

async function drawCard(over: Partial<ComponentProps<typeof VolunteersCard>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: true,
    volunteersShirts: false,
    volunteersShowCounts: false,
    eventDay: EVENT_DAY,
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: null,
    roles: [ROLE],
    categories: [],
    standings: [{ roleId: ROLE.id, needed: 3, taken: 0, confirmed: 0, free: 3 }],
    volunteers: [],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: NOW,
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

async function drawBox(over: Partial<ComponentProps<typeof VolunteerBox>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const role: PublicVolunteerRole = { id: WATER, nameRo: "Punct de apă", nameEn: "Water point", descriptionRo: null, descriptionEn: null, descriptionRoJson: null, descriptionEnJson: null, needed: 3, taken: 0, free: 3, categoryId: null };
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    eventTitle: "Crosul de toamnă",
    whenInSentence: null,
    sent: null,
    roles: [role],
    shirts: false,
    showCounts: false,
    eventDay: EVENT_DAY,
    profile: true,
    minors: false,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: NOW,
    attempt: "attempt",
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

async function drawCallout(clubOnly: boolean, language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteerCallout({ slug: "cursa", roleNames: ["Punct de apă", "Sosire"], clubOnly })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

/** One element's opening tag by its name, attributes in whatever order the server wrote them. */
const tagOf = (page: string, element: "input" | "textarea", name: string) => new RegExp(`<${element}\\b[^>]*\\bname="${name}"[^>]*>`).exec(page)?.[0] ?? "";
const radiosOf = (page: string, name: string) => [...page.matchAll(new RegExp(`<input\\b[^>]*type="radio"[^>]*\\bname="${name}"[^>]*>`, "g"))].map((match) => match[0]);

describe("§820 the card's «Cine se poate oferi»", () => {
  it("draws three native radios under the tick, the saved one checked, one help line each and a «Salvează» — in Romanian", async () => {
    const page = await drawCard({ access: "MEMBERS" });
    expect(page).toContain('data-testid="volunteer-access"');
    expect(page).toContain("Cine se poate oferi");
    for (const words of ["Oricine, de pe pagina evenimentului", "Doar membrii clubului (conectați în zona membrilor)", "Doar cu invitație de la club"]) expect(page).toContain(words);
    const radios = radiosOf(page, "access");
    expect(radios).toHaveLength(3);
    expect(radios.map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(["ANYONE", "MEMBERS", "INVITED"]);
    expect(radios.filter((tag) => /\bchecked\b/.test(tag)).map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(["MEMBERS"]);
    for (const choice of ["ANYONE", "MEMBERS", "INVITED"]) expect(page).toContain(`data-testid="volunteer-access-help-${choice}"`);
    expect(page).toContain("Formularul se arată doar unui membru conectat, cu numele și adresa din contul lui.");
    // A plain form with its own save, never a button that flips: the event and the language ride along.
    expect(page).toMatch(/<form[^>]*data-testid="volunteer-access-form"/);
    expect(page).toContain("Salvează");
    expect(page).not.toMatch(/data-testid="volunteer-access"[\s\S]{0,400}role="checkbox"/);
  });

  it("says the same in English, and checks «Oricine» by default", async () => {
    const page = await drawCard({}, "en");
    expect(page).toContain("Who can offer");
    for (const words of ["Anyone, from the event&#x27;s page", "Only the club&#x27;s members (signed in to the members&#x27; zone)", "Only by invitation from the club"]) expect(page).toContain(words);
    expect(radiosOf(page, "access").filter((tag) => /\bchecked\b/.test(tag)).map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(["ANYONE"]);
  });

  it("is drawn only while the event takes volunteers: the choice means nothing without the tick", async () => {
    const off = await drawCard({ acceptsVolunteers: false, offerClosed: "off", access: "MEMBERS" });
    expect(off).not.toContain('data-testid="volunteer-access"');
    expect(off).not.toContain('data-testid="volunteer-invitations"');
  });

  it("says in words which page is open, by the choice: the event's page, the members' sign-in, or the emailed link", async () => {
    expect(await drawCard({ access: "ANYONE" })).toContain("Pagina „Vreau să fiu voluntar” e deschisă: pagina evenimentului trimite la ea.");
    expect(await drawCard({ access: "MEMBERS" })).toContain("Pagina voluntarilor e deschisă membrilor conectați.");
    expect(await drawCard({ access: "INVITED" })).toContain("Pagina voluntarilor se deschide doar din linkul unei invitații.");
  });
});

describe("§820 the card's «Invitații»", () => {
  it("is a fold with the box of addresses, the club's line, the language and «Trimite invitațiile» while the choice is «Doar cu invitație»", async () => {
    const page = await drawCard({ access: "INVITED", invitations: [] });
    expect(page).toContain('data-testid="volunteer-invitations"');
    expect(page).toContain("Invitații");
    expect(page).toContain("Adrese (una pe rând)");
    expect(tagOf(page, "textarea", "addresses")).toContain("required");
    // The club's line is two boxes, one per language (§354), each bounded, with the English one's translate press beside it.
    expect(tagOf(page, "textarea", "messageRo")).toMatch(/maxLength="500"|maxlength="500"/);
    expect(tagOf(page, "textarea", "messageEn")).toMatch(/maxLength="500"|maxlength="500"/);
    expect(page).toContain("Mesaj (română)");
    expect(page).toContain("Message (English)");
    expect(page).not.toContain('name="message"');
    expect(radiosOf(page, "inviteLocale").map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(["ro", "en"]);
    expect(radiosOf(page, "inviteLocale").filter((tag) => /\bchecked\b/.test(tag))).toHaveLength(1);
    expect(page).toContain("Trimite invitațiile");
    expect(page).toContain("Nicio invitație trimisă încă.");
    expect(page).toContain("O invitație nu ține nimic ocupat.");
    expect(page).toContain("Trimise: 0 · Folosite: 0");
  });

  it("is hidden for «Oricine» with none sent, and says so in a sentence — without the box — under another choice once some exist", async () => {
    expect(await drawCard({ access: "ANYONE", invitations: [] })).not.toContain('data-testid="volunteer-invitations"');
    const page = await drawCard({ access: "MEMBERS", invitations: [invitation()] });
    expect(page).toContain('data-testid="volunteer-invitations"');
    expect(page).toContain('data-testid="volunteer-invite-off"');
    expect(page).toContain("Cele trimise rămân valabile până se folosesc.");
    expect(tagOf(page, "textarea", "addresses")).toBe("");
    expect(page).toContain("ioana@example.test");
  });

  it("lists each invitation with where it stands in words and a glyph, and «Retrimite» / «Retrage» on the open one alone", async () => {
    const page = await drawCard({
      access: "INVITED",
      invitations: [
        invitation(),
        invitation({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", deliveryEmail: "andrei@example.test", usedAt: new Date(NOW.getTime() - HOUR), volunteerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
        invitation({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", deliveryEmail: "vlad@example.test", withdrawnAt: new Date(NOW.getTime() - HOUR) }),
      ],
    });
    const rows = [...page.matchAll(/data-testid="volunteer-invite-row" data-standing="(\w+)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["open", "used", "withdrawn"]);
    for (const word of ["Trimisă", "Folosită", "Retrasă"]) expect(page).toContain(word);
    expect(page).toContain("Trimise: 1 · Folosite: 1");
    // One open row: one «Retrimite» and one «Retrage», each a confirmed form of its own.
    expect([...page.matchAll(/data-testid="volunteer-invite-resend-form"/g)]).toHaveLength(1);
    expect([...page.matchAll(/data-testid="volunteer-invite-withdraw-form"/g)]).toHaveLength(1);
    expect(page).toContain("de Ana Admin");
    // A glyph before the verbs' words (the house's rule): each button wears an icon.
    expect(page).toMatch(/<svg[^>]*>[\s\S]{0,400}?Retrimite/);
  });

  it("reads «Expirată» from the event's own state, not from a deadline stored at the send: an event no longer ahead closes every unused row and offers no press", async () => {
    const page = await drawCard({
      access: "INVITED",
      eventAhead: false,
      invitations: [
        invitation(),
        invitation({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", deliveryEmail: "andrei@example.test", usedAt: new Date(NOW.getTime() - HOUR), volunteerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
      ],
    });
    const rows = [...page.matchAll(/data-testid="volunteer-invite-row" data-standing="(\w+)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["expired", "used"]);
    expect(page).toContain("Expirată");
    expect(page).not.toContain('data-testid="volunteer-invite-resend-form"');
    expect(page).not.toContain('data-testid="volunteer-invite-withdraw-form"');
  });

  it("says the same in English", async () => {
    const page = await drawCard({ access: "INVITED", invitations: [invitation()] }, "en");
    for (const words of ["Invitations", "Addresses (one per line)", "Message (English)", "Language of the invitation", "Send the invitations", "Send again", "Withdraw", "Sent: 1 · Used: 0"]) expect(page).toContain(words);
  });
});

describe("§820 the event page's box", () => {
  it("says the club looks for volunteers among its members, in both languages, and still links the volunteers' page", async () => {
    const ro$ = await drawCallout(true);
    expect(ro$).toContain("Căutăm voluntari dintre membrii clubului: Punct de apă, Sosire");
    expect(ro$).toContain('data-testid="volunteer-callout-button"');
    expect(await drawCallout(true, "en")).toContain("We are looking for volunteers among the club&#x27;s members: Punct de apă, Sosire");
    expect(await drawCallout(false)).toContain("Căutăm voluntari: Punct de apă, Sosire");
    expect(await drawCallout(false)).not.toContain("dintre membrii clubului");
  });
});

describe("§820 the form's locked boxes", () => {
  it("fills a member's name, locks the address as read-only and the club's tick as ticked and disabled — carrying the tick in a hidden box — and posts no secret", async () => {
    const page = await drawBox({ lock: { kind: "member", email: "membru@example.test", name: "Maria Membra" } });
    expect(page).toContain('data-testid="volunteer-lock-note"');
    expect(page).toContain("Ești conectat ca membru: numele, adresa și bifa de membru vin din contul tău.");
    const email = tagOf(page, "input", "email");
    expect(email).toContain('value="membru@example.test"');
    expect(email).toMatch(/\breadonly\b/i);
    expect(tagOf(page, "input", "name")).toContain('value="Maria Membra"');
    expect(page).toContain("Adresa contului tău de membru; nu se schimbă aici.");
    const ticks = [...page.matchAll(/<input\b[^>]*name="clubMember"[^>]*>/g)].map((match) => match[0]);
    expect(ticks.some((tag) => /type="hidden"/.test(tag) && /value="on"/.test(tag))).toBe(true);
    expect(ticks.some((tag) => /type="checkbox"/.test(tag) && /\bchecked\b/.test(tag) && /\bdisabled\b/.test(tag))).toBe(true);
    expect(tagOf(page, "input", "invite")).toBe("");
  });

  it("locks an invitation's address, says the club invited the person, and posts the link's secret back for the server to spend", async () => {
    const secret = "S".repeat(43);
    const page = await drawBox({ lock: { kind: "invite", email: "ioana@example.test", secret } });
    expect(page).toContain("Clubul te-a invitat să fii voluntar.");
    const email = tagOf(page, "input", "email");
    expect(email).toContain('value="ioana@example.test"');
    expect(email).toMatch(/\breadonly\b/i);
    expect(tagOf(page, "input", "invite")).toContain(`value="${secret}"`);
    expect(tagOf(page, "input", "invite")).toContain('type="hidden"');
    expect(page).toContain("Adresa la care a ajuns invitația; nu se schimbă aici.");
    // The club's tick stays the person's own claim: an invitee is not made a member.
    expect([...page.matchAll(/<input\b[^>]*name="clubMember"[^>]*>/g)].some((match) => /\bdisabled\b/.test(match[0]))).toBe(false);
  });

  it("is the form it always was for «Oricine»: an open address and no secret", async () => {
    const page = await drawBox({});
    expect(page).not.toContain('data-testid="volunteer-lock-note"');
    expect(tagOf(page, "input", "email")).not.toMatch(/\breadonly\b/i);
    expect(tagOf(page, "input", "invite")).toBe("");
  });

  it("says the same in English", async () => {
    const page = await drawBox({ lock: { kind: "member", email: "m@example.test", name: "Maria" } }, "en");
    expect(page).toContain("You are signed in as a member: the name, the address and the member tick come from your account.");
    expect(page).toContain("The address of your member account; it does not change here.");
  });
});
