import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied, SUPPLEMENTARY_PLACE_UNCONFIRMED } from "@/modules/registrations/domain/capacity";
import { InvitationRefusal } from "@/modules/registrations/domain/invitations";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — invitations by email (the owner, 2026-10-02: «vreau să trimit „invitații speciale” pe email
 * pentru membrii BVR, un fel de adaugă manual» — «Dar vreau și pentru non-membrii»):
 *
 * - a send holds one counted place per invitation from the send to its deadline (`countOccupied`'s
 *   `invitationHolds`, BR-REQ-034-01), «În afara locurilor» none; on a full race one supplementary
 *   place per invitation that needs it, only on the press that named the capacity (§642);
 * - the link (BR-REQ-036-02): minted at the send, hashed at rest, the GET only reads, the press spends
 *   it once and seats the registration in the invitation's place with no gap, the address proved;
 * - expiry, «Retrimite» (a new link supersedes the old, §619) and «Retrage»; the Organizer changes
 *   nothing (§289, BR-REQ-037-07); the retention erases an ended invitation (BR-REQ-053-01's notice).
 *
 * The two-connection race — two Administrators inviting onto the last place — is
 * `tests/concurrency/capacity.test.ts`.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const STARTS = new Date("2026-10-11T07:00:00.000Z");
const DAY = 24 * 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;
let member: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { submitRegistration, confirmEmail, inviteToEventByStaff, readPublicPlaces, signDeclaration, withdrawInvitationByStaff, resendInvitationByStaff } = await import(
  "@/modules/registrations/service"
);
const { inviteToEvent } = await import("@/modules/registrations/admin-service");
const { acceptInvitation, readInvitationLink } = await import("@/modules/registrations/invitations");
const { countOccupied, findEventsNeedingMaintenance } = await import("@/modules/registrations/repository");
const { countPendingInvitations } = await import("@/modules/registrations/invitation-repository");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { pruneExpiredRows } = await import("@/modules/jobs/retention");
const { nextMaintenanceWork } = await import("@/modules/jobs/next-work");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
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
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.invalid", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.invalid", displayName: "Organizer", role: "MODERATOR" }).returning();
  [member] = await db.insert(staffUsers).values({ email: "dana@example.invalid", displayName: "Dana Membru", role: "MEMBER", preferredLocale: "en" }).returning();
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

async function createEvent(capacity: number | null, options: { auto?: boolean; closesAt?: Date | null; status?: "SCHEDULED" | "CANCELLED" } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity,
      registrationClosesAt: options.closesAt ?? null,
      waitlistAutoOffer: options.auto ?? false,
      eventStatus: options.status ?? "SCHEDULED",
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: event.registrationClosesAt, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

/** What the invitation's form posts: everything but the address, which is the invitation's. */
const form = (firstName: string, sentAt: Date) => ({
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
  // A posted address is never read: the invitation's is used.
  email: "someone-else@example.invalid",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 1_000).toISOString(),
});

async function registered(event: EventInput, name: string, minute: number) {
  await submitRegistration(db, event, { ...form(name, at(minute)), email: `${name.toLowerCase()}@example.invalid` }, at(minute), "REAL", PUBLIC);
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return confirmEmail(db, event, row.id, at(minute));
}

const invitationsOf = (eventId: string) => db.select().from(eventInvitations).where(eq(eventInvitations.eventId, eventId));
const occupied = async (eventId: string, when: Date) => computeOccupied(await countOccupied(db, eventId, when));
const invitationEmails = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION"));
const capacityOf = async (eventId: string) => (await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)))[0].capacity;
const refusalOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

