import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The registration lifecycle's audited defects (§420), one regression per finding, each through the
 * service a participant or the desk actually reaches — the allocator, the job, the renderer:
 *
 * - a "register another person" email keeps its own link alive beside a newer one (§389);
 * - a desk entry that races a family member's public submission is refused, never confirms the
 *   other runner on the paper (BR-REQ-037-05, BR-REQ-037-07);
 * - no waiting-list offer is made once registration has closed (BR-REQ-035-02 criterion 3);
 * - a lapsed declaration hold gives its provisional number back, so the desk can re-allocate it
 *   after the settle (§160, §214, §220);
 * - the settle numbers only the places the capacity formula counts (AGENTS.md §10.5 invariant 3);
 * - an offer carries a provisional number, from the queue and from the desk (§214);
 * - the verification link dies with the registration's own link (BR-REQ-031-03 criterion 2, §377);
 * - the desk's counters leave test registrations out (§30, AGENTS.md §12.6);
 * - "Înscrierile mele" names the runner of a closed registration too (§389).
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const STARTS_AT = new Date("2026-10-10T07:00:00.000Z");
const CLOSES_AT = new Date("2026-10-09T07:00:00.000Z");
const at = (minutes: number, from: Date = NOW) => new Date(from.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

/*
  The desk's pre-check reads outside the event lock (`createRegistrationByStaff`). To put a public
  submission in the gap between it and the locked transaction — tens of milliseconds on Neon — the
  pre-check's one read is told to see nothing, once. Every other call passes through untouched.
*/
const gap = vi.hoisted(() => ({ hideAddressOnce: false }));
vi.mock("@/modules/registrations/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/registrations/repository")>();
  return {
    ...original,
    findRegistrationByEventAndParticipant: (async (...args: Parameters<typeof original.findRegistrationByEventAndParticipant>) => {
      if (gap.hideAddressOnce) {
        gap.hideAddressOnce = false;
        return undefined;
      }
      return original.findRegistrationByEventAndParticipant(...args);
    }) as typeof original.findRegistrationByEventAndParticipant,
  };
});
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration, confirmEmail, signDeclaration, unregister, confirmByStaff, promoteFromWaitlistByStaff } = await import(
  "@/modules/registrations/service"
);
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { consumeAndConfirmEmail } = await import("@/modules/registrations/token-actions");
const { confirmFamilyEntry } = await import("@/modules/registrations/family-confirm");
const { createRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { countDesk } = await import("@/modules/registrations/admin-repository");
const { countConfirmedAndCheckedInByEvent } = await import("@/modules/content/events/repository");
const { listClosedRegistrationsHoldingConsentData } = await import("@/modules/registrations/my-registrations");
const { updateAddressCap } = await import("@/modules/registrations/address-cap");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // The family flow is open (§389, §390): `IF EXISTS`, as the family tests do.
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  gap.hideAddressOnce = false;
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }
});

async function createEvent(options: { capacity?: number | null; closesAt?: Date | null } = {}): Promise<EventInput> {
  const capacity = options.capacity === undefined ? 10 : options.capacity;
  const closesAt = options.closesAt === undefined ? CLOSES_AT : options.closesAt;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS_AT,
      registrationMode: "INTERNAL",
      capacity,
      registrationClosesAt: closesAt,
      // No participation window (§104): every hold here is the club's thirty minutes.
      confirmationOpensDaysBefore: 0,
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    raceId: null,
    publishedAt: NOW,
    confirmationOpensDaysBefore: 0,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  };
}

/** Each member of a family a birth date of their own (§NNN): a different person differs in both. */
const BIRTH_DATES: Record<string, string> = { Maria: "1990-07-11", Ioana: "1993-08-08", Elena: "1992-04-04" };

const submission = (firstName: string, email: string, when: Date = NOW) => ({
  firstName,
  lastName: "Pop",
  birthDate: BIRTH_DATES[firstName] ?? "1985-03-02",
  sex: "UNSPECIFIED",
  nationality: "RO",
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

/** Submit on the public form and return the row as it stands. */
async function submit(event: EventInput, firstName: string, when: Date = NOW, kind: "REAL" | "TEST" = "REAL") {
  const email = `${firstName.toLowerCase()}@example.ro`;
  await submitRegistration(db, event, submission(firstName, email, when), when, kind);
  return rowOf(event, firstName);
}

async function rowOf(event: EventInput, firstName: string) {
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.registeredName, `${firstName} Pop`)));
  return row;
}

