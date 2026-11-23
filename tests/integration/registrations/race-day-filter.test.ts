import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { eventResults } from "@/db/schema/event-results";
import {
  confirmEmail,
  type EventForRegistration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN «Ziua cursei» (BR-REQ-037-05): the registrations list's filter — present, finished, DNS — and each row's time.
 *
 * Kept from the club-member test's set-up:  — "I am a Brașov Runners team member".
 *
 * A claim the club can see, filter and export, and which grants nothing. The last part is the
 * one worth a test: the obvious next change somebody makes to this column is a member price or
 * a reserved place, and both would put a condition into the capacity path that `AGENTS.md`
 * §12.6 keeps out of it. So the assertions here are as much about what the flag does *not*
 * change as about what it stores (`DECISIONS.md` §48).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase, now: Date) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(privacy),
    translations: privacy,
    now,
  });
  await insertLegalDocumentVersion(db, {
    key: "TERMS",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(privacy),
    translations: privacy,
    now,
  });
}

async function createInternalEvent(
  db: TestDatabase,
  overrides: { capacity?: number | null } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: overrides.capacity ?? null,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: overrides.capacity ?? null,
    raceId: null,
    publishedAt: NOW,
  };
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "FEMALE",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email: "ana@example.ro",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

describe("§NNN the registrations list's «Ziua cursei»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db, NOW);
  });

  it("tells who came, who finished with their time, and who never came nor cancelled", async () => {
    const event = await createInternalEvent(db);
    const people = ["fin", "dnf", "desk", "dns", "gone"];
    for (const who of people) await submitRegistration(db, event, submissionInput({ email: `${who}@example.ro`, firstName: who }), NOW);
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const id = (who: string) => rows.find((row) => row.firstName === who)!.id;
    for (const row of rows) await confirmEmail(db, event, row.id, NOW);
    await unregister(db, event, id("gone"), "PARTICIPANT", NOW);
    // The declaration signed: what «confirmed» is — set directly, the signing is not what this test is about.
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.status, "PENDING_DECLARATION"));
    await db.update(registrations).set({ checkedInAt: NOW }).where(eq(registrations.id, id("desk")));
    await db.insert(eventResults).values([
      { eventId: event.id, registrationId: id("fin"), bibNumber: 1, status: "FINISHED", gunTimeMs: 3_000_000 },
      { eventId: event.id, registrationId: id("dnf"), bibNumber: 2, status: "DNF" },
    ]);

    const names = async (raceDay: "present" | "finished" | "dns") =>
      (await listRegistrationsForAdmin(db, { eventId: event.id, raceDay })).map((row) => row.firstName).sort();

    expect(await names("present")).toEqual(["desk", "dnf", "fin"]);
    expect(await names("finished")).toEqual(["fin"]);
    expect(await names("dns")).toEqual(["dns"]);

    const all = await listRegistrationsForAdmin(db, { eventId: event.id });
    const fin = all.find((row) => row.firstName === "fin")!;
    expect([fin.resultStatus, fin.resultTimeMs]).toEqual(["FINISHED", 3_000_000]);
    expect(all.find((row) => row.firstName === "dns")!.resultTimeMs).toBeNull();
  });
});
