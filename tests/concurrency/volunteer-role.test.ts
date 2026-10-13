import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { changeVolunteer, changeVolunteerRole, submitVolunteer } from "@/modules/volunteers/volunteers";

/**
 * §754 — a volunteer role never takes more people than it needs from the public form, proven with real
 * connections racing (BR-REQ-031-01).
 *
 * Ten people press «Mă ofer voluntar» for the same role at the same moment, each on its own connection: the
 * role's row is locked (`SELECT … FOR UPDATE`) in the sign-up's own transaction while its people are counted,
 * so the ten queue on it, the first takes the one place, and the nine after it read a full role and are told
 * «full» — never a second row. PGlite, one connection, serializes the posts whether or not the row is locked,
 * so `tests/integration/volunteers/signup.test.ts` cannot show it (`tests/helpers/db.ts`). And one person's
 * double tap — the same new address twice at once — is one row: the `UNIQUE (event_id, canonical_email)`
 * decides, and both presses hear the same «am primit». The organizers' side meets the same constraint: an
 * address entered by hand while the page posts it is one row, and the organizer hears «already listed», never
 * the database; two «Adaugă rolul» on an event with no role yet take two positions (the event's row is locked).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§754 BR-REQ-031-01 ten people offer for a role's last place at once", () => {
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
    // A privacy notice naming `{{volunteers}}` in both languages, the newest version, so it is the one in force
    // (`noticeDescribesVolunteers`). Withdrawn again after the suite, so the next suite reads what it approved.
    const [{ highest }] = await db
      .select({ highest: sql<number>`coalesce(max(${legalDocuments.version}), 0)::int` })
      .from(legalDocuments)
      .where(eq(legalDocuments.key, "PRIVACY_NOTICE"));
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Voluntari ({{volunteers}}): păstrăm numele."] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["Volunteers ({{volunteers}}): we keep the name."] }] } },
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
    // The volunteer agreement in force (§NNN), the newest version, from the platform's template: the form's
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
        .where(and(inArray(emailOutbox.messageType, ["VOLUNTEER_RECEIVED", "VOLUNTEER_CLUB_NOTICE"]), inArray(sql`${emailOutbox.payloadJson}->>'eventId'`, createdEventIds)));
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

  const offer = (eventId: string, roleId: string, index: number | string) =>
    submitVolunteer(
      db,
      eventId,
      {
        roleId,
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

  it("exactly one person takes a role that needs one; the nine others hear «full»; one row", async () => {
    const { event, role } = await eventWithRole(1);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => offer(event.id, role.id, `one-${index}`)));
    expect(results.filter((result) => result.outcome === "done")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "full")).toHaveLength(9);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.roleId, role.id))).toHaveLength(1);
  });

  it("a role that needs three takes three of ten, never four", async () => {
    const { event, role } = await eventWithRole(3);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => offer(event.id, role.id, `three-${index}`)));
    expect(results.filter((result) => result.outcome === "done")).toHaveLength(3);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.roleId, role.id))).toHaveLength(3);
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
        changeVolunteer(db, admin!, { kind: "add", eventId: event.id, fields: { roleId: role.id, name: "Ana Pop", email, phone: "+40712345678", note: "" } }, NOW),
        submitVolunteer(db, event.id, { roleId: role.id, name: "Ana Pop", email, phone: "+40712345678", message: "", locale: "ro", consent: true, renderedAt: RENDERED }, NOW),
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

  it("a role edited and moved while the page posts a sign-up and an organizer adds one by hand: all four settle, no deadlock", async () => {
    // The event's row is locked NO KEY UPDATE by a role change, never FOR UPDATE: a sign-up holding its role's lock
    // takes KEY SHARE on the event for its foreign key, and FOR UPDATE there closed a cycle (40P01, one side aborted).
    const { event, role } = await eventWithRole(60);
    const [other] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Start", nameEn: "Start", needed: 50, position: 1 }).returning();
    const edit = (needed: number) => ({ nameRo: "Punct de apă", nameEn: "Water point", needed: String(needed), descriptionRo: "", descriptionEn: "" });
    for (let round = 0; round < 25; round++) {
      const results = await Promise.allSettled([
        offer(event.id, role.id, `lock-${round}`),
        changeVolunteerRole(db, admin!, { kind: "edit", eventId: event.id, id: role.id, fields: edit(60 + (round % 2)) }, NOW),
        changeVolunteerRole(db, admin!, { kind: "move", eventId: event.id, id: other.id, direction: round % 2 === 0 ? "up" : "down" }, NOW),
        changeVolunteer(
          db,
          admin!,
          { kind: "add", eventId: event.id, fields: { roleId: role.id, name: "Ion Pop", email: `voluntar.${stamp}.hand-${round}@example.test`, phone: "+40712345678", note: "" } },
          NOW,
        ),
      ]);
      expect(results.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok"]);
      expect((results[0] as PromiseFulfilledResult<{ outcome: string }>).value.outcome).toBe("done");
    }
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, event.id))).toHaveLength(50);
  });
});
