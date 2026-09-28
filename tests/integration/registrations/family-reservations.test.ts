import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds, familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-034-01, BR-REQ-034-02, BR-REQ-036-02, BR-REQ-031-01 — a family sitting reserves every place at
 * once, and its one email lists every registration (§543, amending §389, §446, §519 and §536; the owner,
 * 2026-09-28, after testing on QA: «ar trebui în ultimul mail primit pentru verificare să am toate
 * înscrierile mele! să rezerv 3 locuri și așa să se calculeze pe site»; and «pare că nu se salvează
 * corect»).
 *
 * What was stored before this change, in the owner's scenario (three forms on one address, «Da» after
 * the first, then «Nu mai înscriu pe nimeni»): after each of the three forms one registration row (the
 * first person, PENDING_EMAIL_CONFIRMATION, no hold) and the others as kept forms (0, 1, 2), the public
 * count at 50 of 50 throughout, one held outbox row. The one email already named the three; the site
 * counted none of them, and a refresh, a second device or the backoffice saw one person.
 *
 * Round three of the review (2026-09-28): the deadline is the first form's instant, the club's window
 * and hold, and nothing moves it; a form that writes no registration holds a counted place, so the
 * count and the screen are the same whatever the address holds (§39, AGENTS.md §19.4).
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";
const WINDOW_MS = 10 * 60_000;
const HOLD_MS = 30 * 60_000;
const locale: "ro" | "en" = "ro";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The slot's key, watched (round six): a single registration's allocation never computes a slot.
vi.mock("@/modules/registrations/family-place-slot", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/registrations/family-place-slot")>();
  return { ...real, familyPlaceSlot: vi.fn(real.familyPlaceSlot) };
});
// The family's confirmation page, rendered with the real catalogues (round four: past the deadline it says the places lapsed).
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

const { continueFamilySittingAndReserve, readPublicAvailability, submitRegistration, confirmEmail } = await import("@/modules/registrations/service");
const { releaseFamilySitting } = await import("@/modules/registrations/family-sitting");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { readFamilySittingLink } = await import("@/modules/registrations/family-sitting-confirm");
const { consumeAndConfirmFamilySitting } = await import("@/modules/registrations/token-actions");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { listFamilyReservationsForEvent } = await import("@/modules/registrations/admin-repository");
const { familyOf } = await import("@/modules/registrations/family-marker");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { default: FamilySittingConfirm } = await import("@/modules/registrations/ui/FamilySittingConfirm");
const { NextIntlClientProvider } = await import("next-intl");
const { familyPlaceSlot } = await import("@/modules/registrations/family-place-slot");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await db.delete(familyPlaceHolds);
  forgetCachedDeadlines();
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationTrailRo },
    { locale: "en", title: "Declaration", body: declarationTrailEn },
  ];
  for (const [key, translations] of [
    ["PRIVACY_NOTICE", privacy],
    ["TERMS", privacy],
    ["EVENT_DECLARATION", declaration],
  ] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }
});

async function createEvent(capacity: number | null = 50): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: `crosul-familiei-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The family cross", slug: `family-cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const BIRTH_DATES: Record<string, string> = {
  Ana: "1985-03-02",
  Mihai: "1987-02-14",
  Ioana: "2010-07-11",
  Dan: "2011-05-20",
  Radu: "1990-04-04",
  Elena: "1992-08-08",
  Luca: "2009-03-03",
};

