import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { issueActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { insertLegalDocumentVersion, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { exportPersonData } from "@/modules/registrations/person-data";
import { canWorkTheDesk, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { RAFFLE_KINDS, type RaffleKind } from "@/modules/volunteers/domain/raffle";
import {
  deleteRaffleEntry,
  setEliteLineRaffleTick,
  signUpForRaffleAtDesk,
  signUpForRaffleByForm,
  signUpForRaffleByLink,
  signUpForRaffleByStaff,
  withdrawFromRaffleByLink,
} from "@/modules/volunteers/raffle-entries";
import { canTakeRaffleList, exportRaffleList, readRaffleRoster } from "@/modules/volunteers/raffle-list";
import { readRaffleLine, readRaffleManageCards, readRaffleRules, raffleReasonsFor } from "@/modules/volunteers/raffle-roster";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

/**
 * §NNN — the raffle's own sign-up (the owner, 2026-11-18: «Dar pentru tombolă trebuie să am o înscriere separată» — asked, he chose
 * that in the sign-up mode only those who sign up are in; that they sign up three ways — a tick in their own link, a public form on
 * the site, at the desk on race day — and accept a «Regulamentul tombolei» approved by the club; «trebuie să bifez acolo cine se
 * poate înscrie: doar alergătorii și elitele și voluntarii»). BR-REQ-050-02 for the doors and the settings, BR-REQ-071-01 for who is
 * in the file, BR-REQ-036-02 for the link, BR-REQ-053-01 for the rules' acceptance, BR-REQ-060-01 for who presses, BR-REQ-070-01
 * for the person's own data — on real PostgreSQL (PGlite), through the services.
 *
 * - **The four doors**: the public form (a number and a name, folded words, one neutral refusal, the same thank-you for a person in
 *   already, no email), the person's own link (POST, the token read never spent, another adult never signed up), the desk (every
 *   desk role, the person having accepted on paper or aloud) and the organizers (a volunteer and a line of the elite list too).
 * - **The acceptance** kept as the volunteer agreement keeps one: the version, the moment, the language, the fingerprint of the text
 *   read with its blanks filled, the blanks, the notice's version; the trace for the electronic doors, the recorder for the staff's.
 * - **The gate**: each condition alone shuts every door, writing nothing.
 * - **Who takes part**: one answer for both modes and every group tick, the files and the counts with it; the organizers' exclusion
 *   kept; a line of the elite list with its two ticks.
 * - **The trail** names the door and the group, never a name; **the sweep** deletes a sign-up thirty days after the event's start;
 *   **«Toate datele unei persoane»** lists it; a version somebody accepted is counted on the legal list.
 */

const NOW = new Date("2026-11-20T10:00:00.000Z");
const START = new Date("2026-11-21T07:00:00.000Z");
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const DAY = 24 * 60 * 60_000;
const TRACE = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (test)" };

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
let eventId: string;
let roleId: string;
let noticeVersion: number;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  noticeVersion = await approveNotice();
  await approveRules();
  ({ eventId, roleId } = await race());
});

/** The privacy notice in force, naming `{{raffle}}` in the languages given (both by default). */
async function approveNotice(namesRaffleIn: readonly ("ro" | "en")[] = ["ro", "en"], version = 1): Promise<number> {
  const body = (locale: "ro" | "en") => ({ sections: [{ paragraphs: [namesRaffleIn.includes(locale) ? "Tombola ({{raffle}}): păstrăm înscrierea." : "Nimic despre tombolă."] }] });
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: body("ro") },
    { locale: "en", title: "Privacy", body: body("en") },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  return version;
}

