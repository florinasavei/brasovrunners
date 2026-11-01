import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-01, BR-REQ-060-01, BR-REQ-034-01 — «Toate datele unei persoane» reads «Lista internă de așteptare» (§854) and the
 * personal invitations to an event (§647), and erases both on request (§876; the owner: «Do them all»).
 *
 * - The internal list keeps the address as typed: a line is the person's when its address, through the versioned canonicalizer, is
 *   the person's canonical address (AGENTS.md §10.4) — `Ana.Pop+club@Gmail.com` is `ana.pop@gmail.com` — never by a raw compare.
 *   The author is shown as a role, never a colleague's name (§777).
 * - The invitations are found by the canonical address the send wrote, with their state, deadline and moments.
 * - The erase of the internal list deletes the person's lines and nobody else's; the erase of the invitations withdraws each open one
 *   through «Retrage» (`withdrawInvitationByStaff`) first — on a full race the held place goes back through the allocator to the one
 *   waiting — then deletes the ended ones; an accepted one stays with its registration. Each audited by counts, never the address.
 * - Administrator only, asserted on the server: the Organizer — who keeps the internal list itself — is refused the read, the file
 *   and both erases, at the service, the route and the action.
 */
const NOW = new Date("2026-11-01T10:00:00.000Z");
const STARTS = new Date("2026-11-20T07:00:00.000Z");
const DAY = 24 * 3_600_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", async () => {
  const { DomainError } = await import("@/shared/errors/domain-error");
  return {
    requireStaff: async () => state.actor,
    // The real helper's rule: the capability is asked of the signed-in account, a refusal is FORBIDDEN.
    requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
      if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "refused");
      return state.actor;
    },
  };
});
vi.mock("@/i18n/navigation", () => ({
  // The route's own name, its token in place: enough for a link to be found in an email and a redirect to be read.
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { submitRegistration, confirmEmail, inviteToEventByStaff } = await import("@/modules/registrations/service");
const { acceptInvitation } = await import("@/modules/registrations/invitations");
const { countOccupied } = await import("@/modules/registrations/repository");
const { addReserveEntry } = await import("@/modules/registrations/reserve-list");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { canonicalLookupOf, eraseEventInvitationsOfPerson, eraseReserveEntriesOfPerson, exportPersonData, sealPersonLookup, viewPersonData } = await import(
  "@/modules/registrations/person-data"
);
const { GET } = await import("@/app/api/admin/registrations/person/route");
const { eraseEventInvitationsAction, eraseReserveEntriesAction } = await import("@/app/[locale]/admin/registrations/person/actions");

type EventInput = Parameters<typeof submitRegistration>[1];

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
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
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.invalid", displayName: "Admina Colega", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.invalid", displayName: "Organizatoarea Colega", role: "MODERATOR" }).returning();
  state.actor = admin;
});

async function createEvent(capacity: number | null, title: string, options: { auto?: boolean; startsAt?: Date } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: options.auto ?? false,
      eventStatus: "SCHEDULED",
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title, slug: `ro-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: `${title} (en)`, slug: `en-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

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
  await submitRegistration(db, event, { ...form(name, at(minute)), email: `${name.toLowerCase()}@example.invalid` }, at(minute), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return confirmEmail(db, event, row.id, at(minute));
}

/** The invitation email of one event's invitation rendered as the drain would, and the secret its link carries. */
async function linkOf(eventId: string, when: Date): Promise<string> {
  const [invitation] = await db.select({ id: eventInvitations.id }).from(eventInvitations).where(eq(eventInvitations.eventId, eventId));
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION"))).filter(
    (row) => (row.payloadJson as { invitationId?: string }).invitationId === invitation.id,
  );
  const message = await renderOutboxMessage({ ...rows[0], status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /\/(?:inregistrari\/invitatie|registrations\/invitation)\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error("no invitation link in the message");
  return match[1];
}

const refusalOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);
const ANA = canonicalLookupOf("ana.pop@gmail.com");
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action));

