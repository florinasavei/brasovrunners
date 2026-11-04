import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmailActionTokenPurpose, emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { formatDay } from "@/i18n/dates";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Eliberează singur locurile nesemnate la termen» (§NNN; the review's should-fix) — the registration journey's strip on
 * every page that draws its declaration step: while the release will take the place, the step says to sign online by the
 * release's deadline and that the place goes then, and never «sau pe hârtie la masa de înscrieri în ziua cursei»; with
 * the switch off, today's words, the desk included.
 *
 * Rendered from a real database (PGlite), through the pages themselves, in both languages:
 *
 * - the address confirmed with a place (`/registrations/confirm/[token]?done=1`) and its link opened again afterwards
 *   (the declaration still to sign: «din emailul pe care l-ai primit»);
 * - another person on the address entered with a place (`/registrations/family/[token]?done=declare`) and a family
 *   confirmed with its declarations to sign (`?done=family&wizard=1`) — a hold given now at the event;
 * - an invitation accepted (`/registrations/invitation/[token]?done=1`) — the registration it created;
 * - the signing page itself is `deadline-release-promises.test.ts`'s, the strip there a stand-in told the deadline.
 *
 * And the reader the pages ask (`spentLinkReleaseMoment`), for each kind of link and for a special guest's place.
 */
const NOW = new Date("2026-10-01T09:00:00.000Z");
const RACE_DAY = new Date("2026-11-21T08:00:00.000Z");
const DAY = 86_400_000;
/** The participation window's deadline: two days before the start. */
const DEADLINE = new Date(RACE_DAY.getTime() - 2 * DAY);
const LOCALES = ["ro", "en"] as const;
const DESK = { ro: "sau pe hârtie la masa de înscrieri în ziua cursei", en: "or on paper at the registration desk on race day" } as const;

let db: TestDatabase;
let close: () => Promise<void>;
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
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

const { fakeNextCache } = await import("../../helpers/next-cache");
const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { spentLinkReleaseMoment } = await import("@/modules/registrations/token-actions");
const { default: ConfirmEmailPage } = await import("@/app/[locale]/registrations/confirm/[token]/page");
const { default: FamilyConfirmPage } = await import("@/app/[locale]/registrations/family/[token]/page");
const { default: InvitationPage } = await import("@/app/[locale]/registrations/invitation/[token]/page");

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

/** A capped race asked 7 days and due 2 days before the start, the release switched on or off. */
async function createRace(release: boolean) {
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
      capacity: 20,
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
      releaseUnsignedAtDeadline: release,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul de toamnă" },
    { eventId: event.id, locale: "en", slug: `autumn-cross-${event.id.slice(0, 8)}`, title: "The autumn cross" },
  ]);
  return event;
}

let counter = 0;
/** One address and one registration on it, holding its place until the window's deadline when it waits for the declaration. */
async function register(eventId: string, status: RegistrationStatus, overrides: Partial<typeof registrations.$inferInsert> = {}) {
  counter += 1;
  const email = `runner${counter}@example.org`;
  const [owner] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ana Pop", preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: owner.id,
      status,
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: "Ana P.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      emailConfirmedAt: NOW,
      confirmedAt: status === "CONFIRMED" ? NOW : null,
      holdExpiresAt: status === "PENDING_DECLARATION" ? DEADLINE : null,
      ...overrides,
    })
    .returning();
  return { ...row, email };
}

/** A link of the registration's, already pressed: what the page after the press is opened with. */
async function spentLink(registration: { id: string; participantId: string }, purpose: EmailActionTokenPurpose): Promise<string> {
  const { secret, token } = await issueActionToken(db, { participantId: registration.participantId, registrationId: registration.id, purpose, expiresAt: RACE_DAY, now: NOW });
  await db.update(emailActionTokens).set({ usedAt: NOW }).where(eq(emailActionTokens.id, token.id));
  return secret;
}

/** An invitation accepted with its link: the registration it created, and the spent link. */
async function acceptedInvitation(eventId: string): Promise<string> {
  const registration = await register(eventId, "PENDING_DECLARATION");
  const [invitation] = await db
    .insert(eventInvitations)
    .values({
      eventId,
      participantId: registration.participantId,
      name: "Ana Pop",
      email: registration.email,
      canonicalEmail: registration.email,
      sentAt: NOW,
      lastSentAt: NOW,
      expiresAt: new Date(NOW.getTime() + 7 * DAY),
      acceptedAt: NOW,
      acceptedRegistrationId: registration.id,
    })
    .returning();
  const { secret, token } = await issueActionToken(db, {
    participantId: registration.participantId,
    registrationId: null,
    purpose: "ACCEPT_INVITATION",
    invitationId: invitation.id,
    expiresAt: invitation.expiresAt,
    now: NOW,
  });
  await db.update(emailActionTokens).set({ usedAt: NOW }).where(eq(emailActionTokens.id, token.id));
  return secret;
}

const said = (locale: "ro" | "en") => formatDay(DEADLINE, { locale, timeZone: "Europe/Bucharest", style: "long", withTime: true, position: "inline" });