/** «Regulamentul tombolei» in force from the platform's template, in the languages given (both by default). */
async function approveRules(locales: readonly ("ro" | "en")[] = ["ro", "en"]) {
  const translations: LegalDocumentTranslationInput[] = locales.map((locale) => ({ locale, ...LEGAL_TEMPLATES.RAFFLE_RULES[locale] }));
  return insertLegalDocumentVersion(db, { key: "RAFFLE_RULES", version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
}

/** A published race tomorrow holding a raffle in the sign-up mode, its sign-ups open, every group ticked. */
async function race(over: Partial<typeof events.$inferInsert> = {}) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: START,
      timezone: "Europe/Bucharest",
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-11-01T08:00:00.000Z"),
      locationName: "Parcul Noua",
      bibStartNumber: 1,
      volunteerBibStart: 500,
      hasRaffle: true,
      raffleSignUp: true,
      raffleSignUpOpen: true,
      ...over,
    })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${serial}`, title: `Crosul ${serial}` },
    { eventId: event.id, locale: "en", slug: `cross-${serial}`, title: `The cross ${serial}` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return { eventId: event.id, roleId: role.id };
}

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A participant of their own (or the one given), and a registration of theirs at the event. */
async function runner(
  name: string,
  bibNumber: number | null,
  more: Partial<typeof registrations.$inferInsert> & { participantId?: string; at?: string } = {},
): Promise<{ id: string; participantId: string; email: string }> {
  serial += 1;
  const email = `runner-${serial}@example.test`;
  const { participantId: given, at, ...rest } = more;
  const participantId =
    given ??
    (await db.insert(participants).values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" }).returning({ id: participants.id }))[0].id;
  const status = rest.status ?? "CONFIRMED";
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: at ?? eventId,
      participantId,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      bibNumber,
      ...(status === "CONFIRMED" ? { confirmedAt: NOW } : {}),
      ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "ADMIN" as const } : {}),
      ...(status === "WAITLISTED" ? { waitlistedAt: NOW } : {}),
      ...rest,
    })
    .returning({ id: registrations.id });
  return { id: row.id, participantId, email };
}

async function volunteer(name: string, bibNumber: number | null, more: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "CONFIRMED", source: "STAFF", roleId, bibNumber, ...more })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId: more.roleId ?? roleId });
  return row.id;
}

async function eliteLine(name: string, bibNumber: number | null = null, at = eventId): Promise<string> {
  const [row] = await db.insert(eventEliteEntries).values({ eventId: at, name, bibNumber }).returning({ id: eventEliteEntries.id });
  return row.id;
}

const form = (number: string, name: string, extra: Partial<Parameters<typeof signUpForRaffleByForm>[2]> = {}) => ({
  number,
  name,
  volunteer: false,
  accepted: true,
  locale: "ro" as const,
  renderedAt: RENDERED,
  ...extra,
});

const entries = () => db.select().from(eventRaffleEntries);
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId));
const signUpTrail = async () => (await trail()).filter((row) => row.action.startsWith("event_raffle."));

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

const setGroups = (groups: Partial<Record<RaffleKind, boolean>>) =>
  db
    .update(events)
    .set({ ...("RUNNER" in groups ? { raffleRunners: groups.RUNNER } : {}), ...("ELITE" in groups ? { raffleElites: groups.ELITE } : {}), ...("VOLUNTEER" in groups ? { raffleVolunteers: groups.VOLUNTEER } : {}) })
    .where(eq(events.id, eventId));

describe("§NNN BR-REQ-050-02 the public form (FORM): a race number and a name", () => {
  it("signs up a confirmed runner by number and name, keeping the acceptance as the volunteer agreement keeps one — and emails nobody", async () => {
    const ana = await runner("Ana Maria Popescu", 7);
    expect(await signUpForRaffleByForm(db, eventId, form(" 7 ", "  popescu   ana "), NOW, TRACE)).toBe("done");

    const [row, ...more] = await entries();
    expect(more).toEqual([]);
    const rules = await readRaffleRules(db, eventId, { hasRaffle: true, groups: { RUNNER: true, ELITE: true, VOLUNTEER: true }, signUp: true, signUpOpen: true }, "ro", NOW);
    expect(rules).not.toBeNull();
    expect(row).toMatchObject({
      eventId,
      registrationId: ana.id,
      volunteerId: null,
      eliteEntryId: null,
      method: "FORM",
      // As typed, trimmed and its inner spaces collapsed — never folded.
      typedName: "popescu ana",
      ip: TRACE.ip,
      userAgent: TRACE.userAgent,
      recordedByStaffUserId: null,
      rulesDocumentId: rules?.documentId,
      rulesLocale: "ro",
      rulesAcceptedAt: NOW,
      privacyNoticeVersion: noticeVersion,
      createdAt: NOW,
    });
    // The exact text read, its blanks filled for the event — the volunteer agreement's fingerprint (§556).
    expect(row.rulesTextHash).toBe(signedTextHash({ title: rules?.title ?? "", body: rules?.body ?? { sections: [] }, values: rules?.values ?? {} }));
    const [title] = await db.select({ title: eventTranslations.title }).from(eventTranslations).where(and(eq(eventTranslations.eventId, eventId), eq(eventTranslations.locale, "ro")));
    expect(row.rulesFacts).toEqual({
      event: title.title,
      eventDate: expect.stringContaining("2026"),
      eventLocation: "Parcul Noua",
      raffleGroups: "alergătorii înscriși și confirmați, cu număr de concurs, elitele cursei și voluntarii confirmați, cu număr de voluntar",
    });
    // The trail says the door and the group, never a name or a number.
    const [audit] = await signUpTrail();
    expect(audit).toMatchObject({ action: "event_raffle.entry_created", entityType: "event", entityId: eventId, actorStaffUserId: null, metadataJson: { entryId: row.id, method: "FORM", kind: "RUNNER" } });
    expect(JSON.stringify(audit)).not.toMatch(/Popescu|Ana|\b7\b/);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  it("answers a person in already with the same thank-you, writing nothing more", async () => {
    await runner("Ana Popescu", 7);
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE)).toBe("done");
    expect(await signUpForRaffleByForm(db, eventId, form("7", "ANA POPESCU"), NOW, TRACE)).toBe("done");
    expect(await entries()).toHaveLength(1);
    expect(await signUpTrail()).toHaveLength(1);
  });

  it("answers one neutral «noMatch» for every number and name that name nobody it takes — revealing neither half, writing nothing", async () => {
    await runner("Ana Popescu", 7);
    await runner("Elena Waiting", 8, { status: "WAITLISTED" });
    await runner("Mara Cancelled", 9, { status: "CANCELLED" });
    await runner("Test Runner", 10, { kind: "TEST" });
    await volunteer("Ion Voluntar", 500);
    const other = await race();
    await runner("Dan Altul", 11, { at: other.eventId });
    const cases: Array<[string, string, boolean]> = [
      ["8", "Ana Popescu", false], // the right name, another number
      ["7", "Ana Ionescu", false], // the right number, another name
      ["7", "Popescu", false], // one word for a name of two
      ["7", "Ana Popescu Ionescu", false], // a word the name does not hold
      ["8", "Elena Waiting", false], // waiting, not confirmed
      ["9", "Mara Cancelled", false], // cancelled
      ["10", "Test Runner", false], // a test registration
      ["11", "Dan Altul", false], // another event's runner
      ["500", "Ion Voluntar", false], // a volunteer's number, «Sunt voluntar» unticked
      ["7", "Ana Popescu", true], // a runner's number with «Sunt voluntar»
      ["99", "Nimeni Nicăieri", false], // nobody at all
    ];
    for (const [number, name, volunteer] of cases) {
      expect(await signUpForRaffleByForm(db, eventId, form(number, name, { volunteer }), NOW, TRACE), `${number} ${name} ${volunteer}`).toBe("noMatch");
    }
    expect(await entries()).toEqual([]);
    expect(await signUpTrail()).toEqual([]);
  });

  it("matches a confirmed volunteer by the volunteer's own number with «Sunt voluntar», and a registration marked «Elită» by its race number", async () => {
    const ion = await volunteer("Ion Voluntar", 500);
    const eliud = await runner("Eliud Kipchoge", 3, { elite: true });
    expect(await signUpForRaffleByForm(db, eventId, form("500", "ion voluntar", { volunteer: true }), NOW, TRACE)).toBe("done");
    expect(await signUpForRaffleByForm(db, eventId, form("3", "Kipchoge Eliud"), NOW, TRACE)).toBe("done");
    const rows = await entries();
    expect(rows.map((row) => row.volunteerId ?? row.registrationId).sort()).toEqual([ion, eliud.id].sort());
    expect((await signUpTrail()).map((row) => (row.metadataJson as { kind: string }).kind).sort()).toEqual(["ELITE", "VOLUNTEER"]);
  });

  it("takes only the ticked groups: an unticked group's people get the neutral refusal, the others sign up", async () => {
    await runner("Ana Popescu", 7);
    await runner("Eliud Kipchoge", 3, { elite: true });
    await volunteer("Ion Voluntar", 500);
    await setGroups({ RUNNER: false, VOLUNTEER: false });
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE)).toBe("noMatch");
    expect(await signUpForRaffleByForm(db, eventId, form("500", "Ion Voluntar", { volunteer: true }), NOW, TRACE)).toBe("noMatch");
    expect(await signUpForRaffleByForm(db, eventId, form("3", "Eliud Kipchoge"), NOW, TRACE)).toBe("done");
    await setGroups({ RUNNER: true, ELITE: false });
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE)).toBe("done");
    expect(await entries()).toHaveLength(2);
  });

  it("refuses a malformed form naming its boxes, before anything is counted or written", async () => {
    await runner("Ana Popescu", 7);
    const refused = await failureOf(signUpForRaffleByForm(db, eventId, form("7a", "", { accepted: false }), NOW, TRACE));
    expect(refused.code).toBe("VALIDATION_ERROR");
    expect([...refused.fields].sort()).toEqual(["accept", "name", "number"]);
    expect((await failureOf(signUpForRaffleByForm(db, eventId, form("0", "Ana Popescu"), NOW, TRACE))).fields).toEqual(["number"]);
    expect((await failureOf(signUpForRaffleByForm(db, eventId, form("7", "A".repeat(121)), NOW, TRACE))).fields).toEqual(["name"]);
    expect((await failureOf(signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu", { accepted: false }), NOW, TRACE))).fields).toEqual(["accept"]);
    expect(await entries()).toEqual([]);
  });

  it("answers a bot like a success and keeps nothing: the honeypot filled, or the form sent too fast", async () => {
    await runner("Ana Popescu", 7);
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu", { honeypot: "http://spam.example" }), NOW, TRACE)).toBe("done");
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu", { renderedAt: new Date(NOW.getTime() - 300).toISOString() }), NOW, TRACE)).toBe("done");
    expect(await entries()).toEqual([]);
  });

  it("throttles the number at the event: five tries an hour, then «limited» — the right name included — and another number is untouched", async () => {
    await runner("Ana Popescu", 7);
    await runner("Radu Munteanu", 2);
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await signUpForRaffleByForm(db, eventId, form("7", `Nume Greșit${attempt}`), NOW, TRACE)).toBe("noMatch");
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE)).toBe("limited");
    expect(await signUpForRaffleByForm(db, eventId, form("2", "Radu Munteanu"), NOW, TRACE)).toBe("done");
    // An hour later the number is free again.
    expect(await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), new Date(NOW.getTime() + 61 * 60_000), TRACE)).toBe("done");
    expect(await entries()).toHaveLength(2);
  });
});

describe("§NNN BR-REQ-036-02 the person's own link (LINK): POST only, the token read and never spent", () => {
  const manageToken = async (participantId: string, registrationId: string) =>
    (await issueActionToken(db, { participantId, registrationId, purpose: "MANAGE_REGISTRATION", expiresAt: START, now: NOW })).secret;

  it("signs up the link's own confirmed registration with its trace, and the link still reads afterwards", async () => {
    const ana = await runner("Ana Popescu", 7);
    const secret = await manageToken(ana.participantId, ana.id);
    expect(await signUpForRaffleByLink(db, { secret, accepted: true, locale: "en", trace: TRACE }, NOW)).toEqual({ ok: true, outcome: "created" });
    expect(await signUpForRaffleByLink(db, { secret, accepted: true, locale: "en", trace: TRACE }, NOW)).toEqual({ ok: true, outcome: "already" });
    const [row] = await entries();
    // The rules read in the page's language; no typed name, the request's trace.
    expect(row).toMatchObject({ registrationId: ana.id, method: "LINK", rulesLocale: "en", typedName: null, ip: TRACE.ip, userAgent: TRACE.userAgent, recordedByStaffUserId: null });
    const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now: NOW });
    expect(context.ok).toBe(true);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  it("refuses the press without the rules' own tick, and a registration the raffle does not take, writing nothing", async () => {
    const ana = await runner("Ana Popescu", 7);
    const elena = await runner("Elena Waiting", null, { status: "WAITLISTED" });
    expect((await failureOf(signUpForRaffleByLink(db, { secret: await manageToken(ana.participantId, ana.id), accepted: false, locale: "ro" }, NOW))).code).toBe("RAFFLE_RULES_NOT_ACCEPTED");
    expect((await failureOf(signUpForRaffleByLink(db, { secret: await manageToken(elena.participantId, elena.id), accepted: true, locale: "ro" }, NOW))).code).toBe("RAFFLE_NOT_ELIGIBLE");
    expect(await entries()).toEqual([]);
  });

  it("answers a link it cannot read, or one of another purpose, as the refused link", async () => {
    const ana = await runner("Ana Popescu", 7);
    expect(await signUpForRaffleByLink(db, { secret: "not-a-secret-anybody-holds", accepted: true, locale: "ro" }, NOW)).toMatchObject({ ok: false });
    const listLink = (await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "LIST_CONSENT", expiresAt: START, now: NOW })).secret;
    expect(await signUpForRaffleByLink(db, { secret: listLink, accepted: true, locale: "ro" }, NOW)).toMatchObject({ ok: false });
    expect(await entries()).toEqual([]);
  });

  it("withdraws, audited as the person's own — and a second press changes nothing", async () => {
    const ana = await runner("Ana Popescu", 7);
    const secret = await manageToken(ana.participantId, ana.id);
    await signUpForRaffleByLink(db, { secret, accepted: true, locale: "ro", trace: TRACE }, NOW);
    expect(await withdrawFromRaffleByLink(db, { secret }, NOW)).toEqual({ ok: true, changed: true });
    expect(await withdrawFromRaffleByLink(db, { secret }, NOW)).toEqual({ ok: true, changed: false });
    expect(await entries()).toEqual([]);
    const withdrawn = (await signUpTrail()).filter((row) => row.action === "event_raffle.entry_withdrawn");
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({ actorStaffUserId: null, metadataJson: { kind: "RUNNER", by: "person" } });
  });

  it("never signs another adult on the address up from this link — their acceptance is their own — but may take them out", async () => {
    const ana = await runner("Ana Popescu", 7);
    const dan = await runner("Dan Popescu", 8, { participantId: ana.participantId });
    const secret = await manageToken(ana.participantId, ana.id);
    expect((await failureOf(signUpForRaffleByLink(db, { secret, accepted: true, locale: "ro", registrationId: dan.id }, NOW))).code).toBe("FORBIDDEN");
    expect(await entries()).toEqual([]);
    // Signed up by himself, at the desk: the address's link may still take him out.
    await signUpForRaffleAtDesk(db, await staff("CONTRIBUTOR"), { registrationId: dan.id, accepted: true }, NOW);
    expect(await withdrawFromRaffleByLink(db, { secret, registrationId: dan.id }, NOW)).toEqual({ ok: true, changed: true });
    // The card the page draws offers him the way out alone.
    const cards = await readRaffleManageCards(db, eventId, [{ id: ana.id, anotherAdult: false }, { id: dan.id, anotherAdult: true }], NOW);
    expect(cards.get(ana.id)).toEqual({ signedUp: false, maySignUp: true });
    expect(cards.get(dan.id)).toEqual({ signedUp: false, maySignUp: false });
  });
});

describe("§NNN BR-REQ-037-08 the desk (DESK): every desk role, the person having accepted on paper or aloud", () => {
  it("records a sign-up for every role that works the desk — the desk member the recorder, no trace — and refuses every other", async () => {
    for (const role of STAFF_ROLES) {
      const person = await runner(`Alergător ${role}`, 100 + STAFF_ROLES.indexOf(role));
      const actor = await staff(role);
      if (!canWorkTheDesk(role)) {
        expect((await failureOf(signUpForRaffleAtDesk(db, actor, { registrationId: person.id, accepted: true }, NOW))).code, role).toBe("FORBIDDEN");
        continue;
      }
      expect(await signUpForRaffleAtDesk(db, actor, { registrationId: person.id, accepted: true }, NOW), role).toBe("created");
      const [row] = await db.select().from(eventRaffleEntries).where(eq(eventRaffleEntries.registrationId, person.id));
      expect(row, role).toMatchObject({ method: "DESK", recordedByStaffUserId: actor.id, ip: null, userAgent: null, typedName: null });
    }
    expect(STAFF_ROLES.filter((role) => !canWorkTheDesk(role))).toEqual(["MEMBER"]);
  });

  it("asks the acceptance's tick, and reads the rules in the registration's own language", async () => {
    const actor = await staff("CONTRIBUTOR");
    const jane = await runner("Jane Doe", 7, { locale: "en" });
    expect((await failureOf(signUpForRaffleAtDesk(db, actor, { registrationId: jane.id, accepted: false }, NOW))).code).toBe("RAFFLE_RULES_NOT_ACCEPTED");
    expect(await signUpForRaffleAtDesk(db, actor, { registrationId: jane.id, accepted: true }, NOW)).toBe("created");
    expect(await signUpForRaffleAtDesk(db, actor, { registrationId: jane.id, accepted: true }, NOW)).toBe("already");
    const [row] = await entries();
    expect(row.rulesLocale).toBe("en");
    expect((row.rulesFacts as Record<string, string>).raffleGroups).toBe("the registered and confirmed runners with a race number, the race's elites and the confirmed volunteers with a volunteer number");
    // The desk's line says it, in words — and «Înscrie» is no longer offered.
    expect(await readRaffleLine(db, { table: "registration", id: jane.id }, NOW)).toEqual({ reason: "in", signUpMode: true, signedUp: true, maySignUp: false });
  });
});

describe("§NNN BR-REQ-060-01 the organizers (STAFF): a volunteer, a line of the elite list, anybody of the event", () => {
  it("lets the Organizer and the Administrators sign a volunteer and an elite line up; every other role is refused, nothing written", async () => {
    const ion = await volunteer("Ion Voluntar", 500);
    const line = await eliteLine("Eliud K.");
    for (const role of STAFF_ROLES.filter((candidate) => !canTakeRaffleList(candidate))) {
      expect((await failureOf(signUpForRaffleByStaff(db, await staff(role), { person: { table: "volunteer", id: ion }, accepted: true, eventId }, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect(await entries()).toEqual([]);
    const organizer = await staff("MODERATOR");
    expect(await signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: ion }, accepted: true, eventId }, NOW)).toBe("created");
    expect(await signUpForRaffleByStaff(db, await staff("ADMIN"), { person: { table: "elite", id: line }, accepted: true, eventId }, NOW)).toBe("created");
    const rows = await entries();
    expect(rows.find((row) => row.volunteerId === ion)).toMatchObject({ method: "STAFF", recordedByStaffUserId: organizer.id, ip: null });
    expect(rows.find((row) => row.eliteEntryId === line)).toMatchObject({ method: "STAFF", rulesLocale: "ro" });
    expect((await signUpTrail()).map((row) => (row.metadataJson as { kind: string; method: string }).kind).sort()).toEqual(["ELITE", "VOLUNTEER"]);
  });

  it("finds no person of another event, and asks the acceptance", async () => {
    const ion = await volunteer("Ion Voluntar", 500);
    const other = await race();
    const organizer = await staff("MODERATOR");
    expect((await failureOf(signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: ion }, accepted: true, eventId: other.eventId }, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(signUpForRaffleByStaff(db, organizer, { person: { table: "elite", id: "00000000-0000-4000-8000-000000000000" }, accepted: true, eventId }, NOW))).code).toBe("NOT_FOUND");
    expect((await failureOf(signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: ion }, accepted: false, eventId }, NOW))).code).toBe("RAFFLE_RULES_NOT_ACCEPTED");
    expect(await entries()).toEqual([]);
  });
});

describe("§NNN BR-REQ-050-02 the one gate: each condition alone shuts every door, writing nothing", () => {
  type Shut = { label: string; event?: Partial<typeof events.$inferInsert>; texts?: () => Promise<void>; at?: Date };
  const conditions: Shut[] = [
    { label: "no raffle", event: { hasRaffle: false } },
    { label: "«Din oficiu»", event: { raffleSignUp: false } },
    { label: "sign-ups shut", event: { raffleSignUpOpen: false } },
    { label: "not a race", event: { type: "GROUP_RUN" } },
    { label: "not published", event: { editorialStatus: "DRAFT", publishedAt: null } },
    { label: "cancelled", event: { eventStatus: "CANCELLED" } },
    { label: "over", at: new Date(START.getTime() + 2 * DAY) },
    // A version of the rules in Romanian alone: the English half of the site would refuse its visitors.
    { label: "rules in one language", texts: async () => {
      await resetLegal();
      await approveNotice();
      await approveRules(["ro"]);
    } },
    // A notice that names `{{raffle}}` in Romanian alone.
    { label: "a notice that does not name it everywhere", texts: async () => {
      await resetLegal();
      await approveNotice(["ro"]);
      await approveRules();
    } },
  ];

  async function resetLegal() {
    const { legalDocuments, legalDocumentTranslations, legalDocumentNumbering } = await import("@/db/schema/legal-documents");
    await db.delete(legalDocumentTranslations);
    await db.delete(legalDocuments);
    await db.delete(legalDocumentNumbering);
  }

  it.each(conditions.map((condition) => [condition.label, condition] as const))("%s", async (_label, condition) => {
    const ana = await runner("Ana Popescu", 7);
    const ion = await volunteer("Ion Voluntar", 500);
    if (condition.event) await db.update(events).set(condition.event).where(eq(events.id, eventId));
    if (condition.texts) await condition.texts();
    const at = condition.at ?? NOW;
    const desk = await staff("CONTRIBUTOR");
    const organizer = await staff("MODERATOR");
    const secret = (await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: new Date(START.getTime() + 10 * DAY), now: NOW })).secret;

    expect((await failureOf(signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), at, TRACE))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    expect((await failureOf(signUpForRaffleByLink(db, { secret, accepted: true, locale: "ro" }, at))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    expect((await failureOf(withdrawFromRaffleByLink(db, { secret }, at))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    expect((await failureOf(signUpForRaffleAtDesk(db, desk, { registrationId: ana.id, accepted: true }, at))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    expect((await failureOf(signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: ion }, accepted: true, eventId }, at))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    expect(await entries()).toEqual([]);
    expect(await signUpTrail()).toEqual([]);
    // Nothing is drawn: no card on the link's page, no «Înscrie» at the desk.
    expect((await readRaffleManageCards(db, eventId, [{ id: ana.id, anotherAdult: false }], at)).size).toBe(0);
    expect((await readRaffleLine(db, { table: "registration", id: ana.id }, at))?.maySignUp ?? false).toBe(false);
  });

  it("is open on race day after the start, and shuts at the event's day's end on its own clock", async () => {
    const ana = await runner("Ana Popescu", 7);
    const desk = await staff("CONTRIBUTOR");
    // 14:00 in Bucharest on race day: the race started at 09:00, the desk still signs people up.
    expect(await signUpForRaffleAtDesk(db, desk, { registrationId: ana.id, accepted: true }, new Date("2026-11-21T12:00:00.000Z"))).toBe("created");
    const radu = await runner("Radu Munteanu", 2);
    expect((await failureOf(signUpForRaffleAtDesk(db, desk, { registrationId: radu.id, accepted: true }, new Date("2026-11-21T22:00:00.000Z")))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
  });

  it("shuts the door of a group unticked for its people alone", async () => {
    const ana = await runner("Ana Popescu", 7);
    const ion = await volunteer("Ion Voluntar", 500);
    await setGroups({ VOLUNTEER: false });
    const organizer = await staff("MODERATOR");
    expect((await failureOf(signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: ion }, accepted: true, eventId }, NOW))).code).toBe("RAFFLE_SIGN_UP_CLOSED");
    expect(await signUpForRaffleByStaff(db, organizer, { person: { table: "registration", id: ana.id }, accepted: true, eventId }, NOW)).toBe("created");
  });
});

describe("§NNN BR-REQ-071-01 who takes part: one answer for both modes and every group tick", () => {
  /** The owner's race: a runner, an elite registration, two volunteers, two lines of the elite list, and people the raffle never takes. */
  async function saturday() {
    const ana = await runner("Ana Popescu", 7, { checkedInAt: NOW });
    const radu = await runner("Radu Munteanu", 2);
    const eliud = await runner("Eliud Kipchoge", 3, { elite: true });
    const elena = await runner("Elena Waiting", null, { status: "WAITLISTED" });
    const ion = await volunteer("Ion Voluntar", 500, { present: true });
    const oana = await volunteer("Oana Voluntar", 501);
    const vlad = await volunteer("Vlad Offered", null, { state: "REGISTERED" });
    const zoe = await eliteLine("Zoe Elita");
    const mo = await eliteLine("Mo Farah", 900);
    return { ana, radu, eliud, elena, ion, oana, vlad, zoe, mo };
  }

  it("«Din oficiu»: everybody of the ticked groups who is confirmed with a number and not taken out — the lines of the elite list too", async () => {
    await db.update(events).set({ raffleSignUp: false }).where(eq(events.id, eventId));
    const people = await saturday();
    const roster = await readRaffleRoster(db, await staff("MODERATOR"), eventId, NOW);
    const reasonOf = (id: string) => roster?.rows.find((row) => row.ref.id === id)?.reason;
    expect(reasonOf(people.ana.id)).toBe("in");
    expect(reasonOf(people.eliud.id)).toBe("in");
    expect(reasonOf(people.elena.id)).toBe("notConfirmed");
    expect(reasonOf(people.vlad)).toBe("notConfirmed");
    expect(reasonOf(people.zoe)).toBe("in");
    expect(roster?.counts).toEqual({ in: { RUNNER: 2, ELITE: 3, VOLUNTEER: 2 }, total: 7, present: 2 });
    // The file is the same answer, by the number, the numberless lines last by name — «Elită» for a marked registration and a line alike.
    const admin = await staff("ADMIN");
    const list = await exportRaffleList(db, admin, eventId, NOW);
    expect(list.rows.map((row) => `${row.number ?? "—"} ${row.name} ${row.kind}`)).toEqual([
      "2 Radu Munteanu RUNNER",
      "3 Eliud Kipchoge ELITE",
      "7 Ana Popescu RUNNER",
      "500 Ion Voluntar VOLUNTEER",
      "501 Oana Voluntar VOLUNTEER",
      "900 Mo Farah ELITE",
      "— Zoe Elita ELITE",
    ]);
    expect(list).toMatchObject({ runners: 2, elites: 3, volunteers: 2 });
    // Nobody signed up and nothing asked: the sign-up is no condition of this mode.
    expect(await entries()).toEqual([]);
  });

  it("«Cu înscriere separată»: only those who signed up — the rest «nu s-a înscris» —, the files and the counts with it", async () => {
    const people = await saturday();
    const organizer = await staff("MODERATOR");
    await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE);
    await signUpForRaffleByStaff(db, organizer, { person: { table: "elite", id: people.zoe }, accepted: true, eventId }, NOW);
    await signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: people.oana }, accepted: true, eventId }, NOW);
    const roster = await readRaffleRoster(db, organizer, eventId, NOW);
    const reasonOf = (id: string) => roster?.rows.find((row) => row.ref.id === id)?.reason;
    expect(reasonOf(people.ana.id)).toBe("in");
    expect(reasonOf(people.radu.id)).toBe("notSignedUp");
    expect(reasonOf(people.eliud.id)).toBe("notSignedUp");
    expect(reasonOf(people.ion)).toBe("notSignedUp");
    expect(reasonOf(people.zoe)).toBe("in");
    expect(reasonOf(people.oana)).toBe("in");
    expect(roster?.counts).toEqual({ in: { RUNNER: 1, ELITE: 1, VOLUNTEER: 1 }, total: 3, present: 1 });
    // How and when, for the tab; «Înscrie» offered only to who may still sign up.
    const ana = roster?.rows.find((row) => row.ref.id === people.ana.id);
    expect(ana?.signUp).toMatchObject({ method: "FORM", at: NOW });
    expect(ana?.maySignUp).toBe(false);
    expect(roster?.rows.find((row) => row.ref.id === people.radu.id)?.maySignUp).toBe(true);
    expect(roster?.rows.find((row) => row.ref.id === people.elena.id)?.maySignUp).toBe(false);
    const list = await exportRaffleList(db, organizer, eventId, NOW);
    expect(list.rows.map((row) => row.name)).toEqual(["Ana Popescu", "Oana Voluntar", "Zoe Elita"]);
    // The present-only file: Ana was checked in, Oana not ticked, Zoe not ticked.
    expect((await exportRaffleList(db, organizer, eventId, NOW, { onlyPresent: true })).rows.map((row) => row.name)).toEqual(["Ana Popescu"]);
    // The lists' columns read the same answer.
    const reasons = await raffleReasonsFor(db, eventId, { registrationIds: [people.ana.id, people.radu.id], volunteerIds: [people.oana, people.ion] });
    expect(Object.fromEntries(reasons)).toEqual({ [people.ana.id]: "in", [people.radu.id]: "notSignedUp", [people.oana]: "in", [people.ion]: "notSignedUp" });
  });

  it("lets the group ticks decide in both modes, and keeps the organizers' exclusion in both", async () => {
    const people = await saturday();
    const organizer = await staff("MODERATOR");
    for (const signUp of [false, true]) {
      await db.update(events).set({ raffleSignUp: signUp }).where(eq(events.id, eventId));
      if (signUp) {
        for (const person of [{ table: "registration" as const, id: people.ana.id }, { table: "registration" as const, id: people.eliud.id }, { table: "volunteer" as const, id: people.ion }]) {
          await signUpForRaffleByStaff(db, organizer, { person, accepted: true, eventId }, NOW);
        }
      }
      for (const unticked of RAFFLE_KINDS) {
        await setGroups({ RUNNER: true, ELITE: true, VOLUNTEER: true, [unticked]: false });
        const roster = await readRaffleRoster(db, organizer, eventId, NOW);
        const reasonOf = (id: string) => roster?.rows.find((row) => row.ref.id === id)?.reason;
        const label = `${signUp ? "sign-up" : "automatic"}, ${unticked} unticked`;
        expect(reasonOf(people.ana.id), label).toBe(unticked === "RUNNER" ? "groupNotAllowed" : "in");
        expect(reasonOf(people.eliud.id), label).toBe(unticked === "ELITE" ? "groupNotAllowed" : "in");
        expect(reasonOf(people.ion), label).toBe(unticked === "VOLUNTEER" ? "groupNotAllowed" : "in");
        expect(roster?.counts.in[unticked], label).toBe(0);
      }
      await setGroups({ RUNNER: true, ELITE: true, VOLUNTEER: true });
      // Taken out by the organizers: out, though signed up.
      await db.update(registrations).set({ inRaffle: false }).where(eq(registrations.id, people.ana.id));
      const roster = await readRaffleRoster(db, organizer, eventId, NOW);
      expect(roster?.rows.find((row) => row.ref.id === people.ana.id)?.reason, signUp ? "sign-up" : "automatic").toBe("takenOut");
      await db.update(registrations).set({ inRaffle: true }).where(eq(registrations.id, people.ana.id));
    }
  });

  it("is read by the organizers alone (BR-REQ-060-01)", async () => {
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canTakeRaffleList(role)) expect(await readRaffleRoster(db, actor, eventId, NOW), role).not.toBeNull();
      else expect((await failureOf(readRaffleRoster(db, actor, eventId, NOW))).code, role).toBe("FORBIDDEN");
    }
  });
});

describe("§NNN BR-REQ-071-01 a line of the elite list: its two ticks, the organizers'", () => {
  it("takes a line out and puts it back, ticks it present and clears it — audited by its id, never its name, the same value writing nothing", async () => {
    await db.update(events).set({ raffleSignUp: false }).where(eq(events.id, eventId));
    const line = await eliteLine("Eliud K.", 777);
    const organizer = await staff("MODERATOR");
    expect(await setEliteLineRaffleTick(db, organizer, { entryId: line, eventId, tick: "inRaffle", on: false }, NOW)).toEqual({ changed: true });
    expect((await readRaffleRoster(db, organizer, eventId, NOW))?.rows[0].reason).toBe("takenOut");
    expect((await exportRaffleList(db, organizer, eventId, NOW)).rows).toEqual([]);
    expect(await setEliteLineRaffleTick(db, organizer, { entryId: line, eventId, tick: "inRaffle", on: false }, NOW)).toEqual({ changed: false });
    expect(await setEliteLineRaffleTick(db, organizer, { entryId: line, eventId, tick: "inRaffle", on: true }, NOW)).toEqual({ changed: true });
    expect(await setEliteLineRaffleTick(db, organizer, { entryId: line, eventId, tick: "present", on: true }, NOW)).toEqual({ changed: true });
    expect((await exportRaffleList(db, organizer, eventId, NOW, { onlyPresent: true })).rows).toEqual([{ number: 777, name: "Eliud K.", kind: "ELITE", present: true }]);
    expect(await setEliteLineRaffleTick(db, organizer, { entryId: line, eventId, tick: "present", on: false }, NOW)).toEqual({ changed: true });
    const rows = (await trail()).filter((row) => row.action.startsWith("event_elite."));
    expect(rows.map((row) => row.action)).toEqual(["event_elite.out_of_raffle", "event_elite.in_raffle", "event_elite.present", "event_elite.absent"]);
    expect(rows[0].metadataJson).toEqual({ entryId: line, inRaffle: false });
    expect(JSON.stringify(rows)).not.toContain("Eliud");
  });

  it("is refused to every role but the organizers, and finds no line of another event", async () => {
    const line = await eliteLine("Eliud K.", 777);
    for (const role of STAFF_ROLES.filter((candidate) => !canTakeRaffleList(candidate))) {
      expect((await failureOf(setEliteLineRaffleTick(db, await staff(role), { entryId: line, eventId, tick: "present", on: true }, NOW))).code, role).toBe("FORBIDDEN");
    }
    const other = await race();
    expect((await failureOf(setEliteLineRaffleTick(db, await staff("ADMIN"), { entryId: line, eventId: other.eventId, tick: "present", on: true }, NOW))).code).toBe("NOT_FOUND");
    expect((await db.select({ present: eventEliteEntries.present }).from(eventEliteEntries))[0].present).toBe(false);
  });
});

describe("§NNN «Șterge înscrierea»: the organizers take a sign-up off, at any time", () => {
  it("deletes it, audited as the staff's, for the organizers alone — and finds none of another event", async () => {
    const ana = await runner("Ana Popescu", 7);
    await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE);
    const [row] = await entries();
    expect((await failureOf(deleteRaffleEntry(db, await staff("CONTRIBUTOR"), { entryId: row.id, eventId }, NOW))).code).toBe("FORBIDDEN");
    const other = await race();
    const admin = await staff("ADMIN");
    expect((await failureOf(deleteRaffleEntry(db, admin, { entryId: row.id, eventId: other.eventId }, NOW))).code).toBe("NOT_FOUND");
    // With the sign-ups shut, still: a correction of the organizers', not a door.
    await db.update(events).set({ raffleSignUpOpen: false }).where(eq(events.id, eventId));
    expect(await deleteRaffleEntry(db, admin, { entryId: row.id, eventId }, NOW)).toEqual({ eventId });
    expect(await entries()).toEqual([]);
    const withdrawn = (await signUpTrail()).find((audit) => audit.action === "event_raffle.entry_withdrawn");
    expect(withdrawn).toMatchObject({ actorStaffUserId: admin.id, metadataJson: { entryId: row.id, kind: "RUNNER", by: "staff" } });
    expect(ana.id).toBeTruthy();
  });
});

describe("§NNN BR-REQ-070-01 the sign-up's life: «Toate datele unei persoane», the sweep, its person, the legal list", () => {
  it("is listed in the person's data with its door, its version, the name typed and the trace", async () => {
    const ana = await runner("Ana Popescu", 7);
    await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE);
    const data = await exportPersonData(db, await staff("ADMIN"), ana.email, NOW);
    expect(data.raffleEntries).toEqual([
      expect.objectContaining({ eventId, registrationId: ana.id, volunteerId: null, method: "FORM", rulesVersion: 1, rulesLocale: "ro", typedName: "Ana Popescu", ip: TRACE.ip, userAgent: TRACE.userAgent, recordedByRole: null, privacyNoticeVersion: noticeVersion }),
    ]);
  });

  it("goes with its registration, its volunteer, its line and its event", async () => {
    const ana = await runner("Ana Popescu", 7);
    const ion = await volunteer("Ion Voluntar", 500);
    const line = await eliteLine("Eliud K.");
    const organizer = await staff("MODERATOR");
    await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE);
    await signUpForRaffleByStaff(db, organizer, { person: { table: "volunteer", id: ion }, accepted: true, eventId }, NOW);
    await signUpForRaffleByStaff(db, organizer, { person: { table: "elite", id: line }, accepted: true, eventId }, NOW);
    await db.delete(registrations).where(eq(registrations.id, ana.id));
    await db.delete(eventVolunteers).where(eq(eventVolunteers.id, ion));
    expect((await entries()).map((row) => row.eliteEntryId)).toEqual([line]);
    await db.delete(events).where(eq(events.id, eventId));
    expect(await entries()).toEqual([]);
  });

  it("is deleted by the maintenance sweep thirty days after the event's start, and not a day before", async () => {
    await runner("Ana Popescu", 7);
    await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE);
    const before = await pruneExpiredRows(db, new Date(START.getTime() + 29 * DAY));
    expect(before.raffleEntries).toBe(0);
    expect(await entries()).toHaveLength(1);
    const after = await pruneExpiredRows(db, new Date(START.getTime() + 31 * DAY));
    expect(after.raffleEntries).toBe(1);
    expect(await entries()).toEqual([]);
  });

  it("counts on the legal list as an acceptance of the rules' version — a version somebody accepted is never deleted", async () => {
    await runner("Ana Popescu", 7);
    await runner("Radu Munteanu", 2);
    await signUpForRaffleByForm(db, eventId, form("7", "Ana Popescu"), NOW, TRACE);
    await signUpForRaffleByForm(db, eventId, form("2", "Radu Munteanu"), NOW, TRACE);
    const rules = (await listVersionsForBackoffice(db)).find((version) => version.key === "RAFFLE_RULES");
    expect(rules?.acceptanceCount).toBe(2);
  });
});

describe("§NNN the sign-up is nobody's message", () => {
  it("queues no email at any door, at a withdrawal or at a deletion", async () => {
    const ana = await runner("Ana Popescu", 7);
    const radu = await runner("Radu Munteanu", 2);
    const ion = await volunteer("Ion Voluntar", 500);
    const secret = (await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: START, now: NOW })).secret;
    await signUpForRaffleByLink(db, { secret, accepted: true, locale: "ro" }, NOW);
    await signUpForRaffleByForm(db, eventId, form("2", "Radu Munteanu"), NOW, TRACE);
    await signUpForRaffleByStaff(db, await staff("MODERATOR"), { person: { table: "volunteer", id: ion }, accepted: true, eventId }, NOW);
    await withdrawFromRaffleByLink(db, { secret }, NOW);
    const [left] = await db.select().from(eventRaffleEntries).where(and(eq(eventRaffleEntries.eventId, eventId), eq(eventRaffleEntries.registrationId, radu.id)));
    await deleteRaffleEntry(db, await staff("ADMIN"), { entryId: left.id, eventId }, NOW);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });
});