async function reread(id: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

/** Submitted, the address confirmed, the declaration signed: CONFIRMED. */
async function confirmed(event: EventInput, firstName: string, when: Date = NOW) {
  const row = await submit(event, firstName, when);
  await confirmEmail(db, event, row.id, at(1, when));
  await signDeclaration(db, event, row.id, await signingInput(db, at(2, when), `${firstName} Pop`), at(2, when));
  return reread(row.id);
}

/** Submitted and the address confirmed: a hold, or the waiting list when the event is full. */
async function allocated(event: EventInput, firstName: string, when: Date = NOW) {
  const row = await submit(event, firstName, when);
  await confirmEmail(db, event, row.id, at(1, when));
  return reread(row.id);
}

async function outbox(type: string) {
  return (await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt)).filter((row) => row.messageType === type);
}

async function admin() {
  const [row] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  return row;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
  throw new Error("expected a refusal");
}

/** Render one outbox row as the drain would, and return the secret its action link carries. */
async function secretOf(row: typeof emailOutbox.$inferSelect, when: Date): Promise<string> {
  const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /[/=]([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error(`no action link in the ${row.messageType} message`);
  return match[1];
}

describe("§420 §389 BR-REQ-036-02 every 'register another person' email keeps its own link", () => {
  const EMAIL = "ana@example.ro";
  // The press on the emailed confirmation (§NNN); an adult's acknowledges the fitness statement (§421).
  const confirm = (secret: string, when: Date) => confirmFamilyEntry(db, secret, { fitnessAcknowledged: true }, when);

  it("a parent who fills the form for each child, then opens the inbox, finds every link working", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", EMAIL), NOW);
    // The form once per child, before any email is opened.
    await submitRegistration(db, event, submission("Maria", EMAIL, at(1)), at(1));
    await submitRegistration(db, event, submission("Ioana", EMAIL, at(2)), at(2));
    const offers = await outbox("REGISTER_ANOTHER_PERSON");
    expect(offers).toHaveLength(2);
    const maria = await secretOf(offers[0], at(3));
    const ioana = await secretOf(offers[1], at(4));

    // The older link was not superseded by the newer one: each email's promise holds.
    const live = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(live.map((token) => token.invalidatedAt)).toEqual([null, null]);

    expect(await confirm(maria, at(5))).toMatchObject({ ok: true });
    expect(await confirm(ioana, at(6))).toMatchObject({ ok: true });
    const names = (await db.select().from(registrations).orderBy(registrations.createdAt)).map((row) => row.registeredName);
    expect(names).toEqual(["Ana Pop", "Maria Pop", "Ioana Pop"]);

    // Still single use.
    expect(await confirm(maria, at(7))).toEqual({ ok: false });
  });

  it("the address's limit is still counted under the lock when the second live link is used", async () => {
    await updateAddressCap(db, await admin(), { registrationsPerAddress: "2" }, NOW);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", EMAIL), NOW);
    await submitRegistration(db, event, submission("Maria", EMAIL, at(1)), at(1));
    await submitRegistration(db, event, submission("Ioana", EMAIL, at(2)), at(2));
    const [first, second] = await outbox("REGISTER_ANOTHER_PERSON");
    const maria = await secretOf(first, at(3));
    const ioana = await secretOf(second, at(4));

    expect(await confirm(maria, at(5))).toMatchObject({ ok: true });
    expect(await refusal(confirm(ioana, at(6)))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["addressAtCap"],
    });
    expect(await db.select().from(registrations)).toHaveLength(2);
  });
});

