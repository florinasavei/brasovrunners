import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { createRegistrationByStaff } from "@/modules/registrations/admin-service";
import { waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { confirmEmail, readPublicPlaces, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Direct pe lista de așteptare» (§NNN; BR-REQ-037-05, BR-REQ-034-01; `AGENTS.md` §10.5 rule 3, §15.11). The
 * owner, 2026-10-30: «Ar trebui să pot adăuga pe cineva pe lista de așteptare direct, nu neapărat pe cea
 * internă.»
 *
 * The staff entry's second tick, the Administrator's alone: the address vouched for at the entry — as the
 * desk vouches in person (§67) and «Dă-i un loc acum» vouches remotely (§637) — and the row through the one
 * allocator in the entry's own transaction: the back of the line when the event is full, a declaration
 * hold when a counted place is free, with that state's ordinary email and no verification email. Never a
 * place ahead of anyone, never a supplementary place, never a signature; a full line refuses the whole
 * entry and nothing is written.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
/** A race in five days: inside the column defaults' window (asked 7 days before, owed 2 days before, §104). */
const STARTS = new Date(NOW.getTime() + 5 * DAY);
const WINDOW_DEADLINE = new Date(STARTS.getTime() - 2 * DAY);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
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

async function createEvent(capacity: number | null, options: { waitlistCapacity?: number | null; closesAt?: Date | null; startsAt?: Date } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistCapacity: options.waitlistCapacity ?? null,
      waitlistAutoOffer: false,
      registrationClosesAt: options.closesAt ?? null,
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
    waitlistCapacity: event.waitlistCapacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
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

/** One person on their own address, taken as far as the address's confirmation — the public door. */
async function confirmedAddress(event: EventInput, name: string, minute: number) {
  await submitRegistration(db, event, submission(name, `${name.toLowerCase()}@example.ro`, at(minute)), at(minute), "REAL", PUBLIC);
  return confirmEmail(db, event, (await rowOf(name)).id, at(minute));
}

/** The staff entry of one person, as the form posts it: the relay tick, and whichever of the two boxes. */
const entryOf = (eventId: string, name: string, boxes: { vouchAddress?: boolean; fastTrack?: boolean } = {}) => ({
  eventId,
  firstName: name,
  lastName: "Munteanu",
  email: `${name.toLowerCase()}@example.ro`,
  locale: "ro" as const,
  listOptOut: true,
  relayedByParticipantRequest: true,
  ...boxes,
});

const emailsOf = (registrationId: string, messageType: "VERIFY_REGISTRATION_EMAIL" | "WAITLIST_JOINED" | "COMPLETE_DECLARATION") =>
  db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registrationId), eq(emailOutbox.messageType, messageType)));
