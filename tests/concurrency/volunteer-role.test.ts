import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { saveBadgeRoleColours } from "@/modules/volunteers/badges/badges";
import { changeVolunteer, changeVolunteerRole, changeVolunteerRoles, submitVolunteer } from "@/modules/volunteers/volunteers";

/**
 * §754, §761 — the volunteers' public form and the organizers' card under real connections racing (BR-REQ-031-01).
 *
 * Since §761 an offer holds no place: the person ticks every role they would do and the organizers give one. So ten
 * people ticking a role's one place at once are ten offers, none of them on the role. What the locks still decide:
 * a sign-up locks the roles it ticked (`SELECT … FOR UPDATE`, in the order of their ids — the order a role change
 * locks them) while it counts the people **given** each role, so an organizer giving the role's last place at the
 * same moment is read as it stands — an offer for that role alone is kept only while it still had room, never after
 * — and two sign-ups ticking the same roles in opposite orders, a role edited and moved, a hand entry and a role
 * given all settle without a deadlock. PGlite, one connection, serializes everything whether or not a row is
 * locked, so `tests/integration/volunteers/signup.test.ts` cannot show it (`tests/helpers/db.ts`). One person's
 * double tap — the same new address twice at once — is one row: the `UNIQUE (event_id, canonical_email)` decides,
 * and both presses hear the same «am primit». The organizers' side meets the same constraint: an address entered by
 * hand while the page posts it is one row, and the organizer hears «already listed», never the database; two
 * «Adaugă rolul» on an event with no role yet take two positions (the event's row is locked).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§754 §761 BR-REQ-031-01 people offer for a role's last place at once", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  // The real clock: the notice inserted here must be the one in force, after whatever another suite approved.
  const NOW = new Date();
  const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
  const stamp = Date.now();
  const createdEventIds: string[] = [];
  let noticeId: string | undefined;
  let agreementId: string | undefined;
  let admin: StaffUser | undefined;

  beforeAll(async () => {
    [admin] = await db.insert(staffUsers).values({ email: `volunteers.admin.${stamp}@example.test`, displayName: "Admin", role: "ADMIN" }).returning();
    // A privacy notice naming `{{volunteers}}` and `{{volunteerAgreement}}` (§758) in both languages, the newest
    // version, so it is the one in force (`noticeDescribesVolunteers`, `noticeDescribesVolunteerAgreement`). Withdrawn again after the suite, so the next suite reads what it approved.
    const [{ highest }] = await db
      .select({ highest: sql<number>`coalesce(max(${legalDocuments.version}), 0)::int` })
      .from(legalDocuments)
      .where(eq(legalDocuments.key, "PRIVACY_NOTICE"));
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Voluntari ({{volunteers}}, {{volunteerAgreement}}): păstrăm numele."] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["Volunteers ({{volunteers}}, {{volunteerAgreement}}): we keep the name."] }] } },
    ];
    noticeId = await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: highest + 1,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    // The volunteer agreement in force (§758), the newest version, from the platform's template: the form's
    // fourth condition. Deleted again after the suite, once the events (and the acceptances on them) are gone.
    const [{ highestAgreement }] = await db
      .select({ highestAgreement: sql<number>`coalesce(max(${legalDocuments.version}), 0)::int` })
      .from(legalDocuments)
      .where(eq(legalDocuments.key, "VOLUNTEER_AGREEMENT"));
    const agreement: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
    agreementId = await insertLegalDocumentVersion(db, {
      key: "VOLUNTEER_AGREEMENT",
      version: highestAgreement + 1,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(agreement),
      translations: agreement,
      now: NOW,
    });
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await db
        .delete(emailOutbox)
        .where(
          and(
            inArray(emailOutbox.messageType, ["VOLUNTEER_RECEIVED", "VOLUNTEER_CLUB_NOTICE", "VOLUNTEER_ROLE_ASSIGNED"]),
            inArray(sql`${emailOutbox.payloadJson}->>'eventId'`, createdEventIds),
          ),
        );
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, createdEventIds));
      // The event's cascade takes its roles and its people.
      await db.delete(events).where(inArray(events.id, createdEventIds));
    }
    if (noticeId) await db.delete(legalDocuments).where(eq(legalDocuments.id, noticeId));
    if (agreementId) await db.delete(legalDocuments).where(eq(legalDocuments.id, agreementId));
    if (admin) {
      await db.delete(emailOutbox).where(eq(emailOutbox.recipientEmail, admin.email));
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, admin.id));
      await db.delete(staffUsers).where(eq(staffUsers.id, admin.id));
    }
    await pool.end();
  });

  async function eventWithRole(needed: number) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - 24 * 60 * 60_000),
        acceptsVolunteers: true,
      })
      .returning();
    createdEventIds.push(event.id);
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `voluntari-${stamp}-${event.id.slice(0, 8)}`, title: "Crosul" },
      { eventId: event.id, locale: "en", slug: `volunteers-${stamp}-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed }).returning();
    return { event, role };
  }

  const offer = (eventId: string, roleIds: string | string[], index: number | string) =>
    submitVolunteer(
      db,
      eventId,
      {
        roleIds: Array.isArray(roleIds) ? roleIds : [roleIds],
        name: `Voluntar ${index}`,
        email: `voluntar.${stamp}.${index}@example.test`,
        phone: "+40712345678",
        message: "",
        locale: "ro",
        consent: true,
        agreement: true,
        adult: true,
        renderedAt: RENDERED,
      },
      NOW,
    );

  it("§761 ten people ticking a role's one place at once are ten offers kept — none given the role, which still needs its one", async () => {
    const { event, role } = await eventWithRole(1);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => offer(event.id, role.id, `one-${index}`)));
    expect(results.filter((result) => result.outcome === "done")).toHaveLength(10);
    const rows = await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, event.id));
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.roleId === null)).toBe(true);
    expect(await db.select().from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.roleId, role.id))).toHaveLength(10);
  });

  it("§761 an organizer gives a role's last place while ten people post for it alone: an offer is kept only while the role had room, never after", async () => {
    const { event, role } = await eventWithRole(1);
    const [waiting] = await db
      .insert(eventVolunteers)
      .values({ eventId: event.id, name: "Dana Pop", email: `voluntar.${stamp}.dana@example.test`, canonicalEmail: `voluntar.${stamp}.dana@example.test`, canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF" })
      .returning();
    const settled = await Promise.allSettled([
      changeVolunteer(db, admin!, { kind: "assign", eventId: event.id, id: waiting.id, roleId: role.id }, NOW),
      ...Array.from({ length: 10 }, (_, index) => offer(event.id, role.id, `last-${index}`)),
    ]);
    expect(settled.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual(Array.from({ length: 11 }, () => "ok"));
    // The role is given: «1 din 1».
    const given = await db.select().from(eventVolunteers).where(eq(eventVolunteers.roleId, role.id));
    expect(given.map((row) => row.id)).toEqual([waiting.id]);
    // Every «am primit» left a row with the role among its choices; every «full» left nothing.
    const outcomes = settled.slice(1).map((result) => (result as PromiseFulfilledResult<{ outcome: string }>).value.outcome);
    const offers = await db.select().from(eventVolunteers).where(and(eq(eventVolunteers.eventId, event.id), eq(eventVolunteers.source, "PUBLIC")));
    expect(offers).toHaveLength(outcomes.filter((outcome) => outcome === "done").length);
    expect(outcomes.every((outcome) => outcome === "done" || outcome === "full")).toBe(true);
    // A post that started after the role was given hears «full»: one more, now, is told so.
    expect(await offer(event.id, role.id, "after")).toEqual({ outcome: "full" });
  });

  it("a double tap — one new address twice at once — is one row, and both presses hear «am primit»", async () => {
    const { event, role } = await eventWithRole(5);
    const results = await Promise.all([offer(event.id, role.id, "twice"), offer(event.id, role.id, "twice")]);
    expect(results).toEqual([{ outcome: "done" }, { outcome: "done" }]);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, event.id))).toHaveLength(1);
  });

  it("an address entered by hand while the page posts it is one row, and the organizer hears «already listed», never the database", async () => {
    const { event, role } = await eventWithRole(50);
    for (let round = 0; round < 5; round++) {
      const email = `voluntar.${stamp}.race-${round}@example.test`;
      const [byHand] = await Promise.allSettled([
        changeVolunteer(db, admin!, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Ana Pop", email, phone: "+40712345678", note: "" } }, NOW),
        submitVolunteer(db, event.id, { roleIds: [role.id], name: "Ana Pop", email, phone: "+40712345678", message: "", locale: "ro", consent: true, agreement: true, adult: true, renderedAt: RENDERED }, NOW),
      ]);
      if (byHand.status === "rejected") expect(byHand.reason).toMatchObject({ code: "VOLUNTEER_ALREADY_LISTED", fields: ["email"] });
      const rows = await db.select().from(eventVolunteers).where(and(eq(eventVolunteers.eventId, event.id), eq(eventVolunteers.canonicalEmail, email)));
      expect(rows).toHaveLength(1);
    }
  });

  it("two «Adaugă rolul» on an event with no role yet take two positions", async () => {
    const { event, role } = await eventWithRole(1);
    await db.delete(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, role.id));
    const fields = (name: string) => ({ nameRo: name, nameEn: name, needed: "2", descriptionRo: "", descriptionEn: "" });
    await Promise.all([
      changeVolunteerRole(db, admin!, { kind: "add", eventId: event.id, fields: fields("Unu") }, NOW),
      changeVolunteerRole(db, admin!, { kind: "add", eventId: event.id, fields: fields("Doi") }, NOW),
    ]);
    const positions = (await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, event.id))).map((row) => row.position).sort();
    expect(positions).toEqual([0, 1]);
  });

  it("a role edited and moved while the page posts two sign-ups ticking both roles in opposite orders, an organizer adds one by hand and gives another a role: all settle, no deadlock", async () => {
    // The event's row is locked NO KEY UPDATE by a role change, never FOR UPDATE: a sign-up holding its roles' locks
    // takes KEY SHARE on the event for its foreign key, and FOR UPDATE there closed a cycle (40P01, one side aborted).
    // A sign-up locks the roles it ticked in the order of their ids, as a role change locks the event's roles (§761):
    // two sign-ups ticking A, B and B, A never hold one each and wait on the other.
    const { event, role } = await eventWithRole(60);
    const [other] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Start", nameEn: "Start", needed: 50, position: 1 }).returning();
    const edit = (needed: number) => ({ nameRo: "Punct de apă", nameEn: "Water point", needed: String(needed), descriptionRo: "", descriptionEn: "" });
    for (let round = 0; round < 25; round++) {
      const hand = await changeVolunteer(
        db,
        admin!,
        { kind: "add", eventId: event.id, fields: { roleIds: [role.id, other.id], name: "Dan Pop", email: `voluntar.${stamp}.wait-${round}@example.test`, phone: "+40712345678", note: "" } },
        NOW,
      );
      const results = await Promise.allSettled([
        offer(event.id, [role.id, other.id], `lock-a-${round}`),
        offer(event.id, [other.id, role.id], `lock-b-${round}`),
        changeVolunteerRole(db, admin!, { kind: "edit", eventId: event.id, id: role.id, fields: edit(60 + (round % 2)) }, NOW),
        changeVolunteerRole(db, admin!, { kind: "move", eventId: event.id, id: other.id, direction: round % 2 === 0 ? "up" : "down" }, NOW),
        changeVolunteer(
          db,
          admin!,
          { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Ion Pop", email: `voluntar.${stamp}.hand-${round}@example.test`, phone: "+40712345678", note: "" } },
          NOW,
        ),
        changeVolunteer(db, admin!, { kind: "assign", eventId: event.id, id: hand.volunteer.id, roleId: round % 2 === 0 ? role.id : other.id }, NOW),
      ]);
      expect(results.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
      expect((results[0] as PromiseFulfilledResult<{ outcome: string }>).value.outcome).toBe("done");
      expect((results[1] as PromiseFulfilledResult<{ outcome: string }>).value.outcome).toBe("done");
    }
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, event.id))).toHaveLength(100);
  });

  it("§761 a hand entry and an edit naming two roles and a role given, racing sign-ups ticking both and a role move: all settle, no deadlock", async () => {
    // Before the fix a staff add took KEY SHARE on the role given (the row's foreign key) and then on each ticked role
    // in the order posted, while a sign-up locks the roles FOR UPDATE in the order of their ids: with the role given
    // the higher id, the two waited on each other (40P01). Every writer of a role reference now locks the event's
    // roles first, in the order of their ids.
    const { event, role } = await eventWithRole(80);
    const [other] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Start", nameEn: "Start", needed: 80, position: 1 }).returning();
    const [low, high] = [role.id, other.id].sort();
    const person = (round: number, what: string) => ({
      // The higher id posted first and given: the order that closed the cycle.
      roleIds: [high, low],
      assignedRoleId: high,
      name: "Dan Pop",
      email: `voluntar.${stamp}.${what}-${round}@example.test`,
      phone: "+40712345678",
      note: "",
    });
    for (let round = 0; round < 25; round++) {
      const edited = await changeVolunteer(db, admin!, { kind: "add", eventId: event.id, fields: { ...person(round, "edited"), roleIds: [low], assignedRoleId: low } }, NOW);
      const results = await Promise.allSettled([
        changeVolunteer(db, admin!, { kind: "add", eventId: event.id, fields: person(round, "both") }, NOW),
        offer(event.id, [low, high], `both-a-${round}`),
        offer(event.id, [high, low], `both-b-${round}`),
        changeVolunteer(db, admin!, { kind: "edit", eventId: event.id, id: edited.volunteer.id, fields: person(round, "edited") }, NOW),
        changeVolunteerRole(db, admin!, { kind: "move", eventId: event.id, id: other.id, direction: round % 2 === 0 ? "up" : "down" }, NOW),
      ]);
      expect(results.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    }
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, event.id))).toHaveLength(100);
    // Each hand entry and each edit kept both ticks.
    const hand = await db.select({ id: eventVolunteers.id }).from(eventVolunteers).where(and(eq(eventVolunteers.eventId, event.id), eq(eventVolunteers.roleId, high)));
    expect(hand).toHaveLength(50);
    const ticks = await db.select().from(eventVolunteerRoleChoices).where(inArray(eventVolunteerRoleChoices.volunteerId, hand.map((row) => row.id)));
    expect(ticks).toHaveLength(100);
  });

  it("§764 «Salvează culorile» on the badges' page, racing sign-ups ticking both roles in opposite orders and a role move: all settle, no deadlock", async () => {
    // The press locks the event's roles FOR UPDATE like a sign-up does — in the order of their ids (a role's id is a
    // random uuid, so the table's own scan order differs from it on about half of all events). Without the order, the
    // press held the role a sign-up still needed and waited on the one the sign-up held (40P01, one side aborted).
    const { event, role } = await eventWithRole(60);
    const [other] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Start", nameEn: "Start", needed: 50, position: 1 }).returning();
    const colours = ["#c62828", "#0d47a1"];
    for (let round = 0; round < 25; round++) {
      const results = await Promise.allSettled([
        offer(event.id, [role.id, other.id], `colour-a-${round}`),
        offer(event.id, [other.id, role.id], `colour-b-${round}`),
        saveBadgeRoleColours(
          db,
          admin!,
          event.id,
          [
            { roleId: role.id, choice: colours[round % 2], typed: "" },
            { roleId: other.id, choice: colours[(round + 1) % 2], typed: "" },
          ],
          NOW,
        ),
        changeVolunteerRole(db, admin!, { kind: "move", eventId: event.id, id: other.id, direction: round % 2 === 0 ? "up" : "down" }, NOW),
      ]);
      expect(results.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok"]);
    }
    const kept = await db.select({ id: eventVolunteerRoles.id, colour: eventVolunteerRoles.colour }).from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, event.id));
    expect(kept.every((row) => row.colour !== null)).toBe(true);
  });

  it("§NNN «Salvează toate rolurile» — renaming, ordering and adding roles in one save — racing sign-ups ticking both roles in opposite orders, a role move and a second save: all settle, no deadlock, and the order is never half written", async () => {
    // The plural writer takes the locks every other writer of the roles takes, in the same order: the event (NO KEY UPDATE, so a sign-up's KEY SHARE on
    // it does not close a cycle), its categories, then its roles by id. Two saves at once queue on the event; a save and a sign-up ticking the roles in
    // either order never hold one role each and wait on the other.
    const { event, role } = await eventWithRole(60);
    const [other] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Start", nameEn: "Start", needed: 50, position: 1 }).returning();
    const rounds = 20;
    for (let round = 0; round < rounds; round++) {
      const results = await Promise.allSettled([
        offer(event.id, [role.id, other.id], `plural-a-${round}`),
        offer(event.id, [other.id, role.id], `plural-b-${round}`),
        changeVolunteerRoles(
          db,
          admin!,
          {
            eventId: event.id,
            rows: [
              { key: role.id, id: role.id, fields: { nameEn: `Water ${round}`, position: round % 2 === 0 ? "2" : "1" } },
              { key: other.id, id: other.id, fields: { needed: String(40 + (round % 3)) } },
            ],
          },
          NOW,
        ),
        changeVolunteerRoles(db, admin!, { eventId: event.id, rows: [{ key: "new-none", id: null, fields: { nameRo: `Nou ${round}`, nameEn: `New ${round}`, needed: "1", categoryId: "" } }] }, NOW),
        changeVolunteerRole(db, admin!, { kind: "move", eventId: event.id, id: other.id, direction: round % 2 === 0 ? "up" : "down" }, NOW),
      ]);
      expect(results.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    }
    // Both roles stay, the twenty new ones were each created once, and every role has a place of its own: 0 … n-1, no two alike.
    const roles = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, event.id));
    expect(roles).toHaveLength(2 + rounds);
    expect(roles.map((row) => row.position).sort((a, b) => a - b)).toEqual(Array.from({ length: 2 + rounds }, (_, index) => index));
  });
});
