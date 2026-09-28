import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-034-01, BR-REQ-034-02, BR-REQ-036-02 — a family sitting reserves every place at once, and its
 * one email lists every registration (§NNN, amending §389, §446, §519 and §536; the owner, 2026-09-28,
 * after testing on QA: «ar trebui în ultimul mail primit pentru verificare să am toate înscrierile mele!
 * să rezerv 3 locuri și așa să se calculeze pe site»; and «pare că nu se salvează corect»).
 *
 * What was stored before this change, in the owner's scenario (three forms on one address, «Da» after
 * the first, then «Nu mai înscriu pe nimeni»): after each of the three forms one registration row (the
 * first person, PENDING_EMAIL_CONFIRMATION, no hold) and the others as kept forms (0, 1, 2), the public
 * count at 50 of 50 throughout, one held outbox row. The one email already named the three; the site
 * counted none of them, and a refresh, a second device or the backoffice saw one person.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";
const WINDOW_MS = 10 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { continueFamilySittingAndReserve, readPublicAvailability, submitRegistration, confirmEmail } = await import("@/modules/registrations/service");
const { releaseFamilySitting } = await import("@/modules/registrations/family-sitting");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { readFamilySittingLink } = await import("@/modules/registrations/family-sitting-confirm");
const { consumeAndConfirmFamilySitting } = await import("@/modules/registrations/token-actions");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { listFamilyReservationsForEvent } = await import("@/modules/registrations/admin-repository");
const { familyOf } = await import("@/modules/registrations/family-marker");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
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
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: "crosul-familiei" },
    { eventId: event.id, locale: "en", title: "The family cross", slug: "family-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Mihai: "1987-02-14", Ioana: "2010-07-11", Dan: "2011-05-20", Radu: "1990-04-04" };

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
  ...(firstName === "Ioana" || firstName === "Dan" ? { guardianName: "Ana Pop" } : {}),
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

/** The first form, before «Da» (§536), then «Da» as the action presses it — which reserves the sitting's places (§NNN). */
async function start(event: EventInput, firstName: string, minute: number) {
  const result = await submitRegistration(db, event, submission(firstName, at(minute)), at(minute), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
  const pressed = await continueFamilySittingAndReserve(
    db,
    { sittingId: null, seed: result.sittingSeed ?? null, eventId: event.id, locale: "ro" },
    new Date(at(minute).getTime() + WINDOW_MS),
    at(minute),
  );
  return pressed;
}

/** One form of the sitting after «Da», as the public action sends it. */
async function send(event: EventInput, firstName: string, minute: number, sittingId: string | null, overrides: Record<string, unknown> = {}) {
  return submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true } });
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

