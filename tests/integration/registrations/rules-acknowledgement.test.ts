import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-01 and `DECISIONS.md` §195 — the entrant says they have read the race's conditions,
 * and the moment they said it is kept.
 *
 * The screen makes reading the easy path: the conditions open in a panel, and the button that
 * agrees stays dead until the text has been scrolled to its end. None of that can be proved on a
 * server, and none of it is claimed here. These assertions hold to the part that is checkable —
 * a public submission without the statement is refused, one with it is accepted, and the
 * timestamp is written — so the club can answer "was this person shown the conditions" with a
 * row rather than with a recollection.
 */
const NOW = new Date("2026-09-20T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});

afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
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
    now: NOW,
  });
  await insertLegalDocumentVersion(db, {
    key: "TERMS",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(privacy),
    translations: privacy,
    now: NOW,
  });
});

async function createInternalEvent(): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: null,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: null,
    raceId: null,
    publishedAt: NOW,
  };
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
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
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
  ...overrides,
});

describe("§195 the race conditions are acknowledged, and the moment is kept", () => {
  it("records when the entrant said they had read them", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(), NOW);

    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(row.rulesAcknowledgedAt).toEqual(NOW);
  });

  it("refuses a public submission that does not carry it, and writes nothing", async () => {
    const event = await createInternalEvent();

    await expect(
      submitRegistration(db, event, submission({ rulesAcknowledged: false }), NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(0);
  });

  it("names the field it refused, so the form can point at it", async () => {
    // BR-REQ-031-04: a rejection carries field names and no values, and the form reaches the
    // control by that name. A required consent nobody can find is a dead end.
    const event = await createInternalEvent();

    await expect(
      submitRegistration(db, event, submission({ rulesAcknowledged: false }), NOW),
    ).rejects.toMatchObject({ fields: expect.arrayContaining(["rulesAcknowledged"]) });
  });
});
