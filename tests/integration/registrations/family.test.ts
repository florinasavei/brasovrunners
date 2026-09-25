import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — a family on one address, through the inbox (BR-REQ-032-03, BR-REQ-034-02, BR-REQ-036-02).
 *
 * The owner, 2026-09-25: "sometimes people register as a family… there must be a max number of
 * people with the same email… 'you are already registered, register for another person?'". The
 * public form, sent again with a registered address and another name, creates nothing and says
 * nothing different on screen (§39); the address receives one message with a single-use link to the
 * form for the other person, the address fixed; that submission creates the second registration
 * under the same participant, under the event's lock and the club's limit; and from there each
 * person confirms, signs and is erased alone.
 *
 * This file runs with the one-registration-per-address constraint dropped — the state the contract
 * release leaves the schema in (`family-gate.ts`). `family-gate.test.ts` holds today's schema.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration, confirmEmail, signDeclaration } = await import("@/modules/registrations/service");
const { consumeAndRegisterAnotherPerson, readAnotherPersonLink } = await import("@/modules/registrations/token-actions");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { updateAddressCap } = await import("@/modules/registrations/address-cap");
const { listActiveRegistrationsForParticipant } = await import("@/modules/registrations/my-registrations");
const { deleteRegistrationByStaff, correctRegisteredName } = await import("@/modules/registrations/admin-service");
const { requestRegistrationLink } = await import("@/modules/registrations/service");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // The contract release (§NNN): one address may now carry several runners at an event. Migration
  // 0073 already drops the constraint on a fresh database; `IF EXISTS` keeps this working the day
  // this file is run before 0073 lands, too.
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await approve();
});

async function approve() {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
    { locale: "en", title: "Declaration", body: declarationEn },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

async function createEvent(capacity: number | null = 20): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: "crosul-familiei" },
    { eventId: event.id, locale: "en", title: "The family cross", slug: "family-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (firstName: string, at: Date = NOW, overrides: Record<string, unknown> = {}) => ({
  firstName,
  lastName: "Pop",
  birthDate: "1985-03-02",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
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
  ...overrides,
});

/** The other person's own facts, as the family form posts them: no address, no telephone (a child). */
const anotherPerson = (firstName: string, at: Date = NOW, overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  const posted: Record<string, unknown> = { ...submission(firstName, at, overrides) };
  delete posted.email;
  delete posted.phone;
  return posted;
};

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

async function rowsOf(eventId: string) {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId)).orderBy(registrations.createdAt);
}

async function outbox(type?: string) {
  const rows = await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
  return type ? rows.filter((row) => row.messageType === type) : rows;
}

/** The link the latest "register another person" message carries, as the outbox renders it. */
async function linkFromLatestOffer(now: Date): Promise<{ html: string; text: string; secret: string | null; url: string | null }> {
  const offer = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
  const message = await renderOutboxMessage({ ...offer, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
  const match = /https?:\/\/[^\s"]+\?another=([A-Za-z0-9_-]+)/.exec(message.text);
  return { html: message.html, text: message.text, secret: match?.[1] ?? null, url: match?.[0] ?? null };
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

async function admin() {
  const [row] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  return row;
}

async function signFor(event: EventInput, registrationId: string, typedName: string, now: Date) {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", now);
  return signDeclaration(db, event, registrationId, { accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 }, now);
}

describe("§NNN (b) the form sent again with a registered address and another name", () => {
  it("creates nothing, and queues one email to the address with a single-use link to the form", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));

    const rows = await rowsOf(event.id);
    expect(rows.map((row) => row.registeredName)).toEqual(["Ana Pop"]);

    const offers = await outbox("REGISTER_ANOTHER_PERSON");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ recipientEmail: EMAIL, registrationId: rows[0].id, locale: "ro" });
    expect(offers[0].payloadJson).toEqual({ atCap: false, registrationsPerAddress: 4 });

    // The club's record: the state found and the message sent — never the name typed (§312, §12.12).
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.resubmitted"));
    expect(audit).toMatchObject({ entityId: rows[0].id, actorStaffUserId: null });
    expect(audit.metadataJson).toEqual({ status: "PENDING_EMAIL_CONFIRMATION", resent: "REGISTER_ANOTHER_PERSON" });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("Maria");
  });

  it("the email asks the question in both languages and carries the link to the form, the address fixed", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { text, secret, url } = await linkFromLatestOffer(at(6));

    expect(text).toContain("Ești deja înscris(ă) la Crosul familiei. Vrei să înscrii pe altcineva cu aceeași adresă?");
    expect(text).toContain("You are already registered for The family cross. Do you want to register someone else with the same address?");
    expect(text).toContain("Pe o adresă de email se pot înscrie cel mult 4 persoane la un eveniment.");
    expect(text).toContain("Linkul este valabil 48 de ore");
    expect(url).toContain("/ro/evenimente/crosul-familiei/inscriere?another=");
    expect(secret).not.toBeNull();

    // Hashed at rest (§12.8): the stored row is the SHA-256, never the secret; alive for the email-link window.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.tokenHash).not.toContain(secret!);
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.expiresAt.toISOString()).toBe(new Date(at(6).getTime() + 48 * 3_600_000).toISOString());
    expect(token.usedAt).toBeNull();
  });

  it("(a) the same runner again stays today's silent re-send: no email for another person", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("ANA", at(5), { lastName: "  pop " }), at(5));

    expect((await rowsOf(event.id)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);
    expect((await outbox()).map((row) => row.messageType)).toEqual(["VERIFY_REGISTRATION_EMAIL", "VERIFY_REGISTRATION_EMAIL"]);
  });
});