describe("BR-REQ-070-01 «Lista internă de așteptare» on «Toate datele unei persoane» (§876)", () => {
  it("lists the lines whose typed address canonicalizes to the person's — never a raw compare — with the author as a role", async () => {
    const cross = await createEvent(10, "Crosul");
    const night = await createEvent(10, "Noaptea");
    // The organizers type the address as the person wrote from it.
    await addReserveEntry(db, organizer, cross.id, { firstName: "Ana", lastName: "Pop", email: "Ana.Pop+club@Gmail.com", note: "A scris pe formularul de contact." }, at(1));
    await addReserveEntry(db, admin, night.id, { firstName: "Ana", lastName: "Pop", email: "ana.pop@gmail.com", note: "" }, at(2));
    // Somebody else, and a line with no address: not hers.
    await addReserveEntry(db, organizer, cross.id, { firstName: "Bogdan", lastName: "Pop", email: "bogdan.pop@gmail.com", note: "" }, at(3));
    await addReserveEntry(db, organizer, night.id, { firstName: "Ana", lastName: "Pop", email: "", note: "fără adresă" }, at(4));

    const data = await viewPersonData(db, admin, ANA, at(5));
    expect(data.reserveEntries).toHaveLength(2);
    expect(data.reserveEntries[0]).toMatchObject({
      eventId: cross.id,
      eventTitle: "Crosul",
      firstName: "Ana",
      lastName: "Pop",
      deliveryEmail: "Ana.Pop+club@Gmail.com",
      note: "A scris pe formularul de contact.",
      createdByRole: "MODERATOR",
    });
    expect(data.reserveEntries[0].createdAt).toEqual(at(1));
    expect(data.reserveEntries[1]).toMatchObject({ eventId: night.id, deliveryEmail: "ana.pop@gmail.com", note: null, createdByRole: "ADMIN" });
    // The colleague is a role, never a name (§777).
    expect(JSON.stringify(data.reserveEntries)).not.toContain("Colega");
    // An address with only internal-list lines is not reported as unknown: the page's «nothing found» reads this array.
    expect(data.participant).toBeNull();

    // The same through the file, counted in its audit row with no value.
    const exported = await exportPersonData(db, admin, ANA, at(6));
    expect(exported.reserveEntries).toHaveLength(2);
    const [audit] = await trail("participant.data_exported");
    expect(audit.metadataJson).toMatchObject({ reserveEntries: 2, eventInvitations: 0 });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("Pop");
  });

  it("«Șterge de pe lista internă» deletes the person's lines and nobody else's, audited by the count alone", async () => {
    const cross = await createEvent(10, "Crosul");
    await addReserveEntry(db, organizer, cross.id, { firstName: "Ana", lastName: "Pop", email: "Ana.Pop+club@Gmail.com", note: "notă" }, at(1));
    await addReserveEntry(db, organizer, cross.id, { firstName: "Ana", lastName: "Pop", email: "ANA.POP@gmail.com", note: "" }, at(2));
    await addReserveEntry(db, organizer, cross.id, { firstName: "Bogdan", lastName: "Pop", email: "bogdan.pop@gmail.com", note: "" }, at(3));

    expect(await eraseReserveEntriesOfPerson(db, admin, ANA, at(4))).toEqual({ entries: 2 });
    const left = await db.select().from(eventReserveEntries);
    expect(left.map((row) => row.firstName)).toEqual(["Bogdan"]);
    const [audit] = await trail("participant.reserve_entries_erased");
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, participantId: null, entityId: null, metadataJson: { entries: 2 } });
    expect(JSON.stringify(audit.metadataJson)).not.toMatch(/ana|pop|notă/i);
    expect((await viewPersonData(db, admin, ANA, at(5))).reserveEntries).toEqual([]);
  });
});

