import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  confirmEmail,
  type EventForRegistration,
  readPublicAvailability,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-01 — confirmation, hold, declaration, confirmed. Also exercises BR-REQ-030-01
 * (internal mode only), BR-REQ-031-01 (no password/account surface), and BR-REQ-036-01
 * (self-unregistration).
 *
 * The concurrency requirements this same flow carries — BR-REQ-034-02, BR-REQ-034-03 — are
 * proven against real PostgreSQL in `tests/concurrency`, not here; PGlite is single-connection
 * and cannot race two transactions.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase, now: Date) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d"] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d"] }] } },
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
  await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(declaration),
    translations: declaration,
    now,
  });
}

async function createInternalEvent(
  db: TestDatabase,
  overrides: { capacity?: number | null; startsAt?: Date } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: overrides.startsAt ?? new Date("2026-10-01T09:00:00.000Z"),
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
    publishedAt: NOW, // registration_opens_at defaults to publication when unset
  };
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
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

async function findOneRegistration(db: TestDatabase, eventId: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
  return row;
}

describe("BR-REQ-033-01 registration lifecycle", () => {
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

  /**
   * BR-REQ-033-02 criterion 6 (DECISIONS.md §57): the acceptance names the text the participant
   * read. Version 2 is approved between the page render and the form post — exactly the GET/POST
   * split §53 found — and the signature against version 1 is refused, nothing is written, and
   * the registration is still waiting for a declaration; re-reading and signing records version 2.
   */
  it("BR-REQ-033-02 criterion 6: refuses a signature against a version that is no longer current", async () => {
    const event = await createInternalEvent(db);
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);

    const read = await signingInput(db, NOW); // what the page rendered: version 1

    const revised: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d, revizuit"] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d, revised"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 2,
      effectiveAt: new Date("2026-01-02T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(revised),
      translations: revised,
      now: NOW,
    });

    await expect(
      signDeclaration(db, event, pending.id, read, new Date(NOW.getTime() + 60_000)),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const untouched = await findOneRegistration(db, event.id);
    expect(untouched.status).toBe("PENDING_DECLARATION");
    expect(await db.select().from(declarationAcceptances)).toHaveLength(0);

    // The page re-renders version 2; signing that is recorded against version 2 and its hash.
    const reread = await signingInput(db, NOW);
    const confirmed = await signDeclaration(db, event, pending.id, reread, new Date(NOW.getTime() + 120_000));
    expect(confirmed.status).toBe("CONFIRMED");
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance.declarationVersion).toBe(2);
    expect(acceptance.contentSha256).toBe(reread.contentSha256);
  });

  it("BR-REQ-033-02 criterion 6: refuses a hash or an id that is not the current version's", async () => {
    const event = await createInternalEvent(db);
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);
    const read = await signingInput(db, NOW);

    await expect(
      signDeclaration(db, event, pending.id, { ...read, contentSha256: "0".repeat(64) }, NOW),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      signDeclaration(db, event, pending.id, { ...read, documentId: "00000000-0000-4000-8000-000000000000" }, NOW),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(declarationAcceptances)).toHaveLength(0);
  });

  it("BR-REQ-031-01: the submission surface asks only for name, email, locale, and consent — no password", async () => {
    const event = await createInternalEvent(db);
    const result = await submitRegistration(db, event, submissionInput(), NOW);

    expect(result).toEqual({ ok: true });
    const registration = await findOneRegistration(db, event.id);
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");
    // Nothing resembling an account exists on the row or the schema this test can reach.
    expect(Object.keys(registration)).not.toContain("password");
  });

  it("creates no place until email is confirmed", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });
    await submitRegistration(db, event, submissionInput(), NOW);

    const registration = await findOneRegistration(db, event.id);
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(registration.holdExpiresAt).toBeNull();
  });

  it("holds a place for 30 minutes on confirmation, when capacity allows", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);

    const confirmed = await confirmEmail(db, event, pending.id, NOW);

    expect(confirmed.status).toBe("PENDING_DECLARATION");
    expect(confirmed.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
  });

  it("keeps the declaration hold past its 30 minutes while nobody waits, and a late signature confirms it (§160)", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);

    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    const resigned = await signDeclaration(
      db,
      event,
      pending.id,
      await signingInput(db, NOW, "Ana Pop"),
      past31Minutes,
    );
    expect(resigned.status).toBe("CONFIRMED");
    expect(resigned.expiryReason).toBeNull();
  });

  it("a kept hold still occupies its place; the first to wait for it is offered it at once (§160)", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });
    await submitRegistration(db, event, submissionInput({ email: "first@example.ro" }), NOW);
    const first = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, first.id, NOW);

    // Lapsed, nobody waiting: the count still says full — the place is the person's.
    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    expect(await readPublicAvailability(db, event, past31Minutes)).toBe(0);

    // Somebody joins the waiting list. The queue exists now, so the lapsed hold is released
    // to it — in the same transaction — and the newcomer, alone in line, is offered the place.
    await submitRegistration(db, event, submissionInput({ email: "second@example.ro" }), past31Minutes);
    const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const second = all.find((row) => row.id !== first.id)!;
    const outcome = await confirmEmail(db, event, second.id, past31Minutes);
    expect(outcome.status).toBe("WAITLIST_OFFERED");
    expect(outcome.holdExpiresAt).toEqual(new Date(past31Minutes.getTime() + 24 * 60 * 60_000));

    const [lapsed] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    expect(lapsed.status).toBe("EXPIRED");
    expect(lapsed.expiryReason).toBe("DECLARATION_HOLD_LAPSED");

    // One message for the newcomer: the offer, not "you are on the waiting list" as well.
    const mail = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, second.id));
    expect(mail.map((row) => row.messageType).filter((type) => type !== "VERIFY_REGISTRATION_EMAIL")).toEqual(["WAITLIST_SPOT_OFFER"]);
  });

  it("signing the declaration confirms and records an immutable acceptance", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);

    const confirmed = await signDeclaration(
      db,
      event,
      pending.id,
      await signingInput(db, NOW, "Ana Pop"),
      new Date(NOW.getTime() + 60_000),
    );

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(confirmed.holdExpiresAt).toBeNull();

    const [acceptance] = await db
      .select()
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, confirmed.id));
    expect(acceptance.typedName).toBe("Ana Pop");
    expect(acceptance.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("BR-REQ-036-01: self-unregistration is idempotent and releases the place", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);
    const confirmed = await signDeclaration(
      db,
      event,
      pending.id,
      await signingInput(db, NOW, "Ana Pop"),
      NOW,
    );

    const cancelled = await unregister(db, event, confirmed.id, "PARTICIPANT", NOW);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationSource).toBe("PARTICIPANT");

    // Opening the cancel link a second time is not an error.
    const cancelledAgain = await unregister(db, event, confirmed.id, "PARTICIPANT", NOW);
    expect(cancelledAgain.status).toBe("CANCELLED");
  });

  it("refuses self-unregistration once the event has started", async () => {
    const startsAt = new Date(NOW.getTime() + 60_000);
    const event = await createInternalEvent(db, { capacity: 10, startsAt });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);

    const afterStart = new Date(startsAt.getTime() + 1000);
    await expect(unregister(db, event, pending.id, "PARTICIPANT", afterStart)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });

  it("waitlists a confirmation when the event is already full", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });

    // Fill the one place.
    await submitRegistration(db, event, submissionInput({ email: "first@example.ro" }), NOW);
    const first = await db
      .select()
      .from(registrations)
      .where(eq(registrations.eventId, event.id))
      .then((rows) => rows[0]);
    await confirmEmail(db, event, first.id, NOW);

    // A second participant, confirming afterwards, finds no direct place.
    await submitRegistration(db, event, submissionInput({ email: "second@example.ro" }), NOW);
    const second = await db
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.eventId, event.id), eq(registrations.registeredName, "Ana Pop")),
      )
      .then((rows) => rows.find((row) => row.id !== first.id)!);

    const result = await confirmEmail(db, event, second.id, NOW);
    expect(result.status).toBe("WAITLISTED");
    expect(result.waitlistedAt).toEqual(NOW);
  });

  it("a cancellation frees the place for the front of the waiting list", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });

    await submitRegistration(db, event, submissionInput({ email: "first@example.ro" }), NOW);
    const first = await findOneRegistration(db, event.id);
    const confirmedFirst = await confirmEmail(db, event, first.id, NOW);
    await signDeclaration(db, event, confirmedFirst.id, await signingInput(db, NOW, "Ana Pop"), NOW);

    await submitRegistration(db, event, submissionInput({ email: "second@example.ro" }), new Date(NOW.getTime() + 1000));
    const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const second = all.find((row) => row.id !== confirmedFirst.id)!;
    const waitlisted = await confirmEmail(db, event, second.id, new Date(NOW.getTime() + 2000));
    expect(waitlisted.status).toBe("WAITLISTED");

    await unregister(db, event, confirmedFirst.id, "PARTICIPANT", new Date(NOW.getTime() + 3000));

    const promoted = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, second.id))
      .then((rows) => rows[0]);
    expect(promoted.status).toBe("WAITLIST_OFFERED");
    expect(promoted.holdExpiresAt).not.toBeNull();

    const outboxRow = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
    expect(outboxRow).toHaveLength(1);
  });

  it("BR-REQ-030-01: refuses local registration on a non-internal event", async () => {
    const event = await createInternalEvent(db);
    event.registrationMode = "NONE";

    await expect(submitRegistration(db, event, submissionInput(), NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });

  it("refuses registration when no privacy notice has been approved", async () => {
    await resetTables(db); // no approveLegalDocuments this time
    const event = await createInternalEvent(db);

    await expect(submitRegistration(db, event, submissionInput(), NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });

  it("refuses a honeypot-tripped submission out loud, and creates nothing (§217)", async () => {
    /*
      §194 answered the trap with the success page, so a script could not learn which check it
      tripped. The owner overruled it: "people need to know that they were identified as bots!
      it's very bad for a user to tell him he is waiting for an email but he never receives
      it!" A hidden field is filled by machines and, rarely, by a password manager that does
      not know it is hidden — and that person was being told to wait for an email nobody sent.

      What a script learns is still only "refused": this throws the *same* error with the same
      marker as a too-fast submission, so neither the caller nor a bot can tell them apart.
    */
    const event = await createInternalEvent(db);

    await expect(
      submitRegistration(db, event, submissionInput({ honeypot: "http://spam.example" }), NOW),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields?.includes("tooFast") === true,
    );

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(0);
  });

  it("gives the trap and the timing check the same answer, so neither can be told apart (§217)", async () => {
    // The whole of what the old silence bought, kept: a script gets one sentence for both and
    // still has to wait out the timer. What it no longer costs is a vanished participant.
    const event = await createInternalEvent(db);

    const codes: string[] = [];
    for (const bad of [
      submissionInput({ honeypot: "http://spam.example" }),
      { ...submissionInput(), renderedAt: new Date(NOW.getTime() - 500).toISOString() },
    ]) {
      await submitRegistration(db, event, bad, NOW).catch((error: unknown) => {
        if (isDomainError(error)) codes.push(`${error.code}:${(error.fields ?? []).join(",")}`);
      });
    }
    expect(codes).toHaveLength(2);
    expect(codes[0]).toBe(codes[1]);
  });

  it("tells the sixth submission in an hour why, instead of the check-your-email screen (§217)", async () => {
    /*
      The last silent drop, and it survived the fix that removed the other two — its own
      comment still justified the silence by pointing at the honeypot and the timing check,
      which §217 had already reversed.

      Five an hour is reachable by ordinary use: a re-test, a second person on one mailbox,
      somebody who cancelled and signed up again. The sixth used to get a registration that
      was never written, an email that was never queued, and a screen telling them to wait for
      it — with no log line to find them by afterwards.

      It leaks nothing: the bucket is keyed on the canonical identity of the address they just
      typed, so this tells them about themselves and not about who else is registered.
    */
    const event = await createInternalEvent(db);
    const { limit } = RATE_LIMITS["registration-submit"];

    for (let i = 0; i < limit; i += 1) {
      await submitRegistration(db, event, submissionInput({ email: "ana@example.ro" }), NOW);
    }
    const accepted = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(accepted).toHaveLength(1); // one row: the same person, not five (§199)

    const refused = await submitRegistration(db, event, submissionInput({ email: "ana@example.ro" }), NOW).catch(
      (error: unknown) => error,
    );
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    expect(isDomainError(refused) && refused.fields).toContain("throttled");

    // Somebody else's hour is their own.
    await expect(
      submitRegistration(db, event, submissionInput({ email: "ion@example.ro" }), NOW),
    ).resolves.toEqual({ ok: true });
  });

  it("answers a waitlisted person who fills the form again, instead of promising an email (§217)", async () => {
    /*
      `deriveAllowedResendMessageType` returns null for WAITLISTED and is right to — the
      backoffice's "send it again" hands over a link, and a queued person has none. But this
      is somebody typing their address a second time because they are not sure the first
      worked, and the answer to that is the message that says they are on the list.
    */
    const event = await createInternalEvent(db, { capacity: 1 });
    await submitRegistration(db, event, submissionInput({ email: "first@example.ro" }), NOW);
    const [taken] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, taken.id, NOW);

    const later = new Date(NOW.getTime() + 60_000);
    await submitRegistration(db, event, submissionInput({ email: "queued@example.ro" }), later);
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const queued = rows.find((row) => row.id !== taken.id)!;
    await confirmEmail(db, event, queued.id, later);
    const [waitlisted] = await db.select().from(registrations).where(eq(registrations.id, queued.id));
    expect(waitlisted.status).toBe("WAITLISTED");

    const before = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, queued.id));
    await submitRegistration(db, event, submissionInput({ email: "queued@example.ro" }), new Date(later.getTime() + 60_000));
    const after = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, queued.id));

    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)?.messageType).toBe("WAITLIST_JOINED");
  });

  it("refuses an emergency contact who is the participant (§228)", async () => {
    /*
      Amalia, testing: "și poți pune la persoana de contact numele tău și nr tău". You could,
      and the field was then worth nothing — its whole purpose is a number somebody can ring
      when the runner cannot answer their own.

      The number is the rule and the name is not: two people at one race genuinely share a
      name — a father and a son, two Ion Popescus — and refusing that would turn a real entry
      away. Nobody shares a telephone that answers in an emergency.
    */
    const event = await createInternalEvent(db);

    const refused = await submitRegistration(
      db,
      event,
      submissionInput({ phone: "+40711111111", emergencyContactPhone: "+40711111111" }),
      NOW,
    ).catch((error: unknown) => error);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    expect(isDomainError(refused) && refused.fields).toContain("emergencyContactPhone");
    expect(await db.select().from(registrations).where(eq(registrations.eventId, event.id))).toHaveLength(0);

    // The same name on both is allowed, because it is not evidence of anything.
    await expect(
      submitRegistration(
        db,
        event,
        submissionInput({ emergencyContactName: "Ana Pop", emergencyContactPhone: "+40722222222" }),
        NOW,
      ),
    ).resolves.toEqual({ ok: true });
  });
  it("asks a too-fast submission again instead of discarding it (§194)", async () => {
    /*
      This is the case that cost a real participant: he had autofill, the form went back under
      three seconds, and the old rule answered him with the confirmation page while creating
      nothing. A guess about a person is now a question, not a silent refusal — and the field
      marker is what puts a sentence on the form he can act on.
    */
    const event = await createInternalEvent(db);

    await expect(
      submitRegistration(
        db,
        event,
        submissionInput({ renderedAt: new Date(NOW.getTime() - 500).toISOString() }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["tooFast"] });

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(0);
  });
});
