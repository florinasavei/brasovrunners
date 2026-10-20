import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent } from "@/modules/content/events/service";
import { eventFileSchema, serializeEventFile, volunteersFileSchema } from "@/modules/content/events/transfer/file-format";
import { hasVolunteers } from "@/modules/content/events/transfer/import";
import { importVolunteersFile, readVolunteersFile } from "@/modules/content/events/transfer/volunteers";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { volunteersAdvertised } from "@/modules/volunteers/domain/access";
import { listVolunteers, readPublicVolunteerRoles, setVolunteersButtonShown, submitVolunteer } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");

/**
 * §NNN — «Arată butonul „Vreau să fiu voluntar" pe pagina evenimentului» (BR-REQ-050-02, BR-REQ-060-01; the owner, 2026-10-20), on a real schema:
 * migration 0176's column and its default (every event keeps its button); the club's tick saved by whoever manages volunteers, audited, no change
 * to the page's version; the public read carries it; **a sign-up with the button hidden still goes through the real service** and is kept exactly
 * as one with the button shown; and the tick travels with a copy, a repeat and the event's file (absent in a file = shown). The card and the page
 * are `tests/unit/volunteers/button-shown-render.test.ts` and `own-page.test.ts`.
 */
describe("§NNN the club chooses whether the event page shows «Vreau să fiu voluntar»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let technician: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function approveNotice() {
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}, {{volunteerAgreement}}): ${text}`] }] });
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: EFFECTIVE,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

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
        endsAt: new Date(NOW.getTime() + 30 * DAY + 3_600_000),
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
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3 }).returning();
    return role;
  }

  const stored = async (eventId: string) => (await db.select().from(events).where(eq(events.id, eventId)))[0];

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

  beforeEach(async () => {
    await resetTables(db);
    await approveNotice();
    await approveAgreement();
    admin = await person("ADMIN", "Ana Admin");
    organizer = await person("MODERATOR", "Oana Organizator");
    technician = await person("DEV", "Tudor Tehnic");
  });

  describe("the column", () => {
    it("is on for every event, whatever way it was made: the button looks as it always did", async () => {
      const event = await seedEvent();
      expect((await stored(event.id)).volunteersButtonShown).toBe(true);
      const [bare] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + DAY) }).returning();
      expect(bare.volunteersButtonShown).toBe(true);
    });

    it("is carried by the public read beside the other ticks, on by default and off when the club said so", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      expect(await readPublicVolunteerRoles(db, event.id)).toMatchObject({ acceptsVolunteers: true, buttonShown: true });
      await setVolunteersButtonShown(db, admin, { eventId: event.id, on: false }, NOW);
      expect(await readPublicVolunteerRoles(db, event.id)).toMatchObject({ acceptsVolunteers: true, buttonShown: false });
      // An event that takes no volunteers has no offer to advertise: the read says «on» and nothing else.
      const closed = await seedEvent({ acceptsVolunteers: false, volunteersButtonShown: false });
      expect(await readPublicVolunteerRoles(db, closed.id)).toMatchObject({ acceptsVolunteers: false, buttonShown: true });
    });
  });

  describe("the club's tick", () => {
    it("is saved by whoever manages volunteers, audited with who and the state, and a press that changes nothing writes nothing", async () => {
      const event = await seedEvent();
      expect(await setVolunteersButtonShown(db, organizer, { eventId: event.id, on: false }, NOW)).toEqual({ changed: true });
      expect((await stored(event.id)).volunteersButtonShown).toBe(false);
      expect(await setVolunteersButtonShown(db, organizer, { eventId: event.id, on: false }, NOW)).toEqual({ changed: false });
      expect(await setVolunteersButtonShown(db, admin, { eventId: event.id, on: true }, NOW)).toEqual({ changed: true });
      const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.volunteers_button_switched"));
      expect(trail.map((row) => [row.actorStaffUserId, row.entityId, (row.metadataJson as { on: boolean }).on])).toEqual([
        [organizer.id, event.id, false],
        [admin.id, event.id, true],
      ]);
      // The trail names the switch and nothing of a person.
      expect(JSON.stringify(trail.map((row) => row.metadataJson))).not.toMatch(/maria|@/i);
    });

    it("is refused to the Tehnic role and to an event that is not there; it does not move the page's version", async () => {
      const event = await seedEvent();
      await expect(setVolunteersButtonShown(db, technician, { eventId: event.id, on: false }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setVolunteersButtonShown(db, admin, { eventId: "11111111-1111-4111-8111-111111111111", on: false }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(setVolunteersButtonShown(db, admin, { eventId: "nope", on: false }, NOW)).rejects.toBeTruthy();
      expect((await stored(event.id)).volunteersButtonShown).toBe(true);
      const before = (await stored(event.id)).version;
      await setVolunteersButtonShown(db, admin, { eventId: event.id, on: false }, NOW);
      expect((await stored(event.id)).version).toBe(before);
    });

    it("changes nothing but what the public site advertises: «Primește voluntari», «Cine se poate oferi», the roles and the people stay", async () => {
      const event = await seedEvent({ volunteersAccess: "MEMBERS" });
      const role = await seedRole(event.id);
      expect(await submitVolunteer(db, event.id, signup(role.id, { email: "membru@example.test" }), NOW, undefined, { member: { email: "membru@example.test" } })).toEqual({ outcome: "done" });
      await setVolunteersButtonShown(db, admin, { eventId: event.id, on: false }, NOW);
      expect(await stored(event.id)).toMatchObject({ acceptsVolunteers: true, volunteersAccess: "MEMBERS", volunteersShirts: false, volunteersShowCounts: false, volunteersListPublic: false });
      expect(await listVolunteers(db, event.id)).toHaveLength(1);
    });
  });

  describe("the sign-up with the button hidden", () => {
    it("still goes through the real service and is kept exactly as one with the button shown: the same row, the same two messages", async () => {
      const shown = await seedEvent();
      const hidden = await seedEvent({ volunteersButtonShown: false });
      const shownRole = await seedRole(shown.id);
      const hiddenRole = await seedRole(hidden.id);
      const queued = async () => (await db.select({ type: emailOutbox.messageType }).from(emailOutbox)).map((row) => row.type).sort();
      expect(await submitVolunteer(db, shown.id, signup(shownRole.id), NOW)).toEqual({ outcome: "done" });
      const afterShown = await queued();
      expect(await submitVolunteer(db, hidden.id, signup(hiddenRole.id), NOW)).toEqual({ outcome: "done" });
      const rowOf = async (eventId: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId)))[0];
      const a = await rowOf(shown.id);
      const b = await rowOf(hidden.id);
      expect(b).toMatchObject({ name: a.name, canonicalEmail: a.canonicalEmail, state: "REGISTERED", source: "PUBLIC", roleId: null, privacyNoticeVersion: a.privacyNoticeVersion });
      // The person's receipt and each organizer's notice, as for the shown event: the second sign-up queued the same kinds of message again.
      const afterHidden = await queued();
      expect(afterShown.length).toBeGreaterThan(0);
      expect(afterHidden).toEqual([...afterShown, ...afterShown].sort());
    });

    it("is still refused by every other gate: the tick opens nothing and «Primește voluntari» off still closes the page", async () => {
      const closed = await seedEvent({ acceptsVolunteers: false, volunteersButtonShown: false });
      const role = await seedRole(closed.id);
      await expect(submitVolunteer(db, closed.id, signup(role.id), NOW)).rejects.toMatchObject({ code: expect.any(String) });
      expect(await listVolunteers(db, closed.id)).toHaveLength(0);
    });

    it("keeps «Doar cu invitație» exactly as it was: the hidden button changes no door", async () => {
      const event = await seedEvent({ volunteersButtonShown: false, volunteersAccess: "MEMBERS" });
      const role = await seedRole(event.id);
      await expect(submitVolunteer(db, event.id, signup(role.id), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await listVolunteers(db, event.id)).toHaveLength(0);
    });
  });

  describe("what the event's page advertises", () => {
    it("is the read's own flag met with the door: an open offer with the tick off advertises nothing, by invitation never does", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      const advertised = async () => {
        const read = await readPublicVolunteerRoles(db, event.id);
        return volunteersAdvertised({ access: read.access, buttonShown: read.buttonShown });
      };
      expect(await advertised()).toBe(true);
      await setVolunteersButtonShown(db, admin, { eventId: event.id, on: false }, NOW);
      expect(await advertised()).toBe(false);
      await setVolunteersButtonShown(db, admin, { eventId: event.id, on: true }, NOW);
      await db.update(events).set({ volunteersAccess: "INVITED" }).where(eq(events.id, event.id));
      expect(await advertised()).toBe(false);
    });
  });

  describe("what travels", () => {
    it("a duplicate carries the club's choice, on and off, and the copy still starts without «Primește voluntari»", async () => {
      const off = await seedEvent({ volunteersButtonShown: false });
      const copyOfOff = await duplicateEvent(db, { actor: admin, eventId: off.id });
      expect((await stored(copyOfOff.id)).volunteersButtonShown).toBe(false);
      expect((await stored(copyOfOff.id)).acceptsVolunteers).toBe(false);
      const on = await seedEvent();
      const copyOfOn = await duplicateEvent(db, { actor: admin, eventId: on.id });
      expect((await stored(copyOfOn.id)).volunteersButtonShown).toBe(true);
    });

    it("every date of a repeat starts with the source's choice", async () => {
      const source = await seedEvent({ volunteersButtonShown: false });
      await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-30", publish: false }, now: NOW });
      const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
      expect(dates.length).toBeGreaterThan(0);
      for (const date of dates) expect(date.volunteersButtonShown).toBe(false);
    });

    it("the event's file carries the choice only when it is off, and a file without it reads as shown", async () => {
      const off = await seedEvent({ volunteersButtonShown: false });
      const on = await seedEvent();
      const fileOff = await readVolunteersFile(db, off.id);
      const fileOn = await readVolunteersFile(db, on.id);
      expect(fileOff.buttonShown).toBe(false);
      expect(fileOn.buttonShown).toBe(true);
      // Written only when off — a file from an event that always showed it stays readable by the release before this one.
      const written = (volunteers: unknown) => serializeEventFile({ volunteers } as never);
      expect(written(fileOff)).toContain('"buttonShown": false');
      expect(written(fileOn)).not.toContain("buttonShown");
      expect(volunteersFileSchema.parse({ categories: [], roles: [] }).buttonShown).toBe(true);
      expect(volunteersFileSchema.parse({ categories: [], roles: [], buttonShown: false }).buttonShown).toBe(false);
      expect(() => volunteersFileSchema.parse({ categories: [], roles: [], buttonShown: "no" })).toThrow();
      // A whole event file without the volunteers' block reads the default too.
      expect(eventFileSchema.shape.volunteers.parse(undefined).buttonShown).toBe(true);
    });

    it("importing a file as a new event sets the choice through the card's own service, audited; a file without the key leaves the event shown", async () => {
      const target = await seedEvent();
      await importVolunteersFile(db, admin, target.id, volunteersFileSchema.parse({ categories: [], roles: [], buttonShown: false }), NOW);
      expect((await stored(target.id)).volunteersButtonShown).toBe(false);
      const [switched] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.volunteers_button_switched"));
      expect(switched).toMatchObject({ actorStaffUserId: admin.id, entityId: target.id });
      const untouched = await seedEvent();
      await importVolunteersFile(db, admin, untouched.id, volunteersFileSchema.parse({ categories: [], roles: [] }), NOW);
      expect((await stored(untouched.id)).volunteersButtonShown).toBe(true);
    });

    it("counts as something the file carries (over an existing event it is reported as not applied, like the rest)", () => {
      const base = volunteersFileSchema.parse({ categories: [], roles: [] });
      expect(hasVolunteers({ volunteers: base } as never)).toBe(false);
      expect(hasVolunteers({ volunteers: { ...base, buttonShown: false } } as never)).toBe(true);
    });
  });
});
