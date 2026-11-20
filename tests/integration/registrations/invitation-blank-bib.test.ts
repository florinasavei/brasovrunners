import { and, eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { InvitationRefusal } from "@/modules/registrations/domain/invitations";
import { resolveDisplayName } from "@/modules/registrations/names";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §992 — an invitation can carry a blank bib (the owner, 2026-11-19, two days before the race: «când invit pe cineva, trebuie
 * să pot să-i dau unul dintre locurile de rezervă»; asked whether he meant a place kept for the club or a blank bib: «Ambele»).
 * BR-REQ-037-07 (the send), BR-REQ-038-01 (the number), BR-REQ-034-02 (the kept place), on a real database (PGlite):
 *
 * - «La confirmare primește un BIB gol» is stored on every invitation of the send, audited by a flag, unticked by default;
 *   refused with `INVITATION_NO_SPARES`, nothing written, on an event with no desk spares reserved;
 * - the registration the invitation becomes, CONFIRMED by whichever path — the person's own signature from the link, the
 *   desk's paper confirmation, a registration of the address that took the invitation over — wears the lowest of the desk's
 *   spares free at that moment, marked printed, with its trail line under the Administrator who sent it, and the
 *   confirmation's email says the number; a number handed at the desk with the paper wins; an unticked invitation gets the
 *   allocator's number; a special guest's follows the same rule; a test registration wears none;
 * - no spare free then: the ordinary number and the trail's line — never a runner without a number;
 * - two ticked confirmations take two spares, and a spare the invitation took is never handed at the desk, nor the reverse
 *   (the order under the lock here; the same on two real connections in `tests/concurrency/invitation-blank-bib.test.ts`);
 * - «Ambele»: an invitation takes a place kept for the club with no supplementary place (§914), and then a blank bib;
 * - «Invitații» draws the tick only while the event has spares, saying which are free, and wears its chip on the row —
 *   the spare's number once the registration wears one, as the spares card lists it.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en", actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  // The route's own name, its token in place: enough for a link to be found in an email and a redirect to be read.
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("@/shared/feedback/flash", () => ({ flashOutcome: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
// «Invitații» is a Server Component: its words from the catalogues, as the page has them.
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    getLocale: async () => state.locale,
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: state.locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
  };
});
// The questions' email line reads the club's roads once per render: one road here, as a site without Gmail has.
vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "mailgun", newsletter: "mailgun" }, gmail: false }),
}));

const { confirmEmail, inviteToEventByStaff, signDeclaration, submitRegistration } = await import("@/modules/registrations/service");
const { confirmRegistrationByStaff, createRegistrationByStaff, giveSpareBibByStaff, handedBibRefusalCode, spareBibRefusalCode } = await import("@/modules/registrations/admin-service");
const { acceptInvitation } = await import("@/modules/registrations/invitations");
const { freeSpareBibNumbers, givenSpareBibs } = await import("@/modules/registrations/bibs");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { inviteAction: inviteNow } = await import("@/app/[locale]/admin/registrations/invitation-actions");
const { default: InvitationsPanel } = await import("@/modules/registrations/ui/InvitationsPanel");
const { default: InviteForm } = await import("@/modules/registrations/ui/InviteForm");
const { default: StatusChip } = await import("@/shared/ui/StatusChip");

type EventInput = Parameters<typeof submitRegistration>[1];

const NOW = new Date("2026-09-25T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const STARTS = new Date(NOW.getTime() + 16 * DAY);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
/** The action reads the request's own clock: pressed at NOW, on the fixture's calendar (§712). */
const inviteAction = (...args: Parameters<typeof inviteNow>) => atTheClock(at(1), () => inviteNow(...args));

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;
let desk: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
  state.locale = "ro";
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.invalid", displayName: "Ana Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.invalid", displayName: "Organizer", role: "MODERATOR" }).returning();
  [desk] = await db.insert(staffUsers).values({ email: "desk@example.invalid", displayName: "Desk", role: "CONTRIBUTOR" }).returning();
  state.actor = admin;
});

/**
 * A published race sixteen days off, the owner's sheet of spares reserved (154–156 by default, §444), no participation
 * window — a hold is the club's thirty minutes. `hiddenStart`: «Folosește lista de invitați speciali» on, its series from
 * there (§647), above the race's and the spares, as SETUP advises.
 */
