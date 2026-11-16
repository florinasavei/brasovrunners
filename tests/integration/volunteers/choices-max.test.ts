import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerInvitations } from "@/db/schema/event-volunteer-invitations";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { generateTokenSecret, hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { serializeEventFile } from "@/modules/content/events/transfer/file-format";
import { readVolunteersFile } from "@/modules/content/events/transfer/volunteers";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { STAFF_ROLES, canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { changeVolunteer, listVolunteers, readPublicVolunteerRoles, setVolunteerChoicesMax, submitVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { bornAged } from "../../helpers/volunteer-birth";

/** The public cache's expiry, watched: the event's public page is told when the limit moves, and only then. */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: cache.revalidatePublicContent,
}));

/**
 * §951 — «Cel mult câte roluri poate bifa o persoană» (amending §761; the owner, 2026-11-16, five days before the race:
 * «voluntarii primesc prea multe roluri» — asked where it goes wrong, «Bifează prea multe pe formular», and asked for «cel
 * mult 2 roluri, sau unul»). BR-REQ-031-01 for the public form, BR-REQ-050-02 for the card's setting, BR-REQ-060-01 for who.
 *
 * What is protected, on real PostgreSQL (PGlite), straight through the services:
 * - an event has no limit until the club sets one, and the setting — a whole number from 1 to 20, or none — is saved only
 *   by whoever may manage volunteers, refused naming the box otherwise, audited with the old and the new value, without
 *   moving the page's version, and tells the public page once per change;
 * - the public sign-up refuses a post that ticks more distinct roles than the limit — `VALIDATION_ERROR` naming `roleIds`,
 *   nothing written, nothing queued, no allowance spent — and keeps a post at or under it; with no limit any number passes;
 *   the same id posted twice is one role; the refusal is judged on the post alone, before the «full» pass and the repeat;
 * - the limit is the public form's, whichever door the post came through — the page, a member's session, an invitation's
 *   link — and in both shapes of the form;
 * - the organizers' own entry and «Modifică» are not limited, nor the roles they give, and a person who ticked more
 *   before the limit was set keeps what they ticked;
 * - the public read carries the limit to the form; a copy, a repeat, a series edit and the event's file never carry it.
 */
const NOW = new Date("2026-11-16T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@example.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** The notice in force, in both languages: it names the volunteers and the agreement — and, with `profile`, what a volunteer says about themselves (§765). */
async function approveNotice(profile = false, version = 1) {
  const marker = profile ? "Voluntari ({{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}})" : "Voluntari ({{volunteers}}, {{volunteerAgreement}})";
  const body = (text: string) => ({ sections: [{ paragraphs: [`${marker}: ${text}`] }] });
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
    { locale: "en", title: "Privacy", body: body("we keep the name") },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
}

async function approveAgreement() {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
  await insertLegalDocumentVersion(db, { key: "VOLUNTEER_AGREEMENT", version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
}

async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 5 * DAY), editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), acceptsVolunteers: true, ...overrides })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
  ]);
  return event;
}

const ROLE_NAMES = ["Punct de apă", "Direcționare", "Kituri", "Sosire", "Start"] as const;
/** Five roles of the event, none with a number (§784): never full, so only the limit speaks. */
async function seedRoles(eventId: string, needed: number | null = null) {
  const rows = await db
    .insert(eventVolunteerRoles)
    .values(ROLE_NAMES.map((name, position) => ({ eventId, nameRo: name, nameEn: `${name} (en)`, needed, position })))
    .returning({ id: eventVolunteerRoles.id });
  return rows.map((row) => row.id);
}

/** A post as the form makes it (§758's shape): the roles ticked under one name. */
const offer = (roleIds: readonly string[], extra: Record<string, unknown> = {}) => ({
  roleIds: [...roleIds],
  name: "Maria Test",
  email: "maria@example.test",
  phone: "+40712345678",
  message: "",
  locale: "ro",
  consent: true,
  agreement: true,
  adult: true,
  renderedAt: RENDERED,
  ...extra,
});

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