describe("BR-REQ-034-01 a family sitting reserves every place the moment its form is sent (§NNN)", () => {
  it("the owner's scenario: three forms, the count drops by three, the queue panel lists three, the one email names three with their places", async () => {
    const event = await createEvent(50);
    const pressed = await start(event, "Ana", 0);
    const sittingId = pressed.sittingId;
    expect(sittingId).not.toBeNull();
    // «Da» took the first form's registration in and reserved its place.
    expect(pressed.places).toEqual(["reserved"]);
    expect(await available(event, at(0))).toBe(49);

    const second = await send(event, "Mihai", 2, sittingId);
    expect(second).toMatchObject({ sittingId, sittingPlace: "reserved" });
    expect(await available(event, at(2))).toBe(48);
    const third = await send(event, "Ioana", 4, sittingId);
    expect(third).toMatchObject({ sittingId, sittingPlace: "reserved" });
    // The club's hold after the window's end (30 minutes by default, §377), the same on the screen's half.
    expect(third.reservedUntil?.toISOString()).toBe(new Date(at(4).getTime() + WINDOW_MS + 30 * 60_000).toISOString());

    // Stored as a single registration is: three rows, each waiting for the address, each holding its place.
    const stored = await rows();
    expect(stored.map((row) => [row.registeredName, row.status])).toEqual([
      ["Ana Pop", "PENDING_EMAIL_CONFIRMATION"],
      ["Mihai Pop", "PENDING_EMAIL_CONFIRMATION"],
      ["Ioana Pop", "PENDING_EMAIL_CONFIRMATION"],
    ]);
    for (const row of stored) expect(row.holdExpiresAt?.toISOString()).toBe(third.reservedUntil?.toISOString());
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(0);
    expect(await available(event, at(4))).toBe(47);

    // The queue panel's three held rows, each with the family marker naming the other two.
    const reserved = await listFamilyReservationsForEvent(db, event.id, at(5));
    expect(reserved.map((row) => row.registeredName)).toEqual(["Ana Pop", "Mihai Pop", "Ioana Pop"]);
    expect(reserved.every((row) => row.emailQueued)).toBe(true);
    const family = await familyOf(db, reserved);
    expect(family.get(reserved[0].id)?.map((member) => member.name)).toEqual(["Mihai Pop", "Ioana Pop"]);

    // «Nu mai înscriu pe nimeni»: the one email leaves, and names the three with their places.
    await releaseFamilySitting(db, sittingId!, at(5));
    const sentAt = at(6);
    const { message, secret } = await familyMessage(sentAt);
    expect(message.subject).toContain("Înscriere de familie: 3 persoane la Crosul familiei");
    // Sent at 10:06Z: each place lasts the club's hold from the send, never less than the screen said.
    expect(message.text).toContain("Înscriere de familie: Ana, Mihai și Ioana — 3 locuri rezervate până la 13:44.");
    for (const name of ["Ana Pop", "Mihai Pop", "Ioana Pop"]) expect(message.text).toMatch(new RegExp(`${name}, data nașterii [^\\n]+ — loc rezervat până la 13:44`));
    expect(message.text).toContain("Family registration: Ana, Mihai and Ioana — 3 places reserved until 13:44.");
    expect(message.text).toContain("Confirm și semnez declarațiile (3)");
    // Still held while the email is queued, whatever its stored deadline: the count stays at 47.
    expect(await available(event, at(60))).toBe(47);

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
    expect(message.text).toContain("Înscriere de familie: Ana, Mihai și Ioana — 2 locuri rezervate până la 13:42, o persoană pe lista de așteptare.");
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

describe("BR-REQ-034-02 a family's unconfirmed places go back through the allocator (§NNN)", () => {
  it("once the email has left and the hold is past, the three places are free again and the waiting list is served", async () => {
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
    expect(held.holdExpiresAt!.getTime()).toBeGreaterThan(at(5).getTime());

    // Past the hold: the maintenance job clears the three reservations and offers Radu the place.
    const after = new Date(held.holdExpiresAt!.getTime() + 60_000);
    await runRegistrationMaintenance(db, after);
    const family = (await rows()).filter((row) => row.participantId === held.participantId);
    expect(family.map((row) => [row.registeredName, row.status, row.holdExpiresAt])).toEqual([
      ["Ana Pop", "PENDING_EMAIL_CONFIRMATION", null],
      ["Mihai Pop", "PENDING_EMAIL_CONFIRMATION", null],
      ["Ioana Pop", "PENDING_EMAIL_CONFIRMATION", null],
    ]);
    const [raduNow] = await db.select().from(registrations).where(eq(registrations.id, radu.id));
    expect(raduNow.status).toBe("WAITLIST_OFFERED");
  });
});

describe("BR-REQ-034-02 a family's reservation has a ceiling no «Da» press moves (§NNN, the review of 2026-09-28, round two)", () => {
  /** «Da» pressed again, as the action presses it: the window starts again from this press. */
  async function pressAgain(event: EventInput, sittingId: string | null, minute: number) {
    return continueFamilySittingAndReserve(db, { sittingId, seed: null, eventId: event.id, locale: "ro" }, new Date(at(minute).getTime() + WINDOW_MS), at(minute));
  }

  it("one form, then «Da» every five minutes for two hours: the place is back in the count at the ceiling", async () => {
    const event = await createEvent(2);
    const opened = await start(event, "Ana", 0);
    expect(opened).toMatchObject({ opened: true, places: ["reserved"] });
    // The opening press's window and the club's hold: 10 + 30 minutes.
    const ceiling = new Date(at(0).getTime() + WINDOW_MS + 30 * 60_000);
    expect(opened.reservedUntil?.toISOString()).toBe(ceiling.toISOString());
    expect(await available(event, at(1))).toBe(1);

    for (let minute = 5; minute <= 120; minute += 5) {
      const pressed = await pressAgain(event, opened.sittingId, minute);
      // The sitting takes the next form still, but a later press reserves and lengthens nothing.
      expect(pressed).toMatchObject({ sittingId: opened.sittingId, opened: false, reservedUntil: null, places: [] });
      const [ana] = await rows();
      expect(ana.holdExpiresAt?.toISOString()).toBe(ceiling.toISOString());
      // Before the ceiling the place is Ana's; from the press that moved her email past it, it is free.
      expect(await available(event, at(minute))).toBe(minute < 40 ? 1 : 2);
    }
    // Her email is still held — the presses kept moving it — and holds no place any more.
    const [held] = await db.select().from(emailOutbox);
    expect(held.status).toBe("PENDING");
    expect(held.nextAttemptAt?.toISOString()).toBe(new Date(at(120).getTime() + WINDOW_MS).toISOString());
    expect(await available(event, at(121))).toBe(2);
    // Released at last, the email leaves and gives nothing back: a lapsed reservation is never lengthened.
    await releaseFamilySitting(db, opened.sittingId!, at(122));
    const [verification] = await db.select().from(emailOutbox);
    await renderOutboxMessage({ ...verification, status: "PROCESSING", attemptCount: 1, lockedAt: at(123) }, db, at(123));
    const [ana] = await rows();
    expect([ana.status, ana.holdExpiresAt?.toISOString()]).toEqual(["PENDING_EMAIL_CONFIRMATION", ceiling.toISOString()]);
    expect(await available(event, at(123))).toBe(2);
  });

  it("presses after the last form keep its deadline: an email sent when due lengthens nothing", async () => {
    const event = await createEvent(50);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    const deadline = new Date(at(1).getTime() + WINDOW_MS + 30 * 60_000);
    for (const minute of [8, 16, 24, 30]) await pressAgain(event, sittingId, minute);
    for (const row of await rows()) expect(row.holdExpiresAt?.toISOString()).toBe(deadline.toISOString());
    // Due at minute 40 (the last press's window), before the deadline: held until it leaves, on time.
    const { row } = await familyMessage(at(40));
    expect(row.nextAttemptAt?.toISOString()).toBe(at(40).toISOString());
    for (const stored of await rows()) expect(stored.holdExpiresAt?.toISOString()).toBe(deadline.toISOString());
  });

  it("an email the job sent an hour late gives the family back the hour, up to the club's hold from the send", async () => {
    const event = await createEvent(50);
    const { sittingId } = await start(event, "Ana", 0);
    await send(event, "Mihai", 1, sittingId);
    await releaseFamilySitting(db, sittingId!, at(5));
    // Past the stored deadline (minute 41) and the email still queued, due at minute 5: still the family's.
    expect(await available(event, at(65))).toBe(48);
    await familyMessage(at(65));
    // Lateness 60 minutes on a deadline at minute 41 would be 101; the hold from the send, 95, is the cap.
    for (const stored of await rows()) expect(stored.holdExpiresAt?.toISOString()).toBe(at(95).toISOString());
  });

  it("a form that wrote no registration — the address at its limit with registrations made elsewhere — names no place", async () => {
    const event = await createEvent(50);
    const { updateAddressCap } = await import("@/modules/registrations/address-cap");
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    await updateAddressCap(db, admin, { registrationsPerAddress: 2 }, NOW);
    // Radu registered on this address long before, from another device.
    await submitRegistration(db, event, submission("Radu", at(0)), at(0), "REAL", PUBLIC);
    // Ana's first form is kept (§446); «Da» opens the sitting and reserves nothing: no registration was written.
    const opened = await start(event, "Ana", 1);
    expect(opened).toMatchObject({ opened: true, places: [] });
    // Mihai's form: Radu and Ana's kept form fill the limit of two, so it is a kept form at the limit.
    const second = await send(event, "Mihai", 2, opened.sittingId);
    expect(second.sittingPlace).toBeNull();
    expect((await rows()).map((row) => row.registeredName)).toEqual(["Radu Pop"]);
    expect(await available(event, at(2))).toBe(50);
  });
});

describe("§NNN nothing changes for a single registration, and a person confirmed earlier is said so", () => {
  it("one form with no «Da» reserves nothing: the count is untouched until the address is confirmed", async () => {
    const event = await createEvent(50);
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const [ana] = await rows();
    expect(ana.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(ana.holdExpiresAt).toBeNull();
    expect(await available(event, at(0))).toBe(50);
    expect(await db.select().from(familySittings)).toHaveLength(0);
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
