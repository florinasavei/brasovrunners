import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { NoFreePlaceError, noFreePlaceOutcome, noFreePlaceValues } from "@/modules/registrations/domain/capacity";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-07 — «Dă-i un loc» (the owner, 2026-09-30, on QA: «Nu merge atribuirea de loc din lista
 * de așteptare»). The owner's shape: a race whose places are all taken or promised — one runner
 * confirmed, a family on one address holding its places until it confirms the address — and somebody
 * else on the waiting list. The press was refused, rightly (no place is free, §10.6), with «Verifică
 * datele introduse; ceva nu este valid.», which said nothing. It now names who holds the places (§589),
 * and the same press gives the place as soon as one is free — here, the family's deadline passing
 * with no job run since.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { continueFamilySittingAndReserve, submitRegistration, confirmEmail } = await import("@/modules/registrations/service");
const { releaseFamilySitting } = await import("@/modules/registrations/family-sitting");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { createRegistrationByStaff, promoteRegistrationByStaff } = await import("@/modules/registrations/admin-service");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await db.delete(familyPlaceHolds);
  forgetCachedDeadlines();
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: declarationTrailRo },
    { locale: "en", title: "Declaration", body: declarationTrailEn },
  ];
  for (const [key, translations] of [["PRIVACY_NOTICE", privacy], ["TERMS", privacy], ["EVENT_DECLARATION", declaration]] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }
});

const submission = (firstName: string, email: string, when: Date) => ({
  firstName,
  lastName: "Pop",
  birthDate: "1985-03-02",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(when.getTime() - 30_000).toISOString(),
});

/** Three places: Radu confirmed at the desk, the Pop family's two forms reserved, Elena waiting. */
async function theOwnersShape() {
  const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  const [row] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 3, locationName: "Parc", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: row.id, locale: "ro", title: "Cros", slug: `cros-${row.id.slice(0, 8)}` },
    { eventId: row.id, locale: "en", title: "Cross", slug: `cross-${row.id.slice(0, 8)}` },
  ]);
  const event = { id: row.id, raceId: null, capacity: 3, registrationMode: "INTERNAL" as const, registrationOpensAt: null, registrationClosesAt: null, startsAt: row.startsAt, eventStatus: row.eventStatus, publishedAt: NOW };

  await createRegistrationByStaff(db, admin, { eventId: event.id, firstName: "Radu", lastName: "Ion", email: "radu@example.ro", locale: "ro", listOptOut: false, relayedByParticipantRequest: true, fastTrack: true }, at(0));
  // The family: «Da» after the first form, a second form, «Nu mai înscriu pe nimeni» (§543).
  const first = await submitRegistration(db, event, submission("Ana", "familia.pop@example.ro", at(1)), at(1), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
  const firstWindowEnd = new Date(at(1).getTime() + 10 * 60_000);
  const pressed = await continueFamilySittingAndReserve(
    db,
    { sittingId: first.sittingId ?? randomUUID(), seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" },
    firstWindowEnd,
    at(1),
    { firstWindowEnd, firstName: "Ana Pop", email: "familia.pop@example.ro" },
  );
  await submitRegistration(db, event, submission("Mihai", "familia.pop@example.ro", at(2)), at(2), "REAL", { ...PUBLIC, sitting: { id: pressed.sittingId, joined: true, newPerson: true } });
  await releaseFamilySitting(db, pressed.sittingId!, at(3));

  await submitRegistration(db, event, submission("Elena", "elena@example.ro", at(4)), at(4), "REAL", PUBLIC);
  const [waiting] = await db.select().from(registrations).where(eq(registrations.registeredName, "Elena Pop"));
  expect((await confirmEmail(db, event, waiting.id, at(5))).status).toBe("WAITLISTED");
  return { admin, waiting, deadline: pressed.reservedUntil! };
}

describe("BR-REQ-037-07 «Dă-i un loc» on a full race (§589)", () => {
  it("is refused with who holds the places, changes nothing, and the banner says it in both languages", async () => {
    const { admin, waiting } = await theOwnersShape();

    const refusal = await promoteRegistrationByStaff(db, admin, waiting.id, at(6)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(NoFreePlaceError);
    // Three places: one confirmed, two reserved for the family until it confirms the address.
    expect((refusal as NoFreePlaceError).places).toEqual({ capacity: 3, confirmed: 1, declaration: 0, offered: 0, family: 2, invited: 0 });
    const [after] = await db.select().from(registrations).where(eq(registrations.id, waiting.id));
    expect(after.status).toBe("WAITLISTED");

    // What the action puts on the redirect, and what the page reads back from it.
    const outcome = noFreePlaceOutcome(refusal)!;
    expect(outcome).toEqual({ error: "NO_FREE_PLACE", capacity: "3", confirmed: "1", declaration: "0", offered: "0", family: "2", invited: "0" });
    const values = noFreePlaceValues(outcome.error, { ...outcome, family: "<b>2</b>" });
    expect(values).toMatchObject({ capacity: "3", family: "0" });
    expect(noFreePlaceValues("VALIDATION_ERROR", outcome)).toBeUndefined();
    const sentence = (messages: typeof ro, locale: "ro" | "en") =>
      createTranslator({ locale, messages, namespace: "Admin" })("errors.NO_FREE_PLACE", noFreePlaceValues(outcome.error, outcome));
    expect(sentence(ro, "ro")).toContain("locuri 3, confirmați 1, declarații de semnat 0, oferite 0, rezervate familiilor 2, invitați 0.");
    expect(sentence(en as typeof ro, "en")).toContain("places 3, confirmed 1, declarations to sign 0, offered 0, reserved for families 2, invited 0.");
  });

  it("gives the place once one is free: the family's deadline passed and no job has run since", async () => {
    const { admin, waiting, deadline } = await theOwnersShape();
    const later = new Date(deadline.getTime() + 60_000);

    const promoted = await promoteRegistrationByStaff(db, admin, waiting.id, later);
    expect(promoted.status).toBe("CONFIRMED");
    expect(promoted.bibNumber).not.toBeNull();
    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, waiting.id));
    expect(queued.map((message) => message.messageType)).toContain("REGISTRATION_CONFIRMED");
  });
});