describe("§NNN the link creates the other person's registration, and everybody signs alone", () => {
  it("creates the second registration under the same participant, which then confirms and signs on its own", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));

    // Opening the page reads the link and changes nothing (GET never mutates, §12.8).
    expect(await readAnotherPersonLink(secret!, event.id, at(7))).toMatchObject({ ok: true, email: EMAIL });
    expect(await readAnotherPersonLink(secret!, "00000000-0000-4000-8000-000000000000", at(7))).toEqual({ ok: false });
    const [unspent] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(unspent.usedAt).toBeNull();

    expect(await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Maria", at(8)), {}, at(8))).toEqual({ ok: true, email: EMAIL });

    const [ana, maria] = await rowsOf(event.id);
    expect(maria).toMatchObject({ registeredName: "Maria Pop", participantId: ana.participantId, status: "PENDING_EMAIL_CONFIRMATION", phone: null, source: "PUBLIC", kind: "REAL", nameKey: "maria pop" });
    expect(await db.select().from(participants)).toHaveLength(1);
    // Her own confirmation link, as for anybody.
    expect((await outbox("VERIFY_REGISTRATION_EMAIL")).map((row) => row.registrationId)).toContain(maria.id);

    // Single use: the same link again is a link that does not work.
    expect(await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Ioana", at(9)), {}, at(9))).toEqual({ ok: false });
    expect(await rowsOf(event.id)).toHaveLength(2);

    // Each confirms and signs alone — her own name, her own signature, her own number and desk code.
    await confirmEmail(db, event, ana.id, at(10));
    await confirmEmail(db, event, maria.id, at(10));
    await signFor(event, ana.id, "Ana Pop", at(11));
    expect(await refusal(signFor(event, maria.id, "Ana Pop", at(11)))).toEqual({ code: "VALIDATION_ERROR", fields: ["typedName"] });
    await signFor(event, maria.id, "Maria Pop", at(12));

    const [anaDone, mariaDone] = await rowsOf(event.id);
    expect([anaDone.status, mariaDone.status]).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(anaDone.checkinCode).not.toBeNull();
    expect(mariaDone.checkinCode).not.toBeNull();
    expect(anaDone.checkinCode).not.toBe(mariaDone.checkinCode);
    expect(anaDone.provisionalBibNumber ?? anaDone.bibNumber).not.toBe(mariaDone.provisionalBibNumber ?? mariaDone.bibNumber);

    // "Înscrierile mele" lists both, each by name (§77).
    const mine = await listActiveRegistrationsForParticipant(db, ana.participantId, "ro", at(13));
    expect(mine.map((item) => item.registeredName).sort()).toEqual(["Ana Pop", "Maria Pop"]);

    // Maria's confirmation greets Maria, not the address's first name.
    const confirmation = (await outbox("REGISTRATION_CONFIRMED")).find((row) => row.registrationId === maria.id)!;
    const message = await renderOutboxMessage({ ...confirmation, status: "PROCESSING", attemptCount: 1, lockedAt: at(13) }, db, at(13));
    expect(message.text).toContain("Salut, Maria Pop,");
  });

  it("a refusal behind the link leaves the link working: the runner already on the address", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));

    expect(await refusal(consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Ana", at(7)), {}, at(7)))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["alreadyOnAddress"],
    });
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.usedAt).toBeNull();
    expect(await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Maria", at(8)), {}, at(8))).toMatchObject({ ok: true });
  });

  it("lapses with the club's email-link window", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));
    const lapsed = new Date(at(6).getTime() + 48 * 3_600_000 + 60_000);
    expect(await readAnotherPersonLink(secret!, event.id, lapsed)).toEqual({ ok: false });
    expect(await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Maria", lapsed), {}, lapsed)).toEqual({ ok: false });
    expect(await rowsOf(event.id)).toHaveLength(1);
  });

  it("the address fixed by the token wins over anything the form posts", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));
    await consumeAndRegisterAnotherPerson(secret!, event, { ...anotherPerson("Maria", at(7)), email: "somebody.else@example.ro" }, {}, at(7));
    expect(await db.select().from(participants)).toHaveLength(1);
    const rows = await rowsOf(event.id);
    expect(new Set(rows.map((row) => row.participantId)).size).toBe(1);
  });

  it("the address is throttled behind the link too, in its own bucket: a family of four spends neither hour", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    for (const [index, name] of ["Maria", "Ioana", "Elena"].entries()) {
      const minute = 5 + index * 3;
      await submitRegistration(db, event, submission(name, at(minute)), at(minute));
      const { secret } = await linkFromLatestOffer(at(minute + 1));
      expect(await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson(name, at(minute + 2)), {}, at(minute + 2))).toMatchObject({ ok: true });
    }
    expect(await rowsOf(event.id)).toHaveLength(4);

    // The form's five an hour saw four presses; the link's own bucket saw three (§19.4, keyed on the hashed identity).
    const buckets = await db.select().from(rateLimitBuckets);
    const counted = buckets.filter((row) => row.scope.startsWith("registration-")).map((row) => [row.scope, row.count]).sort();
    expect(counted).toEqual([
      ["registration-link-submit", 3],
      ["registration-submit", 4],
    ]);
  });
});