async function createEvent(options: { capacity?: number; kept?: number; spares?: [number, number] | null; hiddenStart?: number } = {}): Promise<EventInput> {
  const spares = options.spares === undefined ? ([154, 3] as [number, number]) : options.spares;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity: options.capacity ?? 150,
      placesKeptForClub: options.kept ?? 0,
      waitlistAutoOffer: false,
      hiddenListEnabled: options.hiddenStart !== undefined,
      hiddenListBibStart: options.hiddenStart ?? null,
      walkInBibStart: spares ? spares[0] : null,
      walkInBibCount: spares ? spares[1] : null,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW } as EventInput;
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

function invite(event: EventInput, name: string, email: string, options: { blankBib?: boolean; outside?: boolean } = {}, when = at(1)) {
  return inviteToEventByStaff(db, event, { people: [{ name, email }], days: 7, outsideCapacity: options.outside ?? false, blankBib: options.blankBib }, admin, when);
}

/** Render the newest invitation email to `email` as the drain would, and return the secret its link carries. */
async function linkOf(email: string, when: Date): Promise<string> {
  const rows = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_INVITATION")))
    .filter((row) => row.recipientEmail === email)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const message = await renderOutboxMessage({ ...rows[0], status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /\/(?:inregistrari\/invitatie|registrations\/invitation)\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error("no invitation link in the message");
  return match[1];
}

/** The invitation's link pressed: the registration, waiting for its declaration. */
async function accept(email: string, firstName: string, when: Date): Promise<Registration> {
  const accepted = await acceptInvitation(db, await linkOf(email, when), form(firstName, when), when);
  if (!accepted.ok) throw new Error(`the invitation was refused: ${accepted.kind}`);
  expect(accepted.registration.status).toBe("PENDING_DECLARATION");
  return accepted.registration;
}

/** The person signs their own declaration from the link (§15.3). */
async function sign(event: EventInput, registration: Registration, when: Date): Promise<Registration> {
  return signDeclaration(db, event, registration.id, await signingInput(db, when, registration.registeredName), when);
}

/** A walk-in at the desk, confirmed on paper with the spare in hand (§444) — entered by the Organizer since §NNN. */
function walkIn(event: EventInput, firstName: string, bibNumber: number, when: Date) {
  serial += 1;
  return createRegistrationByStaff(
    db,
    organizer,
    { eventId: event.id, firstName, lastName: "Pop", email: `walk-in-${serial}@example.invalid`, locale: "ro", listOptOut: false, relayedByParticipantRequest: true, fastTrack: true, bibNumber },
    when,
  );
}

const trailOf = (registrationId: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "registration"), eq(auditLogs.entityId, registrationId)))
    .then((rows) => rows.filter((row) => row.action.startsWith("registration.invitation_blank_bib")));
const refusalOf = (work: Promise<unknown>) => work.then(() => null, (error: unknown) => error);