const stored = async (eventId: string) => (await db.select().from(events).where(eq(events.id, eventId)))[0];
const limitOf = async (eventId: string) => (await stored(eventId)).volunteerChoicesMax;
const people = (eventId: string) => db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
const choicesOf = async (volunteerId: string) =>
  (await db.select({ roleId: eventVolunteerRoleChoices.roleId }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, volunteerId))).map((row) => row.roleId).sort();
const trailOf = (eventId: string) => db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId)).orderBy(asc(auditLogs.createdAt));
const limitTrail = async (eventId: string) => (await trailOf(eventId)).filter((row) => row.action === "event.volunteer_choices_max_set");
/** Everything a post could leave behind: a person, an email, a spent allowance, a line of the trail. */
const nothingWritten = async (eventId: string) => {
  expect(await people(eventId)).toHaveLength(0);
  expect(await db.select().from(emailOutbox)).toHaveLength(0);
  expect(await db.select().from(rateLimitBuckets)).toHaveLength(0);
  expect((await trailOf(eventId)).filter((row) => row.action === "volunteer.signed_up")).toHaveLength(0);
};

beforeEach(async () => {
  await resetTables(db);
  cache.revalidatePublicContent.mockClear();
  await approveNotice();
  await approveAgreement();
  admin = await staff("ADMIN");
  organizer = await staff("MODERATOR");
});

