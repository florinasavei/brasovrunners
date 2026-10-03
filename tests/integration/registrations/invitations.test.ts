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
 * - a registration of the invited address made another way takes the invitation's place over when it
 *   gets its place (the invitations review of 2026-10-02), and a typed address the club knows keeps its
 *   participant's name and language;
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

const { submitRegistration, confirmEmail, givePlaceNowByStaff, inviteToEventByStaff, readPublicPlaces, signDeclaration, withdrawInvitationByStaff, resendInvitationByStaff } = await import(
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

async function createEvent(
  capacity: number | null,
  options: { auto?: boolean; closesAt?: Date | null; status?: "SCHEDULED" | "CANCELLED"; startsAt?: Date } = {},
): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
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

  it("the deadline is capped by the start, never by the registration close", async () => {
    const event = await createEvent(3, { closesAt: at(60 * 24 * 2) });
    expect((await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW)).deadline).toEqual(at(60 * 24 * 7));
    const soon = await createEvent(3, { startsAt: at(60 * 24 * 3) });
    expect((await inviteToEventByStaff(db, soon, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW)).deadline).toEqual(at(60 * 24 * 3));
  });

  it("after the registration close the club still invites, and the accepted registration's hold is capped by the start alone", async () => {
    // Three days before the start, inside the participation window: a public hold would be capped by the close, already past.
    const startsAt = new Date(STARTS.getTime());
    const sendAt = new Date(startsAt.getTime() - 3 * DAY);
    const event = await createEvent(3, { closesAt: new Date(sendAt.getTime() - 3_600_000), startsAt });
    const sent = await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, sendAt);
    expect(sent.deadline).toEqual(startsAt);
    const pressAt = new Date(sendAt.getTime() + 5 * 60_000);
    const accepted = await acceptInvitation(db, await linkOf("ana@example.invalid", pressAt), form("Ana", pressAt), pressAt);
    const registration = accepted.ok ? accepted.registration : null;
    expect(registration?.status).toBe("PENDING_DECLARATION");
    expect(registration!.holdExpiresAt!.getTime()).toBeGreaterThan(pressAt.getTime());
    expect(registration!.holdExpiresAt!.getTime()).toBeLessThanOrEqual(startsAt.getTime());
  });

  it("a typed address the club has never seen is written to in the language chosen («Limba invitației»)", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "John Guest", email: "john@example.invalid" }], days: 7, outsideCapacity: false, locale: "en" }, admin, NOW);
    const [invitation] = await invitationsOf(event.id);
    expect(invitation.locale).toBe("en");
    const [email] = await invitationEmails();
    expect(email.locale).toBe("en");
    const [participant] = await db.select().from(participants).where(eq(participants.id, invitation.participantId));
    expect(participant).toMatchObject({ preferredLocale: "en", defaultName: "John Guest" });
  });

  it("a typed address the club already knows is written to in its participant's language, and its stored name and language are left as they are", async () => {
    const other = await createEvent(5);
    await submitRegistration(db, other, { ...form("Ana", NOW), email: "ana@example.invalid", locale: "en" }, NOW, "REAL", PUBLIC);
    const [before] = await db.select().from(participants).where(eq(participants.canonicalEmail, "ana@example.invalid"));
    expect(before).toMatchObject({ preferredLocale: "en", emailVerifiedAt: null });

    const event = await createEvent(3);
    // The Administrator's choice of language is for addresses never seen: this one says its own.
    await inviteToEventByStaff(db, event, { people: [{ name: "A. Pop (invitată)", email: "ana@example.invalid" }], days: 7, outsideCapacity: false, locale: "ro" }, admin, at(1));
    const [invitation] = await invitationsOf(event.id);
    expect(invitation).toMatchObject({ locale: "en", participantId: before.id, name: "A. Pop (invitată)" });
    const [email] = await invitationEmails();
    expect(email.locale).toBe("en");
    const [after] = await db.select().from(participants).where(eq(participants.id, before.id));
    expect(after).toMatchObject({ defaultName: before.defaultName, preferredLocale: "en" });
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

describe("§NNN AGENTS.md §15.11 a free place somebody waits for is never an invitation's, offers on or off, before or after the close", () => {
  const bogdan = [{ name: "Bogdan Pop", email: "bogdan@example.invalid" }];

  /** A free place with Elena waiting for it: Ana's invitation held the only one, Elena queued behind it, and «Retrage» freed it. */
  async function freePlaceWithAWaiter(event: EventInput, withdrawAt: Date) {
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const [ana] = await invitationsOf(event.id);
    await withdrawInvitationByStaff(db, ana.id, admin, withdrawAt);
    expect(await occupied(event.id, withdrawAt)).toBe(0);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLISTED");
  }

  async function expectRaisedPastTheWaiter(event: EventInput, when: Date) {
    // The place is Elena's: the plain press is refused and writes nothing.
    const refused = await refusalOf(inviteToEventByStaff(db, event, { people: bogdan, days: 7, outsideCapacity: false }, admin, when));
    expect(isDomainError(refused) && refused.fields).toEqual([SUPPLEMENTARY_PLACE_UNCONFIRMED]);
    expect((await invitationsOf(event.id)).filter((row) => row.canonicalEmail === "bogdan@example.invalid")).toHaveLength(0);
    expect(await capacityOf(event.id)).toBe(1);

    // The press that named «capacitatea devine 2» invites Bogdan on a supplementary place; Elena's stays free for her.
    const sent = await inviteToEventByStaff(db, event, { people: bogdan, days: 7, outsideCapacity: false, addPlaceTo: 2 }, admin, when);
    expect(sent.capacityRaisedTo).toBe(2);
    const [invitation] = (await invitationsOf(event.id)).filter((row) => row.canonicalEmail === "bogdan@example.invalid");
    expect(invitation.supplementaryRaise).toBe(true);
    expect(await occupied(event.id, when)).toBe(1);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLISTED");
    expect(await readPublicPlaces(db, { id: event.id, capacity: 2, waitlistCapacity: null }, when)).toMatchObject({ availablePlaces: 0 });
  }

  it("automatic offers off («Nu», §615): the send adds a supplementary place rather than take the waiting row's", async () => {
    const event = await createEvent(1, { auto: false });
    await freePlaceWithAWaiter(event, at(2));
    await expectRaisedPastTheWaiter(event, at(3));
  });

  it("after the registration close, offers on: nothing offered the place on the way, and it is still not the invitation's", async () => {
    const closesAt = at(60);
    const event = await createEvent(1, { auto: true, closesAt });
    const later = new Date(closesAt.getTime() + 60_000);
    await freePlaceWithAWaiter(event, later);
    await expectRaisedPastTheWaiter(event, new Date(later.getTime() + 60_000));
  });

  it("nobody waiting: a free place is the invitation's, offers off and after the close alike, with no raise", async () => {
    const off = await createEvent(1, { auto: false });
    expect(await inviteToEventByStaff(db, off, { people: bogdan, days: 7, outsideCapacity: false }, admin, NOW)).toMatchObject({ sent: 1, capacityRaisedTo: null });
    const closed = await createEvent(1, { auto: true, closesAt: at(-60) });
    expect(await inviteToEventByStaff(db, closed, { people: bogdan, days: 7, outsideCapacity: false }, admin, NOW)).toMatchObject({ sent: 1, capacityRaisedTo: null });
    expect((await invitationsOf(closed.id))[0].supplementaryRaise).toBe(false);
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

  it("a cancelled event and a started one are refused, an event whose registration closed is not, and the Organizer is", async () => {
    const cancelled = await createEvent(5, { status: "CANCELLED" });
    expect(await refusal(inviteToEventByStaff(db, cancelled, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW))).toMatchObject({
      refusal: "INVITATION_EVENT_CLOSED",
    });
    const started = await createEvent(5, { startsAt: at(-1) });
    expect(await refusal(inviteToEventByStaff(db, started, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW))).toMatchObject({
      refusal: "INVITATION_EVENT_CLOSED",
    });
    // Organizers, pacemakers and volunteers are invited late (§642's «Trimite-i oferta» works after the close too).
    const closed = await createEvent(5, { closesAt: at(-1) });
    expect((await inviteToEventByStaff(db, closed, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW)).sent).toBe(1);
    const forbidden = await refusalOf(inviteToEvent(db, organizer, closed.id, { people: [{ name: "Ioana M", email: "ioana@example.invalid" }], days: 7, outsideCapacity: false }, NOW));
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
    // Audited by the ids alone, with no actor (the person, from the link) and never the name or the address.
    const [acceptedAudit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_accepted"));
    expect(acceptedAudit).toMatchObject({ actorStaffUserId: null, participantId: null, entityId: event.id, metadataJson: { invitationId: invitation.id, registrationId: registration!.id } });
    expect(JSON.stringify(acceptedAudit.metadataJson)).not.toMatch(/Ana|ana@/);

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

  it("a member picked from the members' zone: the page presets «Sunt membru», and the press registers a club member whatever is posted", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "", email: "", memberStaffUserId: member.id }], days: 7, outsideCapacity: false }, admin, at(1));
    const secret = await linkOf("dana@example.invalid", at(2));
    expect(await readInvitationLink(db, secret, "en", at(3))).toMatchObject({ kind: "open", member: true, name: "Dana Membru" });
    // The box unticked, as a no-JS draft or a slip would post it: the club named the account.
    const accepted = await acceptInvitation(db, secret, { ...form("Dana", at(4)), clubMemberDeclared: false }, at(4));
    expect(accepted.ok && accepted.registration).toMatchObject({ status: "PENDING_DECLARATION", clubMemberDeclared: true });
  });

  it("anybody typed answers «Sunt membru» themselves: an unticked box stays unticked", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, at(1));
    const secret = await linkOf("ana@example.invalid", at(2));
    expect(await readInvitationLink(db, secret, "ro", at(3))).toMatchObject({ kind: "open", member: false });
    const accepted = await acceptInvitation(db, secret, { ...form("Ana", at(4)), clubMemberDeclared: false }, at(4));
    expect(accepted.ok && accepted.registration).toMatchObject({ clubMemberDeclared: false });
  });
});