describe("§992 BR-REQ-037-07 the send stores «La confirmare primește un BIB gol»", () => {
  it("stores the tick on every invitation of the send, audited by a flag and never a name; unticked by default", async () => {
    const event = await createEvent();
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Ion Pop", email: "ion@example.invalid" }], days: 7, outsideCapacity: false, blankBib: true }, admin, at(1));
    await invite(event, "Dan Pop", "dan@example.invalid");
    const stored = await db.select({ name: eventInvitations.name, blankBib: eventInvitations.blankBib }).from(eventInvitations);
    expect(Object.fromEntries(stored.map((row) => [row.name, row.blankBib]))).toEqual({ "Ana Pop": true, "Ion Pop": true, "Dan Pop": false });
    const sent = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_sent"));
    expect(sent.map((row) => (row.metadataJson as { blankBib?: boolean }).blankBib ?? false).sort()).toEqual([false, true, true]);
    expect(JSON.stringify(sent.map((row) => row.metadataJson))).not.toMatch(/Ana|Ion|Dan|@example/);
  });

  it("is refused on an event with no spares reserved, before anything is written or anybody emailed", async () => {
    const event = await createEvent({ spares: null });
    const refused = await refusalOf(invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true }));
    expect(refused instanceof InvitationRefusal && refused.refusal).toBe("INVITATION_NO_SPARES");
    expect(await db.select().from(eventInvitations)).toEqual([]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_sent"))).toEqual([]);
    // The same send unticked goes.
    expect((await invite(event, "Ana Pop", "ana@example.invalid")).sent).toBe(1);
  });

  it("the action posts it: `blankBib=1` stored, absent not; a refusal comes back as the island's marker", async () => {
    const event = await createEvent();
    const press = (name: string, email: string, blankBib: boolean) => {
      const body = new FormData();
      body.set("uiLocale", "ro");
      body.set("eventId", event.id);
      body.append("inviteeName", name);
      body.append("inviteeEmail", email);
      body.append("inviteePlaces", "1");
      body.set("days", "7");
      body.set("inviteLocale", "ro");
      body.set("addPlace", "");
      if (blankBib) body.set("blankBib", "1");
      return body;
    };
    await expect(inviteAction(null, press("Ana Pop", "ana@example.invalid", true))).rejects.toThrow(/REDIRECT .*saved=invitationsSent/);
    await expect(inviteAction(null, press("Dan Pop", "dan@example.invalid", false))).rejects.toThrow(/REDIRECT .*saved=invitationsSent/);
    const stored = await db.select({ name: eventInvitations.name, blankBib: eventInvitations.blankBib }).from(eventInvitations);
    expect(Object.fromEntries(stored.map((row) => [row.name, row.blankBib]))).toEqual({ "Ana Pop": true, "Dan Pop": false });

    const bare = await createEvent({ spares: null });
    const refused = await inviteAction(null, (() => {
      const body = press("Ion Pop", "ion@example.invalid", true);
      body.set("eventId", bare.id);
      return body;
    })());
    expect(refused).toMatchObject({ error: "INVITATION_NO_SPARES" });
  });

  it("the Organizer cannot send one: refused at the action and in the service, nothing written", async () => {
    const event = await createEvent();
    const refused = await refusalOf(inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }], days: 7, outsideCapacity: false, blankBib: true }, organizer, at(1)));
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    state.actor = organizer;
    const body = new FormData();
    body.set("uiLocale", "ro");
    body.set("eventId", event.id);
    body.append("inviteeName", "Ana Pop");
    body.append("inviteeEmail", "ana@example.invalid");
    body.append("inviteePlaces", "1");
    body.set("days", "7");
    body.set("blankBib", "1");
    expect(await inviteAction(null, body)).toMatchObject({ error: "FORBIDDEN" });
    expect(await db.select().from(eventInvitations)).toEqual([]);
  });
});

