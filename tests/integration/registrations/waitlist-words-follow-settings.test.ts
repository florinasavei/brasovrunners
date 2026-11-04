import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { FamilyStep } from "@/modules/registrations/domain/family-signing";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — every page a person reads once they are in the waiting list says who gives the places, by the allocator's
 * own rule (`offersOnItsOwn`, read off the event the link names): while no place reaches the line by itself —
 * «Locurile din lista de așteptare se alocă automat» on «Nu», or «Locurile libere le dau doar eu» ticked, whatever
 * «Da» says — the organizers write when they can give a place, never «when a place frees up»; with «Da» and the tick
 * off, today's words. The feat/registration-control join sentence's rule, carried to the rest (its review, round five).
 *
 * Rendered from a real database (PGlite), through the pages themselves, in both languages:
 *
 * - the address confirmed (`/registrations/confirm/[token]?done=waitlist`), and its list of the address's people;
 * - the declaration signed onto the waiting list (`/registrations/declare/[token]?done=waitlisted`), and a family's
 *   last screen there, its waiting person's line; signed with a place (`?done=confirmed`), where a cancelled place goes;
 * - another person on the address entered onto the waiting list (`/registrations/family/[token]?done=waitlist`);
 * - a spent link of somebody waiting (the confirmation page's «Ești pe lista de așteptare»);
 * - the event page's five steps, asked of the event's own row.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const RACE_DAY = new Date("2026-11-21T08:00:00.000Z");

type Setting = { name: string; waitlistAutoOffer: boolean; freePlacesByOfferOnly: boolean; byItself: boolean };
/** «Da» with the tick off, and the two ways no place goes out by itself. */
const SETTINGS: readonly Setting[] = [
  { name: "«Da»", waitlistAutoOffer: true, freePlacesByOfferOnly: false, byItself: true },
  { name: "«Nu»", waitlistAutoOffer: false, freePlacesByOfferOnly: false, byItself: false },
  { name: "«Da» with «Locurile libere le dau doar eu»", waitlistAutoOffer: true, freePlacesByOfferOnly: true, byItself: false },
];
const LOCALES = ["ro", "en"] as const;
const catalogue = { ro, en } as const;

let db: TestDatabase;
let close: () => Promise<void>;
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  /** The family's pass this browser holds (§471): none unless a case says so. */
  pass: null as null | { eventId: string },
  familySteps: [] as unknown[],
}));

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
// The pages, rendered with the real catalogues, in the language the case names.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => {
      const locale = typeof arg === "string" ? state.locale : arg.locale;
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      return createTranslator({ locale, messages: catalogues[locale] as typeof catalogues.ro, namespace: namespace as "Registrations" });
    },
    getLocale: async () => state.locale,
    setRequestLocale: () => {},
  };
});
// A family's wizard (§471): the pass and its people, as the browser would hold them — the rows themselves are the
// test's subject only through the event the pass names.
vi.mock("@/modules/registrations/family-signing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations/family-signing")>()),
  readFamilySigningPass: async () => state.pass,
  familyPassHolds: async () => state.pass !== null,
  familyStepsOfPass: async () => state.familySteps,
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { readSpentRegistrationLink, spentLinkOffersByItself } = await import("@/modules/registrations/token-actions");
const { offersWaitlistAutomatically } = await import("@/modules/registrations/repository");
const { findPublishedEventBySlug } = await import("@/modules/events/repository");
const { default: ConfirmEmailPage } = await import("@/app/[locale]/registrations/confirm/[token]/page");
const { default: DeclarePage } = await import("@/app/[locale]/registrations/declare/[token]/page");
const { default: FamilyConfirmPage } = await import("@/app/[locale]/registrations/family/[token]/page");
const { default: EventPageView } = await import("@/modules/events/ui/EventPageView");
const { default: RegistrationSteps } = await import("@/modules/registrations/ui/RegistrationSteps");