describe("§951 BR-REQ-050-02 «Cel mult câte roluri poate bifa o persoană»: the event's setting", () => {
  it("is none on every event until the club sets one, however the event was made", async () => {
    const event = await seedEvent();
    expect(await limitOf(event.id)).toBeNull();
    const [bare] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + DAY) }).returning();
    expect(bare.volunteerChoicesMax).toBeNull();
  });

  it("is set, moved and taken off by whoever manages volunteers — audited with the old and the new value, never a person — and a press that changes nothing writes nothing", async () => {
    const event = await seedEvent();
    expect(await setVolunteerChoicesMax(db, organizer, { eventId: event.id, max: 2 }, at(0))).toEqual({ changed: true });
    expect(await limitOf(event.id)).toBe(2);
    // The same number again: nothing moved, nothing written, the public page not told.
    cache.revalidatePublicContent.mockClear();
    expect(await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 2 }, at(1))).toEqual({ changed: false });
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
    expect(await limitTrail(event.id)).toHaveLength(1);

    expect(await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 1 }, at(2))).toEqual({ changed: true });
    expect(await limitOf(event.id)).toBe(1);
    // An empty box takes the limit off.
    expect(await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: null }, at(3))).toEqual({ changed: true });
    expect(await limitOf(event.id)).toBeNull();
    expect(await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: null }, at(4))).toEqual({ changed: false });

    const rows = await limitTrail(event.id);
    expect(rows.map((row) => [row.actorStaffUserId, row.entityType, row.metadataJson])).toEqual([
      [organizer.id, "event", { from: null, to: 2 }],
      [admin.id, "event", { from: 2, to: 1 }],
      [admin.id, "event", { from: 1, to: null }],
    ]);
    expect(JSON.stringify(rows.map((row) => row.metadataJson))).not.toMatch(/maria|@|\+40/i);
  });

  it("takes the two ends of its range and refuses what is no limit — nought, a negative, twenty-one, a fraction, no number — naming the box, with nothing written", async () => {
    const event = await seedEvent();
    for (const max of [1, 20]) {
      expect(await setVolunteerChoicesMax(db, admin, { eventId: event.id, max }, NOW), String(max)).toEqual({ changed: true });
      expect(await limitOf(event.id)).toBe(max);
    }
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 2 }, NOW);
    const before = await limitTrail(event.id);
    cache.revalidatePublicContent.mockClear();
    for (const max of [0, -1, 21, 1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const refusal = await failureOf(setVolunteerChoicesMax(db, admin, { eventId: event.id, max }, NOW));
      expect(refusal.code, String(max)).toBe("VALIDATION_ERROR");
      expect(refusal.fields, String(max)).toEqual(["volunteerChoicesMax"]);
    }
    expect(await limitOf(event.id)).toBe(2);
    expect(await limitTrail(event.id)).toHaveLength(before.length);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("does not move the page's version, and tells the event's public page once per change — as «Oferim tricouri voluntarilor» does", async () => {
    const event = await seedEvent();
    const before = (await stored(event.id)).version;
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 2 }, NOW);
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("events", "places");
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: null }, NOW);
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(2);
    // No edit of the page's text: an editor open meanwhile still saves.
    expect((await stored(event.id)).version).toBe(before);
    // …and nothing else of the event moved.
    expect(await stored(event.id)).toMatchObject({ acceptsVolunteers: true, volunteersShirts: false, volunteersShowCounts: false, volunteersAccess: "ANYONE", volunteersButtonShown: true, volunteerBibStart: null });
  });

  it("answers an event that is not there, and an id that is none, as every verb of the card does", async () => {
    await expect(setVolunteerChoicesMax(db, admin, { eventId: "11111111-1111-4111-8111-111111111111", max: 2 }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setVolunteerChoicesMax(db, admin, { eventId: "nope", max: 2 }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it.each(STAFF_ROLES.filter((role) => !canManageVolunteers(role)).map((role) => [role] as const))("BR-REQ-060-01 refuses the %s role, and writes nothing", async (role) => {
    const event = await seedEvent();
    expect((await failureOf(setVolunteerChoicesMax(db, await staff(role), { eventId: event.id, max: 2 }, NOW))).code).toBe("FORBIDDEN");
    // Refused before the box is even read: a number that is no limit says FORBIDDEN too, never what is wrong with it.
    expect((await failureOf(setVolunteerChoicesMax(db, await staff(role), { eventId: event.id, max: 99 }, NOW))).code).toBe("FORBIDDEN");
    expect(await limitOf(event.id)).toBeNull();
    expect(await limitTrail(event.id)).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("BR-REQ-060-01 the refused roles are the Tehnic role, the Redactor, the desk Volunteer and a member — nobody else", () => {
    expect(STAFF_ROLES.filter((role) => !canManageVolunteers(role)).sort()).toEqual(["CONTRIBUTOR", "COPYWRITER", "DEV", "MEMBER"]);
  });

  it.each(STAFF_ROLES.filter((role) => canManageVolunteers(role)).map((role) => [role] as const))("BR-REQ-060-01 serves the %s role", async (role) => {
    const event = await seedEvent();
    expect(await setVolunteerChoicesMax(db, await staff(role), { eventId: event.id, max: 2 }, NOW)).toEqual({ changed: true });
    expect(await limitOf(event.id)).toBe(2);
  });
});

describe("§951 BR-REQ-031-01 the public sign-up under the event's limit", () => {
  it("refuses a post over the limit as the person's own fix — VALIDATION_ERROR naming `roleIds` — with nothing written, nothing queued and no allowance spent", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    const roles = await seedRoles(event.id);
    for (const ticked of [roles.slice(0, 3), roles]) {
      const refusal = await failureOf(submitVolunteer(db, event.id, offer(ticked), NOW));
      expect(refusal.code, String(ticked.length)).toBe("VALIDATION_ERROR");
      expect(refusal.fields, String(ticked.length)).toEqual(["roleIds"]);
    }
    await nothingWritten(event.id);
    // Nothing of the person in what the refusal carries: names of boxes only.
    expect(JSON.stringify((await failureOf(submitVolunteer(db, event.id, offer(roles), NOW))).fields)).not.toMatch(/maria|@/i);
  });

  it("keeps a post at the limit and one under it, every role ticked as a choice and none given", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    const roles = await seedRoles(event.id);
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 2), { email: "doi@example.test" }), NOW)).toEqual({ outcome: "done" });
    expect(await submitVolunteer(db, event.id, offer(roles.slice(4), { email: "unu@example.test" }), NOW)).toEqual({ outcome: "done" });
    const rows = await people(event.id);
    expect(rows.map((row) => [row.email, row.state, row.source, row.roleId]).sort()).toEqual([
      ["doi@example.test", "REGISTERED", "PUBLIC", null],
      ["unu@example.test", "REGISTERED", "PUBLIC", null],
    ]);
    const byEmail = new Map(rows.map((row) => [row.email, row.id]));
    expect(await choicesOf(byEmail.get("doi@example.test") as string)).toEqual(roles.slice(0, 2).sort());
    expect(await choicesOf(byEmail.get("unu@example.test") as string)).toEqual(roles.slice(4));
  });

  it("«Alege un singur rol»: a limit of one takes one tick and refuses two", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 1 });
    const roles = await seedRoles(event.id);
    expect((await failureOf(submitVolunteer(db, event.id, offer(roles.slice(0, 2)), NOW))).fields).toEqual(["roleIds"]);
    await nothingWritten(event.id);
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 1)), NOW)).toEqual({ outcome: "done" });
    expect(await people(event.id)).toHaveLength(1);
  });

  it("with no limit any number of roles passes, as it always did", async () => {
    const event = await seedEvent();
    const roles = await seedRoles(event.id);
    expect(await limitOf(event.id)).toBeNull();
    expect(await submitVolunteer(db, event.id, offer(roles), NOW)).toEqual({ outcome: "done" });
    const [row] = await people(event.id);
    expect(await choicesOf(row.id)).toEqual([...roles].sort());
  });

  it("counts a role once however many times its id was posted: two roles ticked, one of them three times, is two", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    const [water, guide, kits] = await seedRoles(event.id);
    expect(await submitVolunteer(db, event.id, offer([water, guide, water, water, ` ${guide} `]), NOW)).toEqual({ outcome: "done" });
    const [row] = await people(event.id);
    expect(await choicesOf(row.id)).toEqual([water, guide].sort());
    // A third distinct role among the repeats is over.
    expect((await failureOf(submitVolunteer(db, event.id, offer([water, water, guide, kits], { email: "alta@example.test" }), NOW))).fields).toEqual(["roleIds"]);
    expect(await people(event.id)).toHaveLength(1);
  });

  it("names the roles' box together with every other box that failed, in one pass", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    const roles = await seedRoles(event.id);
    const refusal = await failureOf(submitVolunteer(db, event.id, offer(roles, { name: "", consent: false }), NOW));
    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect([...refusal.fields].sort()).toEqual(["consent", "name", "roleIds"]);
    await nothingWritten(event.id);
  });

  it("is judged on the post alone, before the «full» pass and before the repeat is looked for: a listed address and a stranger hear the same", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    const roles = await seedRoles(event.id, 1);
    // Maria is on the list already; then the organizers give every role away, and each needed one person: all five are full.
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 2)), NOW)).toEqual({ outcome: "done" });
    const [maria] = await people(event.id);
    await db.insert(eventVolunteerRoleAssignments).values(roles.map((roleId) => ({ volunteerId: maria.id, roleId, createdAt: NOW })));
    // A post within the limit hears «full» — the listed person and the stranger alike, as §761 has it…
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 2)), at(1))).toEqual({ outcome: "full" });
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 2), { email: "strain@example.test" }), at(1))).toEqual({ outcome: "full" });
    /** Every allowance spent so far, row by row, in a fixed order. */
    const allowances = async () => (await db.select().from(rateLimitBuckets)).map((row) => JSON.stringify(row)).sort();
    const before = { people: (await people(event.id)).length, outbox: (await db.select().from(emailOutbox)).length, allowances: await allowances() };
    // …and a post over it hears the limit, the listed person and the stranger alike, whatever has filled and whoever is listed.
    for (const email of ["maria@example.test", "strain@example.test"]) {
      const refusal = await failureOf(submitVolunteer(db, event.id, offer(roles.slice(0, 3), { email }), at(2)));
      expect([refusal.code, refusal.fields], email).toEqual(["VALIDATION_ERROR", ["roleIds"]]);
    }
    // The over-limit posts left nothing behind: no person, no email, and — unlike the two «full» answers before them — no allowance spent.
    expect((await people(event.id)).length).toBe(before.people);
    expect((await db.select().from(emailOutbox)).length).toBe(before.outbox);
    expect(await allowances()).toEqual(before.allowances);
    expect(before.allowances.length).toBeGreaterThan(0);
  });

  it("is refused over the limit before a role that is not this event's is looked at, and a forged id within the limit is still the box's own refusal", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 1 });
    const [water] = await seedRoles(event.id);
    const other = await seedEvent();
    const [foreign] = await seedRoles(other.id);
    expect((await failureOf(submitVolunteer(db, event.id, offer([water, foreign]), NOW))).fields).toEqual(["roleIds"]);
    expect((await failureOf(submitVolunteer(db, event.id, offer([foreign]), NOW))).fields).toEqual(["roleIds"]);
    expect((await failureOf(submitVolunteer(db, event.id, offer([]), NOW))).fields).toEqual(["roleIds"]);
    expect(await people(event.id)).toHaveLength(0);
  });

  it("limits the form that asks what a volunteer says about themselves too (§765): the other shape of the same form", async () => {
    await approveNotice(true, 2);
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    const roles = await seedRoles(event.id);
    const profile = { birthDate: bornAged(30, new Date(NOW.getTime() + 5 * DAY)), sex: "FEMALE", city: "Brașov" };
    const refusal = await failureOf(submitVolunteer(db, event.id, offer(roles.slice(0, 3), profile), NOW));
    expect([refusal.code, refusal.fields]).toEqual(["VALIDATION_ERROR", ["roleIds"]]);
    await nothingWritten(event.id);
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 2), profile), NOW)).toEqual({ outcome: "done" });
    const [row] = await people(event.id);
    expect(row).toMatchObject({ city: "Brașov", sex: "FEMALE", source: "PUBLIC" });
    expect(await choicesOf(row.id)).toEqual(roles.slice(0, 2).sort());
  });

  it("limits a member's offer on a members' event as anybody's: the door changes who may offer, never how many roles", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2, volunteersAccess: "MEMBERS" });
    const roles = await seedRoles(event.id);
    const member = { member: { email: "membru@example.test" } };
    const refusal = await failureOf(submitVolunteer(db, event.id, offer(roles.slice(0, 3), { email: "membru@example.test" }), NOW, undefined, member));
    expect([refusal.code, refusal.fields]).toEqual(["VALIDATION_ERROR", ["roleIds"]]);
    await nothingWritten(event.id);
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 2), { email: "membru@example.test" }), NOW, undefined, member)).toEqual({ outcome: "done" });
    // A stranger to a members' event is refused at the door, limit or no limit.
    expect((await failureOf(submitVolunteer(db, event.id, offer(roles.slice(0, 1), { email: "strain@example.test" }), NOW))).code).toBe("FORBIDDEN");
  });

  it("limits an invited person's offer too, and a refused post leaves the invitation's link unspent", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 1, volunteersAccess: "INVITED" });
    const roles = await seedRoles(event.id);
    const secret = generateTokenSecret();
    await db.insert(eventVolunteerInvitations).values({
      eventId: event.id,
      deliveryEmail: "ioana@example.test",
      canonicalEmail: "ioana@example.test",
      canonicalizationVersion: 2,
      tokenHash: hashTokenSecret(secret),
      sentAt: NOW,
      expiresAt: new Date(NOW.getTime() + DAY),
    });
    const refusal = await failureOf(submitVolunteer(db, event.id, offer(roles.slice(0, 2), { email: "ioana@example.test" }), NOW, undefined, { inviteSecret: secret }));
    expect([refusal.code, refusal.fields]).toEqual(["VALIDATION_ERROR", ["roleIds"]]);
    await nothingWritten(event.id);
    const [unspent] = await db.select().from(eventVolunteerInvitations).where(eq(eventVolunteerInvitations.eventId, event.id));
    expect(unspent.volunteerId).toBeNull();
    // The same link, the post corrected: kept, and the link spent with it.
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 1), { email: "ioana@example.test" }), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "done" });
    const [row] = await people(event.id);
    const [spent] = await db.select().from(eventVolunteerInvitations).where(eq(eventVolunteerInvitations.eventId, event.id));
    expect(spent.volunteerId).toBe(row.id);
  });

  it("is the event's own row at the post, never the page's copy: set while a form is open it refuses the post, taken off it lets the same post through", async () => {
    const event = await seedEvent();
    const roles = await seedRoles(event.id);
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 2 }, NOW);
    expect((await failureOf(submitVolunteer(db, event.id, offer(roles), at(1)))).fields).toEqual(["roleIds"]);
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: null }, at(2));
    expect(await submitVolunteer(db, event.id, offer(roles), at(3))).toEqual({ outcome: "done" });
  });
});