const trailOf = (registrationId: string, action: "registration.address_vouched_on_entry" | "registration.created_by_staff" | "registration.confirmed_by_staff") =>
  db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, registrationId)));

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("§NNN «Direct pe lista de așteptare»: the address vouched for at the entry, the row through the allocator at once", () => {
  it("a full event: the row joins the back of the line now, told by the ordinary waiting-list email, no verification email, audited under the Administrator", async () => {
    const event = await createEvent(1);
    expect((await confirmedAddress(event, "Ana", 0)).status).toBe("PENDING_DECLARATION");
    expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");

    const { registrationId } = await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true }), at(5));
    const mara = await rowOf("Mara");
    expect(mara.id).toBe(registrationId);
    expect(mara.status).toBe("WAITLISTED");
    expect(mara.source).toBe("STAFF");
    // The desk's vouching, word for word (§67): who vouched, when — and the person's own verification left unset.
    expect(mara.emailConfirmedAt?.toISOString()).toBe(at(5).toISOString());
    expect(mara.emailConfirmedByStaffUserId).toBe(admin.id);
    const [participant] = await db.select().from(participants).where(eq(participants.id, mara.participantId));
    expect(participant.emailVerifiedAt).toBeNull();

    // Behind Elena, never ahead of her (BR-REQ-034-03): the line keeps its order.
    const elena = await rowOf("Elena");
    expect(elena.status).toBe("WAITLISTED");
    expect(mara.waitlistedAt!.getTime()).toBeGreaterThan(elena.waitlistedAt!.getTime());

    // The state's ordinary email, and no link to confirm an address the club vouched for.
    expect(await emailsOf(mara.id, "WAITLIST_JOINED")).toHaveLength(1);
    expect(await emailsOf(mara.id, "VERIFY_REGISTRATION_EMAIL")).toEqual([]);
    expect(await emailsOf(mara.id, "COMPLETE_DECLARATION")).toEqual([]);

    // Two trail rows under the Administrator's id: the entry with the state it landed in, and the vouching.
    const [entered] = await trailOf(mara.id, "registration.created_by_staff");
    expect(entered.actorStaffUserId).toBe(admin.id);
    expect(entered.metadataJson).toMatchObject({ status: "WAITLISTED", fastTrack: false, addressVouched: true });
    const [vouched] = await trailOf(mara.id, "registration.address_vouched_on_entry");
    expect(vouched.actorStaffUserId).toBe(admin.id);
    expect(vouched.metadataJson).toEqual({ from: "PENDING_EMAIL_CONFIRMATION", to: "WAITLISTED" });

    // The public count carries her: none free, two waiting.
    const places = await readPublicPlaces(db, { id: event.id, capacity: 1, waitlistCapacity: null }, at(6));
    expect(places.availablePlaces).toBe(0);
    expect(places.waitlisted).toBe(2);
  });

  it("a counted free place: a declaration hold that waits as «Dă-i un loc acum»'s does, the declaration email starting it, and the person signs as usual", async () => {
    const event = await createEvent(2);
    await confirmedAddress(event, "Ana", 0);

    await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true }), at(5));
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("PENDING_DECLARATION");
    expect(mara.emailConfirmedByStaffUserId).toBe(admin.id);
    // Inside the window the public door would give the club's minutes; a vouched place waits for the window's deadline (§637).
    expect(mara.holdExpiresAt?.toISOString()).toBe(WINDOW_DEADLINE.toISOString());
    const [email] = await emailsOf(mara.id, "COMPLETE_DECLARATION");
    expect(email.payloadJson).toMatchObject({ [STARTS_DEADLINE]: true });
    expect(await emailsOf(mara.id, "VERIFY_REGISTRATION_EMAIL")).toEqual([]);
    expect((await trailOf(mara.id, "registration.address_vouched_on_entry"))[0].metadataJson).toEqual({ from: "PENDING_EMAIL_CONFIRMATION", to: "PENDING_DECLARATION" });
    expect((await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, at(6))).availablePlaces).toBe(0);

    // The signature is the person's, from the email — nothing here signed for them.
    const confirmed = await signDeclaration(db, event, mara.id, await signingInput(db, at(30), "Mara Munteanu"), at(30));
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bibNumber).not.toBeNull();
  });

  it("the line full (§348): the whole entry is refused and nothing is written — no row, no participant, no email", async () => {
    const event = await createEvent(1, { waitlistCapacity: 1 });
    await confirmedAddress(event, "Ana", 0);
    expect((await confirmedAddress(event, "Elena", 1)).status).toBe("WAITLISTED");

    const error = await refusal(createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true }), at(5)));
    expect(waitlistRefusalOf(error)).not.toBeNull();
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "mara@example.ro"))).toEqual([]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.address_vouched_on_entry"))).toEqual([]);
  });

  it("the Administrator's alone (BR-REQ-060-01): an Organizer posting the box is refused before anything is written", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana", 0);

    const error = await refusal(createRegistrationByStaff(db, organizer, entryOf(event.id, "Mara", { vouchAddress: true }), at(5)));
    expect(isDomainError(error) && error.code).toBe("FORBIDDEN");
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "mara@example.ro"))).toEqual([]);

    // Without the box the Organizer's entry is the ordinary one: the person's own link.
    await createRegistrationByStaff(db, organizer, entryOf(event.id, "Mara"), at(6));
    expect((await rowOf("Mara")).status).toBe("PENDING_EMAIL_CONFIRMATION");
  });

  it("without the tick nothing changes: the person's own verification email, the row waiting for their click", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana", 0);

    await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara"), at(5));
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(mara.emailConfirmedByStaffUserId).toBeNull();
    expect(await emailsOf(mara.id, "VERIFY_REGISTRATION_EMAIL")).toHaveLength(1);
    expect(await emailsOf(mara.id, "WAITLIST_JOINED")).toEqual([]);
    expect(await trailOf(mara.id, "registration.address_vouched_on_entry")).toEqual([]);
  });

  it("under the fast track the tick is ignored: the desk's paper confirmation vouches and confirms by itself", async () => {
    const event = await createEvent(3);

    await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true, fastTrack: true }), at(5));
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("CONFIRMED");
    expect(mara.emailConfirmedByStaffUserId).toBe(admin.id);
    expect(await trailOf(mara.id, "registration.confirmed_by_staff")).toHaveLength(1);
    expect(await trailOf(mara.id, "registration.address_vouched_on_entry")).toEqual([]);
    expect((await trailOf(mara.id, "registration.created_by_staff"))[0].metadataJson).toMatchObject({ fastTrack: true });
    expect((await trailOf(mara.id, "registration.created_by_staff"))[0].metadataJson).not.toHaveProperty("addressVouched");
  });

  it("after the start the remote vouching is refused with its own sentence and nothing is written; the desk's walk-in still goes through", async () => {
    const event = await createEvent(3, { startsAt: new Date(NOW.getTime() - 60 * 60_000) });

    const started = await refusal(createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true }), at(5)));
    expect(isDomainError(started) && started.code).toBe("VOUCHED_ENTRY_AFTER_START");
    expect(await rowOf("Mara")).toBeUndefined();
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "mara@example.ro"))).toEqual([]);

    // Race morning at the table (§67): the person in front of the volunteer, the paper signed — unchanged.
    await createRegistrationByStaff(db, admin, entryOf(event.id, "Luca", { fastTrack: true }), at(6));
    expect((await rowOf("Luca")).status).toBe("CONFIRMED");
  });

  it("after the public close the Administrator may still enter and vouch, as at the desk; the ordinary entry is refused; the hold is capped by the start, not the close", async () => {
    const event = await createEvent(2);
    await confirmedAddress(event, "Ana", 0);
    // Registration closed yesterday: the public door, and with it the ordinary staff entry, is shut.
    await db.update(events).set({ registrationClosesAt: new Date(NOW.getTime() - DAY) }).where(eq(events.id, event.id));

    const closed = await refusal(createRegistrationByStaff(db, admin, entryOf(event.id, "Luca"), at(5)));
    expect(isDomainError(closed) && closed.code).toBe("VALIDATION_ERROR");
    expect(await rowOf("Luca")).toBeUndefined();

    await createRegistrationByStaff(db, admin, entryOf(event.id, "Mara", { vouchAddress: true }), at(5));
    const mara = await rowOf("Mara");
    expect(mara.status).toBe("PENDING_DECLARATION");
    // Not born lapsed at a close already behind us: the window's deadline, as a vouched place waits (§637).
    expect(mara.holdExpiresAt?.toISOString()).toBe(WINDOW_DEADLINE.toISOString());
    expect(await emailsOf(mara.id, "COMPLETE_DECLARATION")).toHaveLength(1);
  });
});