/** The page's markup — async Server Components and all — without Emotion's style tags; entities decoded. */
async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(withClientWords(element, state.locale));
  await stream.allReady;
  return (await new Response(stream).text())
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** A capped race, its registration open, with the two settings that say who gives a place. */
async function createRace(setting: Setting) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: RACE_DAY,
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      registrationOpensAt: new Date("2026-09-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2026-11-19T00:00:00.000Z"),
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      locationName: "Parcul Tractorul",
      capacity: 2,
      waitlistAutoOffer: setting.waitlistAutoOffer,
      freePlacesByOfferOnly: setting.freePlacesByOfferOnly,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul de toamnă" },
    { eventId: event.id, locale: "en", slug: `autumn-cross-${event.id.slice(0, 8)}`, title: "The autumn cross" },
  ]);
  return event;
}

let counter = 0;
/** One address and one registration on it, in the state given. */
async function register(eventId: string, name: string, status: RegistrationStatus, participantId?: string) {
  counter += 1;
  const email = `runner${counter}@example.org`;
  const owner =
    participantId ??
    (
      await db
        .insert(participants)
        .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
        .returning()
    )[0].id;
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: owner,
      status,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      emailConfirmedAt: status === "PENDING_EMAIL_CONFIRMATION" ? null : NOW,
      waitlistedAt: status === "WAITLISTED" ? new Date(NOW.getTime() - (100 - counter) * 60_000) : null,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
    })
    .returning();
  return row;
}

/** A link of the registration's, already pressed: what the page after the press is opened with. */
async function spentLink(registration: { id: string; participantId: string }, purpose: EmailActionTokenPurpose): Promise<string> {
  const { secret, token } = await issueActionToken(db, { participantId: registration.participantId, registrationId: registration.id, purpose, expiresAt: RACE_DAY, now: NOW });
  await db.update(emailActionTokens).set({ usedAt: NOW }).where(eq(emailActionTokens.id, token.id));
  return secret;
}

