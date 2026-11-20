import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { sealFormDraft } from "@/modules/registrations/form-draft";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §984, BR-REQ-050-02, BR-REQ-036-02, BR-REQ-041-01 — the raffle's public doors on their screens (the owner, 2026-11-18: «Practic
 * oamenii trebuie să își treacă numărul de concurs și numele, dar trebuie să am și o bifă de „voluntar”»), read from a real database:
 *
 * - the raffle's own page, `/evenimente/<slug>/tombola` and `/en/events/<slug>/raffle`: the form while the one gate is open — the
 *   number (digits), the name, «Sunt voluntar» while the volunteers may take part, «Regulamentul tombolei» in a fold with the event's
 *   facts filled, the acceptance's tick, the notice's line, the honeypot and the render time — and a 404 for each condition that shuts
 *   it, but the thank-you of a person reading the answer to their own post; the neutral sentence and the boxes to fix;
 * - the event page's one calm link, drawn from the gate's cached twin;
 * - «Gestionează înscrierea»'s «Tombola» card: the rules, the tick and «Particip la tombolă» for a confirmed runner with a number while
 *   the gate is open, «Ești înscris la tombolă» and «Nu mai particip» once in, nothing while it is shut — the GET writing nothing and
 *   spending no link.
 *
 * The races start in 2099, so the pages' own clock keeps the gate open; the made-up people are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en", draft: null as string | null }));

vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (arg: string | { locale?: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = (typeof arg === "string" ? state.locale : (arg.locale ?? state.locale)) as "ro" | "en";
      return createTranslator({ locale, messages: catalogues[locale], namespace: namespace as "Event" });
    },
    getLocale: async () => state.locale,
    setRequestLocale: () => {},
  };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  // What a refused post kept, sealed as the action seals it (`form-draft.ts`), when a test hands one back; else no cookie at all.
  cookies: async () => ({ get: (name: string) => (name === "br_form_draft" && state.draft ? { value: state.draft } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement: element } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children, ...rest }: { href: unknown; children?: ReactNode } & Record<string, unknown>) =>
      element("a", { href: typeof href === "string" ? href : JSON.stringify(href), "data-testid": rest["data-testid"] }, children),
  };
});
vi.mock("@/shared/feedback/PublicFlash", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));

const { default: RafflePage } = await import("@/app/[locale]/events/[slug]/tombola/page");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");
const { default: RaffleCallout } = await import("@/modules/volunteers/ui/RaffleCallout");
const { cachedRaffleSignUpOpen } = await import("@/modules/public-cache/reads");
const { signUpForRaffleByLink } = await import("@/modules/volunteers/raffle-entries");
const { raffleManageCard } = await import("@/modules/volunteers/ui/RaffleManageCard");

const START = new Date("2099-11-21T07:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
let eventId: string;
let slug: { ro: string; en: string };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.draft = null;
  ({ eventId, slug } = await race());
});

/** The texts the gate asks, approved: a notice naming `{{raffle}}` and the platform's rules — or, by name, one of them left out. */
async function approveTexts(leaveOut: { rules?: boolean; marker?: boolean } = {}) {
  const paragraph = (locale: "ro" | "en") =>
    leaveOut.marker ? (locale === "ro" ? "Tombola: nimic." : "The raffle: nothing.") : locale === "ro" ? "Tombola ({{raffle}}): păstrăm înscrierea." : "The raffle ({{raffle}}): we keep the sign-up.";
  const texts: Array<[string, LegalDocumentTranslationInput[]]> = [
    ["PRIVACY_NOTICE", (["ro", "en"] as const).map((locale) => ({ locale, title: locale === "ro" ? "Confidențialitate" : "Privacy", body: { sections: [{ paragraphs: [paragraph(locale)] }] } }))],
    ["TERMS", (["ro", "en"] as const).map((locale) => ({ locale, title: "Termeni", body: { sections: [{ paragraphs: ["p"] }] } }))],
    ["EVENT_DECLARATION", (["ro", "en"] as const).map((locale) => ({ locale, title: "Declarație", body: { sections: [{ paragraphs: ["p"] }] } }))],
    ...(leaveOut.rules ? [] : [["RAFFLE_RULES", (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.RAFFLE_RULES[locale] }))] as [string, LegalDocumentTranslationInput[]]]),
  ];
  for (const [key, translations] of texts) {
    await insertLegalDocumentVersion(db, { key: key as "TERMS", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(translations), translations, now: EFFECTIVE });
  }
}

