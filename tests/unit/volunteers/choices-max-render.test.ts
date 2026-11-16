import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { PublicVolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §NNN — «Cel mult câte roluri poate bifa o persoană» as the server draws it (BR-REQ-031-01, BR-REQ-050-02), in both languages:
 *
 * - **the volunteers' own page**, from its real `page.tsx` down to the real form: the limit the public read carries reaches the
 *   roles' help line («Alege un singur rol.», «Poți bifa cel mult 2 roluri.», «…20 de roluri.»), and a refused post — the address
 *   says `?volunteer=invalid&vfields=roleIds` either way — reads as the limit's own sentence when the sealed draft kept more roles
 *   than the limit, and as «Bifează cel puțin un rol» otherwise, with every tick and every typed box back in place;
 * - **the «Voluntari» card's box**: its own small form, the saved value shown, the empty box saying «oricâte».
 *
 * The reads are stood in for with a state a case sets (the public cache's answer, the sealed draft); `readVolunteerOffer`, the page
 * and the form are the real ones. The form is an async Server Component, which `react-dom/server` cannot draw inside the page's
 * tree: the page is drawn with a slot that keeps the props it handed over, and the real form is then drawn with exactly those.
 */
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  choicesMax: undefined as undefined | number | null,
  roles: [] as unknown[],
  draft: null as null | Record<string, string>,
  draftReads: 0,
  handed: null as null | Record<string, unknown>,
}));

const messages = { ro, en } as const;

const EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Crosul de toamnă",
  eventStatus: "SCHEDULED",
  startsAt: new Date("2026-11-21T08:00:00.000Z"),
  endsAt: null as Date | null,
  timezone: "Europe/Bucharest",
  locationName: "Parcul Tractorul",
  dateToBeAnnounced: false,
  timeToBeAnnounced: false,
};

const WATER = "11111111-1111-4111-8111-111111111111";
const GUIDE = "22222222-2222-4222-8222-222222222222";
const KITS = "33333333-3333-4333-8333-333333333333";
const FINISH = "44444444-4444-4444-8444-444444444444";
/** A role of another event, or one deleted since the form was drawn. */
const GONE = "99999999-9999-4999-8999-999999999999";

const role = (id: string, nameRo: string, nameEn: string): PublicVolunteerRole => ({
  id,
  nameRo,
  nameEn,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  needed: null,
  taken: 0,
  free: null,
  categoryId: null,
});
const ROLES = [role(WATER, "Punct de apă", "Water point"), role(GUIDE, "Direcționare", "Marshalling"), role(KITS, "Kituri", "Kits"), role(FINISH, "Sosire", "Finish")];

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  unstable_rethrow: () => {},
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  setRequestLocale: () => {},
  getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
    const language = typeof arg === "object" ? arg.locale : state.locale;
    const namespace = typeof arg === "object" ? arg.namespace : arg;
    return createTranslator({ locale: language, messages: messages[language] as never, namespace: namespace as never });
  },
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: { slug?: string } } }) =>
    typeof href === "string" ? `/${locale}${href}` : `/${locale}/events/${href.params?.slug ?? ""}`,
  Link: () => null,
}));
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("@/modules/resilience/event-copy", () => ({ formEventBySlug: async () => EVENT }));
vi.mock("@/modules/registrations/form-draft", () => ({
  readSubmittedFacts: async () => null,
  readFormDraft: async () => {
    state.draftReads += 1;
    return state.draft;
  },
}));
vi.mock("@/modules/public-cache/reads", () => ({
  // The public read as the cache answers it: `choicesMax` beside `shirts` — or absent, for an entry written before the setting existed.
  cachedVolunteerRoles: async () => ({
    acceptsVolunteers: true,
    access: "ANYONE",
    shirts: false,
    showCounts: false,
    buttonShown: true,
    ...(state.choicesMax === undefined ? {} : { choicesMax: state.choicesMax }),
    roles: state.roles,
    categories: [],
  }),
  cachedVolunteersDescribed: async () => true,
  cachedVolunteerAgreementInForce: async () => true,
  cachedVolunteerAgreementDescribed: async () => true,
  cachedVolunteerProfileDescribed: async () => false,
  cachedVolunteerMinorsOpen: async () => false,
  cachedVolunteersListDescribed: async () => false,
  cachedMemberDefinition: async () => null,
}));
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
// The page's slot for the form: it keeps what the page handed over, for the real form to be drawn with.
vi.mock("@/modules/volunteers/ui/VolunteerBox", async () => {
  const { createElement: element } = await import("react");
  return {
    default: (props: Record<string, unknown>) => {
      state.handed = props;
      return element("div", { "data-testid": "volunteer-box-slot" });
    },
  };
});

