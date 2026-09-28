import { eq, sql } from "drizzle-orm";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-01, BR-REQ-034-02 — a family sitting's places and screens, driven through the real public
 * actions (`submitRegistrationAction`, `continueFamilySittingAction`) and the sealed cookie they write,
 * never a list of people the test assembles (the review of 2026-09-28, round four; §NNN, §39,
 * AGENTS.md §19.4).
 *
 * - **The server decides whether a form adds a person** (finding 3): a fresh address, an address that
 *   already holds the first person, and an address at the club's limit go through the same forms, the
 *   same «Da», and the same replays of the browser's own earlier halves — the half from before a form,
 *   the half from before the press. After every step the public count is the same, and the screen the
 *   register page renders from the cookie is byte for byte the same.
 * - **A form after the deadline** (finding 2) opens a new sitting, and its screen names only the people
 *   of that sitting, reserved until its own deadline — never the lapsed ones as reserved again.
 */
const locale: "ro" | "en" = "ro";
const START = new Date("2026-10-01T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

/** The browser: every cookie the actions set, sent back with the next request, as a browser does. */
const jar = new Map<string, string>();

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => {
      if (value === "" || options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// No Cloudflare in a test: the hidden field and the timing check stand, as they do without keys.
vi.mock("@/modules/registrations/bot-check", () => ({ botCheckIsOn: async () => false, honeypotIsOn: async () => true }));
// The sitting's screen, rendered with the real catalogues.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) =>
      createTranslator({ locale, messages: catalogues[locale] as typeof catalogues.ro, namespace: namespace as "Registration" }),
    getLocale: async () => locale,
  };
});

const { submitRegistrationAction, continueFamilySittingAction } = await import("@/app/[locale]/events/[slug]/register/actions");
const { submitRegistration, readPublicAvailability } = await import("@/modules/registrations/service");
const { openFamilySittingCookie } = await import("@/modules/registrations/family-sitting-cookie");
const { sittingNames } = await import("@/modules/registrations/domain/family-sitting");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { updateAddressCap } = await import("@/modules/registrations/address-cap");
const { default: FamilySittingNext } = await import("@/modules/registrations/ui/FamilySittingNext");
const { NextIntlClientProvider } = await import("next-intl");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};

const SITTING_COOKIE = "br_family_sitting";

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  await resetTables(db);
  await db.delete(familyPlaceHolds);
  forgetCachedDeadlines();
  jar.clear();
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: START });
  }
  // The club's limit at three, so a family of three fills it and a fourth is refused at the form.
  const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  await updateAddressCap(db, admin, { registrationsPerAddress: 3 }, START);
});
afterEach(() => {
  vi.useRealTimers();
});

const minutes = (n: number) => new Date(START.getTime() + n * 60_000);

async function createEvent(slug: string, capacity = 50) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(START.getTime() + 20 * 86_400_000), registrationMode: "INTERNAL", capacity, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: new Date(START.getTime() - 86_400_000) })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug },
    { eventId: event.id, locale: "en", title: "The family cross", slug: `${slug}-en` },
  ]);
  return event;
}

const BIRTH_DATES: Record<string, string> = {
  Ana: "1985-03-02",
  Mihai: "1987-02-14",
  Ioana: "2010-07-11",
  Luca: "2009-03-03",
  Radu: "1990-04-04",
  Dan: "2011-05-20",
  Elena: "1992-08-08",
};

/** The public form as the browser posts it; `family` is the form «Da, încă o persoană» opened (the address fixed). */
function form(slug: string, firstName: string, email: string, family: boolean): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    locale,
    slug,
    firstName,
    lastName: "Pop",
    birthDate: BIRTH_DATES[firstName] ?? "1980-01-01",
    sex: "UNSPECIFIED",
    phone: "0711111111",
    phoneCountry: "RO",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "0722222222",
    emergencyContactPhoneCountry: "RO",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    ...(["Ioana", "Luca", "Dan"].includes(firstName) ? { guardianName: "Ana Pop" } : {}),
    fitnessDeclared: "on",
    rulesAcknowledged: "on",
    termsAccepted: "on",
    privacyAcknowledged: "on",
    honeypot: "",
    renderedAt: new Date(Date.now() - 30_000).toISOString(),
    ...(family ? { familySitting: "1" } : { email, emailConfirm: email }),
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** One request to a real action: where the browser is sent. The cookies it set are in the jar. */
async function request(action: (data: FormData) => Promise<void>, data: FormData): Promise<string> {
  // Several forms from one address inside the hour: the throttle's buckets are not what is proven here.
  await db.delete(rateLimitBuckets);
  try {
    await action(data);
  } catch (error) {
    return (error as { redirectTo?: string }).redirectTo ?? `threw: ${(error as Error).message}`;
  }
  return "no redirect";
}

