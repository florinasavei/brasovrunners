import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  confirmEmail,
  type EventForRegistration,
  submitRegistration,
} from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §199 and `AGENTS.md` §19.4 — somebody fills the form a second time with the
 * same address.
 *
 * The screen must say what it says to everybody: telling a visitor "this address is already
 * registered" would make the public form a way to ask who is entered. The useful answer goes to
 * the address itself, which only its owner reads — and it used to go only while the first
 * registration was still waiting for its email confirmation, so anybody past that point got
 * "we have sent you a confirmation link" and nothing at all.
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

const EMAIL = "ana@example.ro";

const submission = (at: Date) => ({
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Contact Urgență",
  emergencyContactPhone: "+40722222222",
  email: EMAIL,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(at.getTime() - 30_000).toISOString(),
});

const sentTypes = async () =>
  (await db.select().from(emailOutbox)).map((row) => row.messageType);

describe("§199 the form filled a second time with the same address", () => {
  it("creates no second registration", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    await submitRegistration(db, event, submission(later), later);

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(1);
  });

  it("sends the verification link again while the first is still unconfirmed", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    await submitRegistration(db, event, submission(later), later);

    expect(await sentTypes()).toEqual([
      "VERIFY_REGISTRATION_EMAIL",
      "VERIFY_REGISTRATION_EMAIL",
    ]);
  });

  it("sends what the state can offer once the address is already confirmed", async () => {
    /*
      The case that used to send nothing. Somebody who confirmed, forgot, and filled the form
      again saw "we have sent you a confirmation link" and no message arrived — which reads
      exactly like a failure, and is what happened to every re-entered test registration.
    */
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);

    const [registration] = await db.select().from(registrations);
    await confirmEmail(db, event, registration.id, new Date(NOW.getTime() + 60_000));

    const before = await sentTypes();
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    await submitRegistration(db, event, submission(later), later);
    const after = await sentTypes();

    expect(after.length).toBe(before.length + 1);
    // Whatever the state machine allows for that status — not a bare manage link.
    expect(after.at(-1)).toBe("COMPLETE_DECLARATION");
  });
});