/** «24 de ore» / "24 hours": the club's offer window, as the pages say it. */
const OFFER = { ro: "24 de ore", en: "24 hours" } as const;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  state.locale = "ro";
  state.pass = null;
  state.familySteps = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("§NNN the reader of the rule: a spent link names its event", () => {
  it("answers the allocator's own rule for the event the link was spent at", async () => {
    for (const setting of SETTINGS) {
      const race = await createRace(setting);
      const ana = await register(race.id, "Ana Pop", "WAITLISTED");
      const link = await spentLink(ana, "VERIFY_REGISTRATION_EMAIL");
      expect(await spentLinkOffersByItself(link, ["VERIFY_REGISTRATION_EMAIL"], NOW), setting.name).toBe(setting.byItself);
      // The link is presented under another purpose first, as the declaration page presents its own: the next one answers.
      expect(await spentLinkOffersByItself(link, ["COMPLETE_DECLARATION", "VERIFY_REGISTRATION_EMAIL"], NOW), setting.name).toBe(setting.byItself);
    }
  });

  /*
    One default for the two readers (the review of this branch): what cannot be read gets the organizers' words, which
    promise no notice — `offersWaitlistAutomatically` for an event row it cannot find, and the spent link's reader for
    a link that names nothing, even at a «Da» event.
  */
  it("gives the organizers' words for a link that names nothing, as for an event row nobody can find", async () => {
    const race = await createRace(SETTINGS[0]);
    const ana = await register(race.id, "Ana Pop", "WAITLISTED");
    expect(await spentLinkOffersByItself("A".repeat(43), ["VERIFY_REGISTRATION_EMAIL"], NOW)).toBe(false);
    expect(await spentLinkOffersByItself("not-a-token", ["VERIFY_REGISTRATION_EMAIL"], NOW)).toBe(false);
    // A link of the «Da» event, never pressed: nothing spent names it.
    const { secret } = await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "VERIFY_REGISTRATION_EMAIL", expiresAt: RACE_DAY, now: NOW });
    expect(await spentLinkOffersByItself(secret, ["VERIFY_REGISTRATION_EMAIL"], NOW)).toBe(false);
    // Spent, but under another purpose than the page presents it under.
    expect(await spentLinkOffersByItself(await spentLink(ana, "VERIFY_REGISTRATION_EMAIL"), ["COMPLETE_DECLARATION"], NOW)).toBe(false);
    expect(await offersWaitlistAutomatically(db, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("the spent link's own state carries it for somebody waiting, and for nobody else", async () => {
    const race = await createRace(SETTINGS[1]);
    const ana = await register(race.id, "Ana Pop", "WAITLISTED");
    const waiting = await readSpentRegistrationLink(await spentLink(ana, "VERIFY_REGISTRATION_EMAIL"), [{ purpose: "VERIFY_REGISTRATION_EMAIL", reason: "ALREADY_USED" }], "ro", NOW);
    expect(waiting).toMatchObject({ message: "WAITLISTED", next: "NONE", byItself: false });
    const ion = await register(race.id, "Ion Pop", "PENDING_DECLARATION");
    const signing = await readSpentRegistrationLink(await spentLink(ion, "VERIFY_REGISTRATION_EMAIL"), [{ purpose: "VERIFY_REGISTRATION_EMAIL", reason: "ALREADY_USED" }], "ro", NOW);
    expect(signing).toMatchObject({ message: "SIGN_DECLARATION", next: "RESEND" });
    expect(signing).not.toHaveProperty("byItself");
  });
});

describe("§NNN the address confirmed onto the waiting list", () => {
  for (const setting of SETTINGS) {
    for (const locale of LOCALES) {
      it(`${setting.name}: ${setting.byItself ? "today's words" : "the organizers'"} (${locale})`, async () => {
        const race = await createRace(setting);
        const ana = await register(race.id, "Ana Pop", "WAITLISTED");
        // A second person on the same address, already holding a place: the page names each one (§588).
        await register(race.id, "Ion Pop", "PENDING_DECLARATION", ana.participantId);
        const link = await spentLink(ana, "VERIFY_REGISTRATION_EMAIL");
        state.locale = locale;
        const page = await html((await ConfirmEmailPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "waitlist" }) })) as ReactElement);
        const words = catalogue[locale].Registrations.confirm;
        expect(page).toContain('data-testid="confirm-waitlist"');
        expect(page).toContain(setting.byItself ? words.doneWaitlist : words.doneWaitlistByHand);
        expect(page).not.toContain(setting.byItself ? words.doneWaitlistByHand : words.doneWaitlist);
        // The address's list: the waiting person's line by the same rule, the other's as before.
        expect(page).toContain('data-testid="confirm-address-people"');
        expect(page).toContain(setting.byItself ? words.next.WAITLISTED : words.nextWaitlistedByHand);
        expect(page).not.toContain(setting.byItself ? words.nextWaitlistedByHand : words.next.WAITLISTED);
        expect(page).toContain(words.next.PENDING_DECLARATION);
      });
    }
  }
});

describe("§NNN a spent link of somebody waiting", () => {
  for (const setting of SETTINGS) {
    for (const locale of LOCALES) {
      it(`${setting.name}: ${setting.byItself ? "today's words" : "the organizers'"} (${locale})`, async () => {
        const race = await createRace(setting);
        const ana = await register(race.id, "Ana Pop", "WAITLISTED");
        const link = await spentLink(ana, "VERIFY_REGISTRATION_EMAIL");
        state.locale = locale;
        // The link opened again, after its press: the page says where the registration is.
        const page = await html((await ConfirmEmailPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({}) })) as ReactElement);
        const words = catalogue[locale].Registrations.spent;
        expect(page).toContain(words.WAITLISTED.title);
        expect(page).toContain(setting.byItself ? words.waitHelp : words.waitHelpByHand);
        expect(page).not.toContain(setting.byItself ? words.waitHelpByHand : words.waitHelp);
      });
    }
  }
});