describe("BR-REQ-070-01 the personal invitations to an event on «Toate datele unei persoane» (§647, §876)", () => {
  it("lists every invitation sent to the canonical address with its state, deadline and moments, and counts them in the file", async () => {
    const cross = await createEvent(3, "Crosul");
    const night = await createEvent(3, "Noaptea");
    await inviteToEventByStaff(db, cross, { people: [{ name: "Ana Pop", email: "Ana.Pop+club@Gmail.com" }], days: 7, outsideCapacity: false }, admin, NOW);
    await inviteToEventByStaff(db, night, { people: [{ name: "Ana P.", email: "ana.pop@gmail.com" }], days: 2, outsideCapacity: false }, admin, NOW);
    await inviteToEventByStaff(db, night, { people: [{ name: "Bogdan Pop", email: "bogdan.pop@gmail.com" }], days: 7, outsideCapacity: false }, admin, NOW);

    // Three days on: the second invitation's deadline has passed, unstamped — it reads expired.
    const data = await viewPersonData(db, admin, ANA, at(3 * 24 * 60));
    expect(data.eventInvitations).toHaveLength(2);
    // Both sent at the same instant: read by event, not by position.
    const ofCross = data.eventInvitations.find((row) => row.eventId === cross.id);
    const ofNight = data.eventInvitations.find((row) => row.eventId === night.id);
    expect(ofCross).toMatchObject({ eventTitle: "Crosul", name: "Ana Pop", deliveryEmail: "Ana.Pop+club@Gmail.com", locale: "ro", state: "sent", outsideCapacity: false, acceptedAt: null });
    expect(ofCross?.expiresAt).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(ofNight).toMatchObject({ name: "Ana P.", deliveryEmail: "ana.pop@gmail.com", state: "expired" });
    expect(JSON.stringify(data.eventInvitations)).not.toContain("bogdan");

    await exportPersonData(db, admin, ANA, at(3 * 24 * 60));
    const [audit] = await trail("participant.data_exported");
    expect(audit.metadataJson).toMatchObject({ eventInvitations: 2 });
  });

  it("on a full race, the erase withdraws the open invitation through «Retrage»: the place goes back through the allocator to the one waiting, never overbooked", async () => {
    const event = await createEvent(1, "Crosul", { auto: true });
    // Ana's invitation holds the only place; Elena registers behind it and waits.
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "Ana.Pop+club@Gmail.com" }], days: 7, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    expect(computeOccupied(await countOccupied(db, event.id, at(2)))).toBe(1);
    expect((await countOccupied(db, event.id, at(2))).invitationHolds).toBe(1);

    const result = await eraseEventInvitationsOfPerson(db, admin, ANA, at(3));
    expect(result).toEqual({ withdrawn: 1, erased: 1, keptAccepted: 0 });

    // The place went back through the allocator: Elena, first in line, is offered it; nothing is held by an invitation any more.
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLIST_OFFERED");
    const occupied = await countOccupied(db, event.id, at(4));
    expect(occupied.invitationHolds).toBe(0);
    expect(computeOccupied(occupied)).toBeLessThanOrEqual(1);
    // The row and its link are gone: the name and the address with them.
    expect(await db.select().from(eventInvitations)).toEqual([]);
    expect(await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "ACCEPT_INVITATION"))).toEqual([]);

    // Audited twice, neither naming her: «Retrage»'s own row, then the erase's counts.
    const [withdrawal] = await trail("event.invitation_withdrawn");
    expect(withdrawal).toMatchObject({ actorStaffUserId: admin.id, entityId: event.id });
    const [erased] = await trail("participant.invitations_erased");
    expect(erased).toMatchObject({ actorStaffUserId: admin.id, participantId: null, entityId: null, metadataJson: { withdrawn: 1, erased: 1, keptAccepted: 0 } });
    for (const row of [withdrawal, erased]) expect(JSON.stringify(row.metadataJson)).not.toMatch(/ana|pop|gmail/i);
  });

  it("an invitation past its deadline that the job has not stamped goes through the event's sweep first: stamped, audited, its place offered to the one waiting", async () => {
    const event = await createEvent(1, "Crosul", { auto: true });
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana.pop@gmail.com" }], days: 1, outsideCapacity: false }, admin, NOW);
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");

    // Two days on the deadline has passed and no job ran: the row is still unstamped.
    const when = at(2 * 24 * 60);
    const [before] = await db.select().from(eventInvitations);
    expect(before.expiredAt).toBeNull();

    expect(await eraseEventInvitationsOfPerson(db, admin, ANA, when)).toEqual({ withdrawn: 0, erased: 1, keptAccepted: 0 });
    // The sweep's own work, as the job would have done it: the stamp's audit row (the invitation's id, never a name)…
    const [expired] = await trail("event.invitation_expired");
    expect(expired).toMatchObject({ actorStaffUserId: null, entityId: event.id, metadataJson: { invitationId: before.id } });
    expect(JSON.stringify(expired.metadataJson)).not.toMatch(/ana|pop|gmail/i);
    // …and the place offered at once to Elena, never overbooked.
    const [elena] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Munteanu"));
    expect(elena.status).toBe("WAITLIST_OFFERED");
    expect(computeOccupied(await countOccupied(db, event.id, when))).toBeLessThanOrEqual(1);
    expect(await db.select().from(eventInvitations)).toEqual([]);
  });

  it("an accepted invitation stays with its registration; a withdrawn or expired one is deleted with nothing to release; somebody else's is untouched", async () => {
    const cross = await createEvent(5, "Crosul");
    const night = await createEvent(5, "Noaptea");
    const day = await createEvent(5, "Ziua");
    await inviteToEventByStaff(db, cross, { people: [{ name: "Ana Pop", email: "ana.pop@gmail.com" }], days: 7, outsideCapacity: false }, admin, NOW);
    await inviteToEventByStaff(db, night, { people: [{ name: "Ana Pop", email: "Ana.Pop+club@Gmail.com" }], days: 1, outsideCapacity: false }, admin, NOW);
    await inviteToEventByStaff(db, day, { people: [{ name: "Bogdan Pop", email: "bogdan.pop@gmail.com" }], days: 7, outsideCapacity: false }, admin, NOW);
    // She accepts the first from her link.
    const pressAt = at(10);
    const accepted = await acceptInvitation(db, await linkOf(cross.id, pressAt), form("Ana", pressAt), pressAt);
    expect(accepted.ok).toBe(true);

    // Two days on, the second has passed its deadline: it holds nothing.
    const when = at(2 * 24 * 60);
    expect(await eraseEventInvitationsOfPerson(db, admin, ANA, when)).toEqual({ withdrawn: 0, erased: 1, keptAccepted: 1 });
    const left = await db.select().from(eventInvitations);
    expect(left.map((row) => [row.eventId, row.acceptedAt !== null])).toEqual(
      expect.arrayContaining([
        [cross.id, true],
        [day.id, false],
      ]),
    );
    expect(left).toHaveLength(2);
    // Bogdan's still holds its place.
    expect((await countOccupied(db, day.id, when)).invitationHolds).toBe(1);
  });
});