const submission = (firstName: string, at: Date, overrides: Record<string, unknown> = {}) => ({
  firstName,
  lastName: "Pop",
  birthDate: BIRTH_DATES[firstName] ?? "1980-01-01",
  sex: "UNSPECIFIED",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  ...(["Ioana", "Dan", "Luca"].includes(firstName) ? { guardianName: "Ana Pop" } : {}),
  email: EMAIL,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(at.getTime() - 30_000).toISOString(),
  ...overrides,
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

/**
 * The first form, before «Da» (§536), then «Da» as the action presses it: the browser's half carries the
 * first form's window end and an id — the sitting's, or a random one (§39) — and the first press on the
 * browser fixes the sitting's deadline and gives the first form its place (§543).
 */
async function start(event: EventInput, firstName: string, minute: number, overrides: Record<string, unknown> = {}) {
  const result = await submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
  const cookieId = result.sittingId ?? randomUUID();
  const firstWindowEnd = new Date(at(minute).getTime() + WINDOW_MS);
  const pressed = await continueFamilySittingAndReserve(
    db,
    { sittingId: cookieId, seed: result.sittingSeed ?? null, eventId: event.id, locale: "ro" },
    firstWindowEnd,
    at(minute),
    // As the action presses it: the half's first person and address pick the person's slot.
    { firstWindowEnd, firstName: `${firstName} Pop`, email: typeof overrides.email === "string" ? overrides.email : EMAIL },
  );
  // The id the browser keeps for the next form (`continueFamilySittingAction`): the sitting's, or its own.
  return { ...pressed, sittingId: pressed.sittingId ?? cookieId };
}

/**
 * One form of the sitting after «Da», as the public action sends it: a new person unless said otherwise,
 * with what the browser's sealed half carries — how many people it sent before, and the deadline.
 */
async function send(
  event: EventInput,
  firstName: string,
  minute: number,
  sittingId: string | null,
  overrides: Record<string, unknown> = {},
  half: { people?: number; reservedUntil?: Date | null } = {},
) {
  const { newPerson = true, ...fields } = overrides as Record<string, unknown> & { newPerson?: boolean };
  return submitRegistration(db, event, submission(firstName, at(minute), fields), at(minute), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true, newPerson, ...half } });
}

/** «Da» pressed again, as the action presses it: the window starts again from this press. */
async function pressAgain(event: EventInput, sittingId: string | null, minute: number) {
  return continueFamilySittingAndReserve(db, { sittingId, seed: null, eventId: event.id, locale: "ro" }, new Date(at(minute).getTime() + WINDOW_MS), at(minute));
}

async function rows() {
  return db.select().from(registrations).orderBy(registrations.createdAt);
}

async function available(event: EventInput, now: Date) {
  return readPublicAvailability(db, { id: event.id, capacity: event.capacity }, now);
}

async function familyMessage(now: Date) {
  const [row] = (await db.select().from(emailOutbox)).filter((candidate) => (candidate.payloadJson as { familySittingId?: string }).familySittingId);
  const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
  const secret = /\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1] ?? null;
  return { row, message, secret };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
  throw new Error("expected a refusal");
}