describe("§NNN the declaration signed onto the waiting list", () => {
  for (const setting of SETTINGS) {
    for (const locale of LOCALES) {
      it(`${setting.name}: ${setting.byItself ? "today's words" : "the organizers'"} (${locale})`, async () => {
        const race = await createRace(setting);
        const ana = await register(race.id, "Ana Pop", "WAITLISTED");
        const link = await spentLink(ana, "COMPLETE_DECLARATION");
        state.locale = locale;
        const page = await html((await DeclarePage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "waitlisted" }) })) as ReactElement);
        const words = catalogue[locale].Registrations.declare;
        const shown = setting.byItself ? words.nextWaitlisted : words.nextWaitlistedByHand;
        const other = setting.byItself ? words.nextWaitlistedByHand : words.nextWaitlisted;
        for (const line of shown) expect(page).toContain(line);
        // The two lines that differ: the promise, and what happens past the offer's deadline.
        expect(page).not.toContain(other[0]);
        expect(page).not.toContain(other[1]);
      });
    }
  }

  it("an offer's link spent onto the line reads the same rule (§15.7: one link, two purposes)", async () => {
    const race = await createRace(SETTINGS[2]);
    const ana = await register(race.id, "Ana Pop", "WAITLISTED");
    const link = await spentLink(ana, "WAITLIST_OFFER");
    const page = await html((await DeclarePage({ params: Promise.resolve({ locale: "ro", token: link }), searchParams: Promise.resolve({ done: "waitlisted" }) })) as ReactElement);
    expect(page).toContain(ro.Registrations.declare.nextWaitlistedByHand[0]);
    expect(page).not.toContain(ro.Registrations.declare.nextWaitlisted[0]);
  });
});

/*
  The declaration signed with a place (the review of this branch): its last line says what a cancel does with the place —
  «merge la cineva de pe lista de așteptare» only while a place reaches the line by itself; with «Nu» or the tick the freed
  place waits for the organizers' «Trimite-i oferta», so they may give it.
*/
describe("§NNN the declaration signed with a place: where a cancelled place goes", () => {
  for (const setting of SETTINGS) {
    for (const locale of LOCALES) {
      it(`${setting.name}: ${setting.byItself ? "today's words" : "the organizers'"} (${locale})`, async () => {
        const race = await createRace(setting);
        const ana = await register(race.id, "Ana Pop", "CONFIRMED");
        const link = await spentLink(ana, "COMPLETE_DECLARATION");
        state.locale = locale;
        const page = await html((await DeclarePage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "confirmed" }) })) as ReactElement);
        const words = catalogue[locale].Registrations.declare;
        const shown = setting.byItself ? words.nextConfirmed : words.nextConfirmedByHand;
        const other = setting.byItself ? words.nextConfirmedByHand : words.nextConfirmed;
        expect(page).toContain(shown[0]);
        expect(page).toContain(shown[2]);
        // The line that differs: where the place goes on a cancel.
        expect(page).not.toContain(other[2]);
      });
    }
  }

  it("the organizers' lines differ from today's only where a place goes, in both languages", () => {
    for (const locale of LOCALES) {
      const words = catalogue[locale].Registrations.declare;
      expect(words.nextConfirmedByHand.slice(0, 2)).toEqual(words.nextConfirmed.slice(0, 2));
      expect(words.nextConfirmedByHand[2]).not.toBe(words.nextConfirmed[2]);
      expect(words.nextWaitlistedByHand[2]).toBe(words.nextWaitlisted[2]);
    }
  });
});