/** A published race in 2099 whose raffle asks a sign-up, its sign-ups open, every group ticked. */
async function race(over: Partial<typeof events.$inferInsert> = {}) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: START,
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: EFFECTIVE,
      locationName: "Parcul Noua",
      hasRaffle: true,
      raffleSignUp: true,
      raffleSignUpOpen: true,
      ...over,
    })
    .returning({ id: events.id });
  const slugs = { ro: `crosul-tombolei-${serial}`, en: `raffle-cross-${serial}` };
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: slugs.ro, title: `Crosul tombolei ${serial}` },
    { eventId: event.id, locale: "en", slug: slugs.en, title: `The raffle cross ${serial}` },
  ]);
  return { eventId: event.id, slug: slugs };
}

/** A made-up registration of the race, confirmed with a number unless told otherwise; its own address. */
async function runner(name: string, bibNumber: number | null, more: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
    .returning({ id: participants.id });
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      firstName: name.split(" ")[0],
      lastName: name.split(" ").slice(1).join(" ") || "Exemplu",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: EFFECTIVE,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: true,
      tshirtSize: "NONE",
      status: "CONFIRMED",
      confirmedAt: EFFECTIVE,
      bibNumber,
      checkinCode: newCheckinCode(),
      ...more,
    })
    .returning({ id: registrations.id });
  return { id: row.id, participantId: participant.id };
}

async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The opening tag of the element carrying `data-testid` (or the input named) — what a box draws. */
const tagOf = (markup: string, needle: string) => {
  const at = markup.indexOf(needle);
  return at === -1 ? null : markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
};

/** The raffle's page as a visitor gets it, or null for its 404. */
async function rafflePage(query: Record<string, string> = {}, locale: "ro" | "en" = "ro"): Promise<string | null> {
  state.locale = locale;
  try {
    return await html(await RafflePage({ params: Promise.resolve({ locale, slug: slug[locale] }), searchParams: Promise.resolve(query) }));
  } catch (error) {
    if ((error as Error).message === "NEXT_NOT_FOUND") return null;
    throw error;
  }
}

async function managePage(secret: string, query: Record<string, string> = {}, locale: "ro" | "en" = "ro"): Promise<string> {
  state.locale = locale;
  return html(await ManageRegistrationPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve(query) }));
}

const manageToken = async (participantId: string, registrationId: string) =>
  (await issueActionToken(db, { participantId, registrationId, purpose: "MANAGE_REGISTRATION", expiresAt: START, now: new Date() })).secret;