describe("BR-REQ-060-01 Administrator only, asserted on the server", () => {
  it("the Organizer — who keeps the internal list itself — is refused the read, the file and both erases, and nothing is deleted", async () => {
    const event = await createEvent(3, "Crosul");
    await addReserveEntry(db, organizer, event.id, { firstName: "Ana", lastName: "Pop", email: "ana.pop@gmail.com", note: "" }, at(1));
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana.pop@gmail.com" }], days: 7, outsideCapacity: false }, admin, NOW);

    for (const attempt of [
      viewPersonData(db, organizer, ANA, at(2)),
      exportPersonData(db, organizer, ANA, at(2)),
      eraseReserveEntriesOfPerson(db, organizer, ANA, at(2)),
      eraseEventInvitationsOfPerson(db, organizer, ANA, at(2)),
    ]) {
      const refused = await refusalOf(attempt);
      expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    }

    // The route answers 403 and the two presses redirect with FORBIDDEN, whatever a replayed form carries.
    state.actor = organizer;
    const sealed = sealPersonLookup(ANA, new Date())!;
    const response = await GET(new Request(`http://localhost/api/admin/registrations/person?q=${encodeURIComponent(sealed)}`));
    expect(response.status).toBe(403);
    for (const action of [eraseReserveEntriesAction, eraseEventInvitationsAction]) {
      const body = new FormData();
      body.set("uiLocale", "ro");
      body.set("q", sealed);
      const thrown = await refusalOf(action(body));
      expect(String(thrown)).toContain("error=FORBIDDEN");
    }

    expect(await db.select().from(eventReserveEntries)).toHaveLength(1);
    const [invitation] = await db.select().from(eventInvitations);
    expect(invitation.withdrawnAt).toBeNull();
    expect(await trail("participant.reserve_entries_erased")).toEqual([]);
    expect(await trail("participant.invitations_erased")).toEqual([]);
  });

  it("the Administrator's presses go through the sealed lookup and come back with the result's alert", async () => {
    const event = await createEvent(3, "Crosul", { startsAt: new Date(Date.now() + 30 * DAY) });
    await addReserveEntry(db, organizer, event.id, { firstName: "Ana", lastName: "Pop", email: "Ana.Pop+club@Gmail.com", note: "" }, new Date());
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana.pop@gmail.com" }], days: 7, outsideCapacity: false }, admin, new Date());
    const sealed = sealPersonLookup(ANA, new Date())!;
    for (const [action, erased] of [
      [eraseReserveEntriesAction, "reserve"],
      [eraseEventInvitationsAction, "eventInvitations"],
    ] as const) {
      const body = new FormData();
      body.set("uiLocale", "ro");
      body.set("q", sealed);
      expect(String(await refusalOf(action(body)))).toContain(`&erased=${erased}`);
    }
    expect(await db.select().from(eventReserveEntries)).toEqual([]);
    expect(await db.select().from(eventInvitations)).toEqual([]);
  });
});

describe("BR-REQ-070-01 the page's words, in both languages (§876)", () => {
  it("every new key of «Toate datele unei persoane» is in Romanian and in English", () => {
    const keys = [
      "reserveEntries",
      "reserveEntryBy",
      "reserveErase",
      "reserveEraseTitle",
      "reserveEraseBody",
      "reserveErased",
      "eventInvitations",
      "eventInvitationOutside",
      "eventInvitationsErase",
      "eventInvitationsEraseTitle",
      "eventInvitationsEraseBody",
      "eventInvitationsErased",
      "eventInvitationsAcceptedKept",
    ] as const;
    for (const key of keys) {
      expect(ro.Admin.person[key], key).toBeTruthy();
      expect(en.Admin.person[key], key).toBeTruthy();
      expect(ro.Admin.person[key]).not.toBe(en.Admin.person[key]);
    }
  });
});