describe("§NNN a family's last screen: the person on the waiting list", () => {
  for (const setting of SETTINGS) {
    for (const locale of LOCALES) {
      it(`${setting.name}: ${setting.byItself ? "today's words" : "the organizers'"} (${locale})`, async () => {
        const race = await createRace(setting);
        const ana = await register(race.id, "Ana Pop", "CONFIRMED");
        const ion = await register(race.id, "Ion Pop", "WAITLISTED", ana.participantId);
        const step = (row: { id: string; registeredName: string; status: RegistrationStatus }): FamilyStep => ({
          id: row.id,
          registeredName: row.registeredName,
          status: row.status,
          state: "signed",
          holdExpiresAt: null,
          checkinCode: null,
          raceNumber: null,
        });
        // The wizard walked both (§471): the pass this browser holds names the event.
        state.pass = { eventId: race.id };
        state.familySteps = [step(ana), step(ion)];
        state.locale = locale;
        const link = await spentLink(ana, "COMPLETE_DECLARATION");
        const page = await html((await DeclarePage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "confirmed" }) })) as ReactElement);
        const what = catalogue[locale].Registrations.declare.family.what;
        expect(page).toContain('data-testid="family-signing-done"');
        expect(page).toContain(setting.byItself ? what.waitlisted : what.waitlistedByHand);
        expect(page).not.toContain(setting.byItself ? what.waitlistedByHand : what.waitlisted);
      });
    }
  }
});

describe("§NNN another person on the address, entered onto the waiting list", () => {
  for (const setting of SETTINGS) {
    for (const locale of LOCALES) {
      it(`${setting.name}: ${setting.byItself ? "today's words" : "the organizers'"} (${locale})`, async () => {
        const race = await createRace(setting);
        // The link for another person is scoped to the registration the address already holds there (§389).
        const ana = await register(race.id, "Ana Pop", "PENDING_DECLARATION");
        await register(race.id, "Ion Pop", "WAITLISTED", ana.participantId);
        const link = await spentLink(ana, "REGISTER_ANOTHER_PERSON");
        state.locale = locale;
        const page = await html((await FamilyConfirmPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "waitlist" }) })) as ReactElement);
        const words = catalogue[locale].Registrations.family;
        expect(page).toContain('data-testid="family-confirmed"');
        expect(page).toContain(setting.byItself ? words.doneWaitlist : words.doneWaitlistByHand);
        expect(page).not.toContain(setting.byItself ? words.doneWaitlistByHand : words.doneWaitlist);
      });
    }
  }
});

/** Every element of `type` in a returned tree, its children walked without rendering them. */
function elementsOf(node: unknown, type: unknown): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child, type));
  if (typeof node !== "object" || node === null || !("props" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [...(element.type === type ? [element] : []), ...elementsOf(element.props.children, type)];
}

describe("§NNN the event page's five steps ask the event's own row", () => {
  it("the waiting list's step is the organizers' with «Nu» or the tick, today's with «Da» — the page's row in both languages", async () => {
    for (const setting of SETTINGS) {
      const race = await createRace(setting);
      for (const locale of LOCALES) {
        state.locale = locale;
        const slug = locale === "ro" ? `crosul-${race.id.slice(0, 8)}` : `autumn-cross-${race.id.slice(0, 8)}`;
        const event = await findPublishedEventBySlug(db, locale, slug);
        if (!event) throw new Error("the race did not publish");
        const tree = await EventPageView({ event, locale, slug, now: NOW, weather: null, membersOnly: false });
        const steps = elementsOf(tree, RegistrationSteps);
        expect(steps, `${setting.name} ${locale}`).toHaveLength(1);
        expect(steps[0].props.byItself, `${setting.name} ${locale}`).toBe(setting.byItself);
        // And what that asks the steps to say, in this language (`RegistrationSteps`' own test holds the rest).
        const body = catalogue[locale].Registration.steps.waitingList;
        const said = await html((await RegistrationSteps(steps[0].props as Parameters<typeof RegistrationSteps>[0])) as ReactElement);
        expect(said).toContain((setting.byItself ? body.body : body.bodyByHand).replace("{offer}", OFFER[locale]));
      }
    }
  });
});