describe("§420 BR-REQ-037-05 BR-REQ-037-07 a desk entry racing a public submission on one address", () => {
  const EMAIL = "familia.pop@example.ro";

  it("is refused out loud, and never confirms the other runner on this person's paper", async () => {
    const staff = await admin();
    const event = await createEvent();
    // Ion registers himself on the public form in the gap between the desk's pre-check and its lock.
    await submitRegistration(db, event, submission("Ion", EMAIL), NOW);
    gap.hideAddressOnce = true;

    expect(
      await refusal(
        createRegistrationByStaff(
          db,
          staff,
          { eventId: event.id, firstName: "Maria", lastName: "Pop", email: EMAIL, locale: "ro", listOptOut: false, relayedByParticipantRequest: true, fastTrack: true },
          at(1),
        ),
      ),
    ).toEqual({ code: "VALIDATION_ERROR", fields: ["email"] });

    // Ion is exactly as he was: not confirmed, and nothing written in anybody's name.
    const rows = await db.select().from(registrations);
    expect(rows.map((row) => [row.registeredName, row.status])).toEqual([["Ion Pop", "PENDING_EMAIL_CONFIRMATION"]]);
    const audits = (await db.select().from(auditLogs)).map((row) => row.action);
    expect(audits).not.toContain("registration.created_by_staff");
    expect(audits).not.toContain("registration.confirmed_by_staff");
    expect(audits).not.toContain("registration.resubmitted");
    expect((await db.select().from(emailOutbox)).map((row) => row.messageType)).toEqual(["VERIFY_REGISTRATION_EMAIL"]);
  });

  it("a staff entry is told which row it wrote; a public answer never carries one", async () => {
    const staff = await admin();
    const event = await createEvent();
    const publicAnswer = await submitRegistration(db, event, submission("Ana", "ana@example.ro"), NOW);
    expect(publicAnswer).toStrictEqual({ ok: true });

    const staffAnswer = await submitRegistration(db, event, submission("Dan", "dan@example.ro"), at(1), "REAL", {
      source: "STAFF",
      createdByStaffUserId: staff.id,
      atTheDesk: true,
    });
    expect(staffAnswer.registrationId).toBe((await rowOf(event, "Dan")).id);

    // And the fast track confirms that row — the walk-in, on their own paper.
    await createRegistrationByStaff(
      db,
      staff,
      { eventId: event.id, firstName: "Eva", lastName: "Pop", email: "eva@example.ro", locale: "ro", listOptOut: false, relayedByParticipantRequest: true, fastTrack: true },
      at(2),
    );
    expect((await rowOf(event, "Eva")).status).toBe("CONFIRMED");
  });
});

describe("§420 BR-REQ-035-02 criterion 3 no waiting-list offer once registration has closed", () => {
  it("a place freed after the close is offered to nobody, and the job does not work down the list", async () => {
    const event = await createEvent({ capacity: 1 });
    const ana = await confirmed(event, "Ana");
    for (const [index, name] of ["Bogdan", "Cristi", "Dana"].entries()) {
      expect((await allocated(event, name, at(10 + index * 5))).status).toBe("WAITLISTED");
    }

    await unregister(db, event, ana.id, "PARTICIPANT", at(60, CLOSES_AT));
    for (const minutes of [75, 90, 105, 120]) await runRegistrationMaintenance(db, at(minutes, CLOSES_AT));

    for (const name of ["Bogdan", "Cristi", "Dana"]) expect((await rowOf(event, name)).status).toBe("WAITLISTED");
    expect(await outbox("WAITLIST_SPOT_OFFER")).toHaveLength(0);
  });

  it("an offer made before the close lapses at the close, and is not handed on to the next person", async () => {
    const event = await createEvent({ capacity: 1 });
    const ana = await confirmed(event, "Ana");
    await allocated(event, "Bogdan", at(10));
    await allocated(event, "Cristi", at(15));

    await unregister(db, event, ana.id, "PARTICIPANT", at(-120, CLOSES_AT));
    const offered = await rowOf(event, "Bogdan");
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.holdExpiresAt).toEqual(CLOSES_AT);

    await runRegistrationMaintenance(db, at(15, CLOSES_AT));
    expect((await rowOf(event, "Bogdan")).status).toBe("EXPIRED");
    expect((await rowOf(event, "Cristi")).status).toBe("WAITLISTED");
    expect(await outbox("WAITLIST_SPOT_OFFER")).toHaveLength(1);
  });
});

describe("§420 §160 §214 §220 a lapsed declaration hold gives its provisional number back", () => {
  it("so the desk can re-allocate it after the settle, with a free number, instead of a duplicate-key error", async () => {
    const staff = await admin();
    const event = await createEvent({ capacity: 2 });
    const ana = await allocated(event, "Ana");
    const bogdan = await allocated(event, "Bogdan", at(2));
    expect([ana.provisionalBibNumber, bogdan.provisionalBibNumber]).toEqual([1, 2]);
    expect((await allocated(event, "Cristi", at(4))).status).toBe("WAITLISTED");

    // Two hours on: somebody waits, so the oldest lapsed hold goes to the queue (§160).
    await runRegistrationMaintenance(db, at(120));
    const lapsed = await reread(ana.id);
    expect([lapsed.status, lapsed.expiryReason, lapsed.provisionalBibNumber]).toEqual(["EXPIRED", "DECLARATION_HOLD_LAPSED", null]);

    const cristi = await rowOf(event, "Cristi");
    await signDeclaration(db, event, cristi.id, await signingInput(db, at(125), "Cristi Pop"), at(125));
    await signDeclaration(db, event, bogdan.id, await signingInput(db, at(130), "Bogdan Pop"), at(130));
    await runRegistrationMaintenance(db, at(60, CLOSES_AT));
    await unregister(db, event, cristi.id, "ADMIN", at(90, CLOSES_AT));

    // Race morning: Ana at the desk with her paper.
    const raceMorning = at(-60, STARTS_AT);
    const done = await confirmByStaff(db, event, ana.id, staff, raceMorning);
    expect(done.status).toBe("CONFIRMED");
    const finals = (await db.select().from(registrations).where(eq(registrations.eventId, event.id)))
      .map((row) => row.bibNumber)
      .filter((number): number is number => number !== null);
    expect(new Set(finals).size).toBe(finals.length);
    expect(done.bibNumber).not.toBeNull();
  });
});

