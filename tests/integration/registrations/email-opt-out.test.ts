import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Trimite emailul» (the design «telling the owner about every email a staff press sends», 2026-11-03, slice 4): the
 * services of the presses that offer the box, with it unticked (`sendEmail: false`). Each does exactly what it does
 * ticked, keeps back the person's own email — and with it its club copies — and says `emailSkipped` on the press's own
 * audit row; what the press sends anybody else still goes: the freed place's offer to the first in line. A refusal under
 * the terms always tells the person its ground, so it is refused without its email.
 *
 * BR-REQ-037-03, BR-REQ-038-01, BR-REQ-060-01.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { submitRegistration, confirmEmail, signDeclaration } = await import("@/modules/registrations/service");
const { bulkCancelRegistrationsByStaff, cancelRegistrationByStaff, setBibNumberByStaff } = await import("@/modules/registrations/admin-service");
const { inviteStaffUser, inviteMembers } = await import("@/modules/staff-identity/service");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
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

async function createEvent(capacity: number): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (firstName: string, sentAt: Date) => ({
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
  email: `${firstName.toLowerCase()}@example.ro`,
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

/** One person through the address's confirmation, then — `signs` — the declaration. */
async function registered(event: EventInput, name: string, minute: number, signs: boolean) {
  await submitRegistration(db, event, submission(name, at(minute)), at(minute), "REAL", PUBLIC);
  const confirmed = await confirmEmail(db, event, (await rowOf(name)).id, at(minute));
  if (!signs) return confirmed;
  return signDeclaration(db, event, confirmed.id, await signingInput(db, at(minute + 1), `${name} Munteanu`), at(minute + 1));
}

/** A full race of one: Radu confirmed, Elena waiting. */
async function fullRace() {
  const event = await createEvent(1);
  const radu = await registered(event, "Radu", 0, true);
  expect(radu.status).toBe("CONFIRMED");
  expect((await registered(event, "Elena", 3, false)).status).toBe("WAITLISTED");
  return { event, radu };
}

const mailTo = async (name: string, type: (typeof emailOutbox.$inferSelect)["messageType"]) => {
  const row = await rowOf(name);
  return db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, row.id), eq(emailOutbox.messageType, type)));
};
const audited = async (action: string, entityId: string) =>
  (await db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)))).map((row) => row.metadataJson as Record<string, unknown>);

describe("«Trimite emailul» unticked on a cancellation (BR-REQ-037-03)", () => {
  it("cancels through the allocator, sends the person nothing — nor its club copies — and still offers the freed place to the first in line", async () => {
    const { radu } = await fullRace();
    const copiesBefore = await db.select().from(emailOutbox).where(sql`${emailOutbox.participantId} is null`);
    await cancelRegistrationByStaff(db, admin, radu.id, "nu mai vine", at(10), { sendEmail: false });
    expect((await rowOf("Radu")).status).toBe("CANCELLED");
    expect(await mailTo("Radu", "REGISTRATION_CANCELLED")).toEqual([]);
    // Elena's offer is her email, not Radu's: it goes.
    expect((await rowOf("Elena")).status).toBe("WAITLIST_OFFERED");
    expect(await mailTo("Elena", "WAITLIST_SPOT_OFFER")).toHaveLength(1);
    // No club copy of a cancellation that never left.
    const copiesAfter = await db.select().from(emailOutbox).where(sql`${emailOutbox.participantId} is null`);
    expect(copiesAfter.filter((row) => row.messageType === "REGISTRATION_CANCELLED")).toHaveLength(copiesBefore.filter((row) => row.messageType === "REGISTRATION_CANCELLED").length);
    expect(await audited("registration.cancelled_by_staff", radu.id)).toEqual([expect.objectContaining({ reason: "nu mai vine", emailSkipped: true })]);
  });

  it("ticked — or by a caller that does not say — tells the person, and the audit row says nothing of a skip", async () => {
    const { radu } = await fullRace();
    await cancelRegistrationByStaff(db, admin, radu.id, "nu mai vine", at(10));
    expect(await mailTo("Radu", "REGISTRATION_CANCELLED")).toHaveLength(1);
    expect(await audited("registration.cancelled_by_staff", radu.id)).toEqual([expect.not.objectContaining({ emailSkipped: true })]);
  });

  it("refuses the club's refusal under the terms without its email, naming the refusal's box — nothing cancelled", async () => {
    const { radu } = await fullRace();
    const refusal = await cancelRegistrationByStaff(db, admin, radu.id, "dosar incomplet", at(10), { kind: "REFUSED_BY_ORGANIZER", sendEmail: false }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "REFUSAL_NEEDS_EMAIL", fields: ["refusedByOrganizer"] });
    expect((await rowOf("Radu")).status).toBe("CONFIRMED");
    expect(await audited("registration.cancelled_by_staff", radu.id)).toEqual([]);
  });

  it("in bulk: one box for every row ticked — none of them emailed, each audited, each freed place still offered", async () => {
    const event = await createEvent(2);
    const radu = await registered(event, "Radu", 0, true);
    const ana = await registered(event, "Ana", 3, true);
    expect((await registered(event, "Elena", 6, false)).status).toBe("WAITLISTED");
    const result = await bulkCancelRegistrationsByStaff(db, admin, [radu.id, ana.id], "anulare de grup", at(10), { sendEmail: false });
    expect(result).toMatchObject({ cancelled: 2, failed: 0 });
    for (const name of ["Radu", "Ana"]) expect(await mailTo(name, "REGISTRATION_CANCELLED"), name).toEqual([]);
    for (const row of [radu, ana]) expect(await audited("registration.cancelled_by_staff", row.id)).toEqual([expect.objectContaining({ emailSkipped: true })]);
    expect(await mailTo("Elena", "WAITLIST_SPOT_OFFER")).toHaveLength(1);
  });
});

