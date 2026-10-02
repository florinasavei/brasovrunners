import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { NoFreePlaceError } from "@/modules/registrations/domain/capacity";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { SENT_NOW_FLAG } from "@/modules/notifications/domain/send-at-once";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Dă-i un loc acum» (§637; BR-REQ-037-07, BR-REQ-034-01; `AGENTS.md` §10.5 rule 3, §15.11). The
 * owner, 2026-10-02, of a member whose verification email left late in the outage and whose press
 * then met a full race and a full line: «Acestei doamne ghinioniste vreau să-i aloc direct loc și să
 * îi trimit declarația» — «Nu vreau să mai facă ea nimic!! Nu mai vreau să risc».
 *
 * An Administrator vouches for the address of a `PENDING_EMAIL_CONFIRMATION` row and gives it a place
 * now, ahead of the waiting list, under the event lock, from a counted free place only; the person
 * receives the ordinary declaration email and signs it herself — online, or on paper at the desk.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const STARTS = new Date("2026-10-11T07:00:00.000Z");
const DAY = 24 * 60 * 60_000;
/** The column defaults' window (§104): asked 7 days before, owed 2 days before the start. */
const WINDOW_DEADLINE = new Date(STARTS.getTime() - 2 * DAY);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The send-now drain, watched: outside a request it would do nothing anyway (`drain.ts`).
const sentNow = vi.hoisted(() => [] as string[][]);
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: (ids: readonly string[]) => {
    if (ids.length > 0) sentNow.push([...ids]);
  },
}));

const { continueFamilySittingAndReserve, submitRegistration, confirmEmail, signDeclaration } = await import("@/modules/registrations/service");
const { confirmRegistrationByStaff, givePlaceToUnconfirmedByStaff } = await import("@/modules/registrations/admin-service");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { consumeAndConfirmEmail, readSpentRegistrationLink } = await import("@/modules/registrations/token-actions");
const { readPublicPlaces } = await import("@/modules/registrations/service");
const { processOutboxBatch } = await import("@/modules/notifications/outbox");
const { createOutboxRenderer } = await import("@/modules/notifications/render");
const { givePlaceNowAhead } = await import("@/modules/registrations/give-place-tip");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
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
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.ro", displayName: "Organizer", role: "MODERATOR" }).returning();
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

async function createEvent(capacity: number | null, options: { auto?: boolean; startsAt?: Date; window?: [number, number] } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: options.auto ?? false,
      ...(options.window ? { confirmationOpensDaysBefore: options.window[0], confirmationDeadlineDaysBefore: options.window[1] } : {}),
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  };
}

const submission = (firstName: string, email: string, sentAt: Date) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: "1985-03-02",
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