/** The page the family's email opens (`registrations/family/[token]/page.tsx`), rendered from the link it reads. */
async function confirmPage(link: Awaited<ReturnType<typeof readFamilySittingLink>>): Promise<string> {
  if (!link.ok) throw new Error("the page could not read its link");
  const page = (await FamilySittingConfirm({ locale, token: "t", link, action: async () => undefined })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

describe("BR-REQ-034-01 a family sitting reserves every place the moment its form is sent (§543)", () => {
  it("the owner's scenario: three forms, the count drops by three, the queue panel lists three, the one email names three with their places", async () => {
    const event = await createEvent(50);
    const pressed = await start(event, "Ana", 0);
    const sittingId = pressed.sittingId;
    // «Da» took the first form's registration in and reserved its place, until the first form's window and the club's hold.
    const deadline = new Date(at(0).getTime() + WINDOW_MS + HOLD_MS);
    expect(pressed).toMatchObject({ opened: true, place: "reserved" });
    expect(pressed.reservedUntil?.toISOString()).toBe(deadline.toISOString());
    expect(await available(event, at(0))).toBe(49);

    const second = await send(event, "Mihai", 2, sittingId);
    expect(second).toMatchObject({ sittingId, sittingPlace: "reserved" });
    expect(await available(event, at(2))).toBe(48);
    const third = await send(event, "Ioana", 4, sittingId);
    expect(third).toMatchObject({ sittingId, sittingPlace: "reserved" });
    // Every later form's place expires at the same deadline, the one the first form fixed (finding 1).
    expect(third.reservedUntil?.toISOString()).toBe(deadline.toISOString());

    // Stored as a single registration is: three rows, each waiting for the address, each holding its place.
    const stored = await rows();
    expect(stored.map((row) => [row.registeredName, row.status])).toEqual([
      ["Ana Pop", "PENDING_EMAIL_CONFIRMATION"],
      ["Mihai Pop", "PENDING_EMAIL_CONFIRMATION"],
      ["Ioana Pop", "PENDING_EMAIL_CONFIRMATION"],
    ]);
    for (const row of stored) expect(row.holdExpiresAt?.toISOString()).toBe(deadline.toISOString());
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(0);
    expect(await available(event, at(4))).toBe(47);

    // The queue panel's three held rows, each with the family marker naming the other two.
    const reserved = await listFamilyReservationsForEvent(db, event.id, at(5));
    expect(reserved.map((row) => row.registeredName)).toEqual(["Ana Pop", "Mihai Pop", "Ioana Pop"]);
    expect(reserved.every((row) => row.emailQueued)).toBe(true);
    const family = await familyOf(db, reserved);
    expect(family.get(reserved[0].id)?.map((member) => member.name)).toEqual(["Mihai Pop", "Ioana Pop"]);

    // «Nu mai înscriu pe nimeni»: the one email leaves, and names the three with their places, until 13:40.
    await releaseFamilySitting(db, sittingId!, at(5));
    const { message, secret } = await familyMessage(at(6));
    expect(message.subject).toContain("Înscriere de familie: 3 persoane la Crosul familiei");
    expect(message.text).toContain("Înscriere de familie: Ana, Mihai și Ioana — 3 locuri rezervate până la 13:40.");
    for (const name of ["Ana Pop", "Mihai Pop", "Ioana Pop"]) expect(message.text).toMatch(new RegExp(`${name}, data nașterii [^\\n]+ — loc rezervat până la 13:40`));
    expect(message.text).toContain("Family registration: Ana, Mihai and Ioana — 3 places reserved until 13:40.");
    expect(message.text).toContain("Confirm și semnez declarațiile (3)");
    // The send moved nothing, and the ceiling is hard: 47 until 13:40, 50 from it, whatever the email is doing.
    for (const row of await rows()) expect(row.holdExpiresAt?.toISOString()).toBe(deadline.toISOString());
    expect(await available(event, at(39))).toBe(47);
    expect(await available(event, at(40))).toBe(50);

    // The single link confirms all three, and the wizard signs three.
    const page = await readFamilySittingLink(db, secret!, "ro", at(7));
    if (!page.ok) throw new Error("the page could not read its link");
    expect(page.people.map((person) => person.name)).toEqual(["Ana Pop", "Mihai Pop", "Ioana Pop"]);
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: [], fitnessAcknowledged: true }, at(8));
    if (!press.ok || !press.pass) throw new Error("the press opened no wizard");
    expect(press.joined).toBe(3);
    expect(press.pass.eligibleIds).toEqual(stored.map((row) => row.id));
    expect((await rows()).map((row) => row.status)).toEqual(["PENDING_DECLARATION", "PENDING_DECLARATION", "PENDING_DECLARATION"]);
    const [participant] = await db.select().from(participants);
    expect(participant.emailVerifiedAt).not.toBeNull();
    // Their own places, never counted twice: still three taken.
    expect(await available(event, at(8))).toBe(47);
  });

  it("the club's limit per address (here 3) refuses a fourth form at the form, nothing written (§389)", async () => {
    const event = await createEvent(50);
    const { updateAddressCap } = await import("@/modules/registrations/address-cap");
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    await updateAddressCap(db, admin, { registrationsPerAddress: 3 }, NOW);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    await send(event, "Ioana", 2, sittingId);
    expect(await refusal(send(event, "Dan", 3, sittingId))).toEqual({ code: "VALIDATION_ERROR", fields: ["sittingAtCap"] });
    expect((await rows()).map((row) => row.registeredName)).toEqual(["Ana Pop", "Mihai Pop", "Ioana Pop"]);
    expect(await available(event, at(3))).toBe(47);
  });

  it("a full event puts the third on the waiting list: the form says so, the email says so, the press lists them", async () => {
    const event = await createEvent(2);
    const { sittingId } = await start(event, "Ana", 0);
    expect((await send(event, "Mihai", 1, sittingId)).sittingPlace).toBe("reserved");
    const third = await send(event, "Ioana", 2, sittingId);
    expect(third.sittingPlace).toBe("waitlist");
    expect(await available(event, at(2))).toBe(0);
    const ioana = (await rows()).find((row) => row.registeredName === "Ioana Pop")!;
    // No place was free: nothing reserved for her.
    expect(ioana.holdExpiresAt).toBeNull();

    await releaseFamilySitting(db, sittingId!, at(3));
    const { message, secret } = await familyMessage(at(4));
    expect(message.text).toContain("Înscriere de familie: Ana, Mihai și Ioana — 2 locuri rezervate până la 13:40, o persoană pe lista de așteptare.");
    expect(message.text).toMatch(/Ioana Pop, data nașterii [^\n]+ — pe lista de așteptare, după confirmare/);
    expect(message.text).toMatch(/Ioana Pop, date of birth [^\n]+ — on the waiting list, once confirmed/);
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: [], fitnessAcknowledged: true }, at(5));
    if (!press.ok) throw new Error("the press did nothing");
    expect((await rows()).map((row) => [row.registeredName, row.status])).toEqual([
      ["Ana Pop", "PENDING_DECLARATION"],
      ["Mihai Pop", "PENDING_DECLARATION"],
      ["Ioana Pop", "WAITLISTED"],
    ]);
  });
});

