import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-09-25T10:00:00.000Z");
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
const { submitRegistration, readPublicAvailability } = await import("@/modules/registrations/service");
const { continueFamilySitting, releaseFamilySitting } = await import("@/modules/registrations/family-sitting");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { withSittingPerson } = await import("@/modules/registrations/domain/family-sitting");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "C", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "P", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "D", body: declarationTrailRo },
    { locale: "en", title: "D", body: declarationTrailEn },
  ];
  for (const [key, t] of [["PRIVACY_NOTICE", privacy], ["TERMS", privacy], ["EVENT_DECLARATION", declaration]] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(t), translations: t, now: NOW });
  }
});

const BD: Record<string, string> = { Ana: "1985-03-02", Mihai: "1987-02-14", Ioana: "2010-07-11" };
const form = (firstName: string, at: Date) => ({
  firstName, lastName: "Pop", birthDate: BD[firstName], sex: "UNSPECIFIED", nationality: "RO", country: "RO", city: "Brașov",
  phone: "+40711111111", emergencyContactName: "Ion Vecinul", emergencyContactPhone: "+40722222222",
  ...(firstName === "Ioana" ? { guardianName: "Ana Pop" } : {}),
  email: "familia.pop@example.ro", locale: "ro", privacyAcknowledged: true, fitnessDeclared: true, termsAccepted: true,
  rulesAcknowledged: true, resultsNameConsent: false, listOptOut: false, honeypot: "", renderedAt: new Date(at.getTime() - 30_000).toISOString(),
});
const at = (m: number) => new Date(NOW.getTime() + m * 60_000);

it("the owner's scenario, today", async () => {
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, locationName: "P", editorialStatus: "PUBLISHED", publishedAt: NOW }).returning();
  await db.insert(eventTranslations).values([{ eventId: event.id, locale: "ro", title: "Crosul", slug: "crosul" }, { eventId: event.id, locale: "en", title: "Cross", slug: "cross" }]);
  const input = { id: event.id, raceId: null, capacity: 50, registrationMode: "INTERNAL" as const, registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
  const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };
  const snap = async (label: string, now: Date) => {
    const regs = await db.select().from(registrations);
    const entries = await db.select().from(pendingFamilyEntries);
    const box = await db.select().from(emailOutbox);
    const sit = await db.select().from(familySittings);
    console.log(label, JSON.stringify({
      registrations: regs.map((r) => [r.registeredName, r.status, r.holdExpiresAt?.toISOString() ?? null, r.provisionalBibNumber]),
      keptForms: entries.map((e) => [e.fields.firstName, e.sittingId !== null]),
      outbox: box.map((o) => [o.messageType, o.status, o.nextAttemptAt?.toISOString() ?? null]),
      sittings: sit.map((s) => ({ registrationIds: s.registrationIds.length, held: s.heldOutboxIds.length })),
      available: await readPublicAvailability(db, { id: event.id, capacity: 50 }, now),
    }));
  };
  const first = await submitRegistration(db, input, form("Ana", at(0)), at(0), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
  let people = withSittingPerson([], { name: "Ana Pop", birthDate: BD.Ana }).people;
  await snap("after form 1", at(0));
  const sittingId = await continueFamilySitting(db, { sittingId: null, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" }, at(11), at(1));
  await snap("after «Da»", at(1));
  await submitRegistration(db, input, form("Mihai", at(2)), at(2), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true } });
  people = withSittingPerson(people, { name: "Mihai Pop", birthDate: BD.Mihai }).people;
  await snap("after form 2", at(2));
  await continueFamilySitting(db, { sittingId, seed: null, eventId: event.id, locale: "ro" }, at(13), at(3));
  await submitRegistration(db, input, form("Ioana", at(4)), at(4), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true } });
  people = withSittingPerson(people, { name: "Ioana Pop", birthDate: BD.Ioana }).people;
  await snap("after form 3", at(4));
  console.log("cookie people", JSON.stringify(people));
  await releaseFamilySitting(db, sittingId!, at(5));
  await snap("after «Nu mai înscriu pe nimeni»", at(5));
  const rows = await db.select().from(emailOutbox);
  for (const row of rows) {
    const m = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: at(6) }, db, at(6));
    console.log("EMAIL", row.messageType, m.subject, "|", m.text.split("\n").filter((l) => /Pop/.test(l)).join(" // "));
  }
});