/** Render the newest invitation email as the drain would, and return the secret its link carries. */
async function linkOf(email: string, when: Date): Promise<string> {
  const rows = (await invitationEmails()).filter((row) => row.recipientEmail === email).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const message = await renderOutboxMessage({ ...rows[0], status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /\/(?:inregistrari\/invitatie|registrations\/invitation)\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error("no invitation link in the message");
  return match[1];
}

describe("§NNN BR-REQ-034-01 a send holds one counted place per invitation, until its deadline", () => {
  it("counts the invitation in the occupied places and the public line from the send, and names it in the editor's count", async () => {
    const event = await createEvent(3);
    const sent = await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "Ana.Pop@Example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    expect(sent).toMatchObject({ sent: 1, capacityRaisedTo: null });
    expect(sent.deadline).toEqual(new Date(NOW.getTime() + 7 * DAY));
    const [invitation] = await invitationsOf(event.id);
    expect(invitation).toMatchObject({ name: "Ana Pop", canonicalEmail: "ana.pop@example.invalid", outsideCapacity: false, supplementaryRaise: false, locale: "ro" });
    expect((await countOccupied(db, event.id, at(1))).invitationHolds).toBe(1);
    expect(await occupied(event.id, at(1))).toBe(1);
    expect(await readPublicPlaces(db, { id: event.id, capacity: 3, waitlistCapacity: null }, at(1))).toMatchObject({ occupied: 1, availablePlaces: 2 });
    expect(await countPendingInvitations(db, event.id, at(1))).toBe(1);
    // The email, by the invitation's id alone — never a name or an address in the payload (§12.12).
    const [email] = await invitationEmails();
    expect(email.payloadJson).toEqual({ invitationId: invitation.id });
    expect(email.registrationId).toBeNull();
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_sent"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityId: event.id });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("Ana");
  });

  it("a member picked from the members' zone is read from the account: name, address and language", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "", email: "", memberStaffUserId: member.id }], days: 7, outsideCapacity: false }, admin, NOW);
    const [invitation] = await invitationsOf(event.id);
    expect(invitation).toMatchObject({ name: "Dana Membru", email: "dana@example.invalid", locale: "en", memberStaffUserId: member.id });
  });

  it("the deadline is never past the registration close", async () => {
    const event = await createEvent(3, { closesAt: at(60 * 24 * 2) });
    expect((await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW)).deadline).toEqual(at(60 * 24 * 2));
  });

  it("«În afara locurilor» holds no counted place and needs none on a full race", async () => {
    const event = await createEvent(1);
    await registered(event, "Ioana", 0);
    const sent = await inviteToEventByStaff(db, event, { people: [{ name: "Pace Maker", email: "pace@example.invalid" }], days: 7, outsideCapacity: true }, admin, NOW);
    expect(sent.capacityRaisedTo).toBeNull();
    expect((await countOccupied(db, event.id, at(1))).invitationHolds).toBe(0);
    expect(await capacityOf(event.id)).toBe(1);
  });
});