describe("BR-REQ-031-01 the page the family's email opens says whether the places still hold (§543, the review of 2026-09-28, round four)", () => {
  it("before the deadline: reserved, nobody confirmed yet; past it, while the link still lives: the places lapsed, and the press allocates what is free", async () => {
    const event = await createEvent(50);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    await releaseFamilySitting(db, sittingId!, at(2));
    const { secret } = await familyMessage(at(3));

    const before = await confirmPage(await readFamilySittingLink(db, secret!, "ro", at(4), { charge: false }));
    expect(before).toContain("Locurile sunt rezervate, dar nimeni nu e confirmat încă");
    expect(before).not.toContain("Locurile nu mai sunt rezervate");

    // Minute 41: the deadline (40) is past, the link (48 hours) is not.
    const late = await readFamilySittingLink(db, secret!, "ro", at(41), { charge: false });
    expect(late).toMatchObject({ ok: true, reserved: false });
    const after = await confirmPage(late);
    expect(after).toContain("Locurile nu mai sunt rezervate: confirmă oricum și fiecare primește un loc dacă mai e liber, altfel unul pe lista de așteptare.");
    expect(after).not.toContain("Locurile sunt rezervate");

    // …and the press still allocates what is free: two places, both taken now.
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: [], fitnessAcknowledged: true }, at(42));
    if (!press.ok) throw new Error("the press did nothing");
    expect((await rows()).map((row) => row.status)).toEqual(["PENDING_DECLARATION", "PENDING_DECLARATION"]);
    expect(await available(event, at(42))).toBe(48);
  });
});

describe("BR-REQ-034-02 a family's unconfirmed places go back through the allocator (§543)", () => {
  it("once the deadline is past, the three places are free again and the waiting list is served", async () => {
    const event = await createEvent(3);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    await send(event, "Ioana", 2, sittingId);
    expect(await available(event, at(2))).toBe(0);

    // Somebody else, on another address, confirmed and waiting for a place.
    const other = await submitRegistration(db, event, submission("Radu", at(3), { email: "radu@example.ro" }), at(3), "REAL", PUBLIC);
    const [radu] = (await rows()).filter((row) => row.registeredName === "Radu Pop");
    expect(other.ok).toBe(true);
    expect((await confirmEmail(db, event, radu.id, at(4))).status).toBe("WAITLISTED");

    // The family's email leaves at minute 5 and nobody presses its button.
    await releaseFamilySitting(db, sittingId!, at(5));
    const { row } = await familyMessage(at(5));
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(5), attemptCount: 1 }).where(eq(emailOutbox.id, row.id));
    const [held] = await rows();
    expect(held.holdExpiresAt?.toISOString()).toBe(at(40).toISOString());

    // Past the deadline: the maintenance job clears the three reservations and offers Radu the place.
    await runRegistrationMaintenance(db, at(41));
    const family = (await rows()).filter((candidate) => candidate.participantId === held.participantId);
    expect(family.map((candidate) => [candidate.registeredName, candidate.status, candidate.holdExpiresAt])).toEqual([
      ["Ana Pop", "PENDING_EMAIL_CONFIRMATION", null],
      ["Mihai Pop", "PENDING_EMAIL_CONFIRMATION", null],
      ["Ioana Pop", "PENDING_EMAIL_CONFIRMATION", null],
    ]);
    const [raduNow] = await db.select().from(registrations).where(eq(registrations.id, radu.id));
    expect(raduNow.status).toBe("WAITLIST_OFFERED");
  });
});