const post = (slug: string, firstName: string, email: string, family = true) => request(submitRegistrationAction, form(slug, firstName, email, family));
const pressYes = (slug: string) => {
  const data = new FormData();
  data.set("locale", locale);
  data.set("slug", slug);
  return request(continueFamilySittingAction, data);
};

/** The sitting's screen exactly as `register/page.tsx` feeds it from the browser's half, the address masked. */
async function screen(): Promise<string> {
  const sealed = jar.get(SITTING_COOKIE);
  const sitting = sealed ? openFamilySittingCookie(sealed) : null;
  if (!sitting) return "no sitting";
  const now = new Date();
  const page = (await FamilySittingNext({
    email: "adresa@example.ro",
    names: sittingNames(sitting.people),
    reservation: { people: sitting.people, until: sitting.reservedUntil ?? null },
    sameBirthDate: sitting.sameBirthDate ?? null,
    releaseInMs: sitting.heldUntil.getTime() - now.getTime(),
    firstName: null,
    eventTitle: "Crosul familiei",
    atOnce: sitting.atOnce === true,
    windowMinutes: sitting.windowMinutes ?? null,
    locale,
    slug: "crosul-familiei",
    continueAction: async () => undefined,
    releaseAction: async () => undefined,
    now,
  })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replace(/ id="[^"]*"/g, "");
}

/** What the browser's half says about the people, the address and ids aside. */
function half(): unknown {
  const sealed = jar.get(SITTING_COOKIE);
  const sitting = sealed ? openFamilySittingCookie(sealed) : null;
  return sitting ? { people: sitting.people, reservedUntil: sitting.reservedUntil?.toISOString() ?? null, joined: sitting.joined === true } : null;
}

async function available(event: { id: string; capacity: number | null }) {
  return readPublicAvailability(db, { id: event.id, capacity: event.capacity }, new Date());
}

type Case = "fresh" | "holdsTheFirstPerson" | "atItsLimit";

/** The address before the sitting, registered from other devices long before (`PUBLIC`, no sitting). */
async function prepare(kind: Case, event: Awaited<ReturnType<typeof createEvent>>, address: string, full = false) {
  const eventInput = {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: "INTERNAL" as const,
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: event.publishedAt,
  };
  const person = (firstName: string, extra: Record<string, unknown> = {}) => ({
    firstName,
    lastName: "Pop",
    birthDate: BIRTH_DATES[firstName],
    sex: "UNSPECIFIED",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Vecinul",
    emergencyContactPhone: "+40722222222",
    ...(["Dan"].includes(firstName) ? { guardianName: "Radu Pop" } : {}),
    email: address,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: false,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(Date.now() - 30_000).toISOString(),
    ...extra,
  });
  const origin = { source: "PUBLIC" as const, createdByStaffUserId: null };
  if (full) {
    // The event's one place taken by somebody on another address, confirmed, before the family starts.
    await submitRegistration(db, eventInput, person("Radu", { email: `alt.${address}` }), new Date(), "REAL", origin);
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.eventId, event.id));
  }
  if (kind === "holdsTheFirstPerson") await submitRegistration(db, eventInput, person("Ana"), new Date(), "REAL", origin);
  if (kind === "atItsLimit") {
    await submitRegistration(db, eventInput, person("Radu"), new Date(), "REAL", origin);
    const [participant] = await db.select().from(participants).where(eq(participants.deliveryEmail, address));
    for (const name of ["Dan", "Elena"]) {
      await submitRegistration(db, eventInput, person(name, { fitnessAcknowledged: true }), new Date(), "REAL", { ...origin, anotherPerson: { participantId: participant.id } });
    }
    expect(await db.select().from(registrations).where(eq(registrations.participantId, participant.id))).toHaveLength(3);
  }
}