describe("§NNN §642 on a full race: one supplementary place per invitation, only when the press named the capacity", () => {
  it("refuses an unconfirmed or a wrongly named raise, writing nothing, and adds exactly the places named", async () => {
    const event = await createEvent(1);
    await registered(event, "Ioana", 0);
    const people = [
      { name: "Ana Pop", email: "ana@example.invalid" },
      { name: "Bogdan Pop", email: "bogdan@example.invalid" },
    ];
    for (const addPlaceTo of [undefined, 2, 4]) {
      const refused = await refusalOf(inviteToEventByStaff(db, event, { people, days: 7, outsideCapacity: false, addPlaceTo }, admin, NOW));
      expect(isDomainError(refused) && refused.fields).toEqual([SUPPLEMENTARY_PLACE_UNCONFIRMED]);
    }
    expect(await invitationsOf(event.id)).toHaveLength(0);
    expect(await invitationEmails()).toHaveLength(0);
    expect(await capacityOf(event.id)).toBe(1);

    const sent = await inviteToEventByStaff(db, event, { people, days: 7, outsideCapacity: false, addPlaceTo: 3 }, admin, NOW);
    expect(sent.capacityRaisedTo).toBe(3);
    expect(await capacityOf(event.id)).toBe(3);
    expect((await invitationsOf(event.id)).every((row) => row.supplementaryRaise)).toBe(true);
    const raised = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.capacity_raised_for_invitation"));
    expect(raised.map((row) => row.metadataJson)).toEqual([expect.objectContaining({ from: 1, to: 2 }), expect.objectContaining({ from: 2, to: 3 })]);
    // Never overbooked: the count is the capacity, every place held by somebody named.
    expect(await occupied(event.id, at(1))).toBe(3);
  });

  it("a place still free is used first: two invitations on one free place add one", async () => {
    const event = await createEvent(2);
    await registered(event, "Ioana", 0);
    const sent = await inviteToEventByStaff(
      db,
      event,
      { people: [{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Bogdan Pop", email: "bogdan@example.invalid" }], days: 7, outsideCapacity: false, addPlaceTo: 3 },
      admin,
      NOW,
    );
    expect(sent.capacityRaisedTo).toBe(3);
    expect((await invitationsOf(event.id)).filter((row) => row.supplementaryRaise)).toHaveLength(1);
  });
});

describe("§NNN the send refuses, naming the person, and writes nothing", () => {
  const refusal = async (promise: Promise<unknown>) => {
    const error = await refusalOf(promise);
    expect(error).toBeInstanceOf(InvitationRefusal);
    return error as InvitationRefusal;
  };

  it("somebody registered already, somebody invited already, a line twice, a bad address", async () => {
    const event = await createEvent(5);
    await registered(event, "Ioana", 0);
    const send = (people: { name: string; email: string }[]) => inviteToEventByStaff(db, event, { people, days: 7, outsideCapacity: false }, admin, at(1));
    expect(await refusal(send([{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Ioana M", email: "IOANA@example.invalid" }]))).toMatchObject({
      refusal: "INVITATION_ALREADY_REGISTERED",
      person: "Ioana M",
    });
    expect(await refusal(send([{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Ana Again", email: "ana@example.invalid" }]))).toMatchObject({ refusal: "INVITATION_DUPLICATE" });
    expect(await refusal(send([{ name: "Ana Pop", email: "not an address" }]))).toMatchObject({ refusal: "INVITATION_BAD_ADDRESS", person: "Ana Pop" });
    expect(await refusal(inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 0, outsideCapacity: false }, admin, at(1)))).toMatchObject({
      refusal: "INVITATION_BAD_DAYS",
    });
    expect(await invitationsOf(event.id)).toHaveLength(0);
    await send([{ name: "Ana Pop", email: "ana@example.invalid" }]);
    expect(await refusal(send([{ name: "Ana", email: "ana@example.invalid" }]))).toMatchObject({ refusal: "INVITATION_ALREADY_INVITED", person: "Ana" });
    expect(await invitationsOf(event.id)).toHaveLength(1);
  });

  it("a cancelled event, an event whose registration closed, and the Organizer", async () => {
    const cancelled = await createEvent(5, { status: "CANCELLED" });
    expect(await refusal(inviteToEventByStaff(db, cancelled, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW))).toMatchObject({
      refusal: "INVITATION_EVENT_CLOSED",
    });
    const closed = await createEvent(5, { closesAt: at(-1) });
    expect(await refusal(inviteToEventByStaff(db, closed, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW))).toMatchObject({
      refusal: "INVITATION_EVENT_CLOSED",
    });
    const forbidden = await refusalOf(inviteToEvent(db, organizer, closed.id, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, NOW));
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");
  });
});

describe("§NNN BR-REQ-036-02 the link: the GET reads, the press spends it once and seats the registration in the invitation's place", () => {
  it("accepts: the address proved, the place moved from the invitation to the declaration hold with no gap, the declaration's email", async () => {
    const event = await createEvent(2, { auto: true });
    await registered(event, "Ioana", 0);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, at(1));
    // The race is now full, and somebody waits: the invitation's place is not theirs.
    expect((await registered(event, "Elena", 2)).status).toBe("WAITLISTED");
    expect(await occupied(event.id, at(3))).toBe(2);

    const secret = await linkOf("ana@example.invalid", at(4));
    // The GET reads, and changes nothing: the token is still unspent.
    const page = await readInvitationLink(db, secret, "ro", at(5));
    expect(page).toMatchObject({ kind: "open", name: "Ana Pop", email: "ana@example.invalid", member: false, eventTitle: "Crosul" });
    expect((await db.select().from(emailActionTokens).where(isNull(emailActionTokens.usedAt))).some((token) => token.purpose === "ACCEPT_INVITATION")).toBe(true);
    // Hashed at rest: the secret is nowhere in the table.
    expect(JSON.stringify(await db.select().from(emailActionTokens))).not.toContain(secret);

    const accepted = await acceptInvitation(db, secret, form("Ana", at(6)), at(6));
    expect(accepted.ok).toBe(true);
    const registration = accepted.ok ? accepted.registration : null;
    expect(registration).toMatchObject({ status: "PENDING_DECLARATION", registeredName: "Ana Munteanu", outsideCapacity: false });
    // The address is the invitation's, proved by the link: no verification email, ever.
    const [participant] = await db.select().from(participants).where(eq(participants.id, registration!.participantId));
    expect(participant.canonicalEmail).toBe("ana@example.invalid");
    expect(participant.emailVerifiedAt).toEqual(at(6));
    const mail = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registration!.id));
    expect(mail.map((row) => row.messageType)).toEqual(["COMPLETE_DECLARATION"]);
    // The invitation is accepted, and the place moved: two occupied before, two after, nobody offered.
    const [invitation] = await invitationsOf(event.id);
    expect(invitation).toMatchObject({ acceptedAt: at(6), acceptedRegistrationId: registration!.id });
    // Ioana's hold and Ana's now: the invitation's bucket empty.
    expect(await countOccupied(db, event.id, at(6))).toMatchObject({ invitationHolds: 0, pendingDeclarationHolds: 2, confirmed: 0 });
    expect(await occupied(event.id, at(6))).toBe(2);
    expect((await db.select().from(registrations).where(eq(registrations.status, "WAITLIST_OFFERED")))).toHaveLength(0);

    // Single use: the same link again finds it spent, and the page says so.
    expect(await acceptInvitation(db, secret, form("Ana", at(7)), at(7))).toEqual({ ok: false, kind: "used" });
    expect(await readInvitationLink(db, secret, "ro", at(7))).toEqual({ kind: "used" });
    // The declaration is the person's to sign, as anybody's.
    const signed = await signDeclaration(db, event, registration!.id, await signingInput(db, at(8), "Ana Munteanu"), at(8));
    expect(signed.status).toBe("CONFIRMED");
  });

  it("a refused form takes the spend back: the same link still works", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, at(1));
    const secret = await linkOf("ana@example.invalid", at(2));
    const refused = await refusalOf(acceptInvitation(db, secret, { ...form("Ana", at(3)), termsAccepted: false }, at(3)));
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    expect(await readInvitationLink(db, secret, "ro", at(4))).toMatchObject({ kind: "open" });
    expect((await acceptInvitation(db, secret, form("Ana", at(5)), at(5))).ok).toBe(true);
  });

  it("an invitation «În afara locurilor» seats its registration outside the places", async () => {
    const event = await createEvent(1);
    await registered(event, "Ioana", 0);
    await inviteToEventByStaff(db, event, { people: [{ name: "Pace Maker", email: "pace@example.invalid" }], days: 7, outsideCapacity: true }, admin, at(1));
    const accepted = await acceptInvitation(db, await linkOf("pace@example.invalid", at(2)), form("Pace", at(3)), at(3));
    expect(accepted.ok && accepted.registration).toMatchObject({ status: "PENDING_DECLARATION", outsideCapacity: true });
    expect(await occupied(event.id, at(3))).toBe(1);
  });
});

describe("§NNN expiry, «Retrimite» and «Retrage»", () => {
  it("past its deadline the place is free; the sweep stamps it, offers the place to the line, and the link says expired", async () => {
    const event = await createEvent(1, { auto: true });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 1, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const secret = await linkOf("ana@example.invalid", at(2));
    const after = new Date(NOW.getTime() + DAY + 60_000);
    // The job is told the deadline (§334), and finds the event once it passed.
    expect(await nextMaintenanceWork(db, at(3))).toEqual(new Date(NOW.getTime() + DAY));
    expect((await countOccupied(db, event.id, after)).invitationHolds).toBe(0);
    expect(await findEventsNeedingMaintenance(db, after)).toContain(event.id);
    await runRegistrationMaintenance(db, after);
    const [invitation] = await invitationsOf(event.id);
    expect(invitation.expiredAt).toEqual(after);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLIST_OFFERED");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_expired"))).toHaveLength(1);
    expect(await readInvitationLink(db, secret, "ro", after)).toMatchObject({ kind: "expired" });
    expect(await acceptInvitation(db, secret, form("Ana", after), after)).toEqual({ ok: false, kind: "expired" });
  });

  it("«Retrimite»: a new link supersedes the old one (§619), the deadline moves later, never earlier", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const first = await linkOf("ana@example.invalid", at(1));
    const [before] = await invitationsOf(event.id);
    expect((await resendInvitationByStaff(db, before.id, { days: 2 }, admin, at(2))).expiresAt).toEqual(before.expiresAt);
    const moved = await resendInvitationByStaff(db, before.id, { days: 10 }, admin, at(3));
    expect(moved.expiresAt).toEqual(new Date(at(3).getTime() + 10 * DAY));
    const second = await linkOf("ana@example.invalid", at(4));
    expect(second).not.toBe(first);
    expect(await readInvitationLink(db, first, "ro", at(5))).toEqual({ kind: "replaced" });
    expect(await readInvitationLink(db, second, "ro", at(5))).toMatchObject({ kind: "open" });
    const [after] = await invitationsOf(event.id);
    expect(after.resendCount).toBe(2);
    const forbidden = await refusalOf(resendInvitationByStaff(db, before.id, { days: null }, organizer, at(6)));
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");
  });

  it("«Retrage»: the place goes back to the line at once, the link says withdrawn and accepts nothing", async () => {
    const event = await createEvent(1, { auto: true });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const secret = await linkOf("ana@example.invalid", at(2));
    const [invitation] = await invitationsOf(event.id);
    const forbidden = await refusalOf(withdrawInvitationByStaff(db, invitation.id, organizer, at(3)));
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");
    await withdrawInvitationByStaff(db, invitation.id, admin, at(3));
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLIST_OFFERED");
    expect(await readInvitationLink(db, secret, "ro", at(4))).toMatchObject({ kind: "withdrawn" });
    expect(await acceptInvitation(db, secret, form("Ana", at(5)), at(5))).toEqual({ ok: false, kind: "withdrawn" });
    const again = await refusalOf(withdrawInvitationByStaff(db, invitation.id, admin, at(6)));
    expect(again).toBeInstanceOf(InvitationRefusal);
  });

  it("the retention erases an invitation thirty days after it ended, and the address with it", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 1, outsideCapacity: false }, admin, NOW);
    const [invitation] = await invitationsOf(event.id);
    await pruneExpiredRows(db, new Date(NOW.getTime() + 20 * DAY));
    expect(await invitationsOf(event.id)).toHaveLength(1);
    const result = await pruneExpiredRows(db, new Date(NOW.getTime() + 32 * DAY));
    expect(result.invitations).toBe(1);
    expect(await invitationsOf(event.id)).toHaveLength(0);
    expect(await db.select().from(participants).where(eq(participants.id, invitation.participantId))).toHaveLength(0);
    expect(await db.select().from(emailActionTokens).where(and(eq(emailActionTokens.purpose, "ACCEPT_INVITATION")))).toHaveLength(0);
  });
});
