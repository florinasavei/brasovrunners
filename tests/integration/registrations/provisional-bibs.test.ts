import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { pickBibNumber, settleBibNumbers } from "@/modules/registrations/bibs";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import {
  confirmEmail,
  type EventForRegistration,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §214 — the race number is held with the place, and settled when registration
 * closes.
 *
 * What is protected here is the pair of rules that make the two columns safe:
 *
 *   - a provisional number exists **exactly while** a registration occupies a place, so it is
 *     drawn at submission and released the moment the place goes;
 *   - a settled number is never renumbered, and it is the only one that is ever emailed.
 *
 * The releasing half is worth the most: it is what lets the sequence stay dense, and it is also
 * the half that would be silently wrong — a number nobody holds that nobody can take.
 */
const NOW = new Date("2026-09-21T09:00:00.000Z");
const STARTS_AT = new Date("2026-09-24T07:00:00.000Z");
const CLOSES_AT = new Date("2026-09-23T07:00:00.000Z");
const AFTER_CLOSE = new Date("2026-09-23T08:00:00.000Z");

async function approveDeclaration(db: TestDatabase, now: Date) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d"] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now,
  });
}

async function approvePrivacyNotice(db: TestDatabase, now: Date) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now,
  });
  await insertLegalDocumentVersion(db, {
    key: "TERMS",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now,
  });
}

function submissionInput(email: string, at: Date) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "UNSPECIFIED",
    nationality: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