describe("§420 §160 once registration has closed, a lapsed declaration hold still goes to the queue — for the desk to give", () => {
  it("released while somebody waits, offered to nobody by email, and the desk promotes into the place (BR-REQ-035-02 criterion 3)", async () => {
    const staff = await admin();
    const event = await createEvent({ capacity: 1 });
    const ana = await allocated(event, "Ana");
    // Nobody has this capacity's one place until Ana's hold is resolved, so Bogdan queues.
    const bogdan = await allocated(event, "Bogdan", at(5));
    expect(bogdan.status).toBe("WAITLISTED");

    // Registration is closed, and Ana's thirty-minute hold is long past its own deadline. Somebody
    // waits, so the hold is released as §160 says (its number with it, §220) — only the offer is
    // withheld, by `fillAvailableSpots`, because it would be born lapsed.
    await runRegistrationMaintenance(db, at(60, CLOSES_AT));
    const released = await reread(ana.id);
    expect([released.status, released.expiryReason, released.provisionalBibNumber]).toEqual(["EXPIRED", "DECLARATION_HOLD_LAPSED", null]);
    expect((await reread(bogdan.id)).status).toBe("WAITLISTED");
    expect(await outbox("WAITLIST_SPOT_OFFER")).toHaveLength(0);

    // Race week at the desk: the place is free, so Bogdan is given it. Were the hold kept after the
    // close, this would be "the event is full" for a place nobody is holding.
    const promoted = await promoteFromWaitlistByStaff(db, event, bogdan.id, staff, at(90, CLOSES_AT));
    expect(promoted.status).toBe("CONFIRMED");
    expect(promoted.bibNumber).not.toBeNull();
  });
});

describe("§420 AGENTS.md §10.5 invariant 3 the settle numbers only the places the capacity formula counts", () => {
  it("an unconfirmed address gets no final number and no BIB_ASSIGNED, and joins the waiting list without one", async () => {
    const event = await createEvent({ capacity: 1 });
    const ana = await confirmed(event, "Ana");
    const beforeClose = at(-60, CLOSES_AT);
    const bogdan = await submit(event, "Bogdan", beforeClose);
    expect(bogdan.provisionalBibNumber).toBe(2);

    await runRegistrationMaintenance(db, at(15, CLOSES_AT));
    const settledAna = await reread(ana.id);
    const unsettled = await reread(bogdan.id);
    expect(settledAna.bibNumber).toBe(1);
    expect([unsettled.status, unsettled.bibNumber, unsettled.provisionalBibNumber]).toEqual(["PENDING_EMAIL_CONFIRMATION", null, null]);
    expect((await outbox("BIB_ASSIGNED")).map((row) => row.registrationId)).toEqual([ana.id]);

    await confirmEmail(db, event, bogdan.id, at(30, CLOSES_AT));
    const waiting = await reread(bogdan.id);
    expect([waiting.status, waiting.bibNumber, waiting.provisionalBibNumber]).toEqual(["WAITLISTED", null, null]);
  });
});