describe("§NNN the invited address registered by another route takes the invitation's place over", () => {
  /** The public form for the invited address itself, as anybody might fill it in. */
  async function viaPublicForm(event: EventInput, minute: number) {
    await submitRegistration(db, event, { ...form("Ana", at(minute)), email: "ana@example.invalid" }, at(minute), "REAL", PUBLIC);
    const [row] = await db.select().from(registrations).where(and(eq(registrations.eventId, event.id), eq(registrations.registeredName, "Ana Munteanu")));
    return row;
  }

  it("the public form and its confirmation: seated in the invitation's place on a full race, never behind it; the link then says used", async () => {
    const event = await createEvent(1, { auto: true });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 30, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const secret = await linkOf("ana@example.invalid", at(2));
    const pending = await viaPublicForm(event, 3);
    expect(pending.status).toBe("PENDING_EMAIL_CONFIRMATION");
    // Typing the address takes nothing over: the invitation still holds the place until the inbox answers.
    expect((await countOccupied(db, event.id, at(4))).invitationHolds).toBe(1);

    const confirmed = await confirmEmail(db, event, pending.id, at(5));
    expect(confirmed.status).toBe("PENDING_DECLARATION");
    const [invitation] = await invitationsOf(event.id);
    expect(invitation).toMatchObject({ acceptedAt: at(5), acceptedRegistrationId: pending.id });
    // The place moved, with no instant free: one occupied before and after, Elena still waiting, nobody offered.
    expect(await countOccupied(db, event.id, at(5))).toMatchObject({ invitationHolds: 0, pendingDeclarationHolds: 1 });
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLISTED");
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_accepted"));
    expect(audit).toMatchObject({ actorStaffUserId: null, metadataJson: { invitationId: invitation.id, registrationId: pending.id, adopted: true } });
    expect(await readInvitationLink(db, secret, "ro", at(6))).toMatchObject({ kind: "accepted" });
    expect(await acceptInvitation(db, secret, form("Ana", at(7)), at(7))).toEqual({ ok: false, kind: "accepted" });
  });

  it("an invitation on the hidden list taken over seats the registration outside the places", async () => {
    const event = await createEvent(1);
    await registered(event, "Ioana", 0);
    await inviteToEventByStaff(db, event, { people: [{ name: "Pace Maker", email: "ana@example.invalid" }], days: 7, outsideCapacity: true }, admin, at(1));
    const pending = await viaPublicForm(event, 2);
    expect(await confirmEmail(db, event, pending.id, at(3))).toMatchObject({ status: "PENDING_DECLARATION", outsideCapacity: true });
    expect(await occupied(event.id, at(3))).toBe(1);
  });

  it("a place that was free anyway: the registration takes the invitation's, and the one left free is the line's", async () => {
    const event = await createEvent(2);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const pending = await viaPublicForm(event, 1);
    await confirmEmail(db, event, pending.id, at(2));
    expect(await countOccupied(db, event.id, at(2))).toMatchObject({ invitationHolds: 0, pendingDeclarationHolds: 1 });
    expect(await occupied(event.id, at(2))).toBe(1);
  });

  it("«Dă-i un loc acum» on the invited address uses the invitation's place: no supplementary place asked or added", async () => {
    const event = await createEvent(1);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const pending = await viaPublicForm(event, 1);
    const placed = await givePlaceNowByStaff(db, event, pending.id, admin, at(2));
    expect(placed).toMatchObject({ status: "PENDING_DECLARATION", capacityRaisedTo: null });
    expect(await capacityOf(event.id)).toBe(1);
    const [invitation] = await invitationsOf(event.id);
    expect(invitation.acceptedRegistrationId).toBe(pending.id);
    expect(await occupied(event.id, at(2))).toBe(1);
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

  it("past its deadline on an event that offers by hand («Nu»): the place is free and nobody is offered", async () => {
    const event = await createEvent(1, { auto: false });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 1, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const after = new Date(NOW.getTime() + DAY + 60_000);
    await runRegistrationMaintenance(db, after);
    const [invitation] = await invitationsOf(event.id);
    expect(invitation.expiredAt).toEqual(after);
    expect(await occupied(event.id, after)).toBe(0);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLISTED");
    expect(await db.select().from(registrations).where(eq(registrations.status, "WAITLIST_OFFERED"))).toHaveLength(0);
  });

  it("«Retrage» on an event that offers by hand («Nu»): the place is free and nobody is offered", async () => {
    const event = await createEvent(1, { auto: false });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const [invitation] = await invitationsOf(event.id);
    await withdrawInvitationByStaff(db, invitation.id, admin, at(2));
    expect(await occupied(event.id, at(2))).toBe(0);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLISTED");
  });

  it("«Retrimite» with the box empty keeps the deadline", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false }, admin, NOW);
    const [before] = await invitationsOf(event.id);
    expect((await resendInvitationByStaff(db, before.id, { days: null }, admin, at(60 * 24 * 2))).expiresAt).toEqual(before.expiresAt);
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

  /** Whether the link's token is still unspent: a refused press never spends it (the invitations review of 2026-10-03). */
  const unspent = async () => (await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "ACCEPT_INVITATION"))).every((token) => token.usedAt === null);

  it("a press after «Retrage» spends nothing: refused as withdrawn, and the link's page then says withdrawn, never «used»", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    // The person opened the form; the Administrator withdrew the invitation before the press.
    const secret = await linkOf("ana@example.invalid", at(1));
    expect(await readInvitationLink(db, secret, "ro", at(2))).toMatchObject({ kind: "open" });
    const [invitation] = await invitationsOf(event.id);
    await withdrawInvitationByStaff(db, invitation.id, admin, at(3));
    expect(await acceptInvitation(db, secret, form("Ana", at(4)), at(4))).toEqual({ ok: false, kind: "withdrawn" });
    expect(await unspent()).toBe(true);
    expect(await readInvitationLink(db, secret, "ro", at(5))).toMatchObject({ kind: "withdrawn" });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("a press past the deadline, before the sweep, spends nothing: refused as expired, and the page then says expired", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 1, outsideCapacity: false }, admin, NOW);
    const secret = await linkOf("ana@example.invalid", at(1));
    const after = new Date(NOW.getTime() + DAY + 60_000);
    expect(await acceptInvitation(db, secret, form("Ana", after), after)).toEqual({ ok: false, kind: "expired" });
    expect(await unspent()).toBe(true);
    expect(await readInvitationLink(db, secret, "ro", after)).toMatchObject({ kind: "expired" });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("a press after the event was called off spends nothing: refused as cancelled, never as a passed deadline, and the page then says cancelled", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const secret = await linkOf("ana@example.invalid", at(1));
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    expect(await acceptInvitation(db, secret, form("Ana", at(2)), at(2))).toEqual({ ok: false, kind: "cancelled" });
    expect(await unspent()).toBe(true);
    expect(await readInvitationLink(db, secret, "ro", at(3))).toMatchObject({ kind: "cancelled" });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("the link's page of an event called off says cancelled, while the deadline is still ahead", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const secret = await linkOf("ana@example.invalid", at(1));
    const [invitation] = await invitationsOf(event.id);
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(at(3).getTime());
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    expect(await readInvitationLink(db, secret, "en", at(3))).toMatchObject({ kind: "cancelled" });
    expect(await unspent()).toBe(true);
  });

  it("a press after the race started spends nothing: refused as expired", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const secret = await linkOf("ana@example.invalid", at(1));
    // The start moved earlier after the send: the invitation's own deadline is still ahead, so only the start refuses it.
    await db.update(events).set({ startsAt: new Date(NOW.getTime() + DAY) }).where(eq(events.id, event.id));
    const after = new Date(NOW.getTime() + DAY + 60_000);
    const [invitation] = await invitationsOf(event.id);
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(after.getTime());
    expect(await acceptInvitation(db, secret, form("Ana", after), after)).toEqual({ ok: false, kind: "expired" });
    expect(await unspent()).toBe(true);
    expect(await readInvitationLink(db, secret, "ro", after)).toMatchObject({ kind: "expired" });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("an event marked «Încheiat» (COMPLETED) with its start still ahead is no call-off: the link and the press say expired, never cancelled", async () => {
    const event = await createEvent(3);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    const secret = await linkOf("ana@example.invalid", at(1));
    await db.update(events).set({ eventStatus: "COMPLETED" }).where(eq(events.id, event.id));
    expect(await readInvitationLink(db, secret, "ro", at(2))).toMatchObject({ kind: "expired" });
    expect(await acceptInvitation(db, secret, form("Ana", at(3)), at(3))).toEqual({ ok: false, kind: "expired" });
    expect(await unspent()).toBe(true);
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("«Retrimite» with days on a counted invitation while somebody waits: the link and the email again, the deadline kept", async () => {
    const event = await createEvent(1, { auto: true });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false }, admin, NOW);
    // Elena queued behind the invitation's place, and its deadline.
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    const first = await linkOf("ana@example.invalid", at(2));
    const [before] = await invitationsOf(event.id);
    const resent = await resendInvitationByStaff(db, before.id, { days: 10 }, admin, at(3));
    expect(resent).toEqual({ expiresAt: before.expiresAt, kept: "waiting" });
    const [after] = await invitationsOf(event.id);
    expect(after).toMatchObject({ expiresAt: before.expiresAt, resendCount: 1, lastSentAt: at(3) });
    // The new link and the email all the same; the old link is superseded.
    expect(await invitationEmails()).toHaveLength(2);
    const second = await linkOf("ana@example.invalid", at(4));
    expect(second).not.toBe(first);
    expect(await readInvitationLink(db, first, "ro", at(5))).toEqual({ kind: "replaced" });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_resent"));
    expect(audit.metadataJson).toMatchObject({ from: before.expiresAt.toISOString(), to: before.expiresAt.toISOString(), keptForWaiting: true });
    // At the deadline the place is Elena's, as she queued for.
    const deadline = new Date(before.expiresAt.getTime() + 60_000);
    await runRegistrationMaintenance(db, deadline);
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLIST_OFFERED");
  });

  it("«Retrimite» with days on a counted invitation and nobody waiting: the deadline moves later", async () => {
    const event = await createEvent(1, { auto: true });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: false }, admin, NOW);
    const [before] = await invitationsOf(event.id);
    expect(await resendInvitationByStaff(db, before.id, { days: 10 }, admin, at(3))).toEqual({ expiresAt: new Date(at(3).getTime() + 10 * DAY), kept: null });
  });

  it("«Retrimite» with days on a hidden-list invitation while somebody waits: it holds no counted place, so the deadline moves", async () => {
    const event = await createEvent(1, { auto: true });
    await registered(event, "Ioana", 0);
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 3, outsideCapacity: true }, admin, at(1));
    expect((await registered(event, "Elena", 2)).status).toBe("WAITLISTED");
    const [before] = await invitationsOf(event.id);
    expect(await resendInvitationByStaff(db, before.id, { days: 10 }, admin, at(3))).toEqual({ expiresAt: new Date(at(3).getTime() + 10 * DAY), kept: null });
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
