import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { submitVolunteer } from "@/modules/volunteers/volunteers";

/**
 * §NNN — a volunteer role never takes more people than it needs from the public form, proven with real
 * connections racing (BR-REQ-031-01).
 *
 * Ten people press «Mă ofer voluntar» for the same role at the same moment, each on its own connection: the
 * role's row is locked (`SELECT … FOR UPDATE`) in the sign-up's own transaction while its people are counted,
 * so the ten queue on it, the first takes the one place, and the nine after it read a full role and are told
 * «full» — never a second row. PGlite, one connection, serializes the posts whether or not the row is locked,
 * so `tests/integration/volunteers/signup.test.ts` cannot show it (`tests/helpers/db.ts`). And one person's
 * double tap — the same new address twice at once — is one row: the `UNIQUE (event_id, canonical_email)`
 * decides, and both presses hear the same «am primit».
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§NNN BR-REQ-031-01 ten people offer for a role's last place at once", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  // The real clock: the notice inserted here must be the one in force, after whatever another suite approved.
  const NOW = new Date();
  const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
  const stamp = Date.now();
  const createdEventIds: string[] = [];
  let noticeId: string | undefined;

  beforeAll(async () => {
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
});