describe("BR-REQ-031-01 the server decides whether a form adds a person, through the real actions and cookie (§NNN, §39)", () => {
  /**
   * Ana's form, «Da», Mihai's form; then the browser's own earlier halves replayed — Mihai again on the
   * half from before his form, the press again on the half from before the press, Mihai again on the
   * half that press wrote — then Ioana, and Luca over the club's limit of three. The count and the
   * screen after every step.
   */
  async function family(kind: Case, slug: string, address: string, full = false) {
    // Each case from the same instant: the screens name the same hours.
    vi.setSystemTime(START);
    const event = await createEvent(slug, full ? 1 : 50);
    await prepare(kind, event, address, full);
    jar.clear();
    const steps: { step: string; redirect: string; count: number | null; screen: string; half: unknown }[] = [];
    const record = async (step: string, redirect: string) => {
      steps.push({ step, redirect, count: await available(event), screen: await screen(), half: half() });
    };
    steps.push({ step: "before", redirect: "", count: await available(event), screen: "", half: null });

    await record("Ana", await post(slug, "Ana", address, false));
    const beforePress = jar.get(SITTING_COOKIE)!;
    vi.setSystemTime(minutes(1));
    await record("Da", await pressYes(slug));
    const beforeMihai = jar.get(SITTING_COOKIE)!;
    vi.setSystemTime(minutes(2));
    await record("Mihai", await post(slug, "Mihai", address));

    // The half from before Mihai's form, sent again with Mihai: nothing more is held, for any address.
    jar.set(SITTING_COOKIE, beforeMihai);
    vi.setSystemTime(minutes(3));
    await record("Mihai on the half from before his form", await post(slug, "Mihai", address));
    // The half from before the press, pressed again: the first person's place is not taken twice.
    jar.set(SITTING_COOKIE, beforePress);
    vi.setSystemTime(minutes(4));
    await record("«Da» on the half from before the press", await pressYes(slug));
    // …and Mihai on the half that replayed press wrote: his place is found, not added.
    vi.setSystemTime(minutes(5));
    await record("Mihai on the replayed press's half", await post(slug, "Mihai", address));

    vi.setSystemTime(minutes(6));
    await record("Ioana", await post(slug, "Ioana", address));
    vi.setSystemTime(minutes(7));
    await record("Luca, over the limit", await post(slug, "Luca", address));
    const holds = await db.select().from(familyPlaceHolds).where(eq(familyPlaceHolds.eventId, event.id));
    return { steps, holds: holds.length };
  }

  it("a fresh address, one that holds the first person and one at its limit: the same count, the same screen, after every step", async () => {
    const fresh = await family("fresh", "cros-nou", "noua@example.ro");
    expect(fresh.steps.map((step) => step.count)).toEqual([50, 50, 49, 48, 48, 48, 48, 47, 47]);
    expect(fresh.steps.at(-1)!.redirect).toContain("error=VALIDATION_ERROR&fields=sittingAtCap");
    const last = fresh.steps.at(-2)!;
    expect(last.screen).toContain("Înscriere de familie: Ana, Mihai, Ioana — 3 locuri rezervate până la");
    expect(last.screen.match(/ — loc rezervat</g)).toHaveLength(3);
    // No held place on a fresh address: every person's place is their own registration's.
    expect(fresh.holds).toBe(0);

    const holds = await family("holdsTheFirstPerson", "cros-ana", "ana@example.ro");
    const limit = await family("atItsLimit", "cros-plin", "plina@example.ro");
    for (const other of [holds, limit]) {
      expect(other.steps.map((step) => [step.step, step.count, step.redirect.replace(/cros-[a-z]+/, "SLUG")])).toEqual(
        fresh.steps.map((step) => [step.step, step.count, step.redirect.replace(/cros-[a-z]+/, "SLUG")]),
      );
      for (const [index, step] of other.steps.entries()) {
        expect(step.screen, step.step).toBe(fresh.steps[index].screen);
        expect(step.half, step.step).toEqual(fresh.steps[index].half);
      }
    }
    // One held place per person, never one per form: Ana alone on the holding address, all three on the full one.
    expect(holds.holds).toBe(1);
    expect(limit.holds).toBe(3);
  });

  it("on a full event every case reads «pe lista de așteptare», holds nothing and is refused alike at the limit", async () => {
    const fresh = await family("fresh", "cros-nou", "noua@example.ro", true);
    expect(fresh.steps.map((step) => step.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(fresh.steps.at(-1)!.redirect).toContain("error=VALIDATION_ERROR&fields=sittingAtCap");
    const last = fresh.steps.at(-2)!;
    expect(last.screen).toContain("Înscriere de familie: Ana, Mihai, Ioana — 3 persoane pe lista de așteptare.");
    expect(last.screen.match(/ — pe lista de așteptare, după confirmare</g)).toHaveLength(3);
    expect(last.screen).not.toContain("loc rezervat");
    const holds = await family("holdsTheFirstPerson", "cros-ana", "ana@example.ro", true);
    const limit = await family("atItsLimit", "cros-plin", "plina@example.ro", true);
    for (const other of [holds, limit]) {
      for (const [index, step] of other.steps.entries()) {
        expect([step.count, step.redirect.replace(/cros-[a-z]+/, "SLUG")], step.step).toEqual([fresh.steps[index].count, fresh.steps[index].redirect.replace(/cros-[a-z]+/, "SLUG")]);
        expect(step.screen, step.step).toBe(fresh.steps[index].screen);
        expect(step.half, step.step).toEqual(fresh.steps[index].half);
      }
      expect(other.holds).toBe(0);
    }
  });
});

describe("BR-REQ-034-02 a form after the sitting's deadline opens a new sitting, and its screen names only its own people (§NNN)", () => {
  async function lateForm(kind: Case, slug: string, address: string) {
    vi.setSystemTime(START);
    const event = await createEvent(slug);
    await prepare(kind, event, address);
    jar.clear();
    await post(slug, "Ana", address, false);
    await pressYes(slug);
    vi.setSystemTime(minutes(2));
    await post(slug, "Mihai", address);
    // «Da» pressed again and again keeps the browser's half alive; it moves no deadline (40 minutes from the first form).
    for (const minute of [9, 18, 27, 35]) {
      vi.setSystemTime(minutes(minute));
      await pressYes(slug);
    }
    const lapsedScreen = await (async () => {
      vi.setSystemTime(minutes(41));
      return screen();
    })();
    vi.setSystemTime(minutes(42));
    const redirect = await post(slug, "Dan", address);
    return { redirect, lapsedScreen, screen: await screen(), half: half(), count: await available(event) };
  }

  it("the earlier people's places lapsed: the new sitting's screen lists Dan alone, reserved until his own deadline", async () => {
    const fresh = await lateForm("fresh", "cros-tarziu", "noua@example.ro");
    // Before the form: the half still names Ana and Mihai, and says the places are no longer reserved.
    expect(fresh.lapsedScreen).toContain("Locurile nu mai sunt rezervate.");
    expect(fresh.lapsedScreen).not.toContain("loc rezervat");
    expect(fresh.redirect).toContain("submitted=1");
    // The form after the deadline: a new sitting, Dan alone, until 42 + 10 + 30 minutes.
    const deadline = minutes(82).toISOString();
    expect(fresh.half).toEqual({ people: [{ name: "Dan Pop", birthDate: BIRTH_DATES.Dan }], reservedUntil: deadline, joined: true });
    expect(fresh.screen).toContain("Înscriere de familie: Dan — un loc rezervat până la 14:22.");
    expect(fresh.screen).not.toContain("Ana");
    expect(fresh.screen).not.toContain("Mihai");
    // The count agrees: Ana's and Mihai's places lapsed at minute 40, Dan's is held.
    expect(fresh.count).toBe(49);

    // The same screen, half and count for an address that already held Ana (§39).
    const holds = await lateForm("holdsTheFirstPerson", "cros-tarziu-ana", "ana@example.ro");
    expect(holds.screen).toBe(fresh.screen);
    expect(holds.lapsedScreen).toBe(fresh.lapsedScreen);
    expect(holds.half).toEqual(fresh.half);
    expect(holds.count).toBe(fresh.count);
  });
});