describe("BR-REQ-034-02 the deadline is the first form's, and nothing moves it (§543, the review of 2026-09-28, round three)", () => {
  it("one form, then «Da» every five minutes for two hours: the place is back in the count at the first form's deadline", async () => {
    const event = await createEvent(2);
    const opened = await start(event, "Ana", 0);
    const ceiling = new Date(at(0).getTime() + WINDOW_MS + HOLD_MS);
    expect(opened).toMatchObject({ opened: true, place: "reserved" });
    expect(opened.reservedUntil?.toISOString()).toBe(ceiling.toISOString());
    expect(await available(event, at(1))).toBe(1);

    for (let minute = 5; minute <= 120; minute += 5) {
      const pressed = await pressAgain(event, opened.sittingId, minute);
      // Before the deadline the sitting takes the next form, but a later press reserves and lengthens nothing;
      // from it the sitting takes no more forms, and the press holds nothing back.
      if (minute < 40) expect(pressed).toMatchObject({ sittingId: opened.sittingId, opened: false, reservedUntil: null, place: null });
      else expect(pressed).toMatchObject({ sittingId: null, reservedUntil: null, place: null });
      const [ana] = await rows();
      expect(ana.holdExpiresAt?.toISOString()).toBe(ceiling.toISOString());
      expect(await available(event, at(minute))).toBe(minute < 40 ? 1 : 2);
    }
    // The last press before the deadline set her email's window; none after it moved it again.
    const [held] = await db.select().from(emailOutbox);
    expect(held.status).toBe("PENDING");
    expect(held.nextAttemptAt?.toISOString()).toBe(new Date(at(35).getTime() + WINDOW_MS).toISOString());
    // The email leaves and gives nothing back: a lapsed reservation is never lengthened.
    await renderOutboxMessage({ ...held, status: "PROCESSING", attemptCount: 1, lockedAt: at(123) }, db, at(123));
    const [ana] = await rows();
    expect([ana.status, ana.holdExpiresAt?.toISOString()]).toEqual(["PENDING_EMAIL_CONFIRMATION", ceiling.toISOString()]);
    expect(await available(event, at(123))).toBe(2);
  });

  it("every later form's place expires at the first form's deadline; a form after it opens a new sitting with its own", async () => {
    const event = await createEvent(50);
    const { sittingId } = await start(event, "Ana", 0);
    const deadline = new Date(at(0).getTime() + WINDOW_MS + HOLD_MS);
    // Each form and press inside the window the one before it started, the window moving on each time.
    expect((await send(event, "Mihai", 8, sittingId)).reservedUntil?.toISOString()).toBe(deadline.toISOString());
    await pressAgain(event, sittingId, 15);
    expect((await send(event, "Ioana", 24, sittingId)).reservedUntil?.toISOString()).toBe(deadline.toISOString());
    await pressAgain(event, sittingId, 33);
    for (const row of await rows()) expect(row.holdExpiresAt?.toISOString()).toBe(deadline.toISOString());
    expect(await available(event, at(39))).toBe(47);
    expect(await available(event, at(40))).toBe(50);

    // Minute 42: still inside the window the last press started (until 43), past the deadline — a new sitting.
    const late = await send(event, "Dan", 42, sittingId);
    expect(late.sittingId).not.toBeNull();
    expect(late.sittingId).not.toBe(sittingId);
    expect(late.sittingPlace).toBe("reserved");
    expect(late.reservedUntil?.toISOString()).toBe(new Date(at(42).getTime() + WINDOW_MS + HOLD_MS).toISOString());
    expect(await available(event, at(42))).toBe(49);
    const sittings = await db.select().from(familySittings).orderBy(familySittings.createdAt);
    expect(sittings.map((row) => row.reservedUntil?.toISOString())).toEqual([deadline.toISOString(), late.reservedUntil?.toISOString()]);
  });

  it("an email the outbox job sends an hour late gives nothing back: the places lapse at the deadline", async () => {
    const event = await createEvent(50);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    await releaseFamilySitting(db, sittingId!, at(5));
    // Past the deadline (minute 40), the email still queued: the places are free all the same.
    expect(await available(event, at(41))).toBe(50);
    const { message } = await familyMessage(at(65));
    for (const stored of await rows()) expect(stored.holdExpiresAt?.toISOString()).toBe(at(40).toISOString());
    // …and the email names no reserved place it no longer holds.
    expect(message.text).not.toContain("locuri rezervate");
    expect(message.text).not.toContain("loc rezervat");
  });
});