/** One person who sent the form and never confirmed the address. */
async function unconfirmed(event: EventInput, name: string, minute: number, kind: "REAL" | "TEST" = "REAL") {
  await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.ro`, at(minute)), at(minute), kind, PUBLIC);
  const row = await rowOf(name);
  expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
  return row;
}

/** One person on their own address, taken as far as the address's confirmation. */
async function confirmedAddress(event: EventInput, name: string, minute: number) {
  await unconfirmed(event, name, minute);
  return confirmEmail(db, event, (await rowOf(name)).id, at(minute));
}

/** The person's verification link, as the email the renderer sends would carry it. */
async function verificationLink(registrationId: string, participantId: string, now: Date) {
  return (
    await issueActionToken(db, { participantId, registrationId, purpose: "VERIFY_REGISTRATION_EMAIL", expiresAt: new Date(now.getTime() + 48 * 3_600_000), now })
  ).secret;
}

const declarationEmails = (registrationId: string) =>
  db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registrationId), eq(emailOutbox.messageType, "COMPLETE_DECLARATION")));
const vouchedTrail = (registrationId: string) =>
  db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.address_vouched_by_staff"), eq(auditLogs.entityId, registrationId)));

const verificationEmails = (registrationId: string) =>
  db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registrationId), eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL")));

/** A provider that takes everything and remembers what it was handed. */
function provider(): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return { outcome: "sent", providerMessageId: `id-${calls.length}` };
    },
  };
}

/** Lapse a declaration hold whose email has left (§160, §520): kept, still counted, releasable. */
async function lapse(registrationId: string, at: Date) {
  await db.update(emailOutbox).set({ status: "SENT", sentAt: at }).where(eq(emailOutbox.registrationId, registrationId));
  await db.update(registrations).set({ holdExpiresAt: at }).where(eq(registrations.id, registrationId));
}

/** The page's forecast reads the wall clock: set it to the test's instant, the database's timers left alone. */
async function atTheClock<R>(now: Date, work: () => Promise<R>): Promise<R> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    return await work();
  } finally {
    vi.useRealTimers();
  }
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

/** A race of two places: Ana holds one, Elena and Luca wait, and Mara never confirmed her address. */
async function oneFreeTwoWaiting() {
  const event = await createEvent(1);
  expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");
  expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");
  expect((await confirmedAddress(event, "Luca", 2)).status).toBe("WAITLISTED");
  const mara = await unconfirmed(event, "Mara", 3);
  // One more place, offered to nobody («Nu»): a place free beside two people waiting.
  await db.update(events).set({ capacity: 2 }).where(eq(events.id, event.id));
  return { event: { ...event, capacity: 2 }, mara };
}

describe("§637 «Dă-i un loc acum»: the address vouched for, the place given ahead of the line", () => {
  it("a free place and people waiting: the row holds the place until the window's deadline, the declaration email leaves now, the line does not move", async () => {
    const { event, mara } = await oneFreeTwoWaiting();
    const lineBefore = await db.select({ id: registrations.id, status: registrations.status, waitlistedAt: registrations.waitlistedAt }).from(registrations).where(eq(registrations.status, "WAITLISTED"));
    // The public door would have put her in the line (§615 criterion 6).
    const placed = await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(10));

    expect(placed.status).toBe("PENDING_DECLARATION");
    // Before the window opens: the window's deadline, exactly what a public confirmation gets (§104).
    expect(placed.holdExpiresAt?.toISOString()).toBe(WINDOW_DEADLINE.toISOString());
    // The desk's vouching (§67): who vouched, and the person's own verification left unset.
    expect(placed.emailConfirmedAt?.toISOString()).toBe(at(10).toISOString());
    expect(placed.emailConfirmedByStaffUserId).toBe(admin.id);
    const [participant] = await db.select().from(participants).where(eq(participants.id, mara.participantId));
    expect(participant.emailVerifiedAt).toBeNull();

    // The ordinary declaration email: it starts the hold (§513) and leaves now (§596).
    const [email] = await declarationEmails(mara.id);
    expect(email.payloadJson).toMatchObject({ [STARTS_DEADLINE]: true, [SENT_NOW_FLAG]: true });
    expect(sentNow).toEqual([[email.id]]);

    // One audit row naming who vouched, and how many waited.
    const [trail] = await vouchedTrail(mara.id);
    expect(trail.actorStaffUserId).toBe(admin.id);
    expect(trail.metadataJson).toMatchObject({ from: "PENDING_EMAIL_CONFIRMATION", to: "PENDING_DECLARATION", waiting: 2 });

    // Nobody in the line moved, and nobody was offered anything.
    const lineAfter = await db.select({ id: registrations.id, status: registrations.status, waitlistedAt: registrations.waitlistedAt }).from(registrations).where(eq(registrations.status, "WAITLISTED"));
    expect(lineAfter).toEqual(lineBefore);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"))).toEqual([]);

    // The public count shows the held place: none free now, two waiting.
    const places = await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, at(11));
    expect(places.occupied).toBe(2);
    expect(places.availablePlaces).toBe(0);
    expect(places.waitlisted).toBe(2);
  });

  it("nobody waiting: the same, and the public count drops by the place", async () => {
    const event = await createEvent(2, { auto: true });
    await confirmedAddress(event, "Ana", 0);
    const mara = await unconfirmed(event, "Mara", 1);
    expect((await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, at(2))).availablePlaces).toBe(1);

    const placed = await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(2));
    expect(placed.status).toBe("PENDING_DECLARATION");
    expect(await declarationEmails(mara.id)).toHaveLength(1);
    expect(await vouchedTrail(mara.id)).toHaveLength(1);
    expect((await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, at(3))).availablePlaces).toBe(0);
  });

  it("no counted free place: refused with §589's sentence, and nothing is written", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana", 0);
    const mara = await unconfirmed(event, "Mara", 1);
    const link = await verificationLink(mara.id, mara.participantId, at(1));
    const outboxBefore = (await db.select().from(emailOutbox)).length;

    const error = await refusal(givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5)));
    expect(error).toBeInstanceOf(NoFreePlaceError);
    expect((error as NoFreePlaceError).places).toMatchObject({ capacity: 1, declaration: 1 });

    const after = await rowOf("Mara");
    expect(after.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(after.emailConfirmedAt).toBeNull();
    expect(after.emailConfirmedByStaffUserId).toBeNull();
    expect(after.holdExpiresAt).toBeNull();
    expect((await db.select().from(emailOutbox)).length).toBe(outboxBefore);
    expect(await vouchedTrail(mara.id)).toEqual([]);
    expect(sentNow).toEqual([]);
    // Her own link is untouched: still unspent, and it confirms her address as before.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, mara.id));
    expect(token.usedAt).toBeNull();
    expect(token.invalidatedAt).toBeNull();
    expect(await consumeAndConfirmEmail(link, at(6))).toMatchObject({ ok: true });
  });

  it("refuses any other status, a cancelled or started event, and the Organizer", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    const conflict = await refusal(givePlaceToUnconfirmedByStaff(db, admin, ana.id, at(5)));
    expect(isDomainError(conflict) && conflict.code).toBe("CONFLICT");

    const mara = await unconfirmed(event, "Mara", 1);
    const forbidden = await refusal(givePlaceToUnconfirmedByStaff(db, organizer, mara.id, at(5)));
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");

    const started = await refusal(givePlaceToUnconfirmedByStaff(db, admin, mara.id, new Date(STARTS.getTime() + 60_000)));
    expect(isDomainError(started) && started.code).toBe("VALIDATION_ERROR");

    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    const cancelled = await refusal(givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5)));
    expect(isDomainError(cancelled) && cancelled.code).toBe("VALIDATION_ERROR");

    expect((await rowOf("Mara")).status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(await vouchedTrail(mara.id)).toEqual([]);
  });

  it("the old verification link no longer confirms the row, and its page says to sign the declaration", async () => {
    const event = await createEvent(3);
    const mara = await unconfirmed(event, "Mara", 0);
    const link = await verificationLink(mara.id, mara.participantId, at(0));
    await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));

    const pressed = await consumeAndConfirmEmail(link, at(6));
    expect(pressed).toMatchObject({ ok: false, reason: "ALREADY_USED" });
    const row = await rowOf("Mara");
    expect(row.status).toBe("PENDING_DECLARATION");
    expect(await declarationEmails(mara.id)).toHaveLength(1);

    const page = await readSpentRegistrationLink(link, [{ purpose: "VERIFY_REGISTRATION_EMAIL", reason: "ALREADY_USED" }], "ro", at(6));
    expect(page).toMatchObject({ message: "SIGN_DECLARATION", next: "RESEND" });
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, mara.id));
    expect(token.usedAt?.toISOString()).toBe(at(5).toISOString());
  });

  it("she signs the declaration from the email and is confirmed as usual", async () => {
    const event = await createEvent(3);
    const mara = await unconfirmed(event, "Mara", 0);
    await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    const confirmed = await signDeclaration(db, event, mara.id, await signingInput(db, at(30), "Mara Munteanu"), at(30));
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bibNumber).not.toBeNull();
  });

  it("or on paper at the desk: «Confirmă pe hârtie» still works on the row", async () => {
    const event = await createEvent(3);
    const mara = await unconfirmed(event, "Mara", 0);
    await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    const confirmed = await confirmRegistrationByStaff(db, admin, mara.id, at(60));
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("a test registration is given its place exactly as a real one (§30)", async () => {
    const event = await createEvent(1);
    const mara = await unconfirmed(event, "Mara", 0, "TEST");
    const placed = await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    expect(placed.status).toBe("PENDING_DECLARATION");
    expect(placed.holdExpiresAt?.toISOString()).toBe(WINDOW_DEADLINE.toISOString());
    // …and it occupies the place like a real one: the next person finds the race full.
    const radu = await unconfirmed(event, "Radu", 6);
    expect(await refusal(givePlaceToUnconfirmedByStaff(db, admin, radu.id, at(7)))).toBeInstanceOf(NoFreePlaceError);
  });

  it("inside the window, or with none, the place waits for the window's deadline or the start — never the club's minutes", async () => {
    // Inside the window: the window's own deadline.
    const inside = await createEvent(3, { startsAt: new Date(NOW.getTime() + 5 * DAY) });
    const mara = await unconfirmed(inside, "Mara", 0);
    const held = await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    expect(held.holdExpiresAt?.toISOString()).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());

    // No window (switched off): the start.
    const none = await createEvent(3, { window: [0, 0] });
    const radu = await unconfirmed(none, "Radu", 1);
    const kept = await givePlaceToUnconfirmedByStaff(db, admin, radu.id, at(6));
    expect(kept.holdExpiresAt?.toISOString()).toBe(STARTS.toISOString());
  });

  it("a family's reserved place is the row's own, as at the desk (§543): given on a full race, never counted against it", async () => {
    const event = await createEvent(2);
    const first = await submitRegistration(db, event, submission("Ioana", "familia@example.ro", at(0)), at(0), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const cookieId = first.sittingId ?? randomUUID();
    const firstWindowEnd = new Date(at(0).getTime() + 10 * 60_000);
    const pressed = await continueFamilySittingAndReserve(db, { sittingId: cookieId, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" }, firstWindowEnd, at(0), { firstWindowEnd, firstName: "Ioana Munteanu", email: "familia@example.ro" });
    expect(pressed.place).toBe("reserved");
    const second = await submitRegistration(db, event, submission("Mihai", "familia@example.ro", at(1)), at(1), "REAL", { ...PUBLIC, sitting: { id: pressed.sittingId ?? cookieId, joined: true, newPerson: true } });
    expect(second.sittingPlace).toBe("reserved");
    // Both places are the family's: a stranger is refused, the family's own row is not.
    const radu = await unconfirmed(event, "Radu", 2);
    expect(await refusal(givePlaceToUnconfirmedByStaff(db, admin, radu.id, at(3)))).toBeInstanceOf(NoFreePlaceError);

    const ioana = await rowOf("Ioana");
    const placed = await givePlaceToUnconfirmedByStaff(db, admin, ioana.id, at(3));
    expect(placed.status).toBe("PENDING_DECLARATION");
    const [trail] = await vouchedTrail(ioana.id);
    expect(trail.metadataJson).toMatchObject({ familyReservation: true });
    // Mihai keeps his reserved place: still two places taken, not three.
    expect((await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, at(4))).occupied).toBe(2);
  });

  it("a verification email still waiting in the outbox is withdrawn: after the declaration, no late «confirm your address» (review finding 2)", async () => {
    const event = await createEvent(3);
    const mara = await unconfirmed(event, "Mara", 0);
    // The outage's backlog: her verification email queued and never tried.
    const [queued] = await verificationEmails(mara.id);
    expect(queued).toMatchObject({ status: "PENDING", attemptCount: 0 });

    await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    expect(await verificationEmails(mara.id)).toEqual([]);

    const mail = provider();
    await processOutboxBatch(db, { sender: mail, render: createOutboxRenderer(), now: at(60) });
    const keys = mail.calls.map((call) => call.idempotencyKey);
    expect(keys).not.toContain(queued.idempotencyKey);
    // The declaration's email is what she receives.
    const [declaration] = await declarationEmails(mara.id);
    expect(keys).toContain(declaration.idempotencyKey);
  });

  it("a verification email being retried is withdrawn by the renderer, never sent", async () => {
    const event = await createEvent(3);
    const mara = await unconfirmed(event, "Mara", 0);
    const [queued] = await verificationEmails(mara.id);
    // A transient failure before the press: tried once, waiting for its retry — the press leaves it, it may have left.
    await db.update(emailOutbox).set({ attemptCount: 1, nextAttemptAt: null }).where(eq(emailOutbox.id, queued.id));

    await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    expect(await verificationEmails(mara.id)).toHaveLength(1);

    const mail = provider();
    await processOutboxBatch(db, { sender: mail, render: createOutboxRenderer(), now: at(60) });
    expect(mail.calls.map((call) => call.idempotencyKey)).not.toContain(queued.idempotencyKey);
    expect(await verificationEmails(mara.id)).toEqual([]);
  });

  it("a full race with a lapsed declaration hold and nobody waiting: the lapsed hold goes for her (§160), and the question does not say «full»", async () => {
    const event = await createEvent(1);
    const ana = await confirmedAddress(event, "Ana", 0);
    expect(ana.status).toBe("PENDING_DECLARATION");
    await lapse(ana.id, at(1));
    const mara = await unconfirmed(event, "Mara", 2);
    // The forecast agrees with the press: one lapsed hold may go, so the race is not "full" for her.
    expect(await atTheClock(at(4), () => givePlaceNowAhead(event.id))).toEqual({ full: false });

    const placed = await givePlaceToUnconfirmedByStaff(db, admin, mara.id, at(5));
    expect(placed.status).toBe("PENDING_DECLARATION");
    expect((await rowOf("Ana")).status).toBe("EXPIRED");
    expect((await readPublicPlaces(db, { id: event.id, capacity: 1, waitlistCapacity: null }, at(6))).occupied).toBe(1);
  });

  it("the button is offered only where the press can succeed, and says «full» beforehand when it is", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana", 0);
    const ahead = (eventId: string) => atTheClock(at(5), () => givePlaceNowAhead(eventId));
    // A held place still within its deadline: full, and nothing lapsed to release.
    expect(await ahead(event.id)).toEqual({ full: true });
    await db.update(events).set({ capacity: 2 }).where(eq(events.id, event.id));
    expect(await ahead(event.id)).toEqual({ full: false });

    // A started, cancelled, date-to-be-announced or not local event: no button.
    const started = await createEvent(2, { startsAt: at(1) });
    expect(await ahead(started.id)).toBeNull();
    const cancelled = await createEvent(2);
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, cancelled.id));
    expect(await ahead(cancelled.id)).toBeNull();
    const announced = await createEvent(2);
    await db.update(events).set({ dateToBeAnnounced: true }).where(eq(events.id, announced.id));
    expect(await ahead(announced.id)).toBeNull();
    const notLocal = await createEvent(null);
    await db.update(events).set({ registrationMode: "NONE" }).where(eq(events.id, notLocal.id));
    expect(await ahead(notLocal.id)).toBeNull();
  });
});
