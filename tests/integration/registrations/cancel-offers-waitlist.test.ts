import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-035-02, BR-REQ-034-02, BR-REQ-036-01, BR-REQ-037-03, AGENTS.md §10.6 — a cancellation offers the freed place
 * to the head of the waiting list at once, and the offer's email leaves at once (§348, §589, §NNN; the
 * owner, 2026-09-30: «când anulez pe cineva, iau automat pe altcineva de pe lista de așteptare»).
 *
 * The owner's shape: a full race of three — one confirmed, a family's two reserved places, one person
 * waiting — and the confirmed one cancelled by staff, by their own link, or erased; and an offer that
 * lapses, handed to the next in line. Before the fix each of these already made the offer in the
 * cancellation's own transaction and queued its email; what failed on QA was the email, which waited
 * for the scheduled pass (§513) — up to an hour or two there — so nobody heard of the place. Now every
 * offer is marked «Pleacă acum» (§540) and handed, with its club copies, to the send-now drain.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const WINDOW_MS = 10 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The send-now drain, watched: outside a request it would do nothing anyway (`drain.ts`).
const sentNow = vi.hoisted(() => [] as string[][]);
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: (ids: readonly string[]) => {
    if (ids.length > 0) sentNow.push([...ids]);
  },
}));

const { continueFamilySittingAndReserve, submitRegistration, confirmEmail, signDeclaration, unregister } = await import("@/modules/registrations/service");
const { cancelRegistrationByStaff, deleteRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");

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
  sentNow.length = 0;
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };
const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Mihai: "1987-02-14", Radu: "1990-04-04", Elena: "1992-08-08", Luca: "1979-11-30" };

async function createEvent(capacity: number): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Alergarea de joi", slug: `alergarea-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "Thursday run", slug: `thursday-run-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (firstName: string, email: string, sentAt: Date) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: BIRTH_DATES[firstName] ?? "1980-01-01",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 30_000).toISOString(),
});

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

/** One person on their own address, taken as far as the address's confirmation. */
async function confirmedAddress(event: EventInput, name: string, minute: number) {
  await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.ro`, at(minute)), at(minute), "REAL", PUBLIC);
  return confirmEmail(db, event, (await rowOf(name)).id, at(minute));
}

/**
 * The owner's race: capacity 3; Radu confirmed; a family (Ana, Mihai) whose sitting reserved two
 * places; Elena (and Luca, when asked) on the waiting list.
 */
async function ownersRace(options: { secondWaiting?: boolean } = {}) {
  const event = await createEvent(3);
  const radu = await confirmedAddress(event, "Radu", 0);
  expect((await signDeclaration(db, event, radu.id, await signingInput(db, at(1), "Radu Munteanu"), at(1))).status).toBe("CONFIRMED");

  // The family's two forms, «Da» between them (§536, §543): each reserves a place.
  const first = await submitRegistration(db, event, submission("Ana", "familia@example.ro", at(2)), at(2), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
  const cookieId = first.sittingId ?? randomUUID();
  const firstWindowEnd = new Date(at(2).getTime() + WINDOW_MS);
  const pressed = await continueFamilySittingAndReserve(db, { sittingId: cookieId, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" }, firstWindowEnd, at(2), { firstWindowEnd, firstName: "Ana Munteanu", email: "familia@example.ro" });
  expect(pressed.place).toBe("reserved");
  const second = await submitRegistration(db, event, submission("Mihai", "familia@example.ro", at(3)), at(3), "REAL", { ...PUBLIC, sitting: { id: pressed.sittingId ?? cookieId, joined: true, newPerson: true } });
  expect(second.sittingPlace).toBe("reserved");

  expect((await confirmedAddress(event, "Elena", 4)).status).toBe("WAITLISTED");
  if (options.secondWaiting) expect((await confirmedAddress(event, "Luca", 5)).status).toBe("WAITLISTED");
  // Nothing offered yet: the race is full.
  expect(sentNow).toEqual([]);
  return { event, radu };
}

async function offersTo(name: string) {
  const row = await rowOf(name);
  return db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, row.id)).then((rows) => rows.filter((message) => message.messageType === "WAITLIST_SPOT_OFFER"));
}

/** The place offered, its email queued, marked «Pleacă acum» and handed to the send-now drain. */
async function expectOfferLeavingNow(name: string) {
  const row = await rowOf(name);
  expect(row.status).toBe("WAITLIST_OFFERED");
  expect(row.holdExpiresAt).not.toBeNull();
  const offers = await offersTo(name);
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({ status: "PENDING", payloadJson: { startsDeadline: true, sentNow: true } });
  expect(sentNow.flat()).toContain(offers[0].id);
}

describe("AGENTS.md §10.6 a cancellation offers the freed place to the head of the waiting list, and the email leaves now (§348, §589, §NNN)", () => {
  it("a staff cancel of the confirmed one: Elena is offered the place, and the family keeps its two", async () => {
    const { radu } = await ownersRace();
    await cancelRegistrationByStaff(db, admin, radu.id, "nu mai vine", at(10));
    await expectOfferLeavingNow("Elena");
    for (const name of ["Ana", "Mihai"]) expect(await rowOf(name)).toMatchObject({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: expect.any(Date) });
  });

  it("the participant's own cancel (the one path of the manage link, «Înscrierile mele» and the wizard): the same", async () => {
    const { event, radu } = await ownersRace();
    await unregister(db, event, radu.id, "PARTICIPANT", at(10), { via: "MANAGE_LINK", reason: { kind: "INJURY_OR_ILLNESS", text: null } });
    await expectOfferLeavingNow("Elena");
  });

  it("an erasure: the same", async () => {
    const { radu } = await ownersRace();
    await deleteRegistrationByStaff(db, admin, radu.id, "cerere de ștergere", at(10));
    await expectOfferLeavingNow("Elena");
  });

  it("an offer that lapses goes to the next in line, whose email leaves now too", async () => {
    const { radu } = await ownersRace({ secondWaiting: true });
    await cancelRegistrationByStaff(db, admin, radu.id, "nu mai vine", at(10));
    await expectOfferLeavingNow("Elena");
    const [offer] = await offersTo("Elena");
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(10), attemptCount: 1 }).where(eq(emailOutbox.id, offer.id));
    const elena = await rowOf("Elena");
    await runRegistrationMaintenance(db, new Date(elena.holdExpiresAt!.getTime() + 60_000));
    expect((await rowOf("Elena")).status).toBe("EXPIRED");
    await expectOfferLeavingNow("Luca");
  });
});