describe("BR-REQ-031-01 a form that writes no registration holds a place: the count and the places are the same whatever the address holds (§543; §39, AGENTS.md §19.4)", () => {
  type Case = "fresh" | "holdsTheFirstPerson" | "atItsLimit";

  /**
   * One family of three — Ana, Mihai, Ioana — then a fourth, Luca, over the club's limit of three, on
   * an address that is fresh, that already holds Ana (registered from another device, her address not
   * confirmed yet), or that already carries the limit with three other people. `full`: the event's one
   * place taken by somebody on another address first. Returns the public count after each step, the
   * places the browser's half would carry and the deadline. The screen, from the real actions' cookie, is
   * `family-reservations-actions.test.ts`.
   */
  async function family(kind: Case, capacity: number, address: string, full = false) {
    const event = await createEvent(capacity);
    const mail = { email: address };
    if (full) {
      await submitRegistration(db, event, submission("Radu", at(0), { email: `alt.${address}` }), at(0), "REAL", PUBLIC);
      await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.eventId, event.id));
    }
    if (kind === "holdsTheFirstPerson") await submitRegistration(db, event, submission("Ana", at(0), mail), at(0), "REAL", PUBLIC);
    if (kind === "atItsLimit") {
      // Three registrations on the address, the second and third confirmed from its inbox (§446) — three people, the limit.
      await submitRegistration(db, event, submission("Radu", at(0), mail), at(0), "REAL", PUBLIC);
      const [participant] = await db.select().from(participants).where(eq(participants.deliveryEmail, address));
      for (const name of ["Dan", "Elena"]) {
        await submitRegistration(db, event, submission(name, at(0), { ...mail, fitnessAcknowledged: true }), at(0), "REAL", { ...PUBLIC, anotherPerson: { participantId: participant.id } });
      }
      expect((await db.select().from(registrations).where(eq(registrations.participantId, participant.id))).map((row) => row.status)).toEqual([
        "PENDING_EMAIL_CONFIRMATION",
        "PENDING_EMAIL_CONFIRMATION",
        "PENDING_EMAIL_CONFIRMATION",
      ]);
    }
    // Those came long before, from other devices: the throttle's hour is not this sitting's.
    await db.delete(rateLimitBuckets);
    const counts: (number | null)[] = [await available(event, at(0))];
    const opened = await start(event, "Ana", 0, mail);
    counts.push(await available(event, at(0)));
    const places = [opened.place];
    let sittingId = opened.sittingId;
    for (const [name, minute] of [
      ["Mihai", 2],
      ["Ioana", 4],
    ] as const) {
      const result = await send(event, name, minute, sittingId, mail, { people: places.length, reservedUntil: opened.reservedUntil });
      sittingId = result.sittingId ?? sittingId;
      places.push(result.sittingPlace ?? null);
      counts.push(await available(event, at(minute)));
      expect(result.reservedUntil?.toISOString()).toBe(opened.reservedUntil?.toISOString());
    }
    const fourth = await refusal(send(event, "Luca", 6, sittingId, mail, { people: places.length, reservedUntil: opened.reservedUntil }));
    counts.push(await available(event, at(6)));
    // The screen the browser renders is proven from the cookie the real actions write (`family-reservations-actions.test.ts`).
    return { counts, places, fourth, reservedUntil: opened.reservedUntil?.toISOString() };
  }

  async function everyCase(capacity: number, full = false) {
    const { updateAddressCap } = await import("@/modules/registrations/address-cap");
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    await updateAddressCap(db, admin, { registrationsPerAddress: 3 }, NOW);
    return {
      fresh: await family("fresh", capacity, "noua@example.ro", full),
      holds: await family("holdsTheFirstPerson", capacity, "ana@example.ro", full),
      limit: await family("atItsLimit", capacity, "plina@example.ro", full),
    };
  }

  it("with places free: the same count after every form, the same places and deadline, the fourth refused alike", async () => {
    const { fresh, holds, limit } = await everyCase(50);
    expect(fresh.counts).toEqual([50, 49, 48, 47, 47]);
    expect(fresh.places).toEqual(["reserved", "reserved", "reserved"]);
    expect(fresh.fourth).toEqual({ code: "VALIDATION_ERROR", fields: ["sittingAtCap"] });
    for (const other of [holds, limit]) {
      expect(other.counts).toEqual(fresh.counts);
      expect(other.places).toEqual(fresh.places);
      expect(other.fourth).toEqual(fresh.fourth);
      expect(other.reservedUntil).toBe(fresh.reservedUntil);
    }
    // What the held places are: rows naming no person, counted until the deadline.
    const holdsRows = await db.select().from(familyPlaceHolds);
    expect(holdsRows.map((row) => row.expiresAt.toISOString())).toEqual(holdsRows.map(() => fresh.reservedUntil));
    // The holding address's «Da» for Ana, and the three forms of the address at its limit.
    expect(holdsRows).toHaveLength(1 + 3);
  });

  it("on a full event every case reads «pe lista de așteptare», the count stays at 0, the fourth refused alike", async () => {
    // Each event's one place taken by somebody on another address before the family starts.
    const { fresh, holds, limit } = await everyCase(1, true);
    expect(fresh.counts).toEqual([0, 0, 0, 0, 0]);
    expect(fresh.places).toEqual(["waitlist", "waitlist", "waitlist"]);
    expect(fresh.fourth).toEqual({ code: "VALIDATION_ERROR", fields: ["sittingAtCap"] });
    for (const other of [holds, limit]) {
      expect(other.fourth).toEqual(fresh.fourth);
      expect(other.reservedUntil).toBe(fresh.reservedUntil);
      expect(other.counts).toEqual(fresh.counts);
      expect(other.places).toEqual(fresh.places);
    }
  });

  it("the family's confirmation releases the held places before it allocates anybody", async () => {
    const event = await createEvent(2);
    // Radu registered on this address long before; Ana's first form is kept (§446) and «Da» holds her place.
    await submitRegistration(db, event, submission("Radu", at(0)), at(0), "REAL", PUBLIC);
    const { sittingId, place } = await start(event, "Ana", 0);
    expect(place).toBe("reserved");
    const mihai = await send(event, "Mihai", 1, sittingId);
    expect(mihai.sittingPlace).toBe("reserved");
    expect(await available(event, at(1))).toBe(0);
    await releaseFamilySitting(db, sittingId!, at(2));
    const { secret } = await familyMessage(at(3));
    const page = await readFamilySittingLink(db, secret!, "ro", at(4));
    if (!page.ok) throw new Error("the page could not read its link");
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(5));
    if (!press.ok) throw new Error("the press did nothing");
    // Ana's own held place is hers, never counted against her: both take the two places.
    expect(press.joined).toBe(2);
    expect(await db.select().from(familyPlaceHolds)).toHaveLength(0);
    const statuses = (await rows()).filter((row) => row.registeredName !== "Radu Pop").map((row) => [row.registeredName, row.status]);
    expect(statuses).toEqual(expect.arrayContaining([["Ana Pop", "PENDING_DECLARATION"], ["Mihai Pop", "PENDING_DECLARATION"]]));
    expect(await available(event, at(5))).toBe(0);
  });

  it("a person held again by a later sitting, once their own place lapsed, has one place when confirmed (round five)", async () => {
    const event = await createEvent(50);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    await releaseFamilySitting(db, sittingId!, at(2));
    const [first] = (await db.select().from(emailOutbox)).filter((row) => (row.payloadJson as { familySittingId?: string }).familySittingId === sittingId);
    const message = await renderOutboxMessage({ ...first, status: "PROCESSING", attemptCount: 1, lockedAt: at(3) }, db, at(3));
    const secret = /\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
    // Past the deadline (40): Ioana opens a new sitting, and Mihai, sent in it, is held there once.
    const late = await send(event, "Ioana", 42, sittingId);
    expect(late.sittingId).not.toBe(sittingId);
    const mihai = await send(event, "Mihai", 43, late.sittingId ?? null);
    expect(mihai.sittingPlace).toBe("reserved");
    expect(await send(event, "Mihai", 44, late.sittingId ?? null).then((result) => result.sittingPlace)).toBe("reserved");
    expect(await db.select().from(familyPlaceHolds)).toHaveLength(1);
    expect(await available(event, at(44))).toBe(48);
    // The first sitting's link, still alive, confirms Ana and Mihai: Mihai's held place is his, never counted against him.
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: [], fitnessAcknowledged: true }, at(45));
    if (!press.ok) throw new Error("the press did nothing");
    expect(await db.select().from(familyPlaceHolds)).toHaveLength(0);
    const statuses = (await rows()).map((row) => [row.registeredName, row.status]);
    expect(statuses).toEqual(expect.arrayContaining([["Ana Pop", "PENDING_DECLARATION"], ["Mihai Pop", "PENDING_DECLARATION"], ["Ioana Pop", "PENDING_EMAIL_CONFIRMATION"]]));
    expect(await available(event, at(45))).toBe(47);
  });

  it("a replayed opening press holds nothing more", async () => {
    const event = await createEvent(50);
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", PUBLIC);
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.eventId, event.id));
    // Ana again: a re-send, which writes nothing; the browser keeps a random id and no seed.
    const result = await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const cookieId = randomUUID();
    const firstWindowEnd = new Date(at(0).getTime() + WINDOW_MS);
    for (let replay = 0; replay < 5; replay += 1) {
      const pressed = await continueFamilySittingAndReserve(db, { sittingId: cookieId, seed: result.sittingSeed ?? null, eventId: event.id, locale: "ro" }, firstWindowEnd, at(replay), { firstWindowEnd, firstName: "Ana Pop", email: EMAIL });
      expect(pressed.place).toBe("reserved");
    }
    // One held place, as a fresh address's press reserves one; Ana's confirmed place is counted too.
    expect(await available(event, at(5))).toBe(48);
    expect(await db.select().from(familyPlaceHolds)).toHaveLength(1);
  });
});