describe("DECISIONS.md §214 provisional race numbers", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approvePrivacyNotice(db, NOW);
    await approveDeclaration(db, NOW);
  });

  async function createEvent(
    overrides: { bibStartNumber?: number; capacity?: number | null } = {},
  ): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: STARTS_AT,
        registrationMode: "INTERNAL",
        capacity: overrides.capacity ?? 50,
        bibStartNumber: overrides.bibStartNumber ?? 1,
        registrationClosesAt: CLOSES_AT,
      })
      .returning();
    await db
      .insert(eventTranslations)
      .values({ eventId: event.id, locale: "ro", title: "Cros", slug: `cros-${event.id.slice(0, 8)}` });
    return {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      capacity: overrides.capacity ?? 50,
      raceId: null,
      publishedAt: NOW,
    };
  }

  /** Submit, and return the row as it stands: `PENDING_EMAIL_CONFIRMATION`, place held. */
  async function submit(event: EventForRegistration, email: string, at = NOW, kind: "REAL" | "TEST" = "REAL") {
    await submitRegistration(db, event, submissionInput(email, at), at, kind);
    const [participant] = await db.select().from(participants).where(eq(participants.deliveryEmail, email));
    const [row] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, event.id), eq(registrations.participantId, participant.id)));
    return row;
  }

  it("draws the number at submission, before the email is even confirmed", async () => {
    // The whole point of §214, in the owner's words: "I need the BID to be reserved ASAP",
    // said while looking at his own row stuck on "waiting for the email".
    const event = await createEvent();
    const first = await submit(event, "a@example.test");

    expect(first.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(first.provisionalBibNumber).toBe(1);
    // And not the settled one: nothing is printable or emailable yet.
    expect(first.bibNumber).toBeNull();

    const second = await submit(event, "b@example.test", new Date(NOW.getTime() + 60_000));
    expect(second.provisionalBibNumber).toBe(2);
  });

  it("counts from the event's own band, as the settled numbers do", async () => {
    const event = await createEvent({ bibStartNumber: 500 });
    const row = await submit(event, "a@example.test");
    expect(row.provisionalBibNumber).toBe(500);
  });

  it("releases the number when the place goes, and gives it to the next person", async () => {
    /*
      The rule that makes the provisional sequence different from the settled one. A settled
      number is never reissued, because a bib may be printed; a provisional one is printed
      nowhere, so releasing it keeps the sequence dense — which is what makes most people's
      number survive the settle unchanged.
    */
    const event = await createEvent();
    const first = await submit(event, "a@example.test");
    const second = await submit(event, "b@example.test", new Date(NOW.getTime() + 60_000));
    expect([first.provisionalBibNumber, second.provisionalBibNumber]).toEqual([1, 2]);

    await confirmEmail(db, event, first.id, new Date(NOW.getTime() + 120_000));
    await unregister(db, event, first.id, "PARTICIPANT", new Date(NOW.getTime() + 180_000));

    const [cancelled] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.provisionalBibNumber).toBeNull();

    // 1 is free again, and the next person takes it rather than 3.
    const third = await submit(event, "c@example.test", new Date(NOW.getTime() + 240_000));
    expect(third.provisionalBibNumber).toBe(1);
  });

  it("refuses two runners the same provisional number at one event", async () => {
    // The lock is what keeps this from ever being reached; the index is what makes reaching it
    // an error instead of two people wearing one number.
    const event = await createEvent();
    const first = await submit(event, "a@example.test");
    const second = await submit(event, "b@example.test", new Date(NOW.getTime() + 60_000));

    await expectViolation(
      db
        .update(registrations)
        .set({ provisionalBibNumber: first.provisionalBibNumber })
        .where(eq(registrations.id, second.id)),
      { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "registrations_event_provisional_bib_unique" },
    );
  });

  it("gives a test registration no number at all", async () => {
    // `AGENTS.md` §12.6: a test row is in no count the club is given, and a number is the most
    // physical count there is.
    const event = await createEvent();
    const row = await submit(event, "t@example.test", NOW, "TEST");
    expect(row.kind).toBe("TEST");
    expect(row.provisionalBibNumber).toBeNull();
    expect(row.bibNumber).toBeNull();
  });

  it("settles the sequence at the close, closing the holes the cancellations left", async () => {
    const event = await createEvent();
    const a = await submit(event, "a@example.test");
    const b = await submit(event, "b@example.test", new Date(NOW.getTime() + 60_000));
    const c = await submit(event, "c@example.test", new Date(NOW.getTime() + 120_000));
    expect([a.provisionalBibNumber, b.provisionalBibNumber, c.provisionalBibNumber]).toEqual([1, 2, 3]);

    // The middle one goes, leaving 1 and 3 — which is the sheet with a hole in it.
    await confirmEmail(db, event, b.id, new Date(NOW.getTime() + 180_000));
    await unregister(db, event, b.id, "PARTICIPANT", new Date(NOW.getTime() + 240_000));
    // The other two confirm their address: the settle numbers the places the capacity formula
    // counts, and an unproved address is not one of them (§420).
    await confirmEmail(db, event, a.id, new Date(NOW.getTime() + 300_000));
    await confirmEmail(db, event, c.id, new Date(NOW.getTime() + 360_000));

    const [locked] = await db.select().from(events).where(eq(events.id, event.id));
    const settled = await settleBibNumbers(db, {
      eventId: event.id,
      bibStartNumber: locked.bibStartNumber,
      bibsSettledAt: locked.bibsSettledAt,
      now: AFTER_CLOSE,
    });

    expect(settled.map((row) => row.bibNumber)).toEqual([1, 2]);
    const [first] = await db.select().from(registrations).where(eq(registrations.id, a.id));
    const [third] = await db.select().from(registrations).where(eq(registrations.id, c.id));
    expect(first.bibNumber).toBe(1);
    // The hole is closed: 3 becomes 2, which is the one moment a number moves.
    expect(third.bibNumber).toBe(2);
    // And the provisional column is emptied, so one runner has exactly one number.
    expect(first.provisionalBibNumber).toBeNull();
    expect(third.provisionalBibNumber).toBeNull();
  });

  it("settles once, however often the job runs", async () => {
    const event = await createEvent();
    const row = await submit(event, "a@example.test");
    // A place the capacity formula counts: the address confirmed (§420).
    await confirmEmail(db, event, row.id, new Date(NOW.getTime() + 60_000));

    const first = await runRegistrationMaintenance(db, AFTER_CLOSE);
    expect(first.bibsSettled).toBe(1);

    const [afterFirst] = await db.select().from(events).where(eq(events.id, event.id));
    expect(afterFirst.bibsSettledAt).not.toBeNull();

    // The second run finds the marker and does nothing — no renumbering, no second message.
    const second = await runRegistrationMaintenance(db, new Date(AFTER_CLOSE.getTime() + 15 * 60_000));
    expect(second.bibsSettled).toBe(0);

    const told = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "BIB_ASSIGNED"));
    expect(told).toHaveLength(1);
    expect(told[0].payloadJson).toEqual({ bibNumber: 1 });
  });

  it("emails the settled number and never the provisional one", async () => {
    /*
      The rule the whole two-column design exists to keep: a number in somebody's inbox cannot
      move afterwards, so nothing is sent until it cannot.
    */
    const event = await createEvent();
    const row = await submit(event, "a@example.test");
    // A place the capacity formula counts: the address confirmed (§420).
    await confirmEmail(db, event, row.id, new Date(NOW.getTime() + 60_000));

    const beforeClose = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "BIB_ASSIGNED"));
    expect(beforeClose).toHaveLength(0);

    await runRegistrationMaintenance(db, AFTER_CLOSE);
    const afterClose = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "BIB_ASSIGNED"));
    expect(afterClose).toHaveLength(1);
  });

  it("releases the number when a hold lapses in the bulk sweep, not only on the guarded path (§220)", async () => {
    /*
      The release lives in `transitionRegistration`, which is the single guarded transition —
      and the three expiry sweeps do not use it. They are bulk `UPDATE ... SET status =
      'EXPIRED'` statements, so each one has to release the number itself.

      Missing it is invisible until somebody counts: the row is expired, the place is free, and
      the number it was holding can never be handed to anybody, so the sequence the design
      promises to keep dense grows a permanent hole.
    */
    const event = await createEvent();
    const row = await submit(event, "lapses@example.test");
    expect(row.provisionalBibNumber).toBe(1);

    // Past the 48-hour email-confirmation deadline, swept by the job rather than by a click.
    const muchLater = new Date(NOW.getTime() + 72 * 60 * 60_000);
    await runRegistrationMaintenance(db, muchLater);

    const [expired] = await db.select().from(registrations).where(eq(registrations.id, row.id));
    expect(expired.status).toBe("EXPIRED");
    expect(expired.provisionalBibNumber).toBeNull();
  });

  it("never gives a final number that somebody is holding as a provisional one (§220)", async () => {
    /*
      Reachable after the settle: registration has closed, two people are entered at the desk
      and each is given a provisional number, and the first to be confirmed draws a final one.
      Reading `bib_number` alone, that draw would hand them the number the *other* one is
      looking at — and the partial unique index cannot catch it, because the two numbers live
      in different columns. The first anybody would know is two runners with one number.
    */
    const event = await createEvent();
    const a = await submit(event, "a@example.test");
    const b = await submit(event, "b@example.test", new Date(NOW.getTime() + 60_000));
    expect([a.provisionalBibNumber, b.provisionalBibNumber]).toEqual([1, 2]);

    const free = await pickBibNumber(db, event.id);
    expect([a.provisionalBibNumber, b.provisionalBibNumber]).not.toContain(free);
    expect(free).toBe(3);
  });

  it("gives a late confirmation its own provisional number rather than a different one (§220)", async () => {
    // The desk has been showing this number to the runner. Drawing a fresh one would both
    // surprise them and strand the old one, reserved to nobody.
    const event = await createEvent();
    const row = await submit(event, "late@example.test");
    expect(row.provisionalBibNumber).toBe(1);

    await confirmEmail(db, event, row.id, new Date(NOW.getTime() + 60_000));
    const afterClose = new Date("2026-09-23T09:00:00.000Z");
    await signDeclaration(db, event, row.id, await signingInput(db, afterClose), afterClose);

    const [confirmed] = await db.select().from(registrations).where(eq(registrations.id, row.id));
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bibNumber).toBe(1);
    // One runner, one number: the provisional column is emptied when the final one is written.
    expect(confirmed.provisionalBibNumber).toBeNull();
  });

  it("reads one number out of two columns, and says which it is", () => {
    expect(raceNumberOf({ bibNumber: null, provisionalBibNumber: null })).toBeNull();
    expect(raceNumberOf({ bibNumber: null, provisionalBibNumber: 7 })).toEqual({ value: 7, settled: false });
    expect(raceNumberOf({ bibNumber: 3, provisionalBibNumber: null })).toEqual({ value: 3, settled: true });
    // Both, which the settle should never leave behind: the sent one wins.
    expect(raceNumberOf({ bibNumber: 3, provisionalBibNumber: 7 })).toEqual({ value: 3, settled: true });
  });
});
