import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { countVolunteeringEvents, readPublicVolunteerRoles, submitVolunteer } from "@/modules/volunteers/volunteers";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-13T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

/**
 * §NNN — the public «Vreau să fiu voluntar» (BR-REQ-031-01 criterion 3, BR-REQ-053-01, BR-REQ-080-02):
 * the three conditions asked again at the post, the house's anti-bot gates with the form's own silence,
 * the role's capacity (its lock, under two real connections, is `tests/concurrency/volunteer-role.test.ts`), one row per person per event on the canonical address, the same
 * answer for a repeat, and the outbox's two messages — the person's «am primit» and each organizer's
 * notice — queued with the row in one transaction.
 */
describe("§NNN the volunteers' public sign-up", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let technician: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  /** The notice in force, in both languages; `describing` makes it name `{{volunteers}}` (the gate, §NNN). */
  async function approveNotice(describing: boolean, version = 1) {
    const body = (text: string) => ({ sections: [{ paragraphs: [describing ? `Voluntari ({{volunteers}}): ${text}` : text] }] });
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  async function person(role: StaffRole, name: string): Promise<StaffUser> {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
    return row;
  }

  type StaffRole = StaffUser["role"];

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(NOW.getTime() + 30 * DAY),
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - DAY),
        acceptsVolunteers: true,
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
      { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    return event;
  }

  async function seedRole(eventId: string, overrides: Partial<typeof eventVolunteerRoles.$inferInsert> = {}) {
    const [role] = await db
      .insert(eventVolunteerRoles)
      .values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 2, ...overrides })
      .returning();
    return role;
  }

  beforeEach(async () => {
    await resetTables(db);
    await approveNotice(true);
    admin = await person("ADMIN", "Ana Admin");
    organizer = await person("MODERATOR", "Oana Organizator");
    technician = await person("DEV", "Tudor Tehnic");
  });

  const form = (roleId: string, extra: Record<string, unknown> = {}) => ({
    roleId,
    name: "Maria Test",
    email: "maria@example.test",
    phone: "+40712345678",
    message: "",
    locale: "ro",
    consent: true,
    renderedAt: RENDERED,
    ...extra,
  });
  const people = (eventId: string) => db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
  const outbox = (type: "VOLUNTEER_RECEIVED" | "VOLUNTEER_CLUB_NOTICE") => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));

  it("keeps a new person «Înscris» with the notice's version, and queues one receipt and one notice per organizer in the same go", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id);
    const result = await submitVolunteer(db, event.id, form(role.id, { message: "Sunt liber toată ziua" }), NOW);
    expect(result).toEqual({ outcome: "done" });
    const [row] = await people(event.id);
    expect(row).toMatchObject({
      roleId: role.id,
      name: "Maria Test",
      email: "maria@example.test",
      canonicalEmail: "maria@example.test",
      phone: "+40712345678",
      state: "REGISTERED",
      source: "PUBLIC",
      message: "Sunt liber toată ziua",
      privacyNoticeVersion: 1,
      createdByStaffUserId: null,
    });
    // The person's one receipt, in the page's language, with the idempotency key of this row.
    const [receipt] = await outbox("VOLUNTEER_RECEIVED");
    expect(receipt).toMatchObject({ recipientEmail: "maria@example.test", locale: "ro", participantId: null, registrationId: null, idempotencyKey: `volunteer:${row.id}:received` });
    expect(receipt.payloadJson).toEqual({ eventId: event.id, volunteerId: row.id });
    // Each Organizer, Administrator and Superadministrator — never the Tehnic role.
    const notices = await outbox("VOLUNTEER_CLUB_NOTICE");
    expect(notices.map((notice) => notice.recipientEmail).sort()).toEqual([admin.email, organizer.email].sort());
    expect(notices.map((notice) => notice.recipientEmail)).not.toContain(technician.email);
    // The trail names ids and the role, never the person.
    const [signedUp] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.signed_up"));
    expect(signedUp).toMatchObject({ actorStaffUserId: null, entityType: "event", entityId: event.id });
    expect(JSON.stringify(signedUp.metadataJson)).not.toMatch(/Maria|maria@|\+4071/);
  });

  it("answers a repeat — the same address, another spelling, another role, even after an organizer cancelled it — exactly as a new person, and changes and sends nothing", async () => {
    const event = await seedEvent();
    const water = await seedRole(event.id);
    const finish = await seedRole(event.id, { nameRo: "Sosire", nameEn: "Finish", position: 1 });
    expect(await submitVolunteer(db, event.id, form(water.id, { email: "Maria.Test+club@Gmail.com" }), NOW)).toEqual({ outcome: "done" });
    const sentBefore = (await outbox("VOLUNTEER_RECEIVED")).length + (await outbox("VOLUNTEER_CLUB_NOTICE")).length;
    // Gmail's tag and case are one address (§10.4); another role and another name change nothing.
    expect(await submitVolunteer(db, event.id, form(finish.id, { email: " maria.test@gmail.com ", name: "Altcineva" }), NOW)).toEqual({ outcome: "done" });
    await db.update(eventVolunteers).set({ state: "CANCELLED" });
    expect(await submitVolunteer(db, event.id, form(water.id, { email: "maria.test@gmail.com" }), NOW)).toEqual({ outcome: "done" });
    const rows = await people(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ roleId: water.id, name: "Maria Test", state: "CANCELLED" });
    expect((await outbox("VOLUNTEER_RECEIVED")).length + (await outbox("VOLUNTEER_CLUB_NOTICE")).length).toBe(sentBefore);
  });

  it("gives one row per person per event, but the same address may volunteer for another event", async () => {
    const first = await seedEvent();
    const second = await seedEvent();
    const roleOne = await seedRole(first.id);
    const roleTwo = await seedRole(second.id);
    await submitVolunteer(db, first.id, form(roleOne.id), NOW);
    await submitVolunteer(db, second.id, form(roleTwo.id), NOW);
    expect(await people(first.id)).toHaveLength(1);
    expect(await people(second.id)).toHaveLength(1);
  });

  it("refuses a role that has filled — telling the person politely — and counts «Anulat» as free again", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id, { needed: 1 });
    expect(await submitVolunteer(db, event.id, form(role.id), NOW)).toEqual({ outcome: "done" });
    expect(await submitVolunteer(db, event.id, form(role.id, { email: "other@example.test", name: "Alt Nume" }), NOW)).toEqual({ outcome: "full" });
    expect(await people(event.id)).toHaveLength(1);
    expect((await outbox("VOLUNTEER_RECEIVED")).map((row) => row.recipientEmail)).toEqual(["maria@example.test"]);
    // An organizer cancels the first: the place is free again.
    await db.update(eventVolunteers).set({ state: "CANCELLED" });
    expect(await submitVolunteer(db, event.id, form(role.id, { email: "other@example.test", name: "Alt Nume" }), NOW)).toEqual({ outcome: "done" });
    expect(await people(event.id)).toHaveLength(2);
  });

  it("is no oracle on a full role: a forged post naming it answers «full» to a person already listed and to a stranger alike", async () => {
    const event = await seedEvent();
    const water = await seedRole(event.id);
    const finish = await seedRole(event.id, { nameRo: "Sosire", nameEn: "Finish", position: 1, needed: 1 });
    expect(await submitVolunteer(db, event.id, form(water.id), NOW)).toEqual({ outcome: "done" });
    expect(await submitVolunteer(db, event.id, form(finish.id, { email: "ion@example.test", name: "Ion Test" }), NOW)).toEqual({ outcome: "done" });
    // «Sosire» is full now. Maria is listed (on another role), the stranger is nobody: the same answer.
    expect(await submitVolunteer(db, event.id, form(finish.id), NOW)).toEqual({ outcome: "full" });
    expect(await submitVolunteer(db, event.id, form(finish.id, { email: "stranger@example.test", name: "Străin" }), NOW)).toEqual({ outcome: "full" });
    expect(await people(event.id)).toHaveLength(2);
  });

  it("refuses a role of another event as the person's own fix, naming the box", async () => {
    const event = await seedEvent();
    const other = await seedEvent();
    const foreign = await seedRole(other.id);
    await expect(submitVolunteer(db, event.id, form(foreign.id), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["roleId"] });
    expect(await people(event.id)).toHaveLength(0);
    expect(await outbox("VOLUNTEER_RECEIVED")).toHaveLength(0);
  });

  it("names every box a person can fix: the address, the telephone number, the name, the role and the consent tick", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id);
    for (const [field, value] of [
      ["email", "not-an-address"],
      ["phone", ""],
      ["name", "  "],
      ["roleId", "nope"],
      ["consent", false],
    ] as const) {
      const error = await submitVolunteer(db, event.id, form(role.id, { [field]: value }), NOW).catch((caught: unknown) => caught);
      expect(isDomainError(error) && error.code, field).toBe("VALIDATION_ERROR");
      expect(isDomainError(error) && error.fields, field).toEqual([field]);
    }
    expect(await people(event.id)).toHaveLength(0);
  });

  it("answers a bot like a person and keeps nothing: a filled honeypot, a form posted at once", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id);
    expect(await submitVolunteer(db, event.id, form(role.id, { honeypot: "http://spam.example" }), NOW)).toEqual({ outcome: "done" });
    expect(await submitVolunteer(db, event.id, form(role.id, { renderedAt: NOW.toISOString() }), NOW)).toEqual({ outcome: "done" });
    expect(await people(event.id)).toHaveLength(0);
    expect(await outbox("VOLUNTEER_RECEIVED")).toHaveLength(0);
    expect(await outbox("VOLUNTEER_CLUB_NOTICE")).toHaveLength(0);
  });

  it("is the registration form's own judgement: a trap holding the person's own address is a password manager, a missing render time is nobody's fault (§217, §282)", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id, { needed: 5 });
    expect(await submitVolunteer(db, event.id, form(role.id, { honeypot: "maria@example.test" }), NOW)).toEqual({ outcome: "done" });
    expect(await submitVolunteer(db, event.id, form(role.id, { email: "alta@example.test", name: "Alta Persoana", renderedAt: undefined }), NOW)).toEqual({ outcome: "done" });
    expect(await people(event.id)).toHaveLength(2);
  });

  it("is closed — the page offers no form and a post past the page is refused — unless all three conditions hold", async () => {
    const closedWith = async (event: { id: string }, roleId: string) => {
      const error = await submitVolunteer(db, event.id, form(roleId), NOW).catch((caught: unknown) => caught);
      return isDomainError(error) ? error.code : "accepted";
    };
    // (a) The event does not take volunteers.
    const off = await seedEvent({ acceptsVolunteers: false });
    expect(await closedWith(off, (await seedRole(off.id)).id)).toBe("CONFLICT");
    // The event is cancelled, over or not published.
    const cancelled = await seedEvent({ eventStatus: "CANCELLED" });
    expect(await closedWith(cancelled, (await seedRole(cancelled.id)).id)).toBe("CONFLICT");
    const over = await seedEvent({ startsAt: new Date(NOW.getTime() - 2 * DAY) });
    expect(await closedWith(over, (await seedRole(over.id)).id)).toBe("CONFLICT");
    const draft = await seedEvent({ editorialStatus: "DRAFT" });
    expect(await closedWith(draft, (await seedRole(draft.id)).id)).toBe("CONFLICT");
    const members = await seedEvent({ membersOnly: true });
    expect(await closedWith(members, (await seedRole(members.id)).id)).toBe("CONFLICT");
    expect(await db.select().from(eventVolunteers)).toHaveLength(0);
    // (c) The notice in force does not describe volunteers: nothing is kept.
    await resetTables(db);
    await approveNotice(false);
    const quiet = await seedEvent();
    expect(await closedWith(quiet, (await seedRole(quiet.id)).id)).toBe("CONFLICT");
    expect(await db.select().from(eventVolunteers)).toHaveLength(0);
    // Approved from the template (a notice that names it in force, in both languages): it opens.
    await approveNotice(true, 2);
    expect(await closedWith(quiet, (await db.select().from(eventVolunteerRoles))[0].id)).toBe("accepted");
  });

  it("needs the notice in every language, not one: a notice that describes volunteers in Romanian alone keeps the form shut", async () => {
    await resetTables(db);
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Voluntari ({{volunteers}})"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["Nothing about it"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    const event = await seedEvent();
    const role = await seedRole(event.id);
    await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throttles an address after three posts an hour — said plainly — and an event after sixty, whatever the addresses", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id, { needed: 100 });
    // Three posts of one address (the repeat is the same answer) spend its hour; the fourth is told.
    for (let post = 0; post < 3; post += 1) expect(await submitVolunteer(db, event.id, form(role.id), NOW)).toEqual({ outcome: "done" });
    expect(await submitVolunteer(db, event.id, form(role.id), NOW)).toEqual({ outcome: "limited" });
    // Another address is its own bucket.
    expect(await submitVolunteer(db, event.id, form(role.id, { email: "alta@example.test", name: "Alta Persoana" }), NOW)).toEqual({ outcome: "done" });
    // The event's bucket: 60 posts in the hour, then «limited» for everybody.
    const other = await seedEvent();
    const otherRole = await seedRole(other.id, { needed: 100 });
    for (let post = 0; post < 60; post += 1) {
      await submitVolunteer(db, other.id, form(otherRole.id, { email: `v${post}@example.test`, name: `Voluntar ${post}` }), NOW);
    }
    expect(await submitVolunteer(db, other.id, form(otherRole.id, { email: "ultima@example.test", name: "Ultima Persoana" }), NOW)).toEqual({ outcome: "limited" });
    expect(await people(other.id)).toHaveLength(60);
  });

  // PGlite runs one transaction at a time, so this shows the count, not the lock: two connections racing for the
  // last place are `tests/concurrency/volunteer-role.test.ts`.
  it("answers the next post for a role filled by one post with «full», and keeps one row", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id, { needed: 1 });
    const results = await Promise.all([
      submitVolunteer(db, event.id, form(role.id, { email: "unu@example.test", name: "Unu Test" }), NOW),
      submitVolunteer(db, event.id, form(role.id, { email: "doi@example.test", name: "Doi Test" }), NOW),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["done", "full"]);
    expect(await people(event.id)).toHaveLength(1);
  });

  it("renders the receipt in both languages with the role and the event, and no token and no address of anybody else", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id);
    await submitVolunteer(db, event.id, form(role.id), NOW);
    const [row] = await outbox("VOLUNTEER_RECEIVED");
    const message = await renderOutboxMessage({ ...(row as unknown as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW);
    expect(message.subject).toBe("Ți-am primit oferta de voluntar pentru Crosul / We received your offer to volunteer for The cross");
    expect(message.text).toContain("Rol: Punct de apă");
    expect(message.text).toContain("Role: Water point");
    expect(message.text).toContain("nu e o înscriere la cursă");
    expect(message.text).not.toMatch(/token|\/registrations\//i);
    expect(message.text).not.toContain(admin.email);
    expect(message.html).toContain("Salut, Maria Test");
    // The privacy line names the reason in the volunteer's own words, not «a registration».
    expect(message.text).toContain("te-ai oferit, pe site-ul clubului, să ajuți ca voluntar");
  });

  it("renders the organizers' notice with who and which role — and neither the address nor the telephone number — and a button to the card", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id);
    await submitVolunteer(db, event.id, form(role.id), NOW);
    const [row] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "VOLUNTEER_CLUB_NOTICE"), eq(emailOutbox.recipientEmail, organizer.email)));
    const message = await renderOutboxMessage({ ...(row as unknown as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW);
    expect(message.subject).toContain("Voluntar nou la Crosul");
    expect(message.text).toContain("Maria Test — Punct de apă");
    expect(message.text).toContain("Maria Test — Water point");
    expect(message.text).not.toContain("maria@example.test");
    expect(message.text).not.toContain("+40712345678");
    expect(message.text).toContain(`${env.APP_BASE_URL}/ro/admin/events/${event.id}#box-volunteers`);
  });

  it("withdraws a message whose volunteer was cancelled or deleted before it left", async () => {
    const event = await seedEvent();
    const role = await seedRole(event.id);
    await submitVolunteer(db, event.id, form(role.id), NOW);
    const [row] = await outbox("VOLUNTEER_RECEIVED");
    await db.update(eventVolunteers).set({ state: "CANCELLED" });
    await expect(renderOutboxMessage({ ...(row as unknown as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW)).rejects.toThrow(/volunteer/i);
    await db.delete(eventVolunteers);
    await expect(renderOutboxMessage({ ...(row as unknown as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW)).rejects.toThrow(/volunteer/i);
  });

  it("reads the public roles with how each stands, and nothing of a person", async () => {
    const event = await seedEvent();
    const water = await seedRole(event.id, { needed: 2, descriptionRo: "Dai apă", descriptionEn: "Hand out water" });
    await seedRole(event.id, { nameRo: "Sosire", nameEn: "Finish", needed: 1, position: 1 });
    await submitVolunteer(db, event.id, form(water.id), NOW);
    const read = await readPublicVolunteerRoles(db, event.id);
    expect(read.acceptsVolunteers).toBe(true);
    expect(read.roles.map((role) => [role.nameRo, role.needed, role.taken, role.free])).toEqual([
      ["Punct de apă", 2, 1, 1],
      ["Sosire", 1, 0, 1],
    ]);
    expect(JSON.stringify(read)).not.toMatch(/Maria|maria@|\+4071/);
    // Off: no roles are handed out at all.
    await db.update(events).set({ acceptsVolunteers: false });
    expect(await readPublicVolunteerRoles(db, event.id)).toEqual({ acceptsVolunteers: false, roles: [] });
  });

  it("counts the events ahead that take volunteers, for the task row", async () => {
    await seedEvent();
    await seedEvent({ acceptsVolunteers: false });
    await seedEvent({ eventStatus: "CANCELLED" });
    await seedEvent({ startsAt: new Date(NOW.getTime() - 3 * DAY) });
    expect(await countVolunteeringEvents(db, NOW)).toBe(1);
  });

  it("deletes the offers thirty days after the event began, whatever their state, and keeps the roles", async () => {
    const old = await seedEvent({ startsAt: new Date(NOW.getTime() - 31 * DAY) });
    const recent = await seedEvent({ startsAt: new Date(NOW.getTime() - 29 * DAY) });
    const oldRole = await seedRole(old.id);
    const recentRole = await seedRole(recent.id);
    for (const [event, role, state] of [
      [old, oldRole, "CONFIRMED"],
      [old, oldRole, "CANCELLED"],
      [recent, recentRole, "CONFIRMED"],
    ] as const) {
      await db.insert(eventVolunteers).values({
        eventId: event.id,
        roleId: role.id,
        name: `Nume ${state}`,
        email: `${state}-${event.id.slice(0, 4)}@example.test`,
        canonicalEmail: `${state}-${event.id.slice(0, 4)}@example.test`,
        canonicalizationVersion: 2,
        phone: "+40712345678",
        state,
        source: "STAFF",
      });
    }
    const result = await pruneExpiredRows(db, NOW);
    expect(result.failures).toEqual([]);
    expect(result.volunteers).toBe(2);
    expect(await people(old.id)).toHaveLength(0);
    expect(await people(recent.id)).toHaveLength(1);
    expect(await db.select().from(eventVolunteerRoles)).toHaveLength(2);
  });
});