describe("§992 BR-REQ-038-01 a ticked invitation's registration, confirmed, wears the lowest free spare, printed", () => {
  it("by the person's own signature from the link: the lowest free spare, printed, its trail line under the sender, and the confirmation's email says it", async () => {
    const event = await createEvent();
    // 154 is on a walk-in already: the lowest free spare is 155.
    await walkIn(event, "Mara", 154, at(0));
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    const registration = await accept("ana@example.invalid", "Ana", at(2));
    // Nothing before the confirmation (§548): no number, nothing printed, no spare taken.
    expect(registration).toMatchObject({ bibNumber: null, bibPrintedAt: null });
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([155, 156]);

    const signed = await sign(event, registration, at(3));
    expect(signed).toMatchObject({ status: "CONFIRMED", bibNumber: 155, bibPrintedAt: at(3) });
    const [line] = await trailOf(signed.id);
    expect(line).toMatchObject({ action: "registration.invitation_blank_bib_given", actorStaffUserId: admin.id, participantId: signed.participantId, metadataJson: { eventId: event.id, bibNumber: 155 } });
    const [invitation] = await db.select().from(eventInvitations);
    expect((line.metadataJson as { invitationId: string }).invitationId).toBe(invitation.id);
    expect(JSON.stringify(line.metadataJson)).not.toMatch(/Ana|Munteanu|@example/);

    // The confirmation's own email carries the number, as every confirmation's does (§548).
    const [confirmedMail] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, signed.id), eq(emailOutbox.messageType, "REGISTRATION_CONFIRMED")));
    const message = await renderOutboxMessage({ ...confirmedMail, status: "PROCESSING", attemptCount: 1, lockedAt: at(4) }, db, at(4));
    expect(message.text).toContain("155");

    // The spares card lists it with the name (§989); the desk's free spares go on from the next one.
    expect((await givenSpareBibs(db, event.id)).map((given) => [given.bibNumber, given.registeredName])).toEqual([
      [154, "Mara Pop"],
      [155, "Ana Munteanu"],
    ]);
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([156]);
  });

  it("by the desk's paper confirmation («Confirmă aici») with no number handed: the lowest free spare, printed, the trail under the sender", async () => {
    const event = await createEvent();
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    const registration = await accept("ana@example.invalid", "Ana", at(2));
    const confirmed = await confirmRegistrationByStaff(db, desk, registration.id, at(3));
    expect(confirmed).toMatchObject({ status: "CONFIRMED", bibNumber: 154, bibPrintedAt: at(3) });
    expect((await trailOf(confirmed.id)).map((row) => [row.action, row.actorStaffUserId])).toEqual([["registration.invitation_blank_bib_given", admin.id]]);
  });

  it("a number the desk hands with the paper wins over the tick: the runner wears the paper in the volunteer's hand, no trail line", async () => {
    const event = await createEvent();
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    const registration = await accept("ana@example.invalid", "Ana", at(2));
    const confirmed = await confirmRegistrationByStaff(db, desk, registration.id, at(3), { bibNumber: 156 });
    expect(confirmed).toMatchObject({ status: "CONFIRMED", bibNumber: 156, bibPrintedAt: at(3) });
    expect(await trailOf(confirmed.id)).toEqual([]);
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([154, 155]);
  });

  it("an invitation taken over by its address's own registration (the public form) carries the tick to that registration", async () => {
    const event = await createEvent();
    await invite(event, "Ana Munteanu", "ana@example.invalid", { blankBib: true });
    await submitRegistration(db, event, { ...form("Ana", at(2)), email: "ana@example.invalid" }, at(2), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
    const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, "Ana Munteanu"));
    const placed = await confirmEmail(db, event, row.id, at(3));
    expect(placed.status).toBe("PENDING_DECLARATION");
    const [invitation] = await db.select().from(eventInvitations);
    expect(invitation.acceptedRegistrationId).toBe(row.id);

    const signed = await sign(event, placed, at(4));
    expect(signed).toMatchObject({ status: "CONFIRMED", bibNumber: 154, bibPrintedAt: at(4) });
    expect((await trailOf(signed.id)).map((line) => line.action)).toEqual(["registration.invitation_blank_bib_given"]);
  });

  it("an unticked invitation's registration gets the allocator's number, not a spare and not printed", async () => {
    const event = await createEvent();
    await invite(event, "Ana Pop", "ana@example.invalid");
    const signed = await sign(event, await accept("ana@example.invalid", "Ana", at(2)), at(3));
    expect(signed).toMatchObject({ status: "CONFIRMED", bibNumber: 1, bibPrintedAt: null });
    expect(await trailOf(signed.id)).toEqual([]);
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([154, 155, 156]);
  });

  it("a special guest's invitation follows the same rule: a blank bib, not the special guests' own series; unticked, that series", async () => {
    const event = await createEvent({ hiddenStart: 900 });
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true, outside: true });
    await invite(event, "Dan Pop", "dan@example.invalid", { outside: true });
    const ana = await sign(event, await accept("ana@example.invalid", "Ana", at(2)), at(3));
    const dan = await sign(event, await accept("dan@example.invalid", "Dan", at(2)), at(3));
    expect(ana).toMatchObject({ status: "CONFIRMED", outsideCapacity: true, bibNumber: 154, bibPrintedAt: at(3) });
    expect(dan).toMatchObject({ status: "CONFIRMED", outsideCapacity: true, bibNumber: 900, bibPrintedAt: null });
  });

  it("a test registration wears no number (§30), so a ticked invitation it took over gives it no spare and writes no line", async () => {
    const event = await createEvent();
    const email = "test-runner@example.invalid";
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Test Pop", preferredLocale: "ro" })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        kind: "TEST",
        locale: "ro",
        registeredName: "Test Pop",
        displayName: resolveDisplayName({ legalName: "Test Pop" }),
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        status: "PENDING_DECLARATION",
        emailConfirmedAt: NOW,
        holdExpiresAt: at(60 * 24),
      })
      .returning();
    await db.insert(eventInvitations).values({
      eventId: event.id,
      participantId: participant.id,
      name: "Test Pop",
      email,
      canonicalEmail: email,
      invitedByStaffUserId: admin.id,
      sentAt: NOW,
      expiresAt: at(60 * 24 * 7),
      lastSentAt: NOW,
      blankBib: true,
      acceptedAt: at(1),
      acceptedRegistrationId: row.id,
    });
    const confirmed = await confirmRegistrationByStaff(db, desk, row.id, at(2));
    expect(confirmed).toMatchObject({ status: "CONFIRMED", kind: "TEST", bibNumber: null, bibPrintedAt: null });
    expect(await trailOf(row.id)).toEqual([]);
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([154, 155, 156]);
  });
});

