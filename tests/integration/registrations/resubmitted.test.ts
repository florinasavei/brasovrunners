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
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { renderOutboxMessage } from "@/modules/notifications/render";
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
  termsAccepted: true,
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

  it("is refused by the database, not only by the service (§199)", async () => {
    /*
      The owner asked whether two registrations on one address are actually impossible.
      `creates no second registration` above proves the *service* declines to make one, which
      is the path a person takes. This proves the guarantee underneath it.

      The difference matters under a race: two submissions arriving together both read "no
      existing registration" before either has committed, and then both insert. Only the
      constraint decides that, and a constraint nothing tests is a constraint somebody drops
      in a migration to make an unrelated error go away. The bib index is tested the same way
      for the same reason.

      Since the contract migration (§390, migration 0073) the guarantee is keyed on the folded
      name too — `registrations_event_participant_name_unique` — so this repeats the same name
      the existing row carries, the case the family flow does not open a second place for.
    */
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    const [existing] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));

    await expectViolation(
      db.insert(registrations).values({
        eventId: existing.eventId,
        participantId: existing.participantId,
        status: "PENDING_EMAIL_CONFIRMATION",
        kind: "REAL",
        locale: existing.locale,
        registeredName: existing.registeredName,
        nameKey: existing.nameKey,
        displayName: existing.displayName,
        privacyNoticeVersion: existing.privacyNoticeVersion,
        privacyAcknowledgedAt: existing.privacyAcknowledgedAt,
        resultsNameConsent: existing.resultsNameConsent,
        resultsConsentVersion: existing.resultsConsentVersion,
      }),
      { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "registrations_event_participant_name_unique" },
    );

    expect(await db.select().from(registrations).where(eq(registrations.eventId, event.id))).toHaveLength(1);
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

  it("says in the message that it is the registration they already have (§235)", async () => {
    /*
      The owner read two confirmations as two registrations — "te poți înscrie cu fix același
      mail de 2 ori, primești și QR și tot" — because the re-sent one is the confirmation
      again, QR and all, and reads exactly like a first.

      The inbox is the only place this may be answered: saying it on the form would answer
      "is this address registered" about anybody's address (§19.4). So the queued row carries
      the fact, and the rendered message leads with it.
    */
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    // Past the email step, so the re-send is the confirmation — the case the owner met. A
    // re-submission still waiting for its verification link is not "already registered":
    // nothing was finished, and the right answer there is the link again, which it gets.
    const [registration] = await db.select().from(registrations);
    await confirmEmail(db, event, registration.id, new Date(NOW.getTime() + 60_000));

    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    await submitRegistration(db, event, submission(later), later);

    const rows = await db.select().from(emailOutbox);
    const resend = rows.at(-1)!;
    expect(resend.payloadJson).toMatchObject({ alreadyRegistered: true });

    const message = await renderOutboxMessage(
      { ...resend, status: "PROCESSING", attemptCount: 1, lockedAt: later },
      db,
      later,
    );
    expect(message.html).toContain("nu s-a creat o a doua înscriere");
    expect(message.text).toContain("nu s-a creat o a doua înscriere");
    // The sentence they are hunting for is underlined in the HTML and plain in the text (§309):
    // the marker never reaches a reader as underscores.
    expect(message.html).toContain(`<u style="text-decoration:underline">Ești deja înscris</u>`);
    expect(message.text).toContain("Ești deja înscris la acest eveniment");
    expect(message.text).not.toContain("__");
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
