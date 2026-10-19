import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent } from "@/modules/content/events/service";
import { serializeEventFile, volunteersFileSchema } from "@/modules/content/events/transfer/file-format";
import { importVolunteersFile, readVolunteersFile } from "@/modules/content/events/transfer/volunteers";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstVolunteersListNoticeVersion, insertLegalDocumentVersion, noticeDescribesVolunteersList } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { countVolunteersListEvents, readPublicVolunteersList, setVolunteersListPublic } from "@/modules/volunteers/public-list";
import { changeVolunteer, listVolunteers, submitVolunteer } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-19T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");

/**
 * §NNN — the volunteers' public list (BR-REQ-039-01, BR-REQ-050-02, BR-REQ-060-01; the disclosure rule of §143 and §396 reaching volunteers),
 * on a real schema: migration 0172's two columns and their defaults; the sign-up keeps the person's tick only where the form asked it (the
 * club's tick AND a notice that describes the list); the organizers' record of the tick is audited, refused without the notice, and a tick is
 * only ever cleared without it; the public read selects a name, a role and a tick and nothing else; a tick given under an older notice names
 * nobody; the club's tick is the club's alone, audited, and travels with a copy and with the event's file.
 */
describe("§NNN the volunteers' public list", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let technician: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  /** A notice in force in both languages: `markers` is what its volunteers' paragraph names. */
  async function approveNotice(markers: readonly string[], version: number) {
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari (${markers.join(", ")}): ${text}`] }] });
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date(EFFECTIVE.getTime() + version * DAY),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }
  const WITHOUT = ["{{volunteers}}", "{{volunteerAgreement}}"] as const;
  const WITH = [...WITHOUT, "{{volunteersList}}"] as const;

  async function approveAgreement() {
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
    await insertLegalDocumentVersion(db, {
      key: "VOLUNTEER_AGREEMENT",
      version: 1,
      effectiveAt: EFFECTIVE,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  async function person(role: StaffUser["role"], name: string): Promise<StaffUser> {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
    return row;
  }

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

  async function seedRole(eventId: string) {
    const { eventVolunteerRoles } = await import("@/db/schema/event-volunteers");
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3 }).returning();
    return role;
  }

  beforeEach(async () => {
    await resetTables(db);
    await approveAgreement();
    admin = await person("ADMIN", "Ana Admin");
    organizer = await person("MODERATOR", "Oana Organizator");
    technician = await person("DEV", "Tudor Tehnic");
  });

  const signup = (roleId: string, extra: Record<string, unknown> = {}) => ({
    roleIds: [roleId],
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
  const staffEntry = (roleId: string, extra: Record<string, unknown> = {}) => ({ roleIds: [roleId], name: "Ion Ionescu", email: "ion@example.test", phone: "+40712345678", ...extra });
  const rows = (eventId: string) => db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));

  describe("migration 0172", () => {
    it("adds both columns, off by default, so an existing event and an existing volunteer stay private", async () => {
      await approveNotice(WITHOUT, 1);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      expect(event.volunteersListPublic).toBe(false);
      await submitVolunteer(db, event.id, signup(role.id), NOW);
      const [volunteer] = await rows(event.id);
      expect(volunteer.listOptIn).toBe(false);
    });
  });

  describe("the public sign-up keeps the tick only where the form asked it", () => {
    it("keeps it when the club made the list public and the notice in force describes it, recording the notice it was given under", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      expect(await submitVolunteer(db, event.id, signup(role.id, { listOptIn: true }), NOW)).toEqual({ outcome: "done" });
      const [volunteer] = await rows(event.id);
      expect(volunteer).toMatchObject({ listOptIn: true, privacyNoticeVersion: 1, state: "REGISTERED", source: "PUBLIC" });
      // The trail says a tick was given, and nothing of the person.
      const [signedUp] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.signed_up"));
      expect((signedUp.metadataJson as { listOptIn?: boolean }).listOptIn).toBe(true);
      expect(JSON.stringify(signedUp.metadataJson)).not.toMatch(/Maria|maria@|\+4071/);
    });

    it("is off when the person did not tick it", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      await submitVolunteer(db, event.id, signup(role.id), NOW);
      expect((await rows(event.id))[0].listOptIn).toBe(false);
    });

    it("drops a tick posted while the club's list is private — a stale or forged post never makes a person public", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent({ volunteersListPublic: false });
      const role = await seedRole(event.id);
      expect(await submitVolunteer(db, event.id, signup(role.id, { listOptIn: true }), NOW)).toEqual({ outcome: "done" });
      expect((await rows(event.id))[0].listOptIn).toBe(false);
    });

    it("drops a tick posted while the notice in force does not describe the list — the person agreed to nothing that was described", async () => {
      await approveNotice(WITHOUT, 1);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      expect(await submitVolunteer(db, event.id, signup(role.id, { listOptIn: true }), NOW)).toEqual({ outcome: "done" });
      expect((await rows(event.id))[0].listOptIn).toBe(false);
    });

    it("does not read a marker alone as the notice describing the list: the volunteers' paragraph must be named too", async () => {
      await approveNotice(["{{volunteers}}", "{{volunteerAgreement}}"], 1);
      expect(await noticeDescribesVolunteersList(db, NOW)).toBe(false);
      await resetTables(db);
      await approveNotice(["{{volunteersList}}"], 1);
      expect(await noticeDescribesVolunteersList(db, NOW)).toBe(false);
      await resetTables(db);
      await approveNotice(WITH, 1);
      expect(await noticeDescribesVolunteersList(db, NOW)).toBe(true);
    });
  });

  describe("the organizers' record of the person's tick", () => {
    it("is refused as a new entry while the notice does not describe the list, naming the box, and nothing is written", async () => {
      await approveNotice(WITHOUT, 1);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      await expect(changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: staffEntry(role.id, { listOptIn: true }) }, NOW)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["listOptIn"],
      });
      expect(await rows(event.id)).toEqual([]);
    });

    it("is recorded when the notice describes it — under that notice's version — and audited with the staff member who did it, never the person", async () => {
      await approveNotice(WITH, 4);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      const { volunteer } = await changeVolunteer(db, organizer, { kind: "add", eventId: event.id, fields: staffEntry(role.id, { listOptIn: true }) }, NOW);
      const [row] = await rows(event.id);
      expect(row).toMatchObject({ id: volunteer.id, listOptIn: true, privacyNoticeVersion: 4, source: "STAFF", createdByStaffUserId: organizer.id });
      const [added] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.added"));
      expect(added.actorStaffUserId).toBe(organizer.id);
      expect((added.metadataJson as { listOptIn?: boolean }).listOptIn).toBe(true);
      expect(JSON.stringify(added.metadataJson)).not.toMatch(/Ion|ion@|\+4071/);
    });

    it("an entry without the tick records none, and the version stays empty as it always was", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: staffEntry(role.id) }, NOW);
      expect((await rows(event.id))[0]).toMatchObject({ listOptIn: false, privacyNoticeVersion: null });
    });

    it("an edit ticks and unticks it, naming the box in the audit row — and a post that changes nothing writes nothing", async () => {
      await approveNotice(WITH, 2);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      const { volunteer } = await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: staffEntry(role.id) }, NOW);
      const edit = (extra: Record<string, unknown>) => changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id: volunteer.id, fields: staffEntry(role.id, extra) }, NOW);
      expect((await edit({ listOptIn: true })).changed).toBe(true);
      expect((await rows(event.id))[0]).toMatchObject({ listOptIn: true, privacyNoticeVersion: 2 });
      expect((await edit({ listOptIn: true })).changed).toBe(false);
      expect((await edit({})).changed).toBe(true);
      expect((await rows(event.id))[0].listOptIn).toBe(false);
      const edited = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited"));
      expect(edited.map((row) => (row.metadataJson as { fields: string[] }).fields)).toEqual([["listOptIn"], ["listOptIn"]]);
      expect(edited.every((row) => row.actorStaffUserId === admin.id)).toBe(true);
    });

    it("a tick can be cleared but never newly recorded once the notice stops describing the list; an unrelated edit leaves it alone", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      const { volunteer } = await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: staffEntry(role.id, { listOptIn: true }) }, NOW);
      // A later notice that no longer names the list is in force.
      await approveNotice(WITHOUT, 2);
      const edit = (extra: Record<string, unknown>) => changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id: volunteer.id, fields: staffEntry(role.id, extra) }, NOW);
      // The box is drawn for a ticked person: a post that keeps it keeps it (nothing changes), and the phone alone changes only the phone.
      expect((await edit({ listOptIn: true, phone: "+40712345679" })).changed).toBe(true);
      expect((await rows(event.id))[0].listOptIn).toBe(true);
      // Clearing is always allowed; ticking again without the notice is refused.
      expect((await edit({})).changed).toBe(true);
      expect((await rows(event.id))[0].listOptIn).toBe(false);
      await expect(edit({ listOptIn: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["listOptIn"] });
    });

    it("is for whoever manages volunteers alone: the Tehnic role is refused", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      await expect(changeVolunteer(db, technician, { kind: "add", eventId: event.id, fields: staffEntry(role.id, { listOptIn: true }) }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await rows(event.id)).toEqual([]);
    });

    it("the card's list carries the tick, so a row can say «Pe lista publică»", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent();
      const role = await seedRole(event.id);
      await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: staffEntry(role.id, { listOptIn: true }) }, NOW);
      expect((await listVolunteers(db, event.id)).map((item) => item.listOptIn)).toEqual([true]);
    });
  });

  describe("the public read", () => {
    /** Four people: a confirmed one who ticked (with a role given), a confirmed one who did not, a ticked one nobody confirmed, a ticked one who withdrew. */
    async function seedPeople(eventId: string, roleId: string, versions: { ticked: number } = { ticked: 2 }) {
      const base = { eventId, canonicalizationVersion: 2, phone: "+40712345678", source: "PUBLIC" as const, listOptIn: true, privacyNoticeVersion: versions.ticked };
      await db.insert(eventVolunteers).values([
        { ...base, name: "Ana Popescu", email: "ana@example.test", canonicalEmail: "ana@example.test", state: "CONFIRMED", roleId, createdAt: new Date(NOW.getTime() - 4 * DAY) },
        { ...base, name: "Ion Fără Bifă", email: "ion2@example.test", canonicalEmail: "ion2@example.test", state: "CONFIRMED", listOptIn: false, createdAt: new Date(NOW.getTime() - 3 * DAY) },
        { ...base, name: "Nici Confirmat", email: "nu@example.test", canonicalEmail: "nu@example.test", state: "REGISTERED", createdAt: new Date(NOW.getTime() - 2 * DAY) },
        { ...base, name: "Anulat Tot", email: "anulat@example.test", canonicalEmail: "anulat@example.test", state: "CANCELLED", createdAt: new Date(NOW.getTime() - DAY) },
      ]);
    }

    it("names only the confirmed who ticked, with the role given, and counts the other confirmed — the unconfirmed and the cancelled are nobody", async () => {
      await approveNotice(WITHOUT, 1);
      await approveNotice(WITH, 2);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      await seedPeople(event.id, role.id);
      const first = await findFirstVolunteersListNoticeVersion(db);
      expect(first).toBe(2);
      const read = await readPublicVolunteersList(db, event.id, { firstListNoticeVersion: first });
      expect(read.acceptsVolunteers).toBe(true);
      expect(read.list).toEqual({
        count: 2,
        named: [{ name: "Ana Popescu", roleNameRo: "Punct de apă", roleNameEn: "Water point" }],
        others: 1,
      });
    });

    it("selects no address, no telephone number and nothing else of a person: its whole answer holds the names, the roles and two numbers", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      await seedPeople(event.id, role.id, { ticked: 1 });
      const read = await readPublicVolunteersList(db, event.id, { firstListNoticeVersion: 1 });
      const json = JSON.stringify(read);
      expect(json).not.toMatch(/@example\.test|\+4071|Nici Confirmat|Anulat Tot|Fără Bifă/);
      expect(Object.keys(read.list).sort()).toEqual(["count", "named", "others"]);
      expect(Object.keys(read.list.named[0]).sort()).toEqual(["name", "roleNameEn", "roleNameRo"]);
    });

    it("names nobody whose tick was given under a notice older than the first that described the list: they are counted", async () => {
      await approveNotice(WITHOUT, 1);
      await approveNotice(WITH, 2);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      await seedPeople(event.id, role.id, { ticked: 1 });
      const read = await readPublicVolunteersList(db, event.id, { firstListNoticeVersion: await findFirstVolunteersListNoticeVersion(db) });
      expect(read.list).toEqual({ count: 2, named: [], others: 2 });
    });

    it("names nobody while no approved notice has described the list yet (the first version is null)", async () => {
      await approveNotice(WITHOUT, 1);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      await seedPeople(event.id, role.id, { ticked: 1 });
      expect(await findFirstVolunteersListNoticeVersion(db)).toBeNull();
      expect((await readPublicVolunteersList(db, event.id, { firstListNoticeVersion: null })).list.named).toEqual([]);
    });

    it("reads nothing once the event no longer takes volunteers — the master switch is off", async () => {
      await approveNotice(WITH, 2);
      const event = await seedEvent({ volunteersListPublic: true, acceptsVolunteers: false });
      const role = await seedRole(event.id);
      await seedPeople(event.id, role.id);
      expect(await readPublicVolunteersList(db, event.id, { firstListNoticeVersion: 2 })).toEqual({ acceptsVolunteers: false, list: { count: 0, named: [], others: 0 } });
    });
  });

  describe("the club's tick", () => {
    it("is saved by whoever manages volunteers, audited with who and the state, and a press that changes nothing writes nothing", async () => {
      const event = await seedEvent();
      expect(await setVolunteersListPublic(db, organizer, { eventId: event.id, on: true }, NOW)).toEqual({ changed: true });
      expect((await db.select().from(events).where(eq(events.id, event.id)))[0].volunteersListPublic).toBe(true);
      expect(await setVolunteersListPublic(db, organizer, { eventId: event.id, on: true }, NOW)).toEqual({ changed: false });
      expect(await setVolunteersListPublic(db, admin, { eventId: event.id, on: false }, NOW)).toEqual({ changed: true });
      const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.volunteers_list_switched"));
      expect(trail.map((row) => [row.actorStaffUserId, (row.metadataJson as { on: boolean }).on])).toEqual([
        [organizer.id, true],
        [admin.id, false],
      ]);
    });

    it("is refused to the Tehnic role and to an event that is not there; it does not move the page's version", async () => {
      const event = await seedEvent();
      await expect(setVolunteersListPublic(db, technician, { eventId: event.id, on: true }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setVolunteersListPublic(db, admin, { eventId: "11111111-1111-4111-8111-111111111111", on: true }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(setVolunteersListPublic(db, admin, { eventId: "nope", on: true }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const before = (await db.select().from(events).where(eq(events.id, event.id)))[0].version;
      await setVolunteersListPublic(db, admin, { eventId: event.id, on: true }, NOW);
      expect((await db.select().from(events).where(eq(events.id, event.id)))[0].version).toBe(before);
    });

    it("counts the events ahead that have the list public and take volunteers — what the tasks row waits on", async () => {
      await seedEvent({ volunteersListPublic: true });
      await seedEvent({ volunteersListPublic: false });
      await seedEvent({ volunteersListPublic: true, acceptsVolunteers: false });
      await seedEvent({ volunteersListPublic: true, startsAt: new Date(NOW.getTime() - 5 * DAY) });
      await seedEvent({ volunteersListPublic: true, membersOnly: true });
      await seedEvent({ volunteersListPublic: true, editorialStatus: "DRAFT" });
      await seedEvent({ volunteersListPublic: true, eventStatus: "CANCELLED" });
      expect(await countVolunteersListEvents(db, NOW)).toBe(1);
    });
  });

  describe("what travels", () => {
    it("a duplicate and a repeat carry the club's tick, and no volunteer, no ticked person and no «Primește voluntari»", async () => {
      await approveNotice(WITH, 1);
      const event = await seedEvent({ volunteersListPublic: true });
      const role = await seedRole(event.id);
      await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: staffEntry(role.id, { listOptIn: true }) }, NOW);
      const copy = await duplicateEvent(db, { actor: admin, eventId: event.id });
      const [copied] = await db.select().from(events).where(eq(events.id, copy.id));
      expect(copied.volunteersListPublic).toBe(true);
      expect(copied.acceptsVolunteers).toBe(false);
      expect(await rows(copy.id)).toEqual([]);
    });

    it("a copy of an event whose list is private starts private", async () => {
      const event = await seedEvent({ volunteersListPublic: false });
      const copy = await duplicateEvent(db, { actor: admin, eventId: event.id });
      expect((await db.select().from(events).where(eq(events.id, copy.id)))[0].volunteersListPublic).toBe(false);
    });

    it("the event's file carries the tick when it is on, leaves it out when it is off, and a file without it reads as off", async () => {
      const on = await seedEvent({ volunteersListPublic: true });
      const off = await seedEvent({ volunteersListPublic: false });
      const fileOn = await readVolunteersFile(db, on.id);
      const fileOff = await readVolunteersFile(db, off.id);
      expect(fileOn.listPublic).toBe(true);
      expect(fileOff.listPublic).toBe(false);
      // Written only when on — the mirror of `rsvpEnabled` — so a file of an event that never made the list public stays readable by the release before.
      const written = (volunteers: unknown) => serializeEventFile({ volunteers } as never);
      expect(written(fileOn)).toContain('"listPublic": true');
      expect(written(fileOff)).not.toContain("listPublic");
      expect(volunteersFileSchema.parse({ categories: [], roles: [] }).listPublic).toBe(false);
      expect(volunteersFileSchema.parse({ categories: [], roles: [], listPublic: true }).listPublic).toBe(true);
      expect(() => volunteersFileSchema.parse({ categories: [], roles: [], listPublic: "yes" })).toThrow();
    });

    it("importing a file as a new event sets the tick through the card's own service, audited — and names no one", async () => {
      const target = await seedEvent();
      await importVolunteersFile(db, admin, target.id, volunteersFileSchema.parse({ categories: [], roles: [], listPublic: true }), NOW);
      expect((await db.select().from(events).where(eq(events.id, target.id)))[0].volunteersListPublic).toBe(true);
      const [switched] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.volunteers_list_switched"));
      expect(switched).toMatchObject({ actorStaffUserId: admin.id, entityId: target.id });
      const untouched = await seedEvent();
      await importVolunteersFile(db, admin, untouched.id, volunteersFileSchema.parse({ categories: [], roles: [] }), NOW);
      expect((await db.select().from(events).where(eq(events.id, untouched.id)))[0].volunteersListPublic).toBe(false);
    });
  });
});