describe("§984 BR-REQ-050-02 the raffle's own page: the form while the gate is open, a 404 while it is shut", () => {
  it("draws the number, the name, «Sunt voluntar», the rules filled for the event, the tick, the notice's line and the bot defences", async () => {
    await approveTexts();
    const page = await rafflePage();
    expect(page).not.toBeNull();
    const markup = page as string;
    expect(words(markup.slice(markup.indexOf('data-testid="raffle-title"'), markup.indexOf("</h1>")))).toContain(ro.Event.raffle.title);
    // The race number: digits, on a phone's number pad — or a volunteer's V number as it is written, «V007» (§1023), so an optional V
    // first and one character more; the name as at registration, at most the column's length.
    const number = tagOf(markup, 'name="number"') ?? "";
    expect(number).toMatch(/inputmode="numeric"/i);
    expect(number).toMatch(/pattern="\[Vv\]\?\[0-9\]\*"/);
    expect(number).toMatch(/maxlength="6"/i);
    expect(number).toMatch(/required/);
    const name = tagOf(markup, 'name="name"') ?? "";
    expect(name).toMatch(/maxlength="120"/i);
    expect(name).toMatch(/autocomplete="name"/i);
    // «Sunt voluntar» while the volunteers may take part, with its line.
    expect(markup).toContain('name="volunteer"');
    expect(words(markup)).toContain(ro.Event.raffle.volunteer);
    expect(words(markup)).toContain(ro.Event.raffle.introVolunteer);
    // «Regulamentul tombolei» in a fold, closed, its blanks filled for this event and the groups it ticks.
    const fold = markup.slice(markup.indexOf('data-testid="raffle-rules"'), markup.indexOf("</details>", markup.indexOf('data-testid="raffle-rules"')));
    expect(tagOf(markup, 'data-testid="raffle-rules"')).toMatch(/^<details/);
    expect(tagOf(markup, 'data-testid="raffle-rules"')).not.toMatch(/\sopen/);
    expect(words(fold)).toContain("Regulamentul tombolei");
    expect(words(fold)).toContain(`Tombola se ține la evenimentul Crosul tombolei ${serial}`);
    expect(words(fold)).toContain("în Parcul Noua");
    // The filled blank is drawn in bold: its words, the sentence's period after the tag.
    expect(words(fold)).toContain("Pot participa la tombolă alergătorii înscriși și confirmați, cu număr de concurs, sportivii de top ai cursei și voluntarii confirmați, cu număr de voluntar");
    expect(fold).not.toContain("{{");
    // The acceptance's tick, required, its words the owner's; the notice's line with its link; no email promised.
    expect(tagOf(markup, 'name="accept"')).toMatch(/required/);
    expect(words(markup)).toContain(ro.Event.raffle.accept);
    expect(words(markup.slice(markup.indexOf('data-testid="raffle-notice"')))).toContain("nota de confidențialitate");
    expect(markup).toContain('href="/legal/privacy"');
    // The house's public-form defences: the honeypot, the render time — and no Turnstile without its keys.
    expect(tagOf(markup, 'name="honeypot"')).toMatch(/tabindex="-1"/i);
    expect(markup).toMatch(/name="renderedAt" value="\d{4}-\d{2}-\d{2}T/);
    expect(markup).not.toContain("cf-turnstile");
    expect(words(markup)).toContain(ro.Event.raffle.submit);
    // Nothing of a person, nothing typed: the boxes start empty.
    expect(number).toMatch(/value=""/);
  });

  it("asks no «Sunt voluntar» while the event's volunteers may not take part", async () => {
    await approveTexts();
    await db.update(events).set({ raffleVolunteers: false }).where(eq(events.id, eventId));
    const page = (await rafflePage()) as string;
    expect(page).not.toBeNull();
    expect(page).not.toContain('name="volunteer"');
    expect(words(page)).not.toContain(ro.Event.raffle.introVolunteer);
  });

  it("is a 404 for each condition that shuts the gate — and never a form that cannot work", async () => {
    const shut: Array<[string, Partial<typeof events.$inferInsert>]> = [
      ["no raffle", { hasRaffle: false }],
      ["«Din oficiu»", { raffleSignUp: false }],
      ["the sign-ups closed", { raffleSignUpOpen: false }],
      ["no group ticked", { raffleRunners: false, raffleElites: false, raffleVolunteers: false }],
      ["cancelled", { eventStatus: "CANCELLED" }],
      ["over", { startsAt: new Date("2020-05-01T07:00:00.000Z"), endsAt: new Date("2020-05-01T12:00:00.000Z") }],
      ["not a race", { type: "GROUP_RUN" }],
      ["not published", { editorialStatus: "DRAFT" }],
    ];
    await approveTexts();
    expect(await rafflePage()).not.toBeNull();
    for (const [why, change] of shut) {
      ({ eventId, slug } = await race(change));
      expect(await rafflePage(), why).toBeNull();
      expect(await cachedRaffleSignUpOpen(eventId, new Date()), why).toBe(false);
    }
  });

  it("is a 404 without the rules in force, and without a notice naming `{{raffle}}` — in every language", async () => {
    await approveTexts({ rules: true });
    expect(await rafflePage()).toBeNull();
    expect(await rafflePage({}, "en")).toBeNull();
    await resetTables(db);
    ({ eventId, slug } = await race());
    await approveTexts({ marker: true });
    expect(await rafflePage()).toBeNull();
    expect(await cachedRaffleSignUpOpen(eventId, new Date())).toBe(false);
  });

  it("answers the thank-you to a person reading the answer to their own post, though the sign-ups closed meanwhile", async () => {
    await approveTexts();
    await db.update(events).set({ raffleSignUpOpen: false }).where(eq(events.id, eventId));
    const page = (await rafflePage({ tombola: "done" })) as string;
    expect(page).not.toBeNull();
    expect(words(page)).toContain(ro.Event.raffle.done);
    expect(page).not.toContain('name="number"');
    // …but not on an event that holds no raffle, nor on one «Din oficiu»: an address typed with the answer says nothing there.
    await db.update(events).set({ raffleSignUp: false }).where(eq(events.id, eventId));
    expect(await rafflePage({ tombola: "done" })).toBeNull();
    await db.update(events).set({ raffleSignUp: true, hasRaffle: false }).where(eq(events.id, eventId));
    expect(await rafflePage({ tombola: "done" })).toBeNull();
  });

  it("says the one neutral sentence, the throttle's, the bot check's, and names the boxes to fix", async () => {
    await approveTexts();
    expect(words((await rafflePage({ tombola: "nomatch" })) as string)).toContain(ro.Event.raffle.noMatch);
    expect(words((await rafflePage({ tombola: "limited" })) as string)).toContain(ro.Event.raffle.limited);
    expect(words((await rafflePage({ tombola: "captcha" })) as string)).toContain(ro.Event.raffle.captcha);
    const fix = words((await rafflePage({ tombola: "invalid", fields: "number,name,accept" })) as string);
    for (const sentence of [ro.Event.raffle.fix, ro.Event.raffle.errors.number, ro.Event.raffle.errors.name, ro.Event.raffle.errors.accept]) expect(fix).toContain(sentence);
    // An answer the page does not know is no answer: the plain form.
    const unknown = words((await rafflePage({ tombola: "anything" })) as string);
    expect(unknown).not.toContain(ro.Event.raffle.noMatch);
    expect(unknown).not.toContain(ro.Event.raffle.done);
  });

  it("says under a runner's number refused for «V7» that a number starting with V is a volunteer's, «Sunt voluntar» to tick (§1023)", async () => {
    await approveTexts();
    // The box's pattern lets «V7» through for the volunteers; the service refuses it as a race number and the action keeps what was typed.
    state.draft = sealFormDraft({ number: "V7", name: "Ion Voluntar", volunteer: "" });
    const refused = (await rafflePage({ tombola: "invalid", fields: "number" })) as string;
    expect(words(refused)).toContain(ro.Event.raffle.errors.volunteerNumber);
    expect(words(refused)).not.toContain(ro.Event.raffle.errors.number);
    expect(tagOf(refused, 'name="number"')).toMatch(/value="V7"/);
    expect(ro.Event.raffle.errors.volunteerNumber).toContain(`„${ro.Event.raffle.volunteer}”`);
    // In English, the box's own words.
    const english = words((await rafflePage({ tombola: "invalid", fields: "number" }, "en")) as string);
    expect(english).toContain(en.Event.raffle.errors.volunteerNumber);
    expect(en.Event.raffle.errors.volunteerNumber).toContain(`“${en.Event.raffle.volunteer}”`);
    // A runner's malformed number, or a volunteer's with the box ticked: the plain words, as before.
    for (const typed of [{ number: "7a", volunteer: "" }, { number: "V7a", volunteer: "on" }]) {
      state.draft = sealFormDraft({ ...typed, name: "Ion Voluntar" });
      const plain = words((await rafflePage({ tombola: "invalid", fields: "number" })) as string);
      expect(plain, typed.number).toContain(ro.Event.raffle.errors.number);
      expect(plain, typed.number).not.toContain(ro.Event.raffle.errors.volunteerNumber);
    }
    // Where the volunteers may not take part, «Sunt voluntar» is not drawn to be ticked: the plain words.
    ({ eventId, slug } = await race({ raffleVolunteers: false }));
    state.draft = sealFormDraft({ number: "V7", name: "Ion Voluntar", volunteer: "" });
    const noVolunteers = words((await rafflePage({ tombola: "invalid", fields: "number" })) as string);
    expect(noVolunteers).toContain(ro.Event.raffle.errors.number);
    expect(noVolunteers).not.toContain(ro.Event.raffle.errors.volunteerNumber);
  });

  it("speaks English at /en/events/<slug>/raffle, the English rules filled", async () => {
    await approveTexts();
    const page = (await rafflePage({}, "en")) as string;
    expect(page).not.toBeNull();
    const text = words(page);
    for (const sentence of [en.Event.raffle.title, en.Event.raffle.number, en.Event.raffle.name, en.Event.raffle.volunteer, en.Event.raffle.accept, en.Event.raffle.submit]) expect(text).toContain(sentence);
    expect(text).toContain(`The raffle is held at the event The raffle cross ${serial}`);
    expect(text).toContain("Raffle rules");
    expect(page).toContain('href="/legal/privacy"');
  });
});

describe("§984 BR-REQ-041-01 the event page's one calm link to the raffle's page", () => {
  it("is drawn from the gate's cached twin — open only while every condition holds — never on a members' event", async () => {
    await approveTexts();
    expect(await cachedRaffleSignUpOpen(eventId, new Date())).toBe(true);
    await db.update(events).set({ raffleSignUpOpen: false }).where(eq(events.id, eventId));
    expect(await cachedRaffleSignUpOpen(eventId, new Date())).toBe(false);
    // The event page asks it, after the members' check, and hands the view one boolean; the view draws the link from it alone.
    const page = readFileSync("src/app/[locale]/events/[slug]/page.tsx", "utf8");
    expect(page).toMatch(/const raffleOpen = membersOnly \? false : await readOrWhileAway\(\(\) => cachedRaffleSignUpOpen\(event\.id, now\), false\)/);
    expect(page).toContain("raffle: raffleOpen");
    expect(readFileSync("src/modules/events/ui/EventPageView.tsx", "utf8")).toContain("{visit?.raffle && !membersOnly && <RaffleCallout slug={slug} />}");
  });

  it("says one line and links to the raffle's own page with a thumb's 44 pixels, in both languages", async () => {
    const markup = await html(await RaffleCallout({ slug: "crosul-tombolei" }));
    expect(words(markup)).toContain(ro.Event.raffle.callout.line);
    expect(words(markup)).toContain(ro.Event.raffle.callout.button);
    expect(markup).toContain(JSON.stringify({ pathname: "/events/[slug]/tombola", params: { slug: "crosul-tombolei" } }).replace(/"/g, "&quot;"));
    expect(readFileSync("src/modules/volunteers/ui/RaffleCallout.tsx", "utf8")).toMatch(/sx=\{\{ \.\.\.TAP_TARGET, \.\.\.WITH_GLYPH_SX \}\}/);
    state.locale = "en";
    expect(words(await html(await RaffleCallout({ slug: "raffle-cross" })))).toContain(en.Event.raffle.callout.button);
  });
});

describe("§984 BR-REQ-036-02 «Gestionează înscrierea»'s «Tombola» card", () => {
  it("offers a confirmed runner with a number the rules, the tick and «Particip la tombolă» — the GET writing nothing, the link not spent", async () => {
    await approveTexts();
    const ana = await runner("Ana Popescu", 7);
    const secret = await manageToken(ana.participantId, ana.id);
    const page = await managePage(secret);
    const card = page.slice(page.indexOf('data-testid="manage-raffle"'));
    expect(page).toContain('data-testid="manage-raffle-sign-up"');
    expect(words(card)).toContain(ro.Registrations.raffle.title);
    expect(words(card)).toContain(ro.Registrations.raffle.intro);
    expect(tagOf(card, 'data-testid="manage-raffle-rules"')).toMatch(/^<details/);
    expect(words(card)).toContain("Pot participa la tombolă alergătorii înscriși și confirmați");
    expect(tagOf(card, 'name="accept"')).toMatch(/required/);
    expect(words(card)).toContain(ro.Registrations.raffle.signUp);
    // A POST form carrying the link and the person — never a link that acts on a GET.
    expect(card).toMatch(new RegExp(`name="registrationId" value="${ana.id}"`));
    expect(await db.select().from(eventRaffleEntries)).toEqual([]);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, ana.id));
    expect(token.usedAt).toBeNull();
  });

  it("says «Ești înscris la tombolă» with «Nu mai particip» once in, and the press's own sentence", async () => {
    await approveTexts();
    const ana = await runner("Ana Popescu", 7);
    const secret = await manageToken(ana.participantId, ana.id);
    await signUpForRaffleByLink(db, { secret, accepted: true, locale: "ro" }, new Date());
    const page = await managePage(secret, { raffle: "1" });
    expect(page).toContain('data-testid="manage-raffle-withdraw"');
    expect(page).not.toContain('data-testid="manage-raffle-sign-up"');
    expect(words(page)).toContain(ro.Registrations.raffle.signedUp);
    expect(words(page)).toContain(ro.Registrations.raffle.withdraw);
    expect(words(page)).toContain(ro.Registrations.raffle.done);
    expect(words(await managePage(secret, { raffle: "a" }))).toContain(ro.Registrations.raffle.needAccept);
    expect(words(await managePage(secret, { raffle: "w" }))).toContain(ro.Registrations.raffle.withdrawn);
  });

  it("draws nothing where no rules can be read, and tells another adult on the address only where they sign up", async () => {
    const base = {
      locale: "ro",
      token: "t",
      registrationId: "00000000-0000-4000-8000-000000000001",
      own: false,
      family: true,
      outcome: null,
      signUpAction: async () => {},
      withdrawAction: async () => {},
    };
    // Eligible, not in, and no rules to read in the page's language: no card with no tick and no button.
    expect(await raffleManageCard({ ...base, card: { signedUp: false, maySignUp: true }, rules: null })).toBeNull();
    // Another adult, not in: one sentence, no form, and no promise of a way out the card does not offer.
    const other = await html(await raffleManageCard({ ...base, card: { signedUp: false, maySignUp: false }, rules: null }));
    expect(words(other)).toContain(ro.Registrations.raffle.otherAdult);
    expect(other).not.toContain("<form");
    expect(other).not.toContain("<button");
    expect(ro.Registrations.raffle.otherAdult).not.toMatch(/retrag/);
    expect(en.Registrations.raffle.otherAdult).not.toMatch(/take them out/);
    // Another adult already in keeps the way out.
    expect(await html(await raffleManageCard({ ...base, card: { signedUp: true, maySignUp: false }, rules: null }))).toContain('data-testid="manage-raffle-withdraw"');
  });

  it("is not drawn while the gate is shut, nor for a runner the raffle does not take — and speaks English", async () => {
    await approveTexts();
    const ana = await runner("Ana Popescu", 7);
    const secret = await manageToken(ana.participantId, ana.id);
    const english = await managePage(secret, {}, "en");
    expect(words(english)).toContain(en.Registrations.raffle.title);
    expect(words(english)).toContain(en.Registrations.raffle.signUp);
    await db.update(events).set({ raffleSignUpOpen: false }).where(eq(events.id, eventId));
    expect(await managePage(secret)).not.toContain('data-testid="manage-raffle"');
    await db.update(events).set({ raffleSignUpOpen: true, raffleRunners: false }).where(eq(events.id, eventId));
    expect(await managePage(secret)).not.toContain('data-testid="manage-raffle"');
    await db.update(events).set({ raffleRunners: true }).where(eq(events.id, eventId));
    // No number yet: nothing to draw; a number given: the card.
    const dan = await runner("Dan Ionescu", null);
    const danSecret = await manageToken(dan.participantId, dan.id);
    expect(await managePage(danSecret)).not.toContain('data-testid="manage-raffle"');
    await db.update(registrations).set({ bibNumber: 9 }).where(eq(registrations.id, dan.id));
    expect(await managePage(danSecret)).toContain('data-testid="manage-raffle"');
  });
});