describe("§420 §214 an offered place carries a provisional number", () => {
  it("from the waiting list: offered with a number, and signed keeping it", async () => {
    const event = await createEvent({ capacity: 1 });
    const ana = await allocated(event, "Ana");
    await allocated(event, "Bogdan", at(5));
    await unregister(db, event, ana.id, "PARTICIPANT", at(10));

    const offered = await rowOf(event, "Bogdan");
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.provisionalBibNumber).toBe(1);

    await signDeclaration(db, event, offered.id, await signingInput(db, at(20), "Bogdan Pop"), at(20));
    const signed = await reread(offered.id);
    expect([signed.status, signed.bibNumber, signed.provisionalBibNumber]).toEqual(["CONFIRMED", null, 1]);
  });

  it("from the desk's promotion: before the close it keeps a provisional number, after it that number is its final one", async () => {
    const staff = await admin();
    const event = await createEvent({ capacity: 1 });
    await confirmed(event, "Ana");
    const bogdan = await allocated(event, "Bogdan", at(5));
    const cristi = await allocated(event, "Cristi", at(10));
    // One more place, raised by hand (no editor, so nobody is offered it), for the desk to promote into.
    await db.update(events).set({ capacity: 2 }).where(eq(events.id, event.id));

    const early = await promoteFromWaitlistByStaff(db, event, bogdan.id, staff, at(20));
    expect([early.status, early.bibNumber, early.provisionalBibNumber]).toEqual(["CONFIRMED", null, 2]);

    await runRegistrationMaintenance(db, at(15, CLOSES_AT));
    // And one more on race week, after the numbers were settled.
    await db.update(events).set({ capacity: 3 }).where(eq(events.id, event.id));
    const late = await promoteFromWaitlistByStaff(db, event, cristi.id, staff, at(30, CLOSES_AT));
    expect(late.status).toBe("CONFIRMED");
    expect(late.provisionalBibNumber).toBeNull();
    // Numbered without a gap: 1 and 2 were settled, and the drawn number is adopted, not skipped.
    expect(late.bibNumber).toBe(3);
  });
});

describe("§420 BR-REQ-031-03 criterion 2 the confirmation link lapses with the registration's own link", () => {
  it("the verification token dies when the row's link does, so a click after the job is refused, not 'confirmed'", async () => {
    const event = await createEvent();
    const row = await submit(event, "Ana");
    const [verify] = await outbox("VERIFY_REGISTRATION_EMAIL");
    const secret = await secretOf(verify, NOW);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "VERIFY_REGISTRATION_EMAIL"));
    expect(token.expiresAt).toEqual(row.emailLinkExpiresAt);

    const later = at(50 * 60);
    await runRegistrationMaintenance(db, later);
    expect((await reread(row.id)).status).toBe("EXPIRED");
    expect(await consumeAndConfirmEmail(secret, later)).toMatchObject({ ok: false, reason: "EXPIRED" });
  });

  it("a click after the lapse and before the sweep lapses the row rather than allocating it", async () => {
    const event = await createEvent();
    const row = await submit(event, "Ana");

    const after = await confirmEmail(db, event, row.id, at(49 * 60));
    expect([after.status, after.expiryReason, after.provisionalBibNumber]).toEqual(["EXPIRED", "EMAIL_CONFIRMATION_LAPSED", null]);
    const [participant] = await db.select().from(participants).where(eq(participants.id, row.participantId));
    expect(participant.emailVerifiedAt).toBeNull();
    expect(await outbox("COMPLETE_DECLARATION")).toHaveLength(0);
  });
});

describe("§420 §30 AGENTS.md §12.6 the desk's counters leave test registrations out", () => {
  it("a test row on hold or confirmed adds nothing to the desk's or the events list's numbers", async () => {
    const event = await createEvent();
    await allocated(event, "Ana");
    const test = await submit(event, "Test", NOW, "TEST");
    expect(await countDesk(db, event.id)).toEqual({ confirmed: 0, checkedIn: 0, withoutBib: 0, pending: 1 });

    await db.update(registrations).set({ status: "CONFIRMED", checkedInAt: at(5) }).where(eq(registrations.id, test.id));
    expect(await countDesk(db, event.id)).toEqual({ confirmed: 0, checkedIn: 0, withoutBib: 0, pending: 1 });
    expect((await countConfirmedAndCheckedInByEvent(db)).get(event.id) ?? { confirmed: 0, checkedIn: 0 }).toEqual({ confirmed: 0, checkedIn: 0 });
  });
});

describe("§420 §389 'Înscrierile mele' names the runner of a closed registration", () => {
  it("each closed card with data to withdraw says whose it is", async () => {
    const event = await createEvent();
    const ana = await allocated(event, "Ana");
    await db.update(registrations).set({ stravaUrl: "https://www.strava.com/athletes/1" }).where(eq(registrations.id, ana.id));
    await unregister(db, event, ana.id, "PARTICIPANT", at(10));

    const closed = await listClosedRegistrationsHoldingConsentData(db, ana.participantId, "ro");
    expect(closed.map((row) => [row.registeredName, row.status])).toEqual([["Ana Pop", "CANCELLED"]]);
  });
});