describe("«Trimite emailul» unticked on a race number given by hand (BR-REQ-038-01)", () => {
  it("writes and audits the number, and queues no «Numărul de concurs dat de mână»", async () => {
    const { radu } = await fullRace();
    await setBibNumberByStaff(db, admin, radu.id, 77, at(10), { sendEmail: false });
    expect((await rowOf("Radu")).bibNumber).toBe(77);
    expect(await mailTo("Radu", "BIB_ASSIGNED")).toEqual([]);
    expect(await audited("registration.bib_set", radu.id)).toEqual([expect.objectContaining({ to: 77, emailSkipped: true })]);
    // Ticked, the next number is emailed as ever.
    await setBibNumberByStaff(db, admin, radu.id, 78, at(11));
    expect(await mailTo("Radu", "BIB_ASSIGNED")).toHaveLength(1);
  });
});

describe("«Trimite invitația acum» unticked on «Echipa» (BR-REQ-060-01)", () => {
  it("adds the colleague and queues no invitation; one staff.invitation_not_sent row says so, by id and message, never an address", async () => {
    const member = await inviteStaffUser(db, admin, { email: "nou@example.ro", displayName: "Nou Coleg", role: "MODERATOR", preferredLocale: "ro" }, { sendEmail: false });
    expect(member).toMatchObject({ email: "nou@example.ro", role: "MODERATOR" });
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "nou@example.ro"))).toEqual([]);
    const trail = await audited("staff.invitation_not_sent", member.id);
    expect(trail).toEqual([{ staffUserId: member.id, messageType: "STAFF_INVITATION", emailSkipped: true }]);
    expect(JSON.stringify(trail)).not.toContain("example.ro");
  });

  it("ticked, invites as ever; members added in one press with the box unticked are written to nobody", async () => {
    await inviteStaffUser(db, admin, { email: "coleg@example.ro", displayName: "Coleg", role: "MODERATOR", preferredLocale: "ro" });
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "coleg@example.ro"))).map((row) => row.messageType)).toEqual(["STAFF_INVITATION"]);
    const { added } = await inviteMembers(db, admin, { rows: [{ email: "m1@example.ro", displayName: "Membru Unu" }, { email: "m2@example.ro", displayName: "Membru Doi" }], preferredLocale: "ro", sendEmail: false });
    expect(added).toHaveLength(2);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "MEMBER_INVITATION"))).toEqual([]);
  });
});