const { default: Page } = await import("@/app/[locale]/events/[slug]/volunteers/page");
const { default: VolunteerBox } = await vi.importActual<typeof import("@/modules/volunteers/ui/VolunteerBox")>("@/modules/volunteers/ui/VolunteerBox");
const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
  state.locale = "ro";
  state.choicesMax = undefined;
  state.roles = ROLES;
  state.draft = null;
  state.draftReads = 0;
  state.handed = null;
});

/** A tree as the server streams it, Suspense settled; Emotion's styles and React's text separators out of the way of what is asserted. */
async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

/**
 * The volunteers' page as a visitor's request draws it: the real page (its reads, the address, the sealed draft), then the real
 * form with exactly the props the page handed it.
 */
async function visit(search: Record<string, string> = {}, locale: "ro" | "en" = "ro"): Promise<string> {
  state.locale = locale;
  state.handed = null;
  const page = await Page({ params: Promise.resolve({ locale, slug: "crosul" }), searchParams: Promise.resolve(search) });
  const shell = renderToStaticMarkup(page as ReactNode as never);
  expect(shell).toContain('data-testid="volunteer-box-slot"');
  expect(state.handed).not.toBeNull();
  const drawn = (await VolunteerBox(state.handed as unknown as ComponentProps<typeof VolunteerBox>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale, messages: { Event: messages[locale].Event, Registration: messages[locale].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

/** A refused post's page: the address the action redirects to, and what the sealed draft kept. */
const refusedVisit = (roleIds: string, locale: "ro" | "en" = "ro", typed: Record<string, string> = {}) => {
  state.draft = { roleIds, name: "Maria Test", email: "maria@example.test", phoneCountry: "RO", phone: "0712 345 678", message: "Pot toată ziua", ...typed };
  return visit({ volunteer: "invalid", vfields: "roleIds" }, locale);
};

const helpOf = (page: string) => /<p[^>]*data-testid="volunteer-roles-help"[^>]*>([^<]*)<\/p>/.exec(page)?.[1] ?? "";
const helpTag = (page: string) => /<p[^>]*data-testid="volunteer-roles-help"[^>]*>/.exec(page)?.[0] ?? "";
const errorOf = (page: string) => /<p[^>]*data-testid="volunteer-roles-error"[^>]*>([^<]*)<\/p>/.exec(page)?.[1] ?? "";
const errorTag = (page: string) => /<p[^>]*data-testid="volunteer-roles-error"[^>]*>/.exec(page)?.[0] ?? "";
/** The refusal summary's sentences, each a link to its box. */
const summaryOf = (page: string) => [.../<li><a href="#([^"]+)">([^<]*)<\/a><\/li>/g[Symbol.matchAll](page)].map((match) => ({ box: match[1], sentence: match[2] }));
/** The roles' checkboxes as drawn: each id with whether it came back ticked. */
const boxesOf = (page: string) =>
  [...page.matchAll(/<input\b[^>]*\bname="roleIds"[^>]*>/g)].map((match) => ({
    tag: match[0],
    id: /\bvalue="([^"]+)"/.exec(match[0])?.[1] ?? "",
    ticked: /\bchecked=""/.test(match[0]),
  }));
const decode = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const RO = {
  help: "Bifează tot ce ai face, cel puțin un rol.",
  none: "Bifează cel puțin un rol la „Ce ești dispus(ă) să faci”.",
};
const EN = {
  help: "Tick everything you would do, at least one role.",
  none: "Tick at least one role under “What you are willing to do”.",
};

describe("§NNN BR-REQ-031-01 the roles' help line says the event's limit", () => {
  it("says «Bifează tot ce ai face» while the event has no limit — and for a page's copy made before the setting existed", async () => {
    for (const choicesMax of [null, undefined] as const) {
      state.choicesMax = choicesMax;
      expect(helpOf(await visit())).toBe(RO.help);
      expect(helpTag(await visit())).not.toContain("data-choices-max");
      expect(helpOf(await visit({}, "en"))).toBe(EN.help);
      // The page hands the form «no limit», never an absent value.
      expect(state.handed).toMatchObject({ choicesMax: null, shirts: false });
    }
  });

  it("«Alege un singur rol.» for a limit of one, in both languages, in the instruction's place", async () => {
    state.choicesMax = 1;
    const page = await visit();
    expect(helpOf(page)).toBe("Alege un singur rol.");
    expect(helpTag(page)).toContain('data-choices-max="1"');
    expect(page).not.toContain(RO.help);
    const english = await visit({}, "en");
    expect(helpOf(english)).toBe("Choose one role only.");
    expect(english).not.toContain(EN.help);
    expect(state.handed).toMatchObject({ choicesMax: 1 });
  });

  it("«Poți bifa cel mult 2 roluri.» for more — and «20 de roluri» where Romanian counts with «de»: the count's own form, never an ICU plural", async () => {
    const said: Record<number, [string, string]> = {
      2: ["Poți bifa cel mult 2 roluri.", "You can tick at most 2 roles."],
      3: ["Poți bifa cel mult 3 roluri.", "You can tick at most 3 roles."],
      19: ["Poți bifa cel mult 19 roluri.", "You can tick at most 19 roles."],
      20: ["Poți bifa cel mult 20 de roluri.", "You can tick at most 20 roles."],
    };
    for (const [limit, [romanian, english]] of Object.entries(said)) {
      state.choicesMax = Number(limit);
      expect(helpOf(await visit()), limit).toBe(romanian);
      expect(helpOf(await visit({}, "en")), limit).toBe(english);
    }
    for (const catalogue of [ro, en]) {
      for (const words of [catalogue.Event.volunteers.choicesHelpMax, catalogue.Event.volunteers.errors.roleIdsMax]) {
        expect(Object.keys(words).sort()).toEqual(["few", "one", "other"]);
        for (const sentence of Object.values(words)) expect(sentence).not.toMatch(/\{\w+,\s*plural/);
        expect(words.one).not.toContain("{count}");
        expect(words.few).toContain("{count}");
        expect(words.other).toContain("{count}");
      }
    }
    expect(ro.Event.volunteers.choicesHelpMax.other).toContain("{count} de roluri");
  });

  it("is the group's own description for a screen reader, and the form stays native checkboxes with no island", async () => {
    state.choicesMax = 2;
    const page = await visit();
    const group = /<fieldset[^>]*data-testid="volunteer-roles"[^>]*>/.exec(page)?.[0] ?? "";
    expect(group).toContain('id="volunteer-roleIds"');
    expect(group).toMatch(/aria-describedby="volunteer-roleIds-help volunteer-roleIds-note"/);
    expect(helpTag(page)).toContain('id="volunteer-roleIds-help"');
    const boxes = boxesOf(page);
    expect(boxes.map((box) => box.id)).toEqual([WATER, GUIDE, KITS, FINISH]);
    for (const box of boxes) {
      expect(box.tag).toContain('type="checkbox"');
      // Nothing in the page switches a box off or counts the ticks: the server is the gate, and the form works with scripts off.
      expect(box.tag).not.toMatch(/disabled|onchange|onclick|data-max/i);
      expect(box.ticked).toBe(false);
    }
    const source = readFileSync("src/modules/volunteers/ui/VolunteerBox.tsx", "utf8");
    expect(source).not.toMatch(/^["']use client["']/m);
    expect(readFileSync("src/modules/volunteers/ui/VolunteerRoleChip.tsx", "utf8")).not.toMatch(/^["']use client["']/m);
  });
});

describe("§NNN BR-REQ-031-01 a refusal over the limit says the limit, not «Bifează cel puțin un rol»", () => {
  it("draws the limit's sentence at the roles and in the summary, with every tick and every typed box back — in Romanian", async () => {
    state.choicesMax = 2;
    const page = decode(await refusedVisit(`${WATER},${GUIDE},${KITS}`));
    const sentence = "Ai bifat prea multe: poți bifa cel mult 2 roluri la „Ce ești dispus(ă) să faci”.";
    expect(errorOf(page)).toBe(sentence);
    expect(errorTag(page)).toContain('data-reason="tooMany"');
    expect(summaryOf(page)).toEqual([{ box: "volunteer-roleIds", sentence }]);
    expect(page).not.toContain(RO.none);
    // The help line still says the rule the person broke.
    expect(helpOf(page)).toBe("Poți bifa cel mult 2 roluri.");
    // What was ticked comes back ticked — the person unticks one, they do not start again.
    expect(boxesOf(page).map((box) => [box.id, box.ticked])).toEqual([
      [WATER, true],
      [GUIDE, true],
      [KITS, true],
      [FINISH, false],
    ]);
    expect(page).toMatch(/<input[^>]*name="name"[^>]*value="Maria Test"/);
    expect(page).toMatch(/<input[^>]*name="email"[^>]*value="maria@example.test"/);
    expect(page).toMatch(/<textarea[^>]*name="message"[^>]*>Pot toată ziua<\/textarea>/);
    // The group is described by its error too.
    expect(/<fieldset[^>]*data-testid="volunteer-roles"[^>]*>/.exec(page)?.[0]).toMatch(/aria-describedby="volunteer-roleIds-help volunteer-roleIds-note volunteer-roleIds-error"/);
    expect(state.draftReads).toBe(1);
  });

  it("says the same in English", async () => {
    state.choicesMax = 2;
    const page = decode(await refusedVisit(`${WATER},${GUIDE},${KITS}`, "en"));
    const sentence = "You ticked too many: you can tick at most 2 roles under “What you are willing to do”.";
    expect(errorOf(page)).toBe(sentence);
    expect(summaryOf(page)).toEqual([{ box: "volunteer-roleIds", sentence }]);
    expect(page).not.toContain(EN.none);
    expect(helpOf(page)).toBe("You can tick at most 2 roles.");
    expect(boxesOf(page).filter((box) => box.ticked).map((box) => box.id)).toEqual([WATER, GUIDE, KITS]);
  });

  it("«alege un singur rol» for a limit of one, and «20 de roluri» for twenty", async () => {
    state.choicesMax = 1;
    expect(errorOf(decode(await refusedVisit(`${WATER},${GUIDE}`)))).toBe("Ai bifat prea multe: alege un singur rol la „Ce ești dispus(ă) să faci”.");
    expect(errorOf(decode(await refusedVisit(`${WATER},${GUIDE}`, "en")))).toBe("You ticked too many: choose one role only under “What you are willing to do”.");
    expect(ro.Event.volunteers.errors.roleIdsMax.other).toBe("Ai bifat prea multe: poți bifa cel mult {count} de roluri la „Ce ești dispus(ă) să faci”.");
  });

  it("keeps «Bifează cel puțin un rol» for a post with no role ticked, under the same limit and the same address", async () => {
    state.choicesMax = 2;
    for (const [language, words] of [["ro", RO], ["en", EN]] as const) {
      const page = decode(await refusedVisit("", language));
      expect(errorOf(page)).toBe(words.none);
      expect(errorTag(page)).toContain('data-reason="atLeastOne"');
      expect(summaryOf(page)).toEqual([{ box: "volunteer-roleIds", sentence: words.none }]);
      expect(page).not.toMatch(/Ai bifat prea multe|You ticked too many/);
      expect(boxesOf(page).some((box) => box.ticked)).toBe(false);
      // The typed boxes come back all the same.
      expect(page).toMatch(/<input[^>]*name="name"[^>]*value="Maria Test"/);
    }
  });

  it("counts what the draft kept as the sign-up counted it: a role once however often its id came, and a role no longer offered still counts", async () => {
    state.choicesMax = 2;
    // Two roles, one of them posted three times: within the limit — so this refusal of the box is the other one (a role that is no longer this event's).
    expect(errorOf(decode(await refusedVisit(`${WATER},${WATER},${GONE},${WATER}`)))).toBe(RO.none);
    // Three roles, one of them filled or gone since: over the limit, and the two still offered come back ticked.
    const page = decode(await refusedVisit(`${WATER},${GONE},${GUIDE}`));
    expect(errorOf(page)).toBe("Ai bifat prea multe: poți bifa cel mult 2 roluri la „Ce ești dispus(ă) să faci”.");
    expect(boxesOf(page).filter((box) => box.ticked).map((box) => box.id)).toEqual([WATER, GUIDE]);
  });

  it("without a limit a refusal of the roles' box is «Bifează cel puțin un rol», however many were ticked — as it always was", async () => {
    state.choicesMax = null;
    const page = decode(await refusedVisit(`${WATER},${GUIDE},${KITS},${FINISH}`));
    expect(errorOf(page)).toBe(RO.none);
    expect(errorTag(page)).toContain('data-reason="atLeastOne"');
    expect(boxesOf(page).every((box) => box.ticked)).toBe(true);
  });

  it("says each refused box's own sentence when the roles are not the only one, and nothing about the roles when they were not refused", async () => {
    state.choicesMax = 2;
    state.draft = { roleIds: `${WATER},${GUIDE},${KITS}`, name: "", email: "maria@example.test" };
    const both = decode(await visit({ volunteer: "invalid", vfields: "roleIds,name" }));
    expect(summaryOf(both)).toEqual([
      { box: "volunteer-roleIds", sentence: "Ai bifat prea multe: poți bifa cel mult 2 roluri la „Ce ești dispus(ă) să faci”." },
      { box: "volunteer-name", sentence: "Scrie-ți numele." },
    ]);
    // Another box refused, three roles ticked under a limit the club set meanwhile: the address does not name the roles, so the page says nothing of them.
    const other = decode(await visit({ volunteer: "invalid", vfields: "name" }));
    expect(other).not.toContain('data-testid="volunteer-roles-error"');
    expect(summaryOf(other)).toEqual([{ box: "volunteer-name", sentence: "Scrie-ți numele." }]);
  });
});

describe("§NNN BR-REQ-050-02 the «Voluntari» card's box", () => {
  const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });

  async function drawCard(over: Partial<ComponentProps<typeof VolunteersCard>> = {}, language: "ro" | "en" = "ro") {
    state.locale = language;
    const drawn = (await VolunteersCard({
      locale: language,
      eventId: EVENT.id,
      acceptsVolunteers: true,
      volunteersShirts: false,
      volunteersShowCounts: false,
      eventDay: "2026-11-21",
      profileDescribed: false,
      minorsOpen: false,
      offerClosed: null,
      roles: [],
      categories: [],
      standings: [],
      volunteers: [],
      agreementInForce: true,
      agreementNoticeDescribes: true,
      agreementDocumentIds: {},
      agreementEvent: {},
      now: new Date("2026-11-16T10:00:00.000Z"),
      ...over,
    })) as ReactElement;
    const { NextIntlClientProvider } = await import("next-intl");
    const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
    return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
  }
  const formOf = (card: string) => /<form[^>]*data-testid="volunteer-choices-max-form"[\s\S]*?<\/form>/.exec(card)?.[0] ?? "";
  const boxOf = (card: string) => /<input\b[^>]*\bname="max"[^>]*>/.exec(formOf(card))?.[0] ?? "";

  it("is a small form of its own: the event, the box with the saved number, its «Salvează», and the help that says the range and what does not change", async () => {
    const form = decode(await drawCard({ volunteerChoicesMax: 2 }));
    expect(form).toContain('data-testid="volunteer-choices-max-form"');
    const own = decode(formOf(await drawCard({ volunteerChoicesMax: 2 })));
    expect(own).toContain(`name="eventId" value="${EVENT.id}"`);
    expect(own).toContain('name="uiLocale" value="ro"');
    const box = boxOf(await drawCard({ volunteerChoicesMax: 2 }));
    expect(box).toContain('value="2"');
    expect(box).toContain('inputMode="numeric"');
    expect(box).toContain('maxLength="2"');
    expect(box).toContain('data-testid="volunteer-choices-max"');
    expect(own).toContain("Cel mult câte roluri poate bifa o persoană");
    expect(own).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Salvează limita/);
    expect(own).toContain("Pe formularul public, o persoană bifează cel mult atâtea roluri, de la 1 la 20. Gol: oricâte. Ce adaugi tu de mână și ce a bifat cineva până acum rămân neschimbate.");
    // A form of its own beside the card's others — never a box of the numbers' form or of a tick's.
    expect(formOf(await drawCard({ volunteerChoicesMax: 2 }))).not.toContain('name="start"');
    expect((form.match(/data-testid="volunteer-choices-max-form"/g) ?? []).length).toBe(1);
  });

  it("shows an empty box that says «oricâte» while the event has no limit, and the box is never required: emptying it is how the limit comes off", async () => {
    for (const card of [await drawCard({ volunteerChoicesMax: null }), await drawCard()]) {
      const box = boxOf(card);
      expect(box).toContain('value=""');
      expect(box).toContain('placeholder="oricâte"');
      expect(box).not.toMatch(/\brequired\b/);
    }
  });

  it("says the same in English, and each number the event may hold is shown as saved", async () => {
    const own = decode(formOf(await drawCard({ volunteerChoicesMax: 1 }, "en")));
    expect(own).toContain("The most roles one person may tick");
    expect(own).toContain("Save the limit");
    expect(own).toContain("On the public form a person ticks at most this many roles, from 1 to 20. Empty: any number. What you add by hand and what somebody has already ticked stay as they are.");
    expect(boxOf(await drawCard({ volunteerChoicesMax: 1 }, "en"))).toContain('value="1"');
    expect(boxOf(await drawCard({ volunteerChoicesMax: 20 }, "en"))).toContain('value="20"');
    expect(boxOf(await drawCard({}, "en"))).toContain('placeholder="any number"');
  });

  it("is posted to its own Server Action from the card, and the editor's page hands the card the saved value", () => {
    const card = readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8");
    expect(card).toMatch(/<Box component="form" action=\{setVolunteerChoicesMaxAction\} data-testid="volunteer-choices-max-form">/);
    const page = readFileSync("src/app/[locale]/admin/events/[id]/page.tsx", "utf8");
    expect(page).toContain("volunteerChoicesMax={event.volunteerChoicesMax}");
  });
});