describe("§951 the limit is the public form's alone", () => {
  /** The organizers' own entry, as «Adaugă un voluntar de mână» posts it. */
  const entry = (roleIds: readonly string[], assignedRoleIds: readonly string[] = []) => ({
    roleIds: [...roleIds],
    assignedRoleIds: [...assignedRoleIds],
    name: "Ion Adăugat",
    email: "ion@example.test",
    phone: "+40712345679",
  });

  it("a staff entry with more choices than the limit is saved, every choice kept", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 1 });
    const roles = await seedRoles(event.id);
    const result = await changeVolunteer(db, organizer, { kind: "add", eventId: event.id, fields: entry(roles) }, NOW, { sendEmail: false });
    expect(result.changed).toBe(true);
    const [person] = await listVolunteers(db, event.id);
    expect(person).toMatchObject({ name: "Ion Adăugat", source: "STAFF" });
    expect([...person.choiceIds].sort()).toEqual([...roles].sort());
  });

  it("«Modifică» may tick more choices than the limit on a person who offered on the page, and the organizers may give more roles than it", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 1 });
    const roles = await seedRoles(event.id);
    expect(await submitVolunteer(db, event.id, offer(roles.slice(0, 1)), NOW)).toEqual({ outcome: "done" });
    const [maria] = await listVolunteers(db, event.id);
    const edited = await changeVolunteer(
      db,
      admin,
      { kind: "edit", eventId: event.id, id: maria.id, fields: { ...entry(roles.slice(0, 4)), name: maria.name, email: maria.email, phone: maria.phone } },
      at(1),
      { sendEmail: false },
    );
    expect(edited.changed).toBe(true);
    expect([...(await listVolunteers(db, event.id))[0].choiceIds].sort()).toEqual(roles.slice(0, 4).sort());
    // «Dă-i rolul …» twice: two roles given under a limit of one.
    for (const roleId of roles.slice(0, 2)) await changeVolunteer(db, admin, { kind: "assign", eventId: event.id, id: maria.id, roleId }, at(2), { sendEmail: false });
    expect([...(await listVolunteers(db, event.id))[0].roleIds].sort()).toEqual(roles.slice(0, 2).sort());
  });

  it("a person who ticked more before the limit was set keeps what they ticked: setting it changes nobody already listed", async () => {
    const event = await seedEvent();
    const roles = await seedRoles(event.id);
    expect(await submitVolunteer(db, event.id, offer(roles), NOW)).toEqual({ outcome: "done" });
    const [before] = await listVolunteers(db, event.id);
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 1 }, at(1));
    const [after] = await listVolunteers(db, event.id);
    expect([...after.choiceIds].sort()).toEqual([...roles].sort());
    expect(after).toMatchObject({ id: before.id, state: before.state, updatedAt: before.updatedAt });
    // …and their repeat, ticking what they had ticked, is over the limit like anybody's.
    expect((await failureOf(submitVolunteer(db, event.id, offer(roles), at(2)))).fields).toEqual(["roleIds"]);
  });
});