describe("§992 no spare free at the confirmation: the ordinary number and the trail's line, never a runner without a number", () => {
  it("every spare given since the send: the allocator's next number, not printed, and the line says the blank bib could not be given", async () => {
    const event = await createEvent({ spares: [154, 1] });
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    // The one spare goes to a walk-in between the send and the confirmation.
    await walkIn(event, "Mara", 154, at(2));
    const signed = await sign(event, await accept("ana@example.invalid", "Ana", at(3)), at(4));
    expect(signed).toMatchObject({ status: "CONFIRMED", bibNumber: 1, bibPrintedAt: null });
    const [line] = await trailOf(signed.id);
    expect(line).toMatchObject({ action: "registration.invitation_blank_bib_missed", actorStaffUserId: admin.id, metadataJson: { eventId: event.id, bibNumber: 1 } });
  });
});

describe("§992 §444 two confirmations never take one spare, and the desk never hands the same", () => {
  it("two ticked confirmations, one after the other, take the two lowest spares in turn", async () => {
    const event = await createEvent();
    await inviteToEventByStaff(db, event, { people: [{ name: "Ana Pop", email: "ana@example.invalid" }, { name: "Ion Pop", email: "ion@example.invalid" }], days: 7, outsideCapacity: false, blankBib: true }, admin, at(1));
    const ana = await accept("ana@example.invalid", "Ana", at(2));
    const ion = await accept("ion@example.invalid", "Ion", at(2));
    expect((await sign(event, ion, at(3))).bibNumber).toBe(154);
    expect((await confirmRegistrationByStaff(db, desk, ana.id, at(4))).bibNumber).toBe(155);
    const numbers = (await db.select({ bib: registrations.bibNumber }).from(registrations).where(eq(registrations.eventId, event.id))).map((row) => row.bib);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("a spare the invitation took is never handed at the desk, typed, or given as «Dă-i un BIB gol»; the desk suggests the next", async () => {
    const event = await createEvent();
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    const ana = await sign(event, await accept("ana@example.invalid", "Ana", at(2)), at(3));
    expect(ana.bibNumber).toBe(154);
    // The walk-in's spare in the volunteer's hand: refused as somebody's, nothing written.
    const taken = await refusalOf(walkIn(event, "Mara", 154, at(4)));
    expect(handedBibRefusalCode(taken)).toBe("BIB_NUMBER_TAKEN");
    expect(await db.select().from(registrations).where(eq(registrations.registeredName, "Mara Pop"))).toEqual([]);
    // «Dă-i un BIB gol» on another confirmed runner: the spare chosen is somebody's.
    const other = await walkIn(event, "Ilie", 155, at(5));
    const given = await refusalOf(giveSpareBibByStaff(db, admin, other.registrationId as string, 154, at(6)));
    expect(spareBibRefusalCode(given)).toBe("SPARE_BIB_TAKEN");
    // What the desk suggests next, and the sheet reprints: the free ones only.
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([156]);
  });

  it("a spare the desk handed first is stepped over by the invitation's confirmation", async () => {
    const event = await createEvent();
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    const ana = await accept("ana@example.invalid", "Ana", at(2));
    await walkIn(event, "Mara", 154, at(3));
    expect((await sign(event, ana, at(4))).bibNumber).toBe(155);
  });
});

describe("§914 §992 «Ambele»: an invitation takes a place kept for the club, and then a blank bib", () => {
  it("the site's places taken and somebody waiting: the invitation takes a kept place with no supplementary place, and its confirmation the lowest spare", async () => {
    const event = await createEvent({ capacity: 3, kept: 1 });
    // The site's two places, then the line.
    for (const [index, name] of ["Bia", "Cora", "Dana"].entries()) {
      await submitRegistration(db, event, { ...form(name, at(index)), email: `${name.toLowerCase()}@example.invalid` }, at(index), "REAL", { source: "PUBLIC", createdByStaffUserId: null });
      const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
      await confirmEmail(db, event, row.id, at(index));
    }
    expect((await db.select({ name: registrations.registeredName, status: registrations.status }).from(registrations)).map((row) => row.status).sort()).toEqual([
      "PENDING_DECLARATION",
      "PENDING_DECLARATION",
      "WAITLISTED",
    ]);
    const sent = await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true }, at(4));
    // The kept place is the invitation's: no place added, the capacity as it was, no raise in the trail.
    expect(sent.capacityRaisedTo).toBeNull();
    expect((await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, event.id)))[0].capacity).toBe(3);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "event.capacity_raised_for_invitation")))).toEqual([]);

    const signed = await sign(event, await accept("ana@example.invalid", "Ana", at(5)), at(6));
    expect(signed).toMatchObject({ status: "CONFIRMED", bibNumber: 154, bibPrintedAt: at(6) });
    // The one waiting still waits: the kept place was the club's to give.
    expect((await db.select().from(registrations).where(eq(registrations.registeredName, "Dana Munteanu")))[0].status).toBe("WAITLISTED");
  });
});