describe("§NNN the club's limit of registrations per address", () => {
  it("at the limit, the email says so and carries no link — and nothing is minted", async () => {
    await updateAddressCap(db, await admin(), { registrationsPerAddress: "2" }, NOW);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Ion", at(1)), at(1));
    const { secret } = await linkFromLatestOffer(at(2));
    await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Ion", at(3)), {}, at(3));
    expect(await rowsOf(event.id)).toHaveLength(2);

    await submitRegistration(db, event, submission("Maria", at(10)), at(10));
    const offer = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
    expect(offer.payloadJson).toEqual({ atCap: true, registrationsPerAddress: 2 });
    const tokensBefore = (await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"))).length;
    const { text, secret: none } = await linkFromLatestOffer(at(11));
    expect(none).toBeNull();
    expect(text).toContain("pe o adresă de email se pot înscrie cel mult 2 persoane la un eveniment, iar adresa ta le are deja");
    expect(text).toContain("one email address may register at most 2 people for an event");
    const tokensAfter = (await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"))).length;
    expect(tokensAfter).toBe(tokensBefore);
    expect(await rowsOf(event.id)).toHaveLength(2);
  });

  it("is enforced under the lock when the link is used: an older link at a full address is refused, and works again once a slot frees", async () => {
    await updateAddressCap(db, await admin(), { registrationsPerAddress: "2" }, NOW);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    // Two links out at once, for two different people.
    await submitRegistration(db, event, submission("Ion", at(1)), at(1));
    const first = await linkFromLatestOffer(at(2));
    await consumeAndRegisterAnotherPerson(first.secret!, event, anotherPerson("Ion", at(3)), {}, at(3));
    // A link minted while there was room (a second message rendered before the first was used).
    await submitRegistration(db, event, submission("Dan", at(4)), at(4));
    const offer = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
    // Rendered as if it had been decided with room: the renderer mints from the row's payload.
    await db.update(emailOutbox).set({ payloadJson: { atCap: false, registrationsPerAddress: 2 } }).where(eq(emailOutbox.id, offer.id));
    const second = await linkFromLatestOffer(at(5));
    expect(second.secret).not.toBeNull();

    expect(await refusal(consumeAndRegisterAnotherPerson(second.secret!, event, anotherPerson("Dan", at(6)), {}, at(6)))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["addressAtCap"],
    });
    expect(await rowsOf(event.id)).toHaveLength(2);

    // Ion cannot come after all: his slot on the address frees, and the same link now works.
    const [, ion] = await rowsOf(event.id);
    await db.update(registrations).set({ status: "EXPIRED", expiredAt: at(7), expiryReason: "EMAIL_CONFIRMATION_LAPSED" }).where(eq(registrations.id, ion.id));
    expect(await consumeAndRegisterAnotherPerson(second.secret!, event, anotherPerson("Dan", at(8)), {}, at(8))).toMatchObject({ ok: true });
    expect((await rowsOf(event.id)).map((row) => row.registeredName)).toEqual(["Ana Pop", "Ion Pop", "Dan Pop"]);
  });

  it("counts a test registration like a real one (§30): kind appears in no condition", async () => {
    await updateAddressCap(db, await admin(), { registrationsPerAddress: "1" }, NOW);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW, "TEST");
    await submitRegistration(db, event, submission("Maria", at(1)), at(1));
    expect((await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!.payloadJson).toEqual({ atCap: true, registrationsPerAddress: 1 });
  });
});

describe("§NNN each person is their own registration afterwards", () => {
  it("erasing one leaves the other exactly as it was", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));
    await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Maria", at(7)), {}, at(7));
    const [ana, maria] = await rowsOf(event.id);
    await confirmEmail(db, event, ana.id, at(8));
    await confirmEmail(db, event, maria.id, at(8));
    await signFor(event, maria.id, "Maria Pop", at(9));
    const before = (await rowsOf(event.id)).find((row) => row.id === maria.id)!;

    await deleteRegistrationByStaff(db, await admin(), ana.id, "cerere GDPR", at(10), { confirmName: "Ana Pop" });

    const after = await rowsOf(event.id);
    expect(after.map((row) => row.id)).toEqual([maria.id]);
    expect(after[0]).toEqual(before);
  });

  it("a staff correction of the name cannot make two people one", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));
    await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Maria", at(7)), {}, at(7));
    const [, maria] = await rowsOf(event.id);
    const staff = await admin();
    expect(await refusal(correctRegisteredName(db, staff, maria.id, "ANA POP", at(8)))).toEqual({ code: "VALIDATION_ERROR", fields: ["registeredName"] });
    const renamed = await correctRegisteredName(db, staff, maria.id, "Maria Ioana Pop", at(9));
    expect(renamed).toMatchObject({ registeredName: "Maria Ioana Pop", nameKey: "maria ioana pop" });
  });

  it("asking for the link again sends each person on the address their own", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { secret } = await linkFromLatestOffer(at(6));
    await consumeAndRegisterAnotherPerson(secret!, event, anotherPerson("Maria", at(7)), {}, at(7));
    const before = (await outbox("VERIFY_REGISTRATION_EMAIL")).length;
    await requestRegistrationLink(db, { email: EMAIL, eventId: event.id }, at(20));
    const resent = (await outbox("VERIFY_REGISTRATION_EMAIL")).slice(before);
    const [ana, maria] = await rowsOf(event.id);
    expect(resent.map((row) => row.registrationId).sort()).toEqual([ana.id, maria.id].sort());
  });

  it("the database refuses the same runner twice on one address, even past the service", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const [ana] = await rowsOf(event.id);
    await expect(
      db.insert(registrations).values({
        eventId: ana.eventId,
        participantId: ana.participantId,
        status: "PENDING_EMAIL_CONFIRMATION",
        locale: "ro",
        registeredName: "ana  pop",
        nameKey: "ana pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
      }),
    ).rejects.toThrow();
    expect(
      await db.select().from(registrations).where(and(eq(registrations.eventId, event.id), eq(registrations.participantId, ana.participantId))),
    ).toHaveLength(1);
  });
});