/** The strip's declaration step with the release: the deadline, online, never the desk; today's words without it. */
function expectStrip(page: string, locale: "ro" | "en", release: boolean) {
  if (release) {
    expect(page).toContain(`${locale === "ro" ? "până" : "by"} ${said(locale)}`);
    expect(page).not.toContain(DESK[locale]);
  } else {
    expect(page).toContain(DESK[locale]);
    expect(page).not.toContain(said(locale));
  }
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  state.locale = "ro";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("§NNN the reader the pages ask: when the release will take the place a spent link speaks of", () => {
  it("the person's own hold for their own links, a hold given now for a family's link, the accepted registration for an invitation's", async () => {
    const race = await createRace(true);
    const ana = await register(race.id, "PENDING_DECLARATION");
    const deadline = { at: DEADLINE, timeZone: "Europe/Bucharest" };
    expect(await spentLinkReleaseMoment(await spentLink(ana, "VERIFY_REGISTRATION_EMAIL"), ["VERIFY_REGISTRATION_EMAIL"], NOW)).toEqual(deadline);
    // Presented under another purpose first, as the signing page presents its own: the next one answers.
    expect(await spentLinkReleaseMoment(await spentLink(ana, "WAITLIST_OFFER"), ["COMPLETE_DECLARATION", "WAITLIST_OFFER"], NOW)).toEqual(deadline);
    // A family's link names the address's registration, confirmed long ago: a hold given now at the event.
    const holder = await register(race.id, "CONFIRMED");
    expect(await spentLinkReleaseMoment(await spentLink(holder, "REGISTER_ANOTHER_PERSON"), ["REGISTER_ANOTHER_PERSON"], NOW)).toEqual(deadline);
    expect(await spentLinkReleaseMoment(await acceptedInvitation(race.id), ["ACCEPT_INVITATION"], NOW)).toEqual(deadline);
    // A special guest's place: the release leaves it (§643), so the desk stays true.
    const guest = await register(race.id, "PENDING_DECLARATION", { outsideCapacity: true });
    expect(await spentLinkReleaseMoment(await spentLink(guest, "VERIFY_REGISTRATION_EMAIL"), ["VERIFY_REGISTRATION_EMAIL"], NOW)).toBeNull();
    // Somebody on the waiting list has no place to release; a link that names nothing answers today's words.
    const waiting = await register(race.id, "WAITLISTED");
    expect(await spentLinkReleaseMoment(await spentLink(waiting, "VERIFY_REGISTRATION_EMAIL"), ["VERIFY_REGISTRATION_EMAIL"], NOW)).toBeNull();
    expect(await spentLinkReleaseMoment("A".repeat(43), ["VERIFY_REGISTRATION_EMAIL", "ACCEPT_INVITATION"], NOW)).toBeNull();
  });

  it("the switch off, or the release already run for this deadline: nothing", async () => {
    const off = await createRace(false);
    const ana = await register(off.id, "PENDING_DECLARATION");
    expect(await spentLinkReleaseMoment(await spentLink(ana, "VERIFY_REGISTRATION_EMAIL"), ["VERIFY_REGISTRATION_EMAIL"], NOW)).toBeNull();
    const ran = await createRace(true);
    await db.update(events).set({ unsignedReleasedFor: DEADLINE }).where(eq(events.id, ran.id));
    const holder = await register(ran.id, "CONFIRMED");
    expect(await spentLinkReleaseMoment(await spentLink(holder, "REGISTER_ANOTHER_PERSON"), ["REGISTER_ANOTHER_PERSON"], NOW)).toBeNull();
  });
});

describe("§NNN the journey's strip on every page that draws the declaration step", () => {
  for (const release of [true, false]) {
    for (const locale of LOCALES) {
      const name = `${release ? "the release armed" : "the switch off"} (${locale})`;

      it(`the address confirmed with a place, and its link opened again: ${name}`, async () => {
        const race = await createRace(release);
        const ana = await register(race.id, "PENDING_DECLARATION");
        const link = await spentLink(ana, "VERIFY_REGISTRATION_EMAIL");
        state.locale = locale;
        const done = await html((await ConfirmEmailPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "1" }) })) as ReactElement);
        expectStrip(done, locale, release);
        const again = await html((await ConfirmEmailPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({}) })) as ReactElement);
        expectStrip(again, locale, release);
      });

      it(`another person on the address entered with a place, and a family confirmed: ${name}`, async () => {
        const race = await createRace(release);
        const holder = await register(race.id, "CONFIRMED");
        const link = await spentLink(holder, "REGISTER_ANOTHER_PERSON");
        state.locale = locale;
        const entered = await html((await FamilyConfirmPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "declare" }) })) as ReactElement);
        expectStrip(entered, locale, release);
        const family = await html(
          (await FamilyConfirmPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "family", wizard: "1" }) })) as ReactElement,
        );
        expectStrip(family, locale, release);
      });

      it(`an invitation accepted: ${name}`, async () => {
        const race = await createRace(release);
        const link = await acceptedInvitation(race.id);
        state.locale = locale;
        const page = await html((await InvitationPage({ params: Promise.resolve({ locale, token: link }), searchParams: Promise.resolve({ done: "1" }) })) as ReactElement);
        expectStrip(page, locale, release);
      });
    }
  }
});