describe("§543 nothing changes for a single registration, and a person confirmed earlier is said so", () => {
  it("one form with no «Da» reserves nothing: the count is untouched until the address is confirmed", async () => {
    const event = await createEvent(50);
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const [ana] = await rows();
    expect(ana.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(ana.holdExpiresAt).toBeNull();
    expect(await available(event, at(0))).toBe(50);
    expect(await db.select().from(familySittings)).toHaveLength(0);
  });

  it("a single registration's allocation never keys the family slot secret, even where the secret would refuse (round six)", async () => {
    const event = await createEvent(50);
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", PUBLIC);
    const [ana] = await rows();
    // As on qa or production with neither AUTH_SECRET nor JOB_SECRET: keying a slot throws.
    vi.mocked(familyPlaceSlot).mockClear();
    vi.mocked(familyPlaceSlot).mockImplementation(() => {
      throw new Error("APP_ENV=production requires AUTH_SECRET or JOB_SECRET");
    });
    try {
      const allocated = await confirmEmail(db, event, ana.id, at(1));
      expect(allocated.status).toBe("PENDING_DECLARATION");
      expect(familyPlaceSlot).not.toHaveBeenCalled();
    } finally {
      vi.mocked(familyPlaceSlot).mockReset();
      const real = await vi.importActual<typeof import("@/modules/registrations/family-place-slot")>("@/modules/registrations/family-place-slot");
      vi.mocked(familyPlaceSlot).mockImplementation(real.familyPlaceSlot);
    }
  });

  it("on an event where a family sitting holds somebody, the allocation still releases that person's held place (round six)", async () => {
    const event = await createEvent(50);
    // Mihai's own single registration, and a place a family sitting of the address held for him (`holdFamilyPlace`).
    await submitRegistration(db, event, submission("Mihai", at(1)), at(1), "REAL", PUBLIC);
    const [mihai] = await rows();
    await db.insert(familyPlaceHolds).values({ eventId: event.id, sittingKey: randomUUID(), slot: familyPlaceSlot(event.id, mihai.participantId, "Mihai Pop"), expiresAt: at(40) });
    const before = await available(event, at(2));
    expect(before).toBe(49);
    vi.mocked(familyPlaceSlot).mockClear();
    const allocated = await confirmEmail(db, event, mihai.id, at(2));
    expect(allocated.status).toBe("PENDING_DECLARATION");
    expect(familyPlaceSlot).toHaveBeenCalled();
    // His held place went as his registration took one: the count moved by nothing.
    expect(await available(event, at(2))).toBe(before);
  });

  it("the family's email lists who the address held before with their state, and asks nothing of them again", async () => {
    const event = await createEvent(50);
    // Ana registered and confirmed long before.
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", PUBLIC);
    const [ana] = await rows();
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.id, ana.id));
    // A new sitting: Mihai's first form is kept (§446), «Da», then Ioana's form reserves her place.
    const { sittingId } = await start(event, "Mihai", 10);
    await send(event, "Ioana", 11, sittingId);
    await releaseFamilySitting(db, sittingId!, at(12));
    const { message } = await familyMessage(at(13));
    expect(message.text).toContain("Înscriși deja cu această adresă: Ana P. — confirmat");
    expect(message.text).toContain("Already registered with this address: Ana P. — confirmed");
    expect(message.text).toMatch(/Ioana Pop, data nașterii [^\n]+ — loc rezervat/);
    expect(message.text).not.toMatch(/Ana Pop, data nașterii/);
  });
});