/** Every element of a Server Component's tree, as drawn (not rendered). */
function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

async function panel(event: EventInput, mayManage: boolean, now: Date) {
  return elementsOf(
    await InvitationsPanel({
      db,
      actor: { role: mayManage ? "ADMIN" : "MODERATOR" },
      locale: state.locale,
      eventId: event.id,
      mayManage,
      sendAction: (async () => null) as never,
      resendAction: (async () => null) as never,
      withdrawAction: (async () => null) as never,
      deleteAction: (async () => null) as never,
      now,
    }),
  );
}

describe("§992 «Invitații»: the tick on the form only while the event has spares, and its chip on the row", () => {
  it.each(["ro", "en"] as const)("%s: the form is handed the free spares as the desk writes them, and the tick's words", async (locale) => {
    state.locale = locale;
    const catalogue = (locale === "ro" ? ro : en).Admin.invitations;
    const event = await createEvent({ spares: [154, 4] });
    await walkIn(event, "Mara", 155, at(0));
    const inviteForm = (await panel(event, true, at(1))).find((element) => element.type === InviteForm);
    expect(inviteForm?.props.blankBibSpares).toEqual({ count: 3, numbers: "154, 156–157" });
    const words = inviteForm?.props.words as Record<string, unknown>;
    expect(words.blankBibLabel).toBe(catalogue.blankBibLabel);
    expect(words.blankBibHelp).toEqual(catalogue.blankBibHelp);
    expect(words.blankBibHelpOut).toBe(catalogue.blankBibHelpOut);
    expect(words.dialogBlankBib).toBe(catalogue.dialog.blankBib);
    expect((words.errors as Record<string, string>).INVITATION_NO_SPARES).toBe(catalogue.errors.INVITATION_NO_SPARES);
  });

  it("no spares reserved: no tick; every spare given: the tick, saying so", async () => {
    const bare = await createEvent({ spares: null });
    expect((await panel(bare, true, at(1))).find((element) => element.type === InviteForm)?.props.blankBibSpares).toBeNull();
    const out = await createEvent({ spares: [154, 1] });
    await walkIn(out, "Mara", 154, at(0));
    expect((await panel(out, true, at(1))).find((element) => element.type === InviteForm)?.props.blankBibSpares).toEqual({ count: 0, numbers: "" });
  });

  it("the row wears «BIB gol la confirmare» by the number's glyph, then the spare the registration got; none unticked; the Organizer reads it", async () => {
    const event = await createEvent();
    await invite(event, "Ana Pop", "ana@example.invalid", { blankBib: true });
    await invite(event, "Dan Pop", "dan@example.invalid");
    const chips = async (mayManage: boolean, now: Date) => {
      const rows = (await panel(event, mayManage, now)).filter((element) => element.props["data-testid"] === "invitation-row");
      const nameOf = (row: ReactElement<Record<string, unknown>>) => elementsOf(row).map((element) => element.props.children).find((child) => typeof child === "string" && / Pop$/.test(child));
      return Object.fromEntries(
        rows.map((row) => [
          nameOf(row),
          elementsOf(row)
            .filter((element) => element.type === StatusChip && element.props.testId === "invitation-blank-bib-chip")
            .map((chip) => [chip.props.glyph, chip.props.label]),
        ]),
      );
    };
    expect(await chips(true, at(1))).toEqual({ "Ana Pop": [["number", "BIB gol la confirmare"]], "Dan Pop": [] });
    // Accepted, not yet confirmed: still the tick.
    const ana = await accept("ana@example.invalid", "Ana", at(2));
    expect(await chips(false, at(2))).toEqual({ "Ana Pop": [["number", "BIB gol la confirmare"]], "Dan Pop": [] });
    // Confirmed: the spare it wears, as the spares card lists it.
    await sign(event, ana, at(3));
    expect(await chips(false, at(4))).toEqual({ "Ana Pop": [["number", "BIB gol: 154"]], "Dan Pop": [] });
    // The Organizer reads the list and is handed no form (§289).
    expect((await panel(event, false, at(4))).some((element) => element.type === InviteForm)).toBe(false);
  });
});