describe("§951 where the limit is read, and where it never travels", () => {
  it("the public read carries it to the form beside «Oferim tricouri voluntarilor», and an event that takes no volunteers reads none", async () => {
    const event = await seedEvent();
    await seedRoles(event.id);
    expect(await readPublicVolunteerRoles(db, event.id)).toMatchObject({ acceptsVolunteers: true, shirts: false, choicesMax: null });
    await setVolunteerChoicesMax(db, admin, { eventId: event.id, max: 2 }, NOW);
    expect(await readPublicVolunteerRoles(db, event.id)).toMatchObject({ acceptsVolunteers: true, shirts: false, choicesMax: 2 });
    const closed = await seedEvent({ acceptsVolunteers: false, volunteerChoicesMax: 3 });
    expect(await readPublicVolunteerRoles(db, closed.id)).toEqual({ acceptsVolunteers: false, access: "ANYONE", shirts: false, showCounts: false, buttonShown: true, choicesMax: null, roles: [], categories: [] });
  });

  it("is one edition's own, like «Oferim tricouri voluntarilor»: a copy and every date of a repeat start without it", async () => {
    const source = await seedEvent({ volunteerChoicesMax: 2, volunteersShirts: true });
    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect(await stored(copy.id)).toMatchObject({ volunteerChoicesMax: null, volunteersShirts: false, acceptsVolunteers: false });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-12", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect([date.volunteerChoicesMax, date.volunteersShirts]).toEqual([null, false]);
    expect(await limitOf(source.id)).toBe(2);
  });

  it("is carried by no series edit: «toate datele» neither spreads one date's limit nor wipes another's", async () => {
    const source = await seedEvent({ editorialStatus: "DRAFT", publishedAt: null, locationName: "Parcul Tractorul", timezone: "Europe/Bucharest" });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-12", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBeGreaterThanOrEqual(2);
    await setVolunteerChoicesMax(db, admin, { eventId: source.id, max: 2 }, NOW);
    await setVolunteerChoicesMax(db, admin, { eventId: dates[1].id, max: 5 }, NOW);

    const row = await stored(source.id);
    const [ro] = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, source.id))).filter((translation) => translation.locale === "ro");
    const result = await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: {
        type: row.type,
        eventStatus: row.eventStatus,
        timezone: row.timezone,
        startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: row.surface,
        difficulty: null,
        costType: null,
        mapUrl: "https://maps.example.test/start",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: row.registrationMode,
        participantListVisibility: "HIDDEN" as const,
        capacity: "",
        minAge: String(row.minAge),
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
      },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: "Crosul, toate datele", excerpt: "", seoTitle: "", seoDescription: "" } }],
      scope: "all",
      now: at(5),
    });
    // The save reached the other dates — the map link went with it — and the limits stayed where the club set them.
    expect(result.appliedTo).toBe(dates.length);
    expect((await stored(dates[0].id)).mapUrl).toBe("https://maps.example.test/start");
    expect(await limitOf(source.id)).toBe(2);
    expect(await limitOf(dates[0].id)).toBeNull();
    expect(await limitOf(dates[1].id)).toBe(5);
  });

  it("is not in the event's file, like «Oferim tricouri voluntarilor»: neither the volunteers' block nor a module of the transfer names it", async () => {
    const event = await seedEvent({ volunteerChoicesMax: 2 });
    await seedRoles(event.id);
    const block = await readVolunteersFile(db, event.id);
    expect(Object.keys(block).sort()).toEqual(["access", "buttonShown", "categories", "listPublic", "roles"]);
    expect(serializeEventFile({ volunteers: block } as never)).not.toMatch(/choicesMax|choices_max/i);
    for (const file of ["file-format.ts", "export.ts", "import.ts", "volunteers.ts", "fields-from-config.ts", "diff.ts"]) {
      expect(readFileSync(`src/modules/content/events/transfer/${file}`, "utf8"), file).not.toMatch(/choicesMax|choices_max/i);
    }
  });

  it("is in neither list of columns the events' service carries: not the series', not a copy's", () => {
    const service = readFileSync("src/modules/content/events/service.ts", "utf8").replace(/\r\n/g, "\n");
    const seriesColumns = /const SERIES_COLUMNS = \[([\s\S]*?)\] as const;/.exec(service)?.[1] ?? "";
    expect(seriesColumns).toContain('"volunteersAccess"');
    expect(seriesColumns).not.toMatch(/volunteerChoicesMax|volunteersShirts/);
    const copied = /function copiedEventValues\([\s\S]*?\n}\n/.exec(service)?.[0] ?? "";
    expect(copied).toContain("volunteersAccess: source.volunteersAccess");
    expect(copied).not.toMatch(/volunteerChoicesMax|volunteersShirts/);
    // The blank row a new event starts from says «no limit».
    expect(service).toMatch(/volunteerChoicesMax: null,/);
  });
});
