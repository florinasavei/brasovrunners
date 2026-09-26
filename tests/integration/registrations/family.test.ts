import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { pendingFamilyEntries } from "@/db/schema/family-entries";
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
 * §389, amended by §NNN — a family on one address, confirmed from the inbox (BR-REQ-032-03,
 * BR-REQ-034-02, BR-REQ-036-02, BR-REQ-031-01 criterion 3).
 *
 * The owner, 2026-09-26: "înscrierea altei persoane trebuie să fie mai simplă: în mail să îți
 * afișez înscrierile și să zic «confirm că înscriu altă persoană», dar trebuie să verific că numele
 * e diferit (ignorând whitespace) și data nașterii e complet diferită". The public form, sent again
 * from a registered address for a *different person* (another name and another birth date than
 * everybody registered on it), registers nobody and says nothing different on screen (§39); the
 * posted form is kept; the address receives one message listing who it holds and naming the person,
 * with one button; the press registers that person under the same participant — the address
 * confirmed by the press, straight to a place and its declaration or to the waiting list — under
 * the event's lock and the club's limit. Only one of the two matching is a slip: the existing
 * registration is re-sent, with a sentence on how to register somebody else.
 *
 * This file runs with the one-registration-per-address constraint dropped — the state the contract
 * release leaves the schema in (`family-gate.ts`). `family-gate.test.ts` holds the older schema.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration, confirmEmail, signDeclaration, requestRegistrationLink } = await import("@/modules/registrations/service");
const { confirmFamilyEntry, readFamilyEntryLink } = await import("@/modules/registrations/family-confirm");
const { purgeLapsedFamilyEntries } = await import("@/modules/registrations/family-entries");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { updateAddressCap } = await import("@/modules/registrations/address-cap");
const { listActiveRegistrationsForParticipant } = await import("@/modules/registrations/my-registrations");
const { deleteRegistrationByStaff, correctRegisteredName } = await import("@/modules/registrations/admin-service");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // The contract release (§390): one address may carry several runners at an event. Migration
  // 0073 already drops the constraint on a fresh database; `IF EXISTS` keeps this harmless.
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
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
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

/** Each runner's own birth date: every person of the family is a different person by both facts. */
const BIRTH_DATES: Record<string, string> = {
  Ana: "1985-03-02",
  Maria: "1990-07-11",
  Ion: "1987-02-14",
  Dan: "1988-05-20",
  Eva: "1991-11-30",
  Elena: "1992-04-04",
  Ioana: "1993-08-08",
};

/** The public form as a person posts it. */
const submission = (firstName: string, at: Date = NOW, overrides: Record<string, unknown> = {}) => ({
  firstName,
  lastName: "Pop",
  birthDate: BIRTH_DATES[firstName] ?? "1980-01-01",
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
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(at.getTime() - 30_000).toISOString(),
  ...overrides,
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const HOURS_48 = 48 * 3_600_000;

async function rowsOf(eventId: string) {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId)).orderBy(registrations.createdAt);
}

async function outbox(type?: string) {
  const rows = await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
  return type ? rows.filter((row) => row.messageType === type) : rows;
}

async function entries() {
  return db.select().from(pendingFamilyEntries).orderBy(pendingFamilyEntries.createdAt);
}

async function render(row: Awaited<ReturnType<typeof outbox>>[number], now: Date) {
  return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
}

/** The confirmation link the latest "one more person?" message carries, as the outbox renders it. */
async function linkFromLatestOffer(now: Date): Promise<{ subject: string; text: string; secret: string | null; url: string | null }> {
  const offer = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
  const message = await render(offer, now);
  const match = /https?:\/\/[^\s"]+\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text);
  return { subject: message.subject, text: message.text, secret: match?.[1] ?? null, url: match?.[0] ?? null };
}

/** The form for a different person, then the link its email carries. */
async function offer(event: EventInput, firstName: string, minute: number, overrides: Record<string, unknown> = {}): Promise<string> {
  await submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute));
  const { secret } = await linkFromLatestOffer(at(minute + 1));
  if (!secret) throw new Error("the email carried no confirmation");
  return secret;
}

const press = (secret: string, now: Date, fitnessAcknowledged = true) => confirmFamilyEntry(db, secret, { fitnessAcknowledged }, now);

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

describe("§NNN the form sent again from a registered address for a different person", () => {
  it("registers nobody, keeps the posted form without the address, and queues one email naming the kept form", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));

    const rows = await rowsOf(event.id);
    expect(rows.map((row) => row.registeredName)).toEqual(["Ana Pop"]);

    const [entry] = await entries();
    expect(entry).toMatchObject({ eventId: event.id, participantId: rows[0].participantId, registrationId: rows[0].id, locale: "ro", actionTokenId: null });
    expect(entry.expiresAt.toISOString()).toBe(new Date(at(5).getTime() + HOURS_48).toISOString());
    expect(entry.fields).toMatchObject({ firstName: "Maria", lastName: "Pop", birthDate: "1990-07-11", termsAccepted: true });
    for (const name of ["email", "emailConfirm", "honeypot", "renderedAt"]) expect(entry.fields).not.toHaveProperty(name);

    const offers = await outbox("REGISTER_ANOTHER_PERSON");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ recipientEmail: EMAIL, registrationId: rows[0].id, locale: "ro" });
    // The kept form by its id alone: no name and no date in the outbox (§12.12).
    expect(offers[0].payloadJson).toEqual({ atCap: false, registrationsPerAddress: 4, familyEntryId: entry.id });

    // The club's record: the state found and the message sent — never the name typed (§312, §12.12).
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.resubmitted"));
    expect(audit).toMatchObject({ entityId: rows[0].id, actorStaffUserId: null });
    expect(audit.metadataJson).toEqual({ status: "PENDING_EMAIL_CONFIRMATION", resent: "REGISTER_ANOTHER_PERSON" });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("Maria");
  });

  it("the email lists the address's own registrations, names the person and carries one confirmation, in both languages", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    // Somebody else's address at the same event: never named to this one.
    await submitRegistration(db, event, submission("Vecina", at(1), { lastName: "Străină", email: "vecina@example.ro" }), at(1));
    await submitRegistration(db, event, submission("Maria", at(5)), at(5));
    const { subject, text, secret, url } = await linkFromLatestOffer(at(6));

    expect(subject).toContain("Înscrii încă o persoană la Crosul familiei?");
    expect(subject).toContain("Registering one more person for The family cross?");
    expect(text).toContain("Înscriși deja cu această adresă: Ana P.");
    expect(text).toContain("Persoana din formular: Maria Pop, data nașterii 11.07.1990.");
    expect(text).toContain("Already registered with this address: Ana P.");
    expect(text).toContain("The person in the form: Maria Pop, born on 11.07.1990.");
    expect(text).not.toContain("Vecina");
    expect(text).toContain("Confirm că înscriu altă persoană");
    expect(text).toContain("Pe o adresă de email se pot înscrie cel mult 4 persoane la un eveniment.");
    expect(text).toContain("Linkul este valabil 48 de ore");
    expect(url).toContain("/ro/inregistrari/familie/");
    expect(secret).not.toBeNull();

    // Hashed at rest (§12.8), alive exactly as long as the kept form, and tied to it.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.tokenHash).not.toContain(secret!);
    const [entry] = await entries();
    expect(token.expiresAt.toISOString()).toBe(entry.expiresAt.toISOString());
    expect(entry.actionTokenId).toBe(token.id);
    expect(token.usedAt).toBeNull();
  });

  it("(a) the same person again — the name and the birth date — stays the silent re-send: nothing kept, nothing offered", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("ANA", at(5), { lastName: "  pop ", birthDate: BIRTH_DATES.Ana }), at(5));

    expect((await rowsOf(event.id)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);
    expect(await entries()).toHaveLength(0);
    const sent = await outbox();
    expect(sent.map((row) => row.messageType)).toEqual(["VERIFY_REGISTRATION_EMAIL", "VERIFY_REGISTRATION_EMAIL"]);
    expect(sent[1].payloadJson).toEqual({});
  });

  it("the same name with another birth date is a slip: nothing registered, the re-send says how to register somebody else", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Ana", at(5), { birthDate: "2012-01-01", guardianName: "Ion Pop" }), at(5));

    expect((await rowsOf(event.id)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);
    expect(await entries()).toHaveLength(0);
    expect(await outbox("REGISTER_ANOTHER_PERSON")).toHaveLength(0);
    const resent = (await outbox("VERIFY_REGISTRATION_EMAIL")).at(-1)!;
    expect(resent.payloadJson).toEqual({ anotherPersonHint: true });
    const message = await render(resent, at(6));
    expect(message.text).toContain("Dacă vrei să înscrii pe altcineva, trimite formularul cu numele complet și data de naștere a acelei persoane.");
    expect(message.text).toContain("If you want to register someone else, send the form with that person's full name and birth date.");
  });

  it("another name with a registered person's birth date is a slip too, whatever state that registration is in", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const [ana] = await rowsOf(event.id);
    await confirmEmail(db, event, ana.id, at(1));
    await submitRegistration(db, event, submission("Maria", at(5), { birthDate: BIRTH_DATES.Ana }), at(5));

    expect(await rowsOf(event.id)).toHaveLength(1);
    expect(await entries()).toHaveLength(0);
    const resent = (await outbox("COMPLETE_DECLARATION")).at(-1)!;
    expect(resent.payloadJson).toEqual({ alreadyRegistered: true, anotherPersonHint: true });
    const message = await render(resent, at(6));
    expect(message.text).toContain("Dacă vrei să înscrii pe altcineva");
  });
});

describe("§NNN the confirmation registers the person, and everybody signs alone", () => {
  it("opening the page reads the link and changes nothing (GET never mutates, §12.8)", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const secret = await offer(event, "Maria", 5);

    expect(await readFamilyEntryLink(db, secret, "ro", at(7))).toEqual({
      ok: true,
      email: EMAIL,
      eventTitle: "Crosul familiei",
      registered: ["Ana P."],
      personName: "Maria Pop",
      personBirthDate: "11.07.1990",
      adult: true,
      registrationsPerAddress: 4,
    });
    expect(await readFamilyEntryLink(db, "not-a-real-secret-at-all-0123456789abcdefghij", "ro", at(7))).toEqual({ ok: false });
    const [unspent] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(unspent.usedAt).toBeNull();
    expect(await rowsOf(event.id)).toHaveLength(1);
    expect(await entries()).toHaveLength(1);
  });

  it("the press registers the person under the same address, straight to a place and the declaration, and the kept form goes", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const secret = await offer(event, "Maria", 5);

    const result = await press(secret, at(8));
    expect(result).toMatchObject({ ok: true, email: EMAIL });

    const [ana, maria] = await rowsOf(event.id);
    expect(maria).toMatchObject({ registeredName: "Maria Pop", participantId: ana.participantId, status: "PENDING_DECLARATION", source: "PUBLIC", kind: "REAL", nameKey: "maria pop", birthDate: "1990-07-11" });
    expect(maria.holdExpiresAt).not.toBeNull();
    // The press proved the inbox: the address is confirmed, and no second confirmation link is sent.
    const [participant] = await db.select().from(participants);
    expect(participant.emailVerifiedAt).not.toBeNull();
    expect((await outbox("VERIFY_REGISTRATION_EMAIL")).map((row) => row.registrationId)).not.toContain(maria.id);
    expect((await outbox("COMPLETE_DECLARATION")).map((row) => row.registrationId)).toEqual([maria.id]);
    // Ana's own registration waits for her own link, as before.
    expect(ana.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(await entries()).toHaveLength(0);

    // Single use: the same link again is a link that does not work.
    expect(await press(secret, at(9))).toEqual({ ok: false });
    expect(await rowsOf(event.id)).toHaveLength(2);

    // Each confirms and signs alone — her own name, her own signature, her own number and desk code.
    await confirmEmail(db, event, ana.id, at(10));
    await signFor(event, ana.id, "Ana Pop", at(11));
    expect(await refusal(signFor(event, maria.id, "Ana Pop", at(11)))).toEqual({ code: "VALIDATION_ERROR", fields: ["typedName"] });
    await signFor(event, maria.id, "Maria Pop", at(12));
    const [anaDone, mariaDone] = await rowsOf(event.id);
    expect([anaDone.status, mariaDone.status]).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(anaDone.checkinCode).not.toBe(mariaDone.checkinCode);
    expect(anaDone.provisionalBibNumber ?? anaDone.bibNumber).not.toBe(mariaDone.provisionalBibNumber ?? mariaDone.bibNumber);

    // "Înscrierile mele" lists both, each by name (§77).
    const mine = await listActiveRegistrationsForParticipant(db, ana.participantId, "ro", at(13));
    expect(mine.map((item) => item.registeredName).sort()).toEqual(["Ana Pop", "Maria Pop"]);

    // Maria's messages greet Maria, not the address's first name.
    const confirmation = (await outbox("REGISTRATION_CONFIRMED")).find((row) => row.registrationId === maria.id)!;
    expect((await render(confirmation, at(13))).text).toContain("Salut, Maria Pop,");
  });

  it("with no place left, the press puts the person on the waiting list, with its own message", async () => {
    const event = await createEvent(1);
    await submitRegistration(db, event, submission("Ana"), NOW);
    // Ana confirms her address and takes the one place.
    await confirmEmail(db, event, (await rowsOf(event.id))[0].id, at(1));
    const secret = await offer(event, "Maria", 5);
    const result = await press(secret, at(8));
    expect(result.ok && result.registration.status).toBe("WAITLISTED");
    const maria = (await rowsOf(event.id)).find((row) => row.registeredName === "Maria Pop")!;
    expect((await outbox("WAITLIST_JOINED")).map((row) => row.registrationId)).toEqual([maria.id]);
  });

  it("asks the address holder's acknowledgement for an adult, and a refusal leaves the link working", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const secret = await offer(event, "Maria", 5);
    expect(await refusal(press(secret, at(7), false))).toEqual({ code: "VALIDATION_ERROR", fields: ["fitnessAcknowledged"] });
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.usedAt).toBeNull();
    expect(await rowsOf(event.id)).toHaveLength(1);
    expect(await entries()).toHaveLength(1);
    expect(await press(secret, at(8))).toMatchObject({ ok: true });
  });

  it("refuses a person the address holds by then — the same person sent twice — out loud, the second link unspent", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const first = await offer(event, "Maria", 5);
    const second = await offer(event, "Maria", 7);
    // Both links live beside each other (§420): neither supersedes the other.
    expect(await press(first, at(9))).toMatchObject({ ok: true });
    expect(await refusal(press(second, at(10)))).toEqual({ code: "VALIDATION_ERROR", fields: ["alreadyOnAddress"] });
    const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(tokens.filter((token) => token.usedAt === null)).toHaveLength(1);
    expect((await rowsOf(event.id)).map((row) => row.registeredName)).toEqual(["Ana Pop", "Maria Pop"]);
  });

  it("lapses with the club's email-link window, and the maintenance job deletes the kept form with its data", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const secret = await offer(event, "Maria", 5);
    const lapsed = new Date(at(5).getTime() + HOURS_48 + 60_000);
    expect(await readFamilyEntryLink(db, secret, "ro", lapsed)).toEqual({ ok: false });
    expect(await press(secret, lapsed)).toEqual({ ok: false });
    expect(await rowsOf(event.id)).toHaveLength(1);

    // Not before its time…
    expect(await purgeLapsedFamilyEntries(db, at(60))).toBe(0);
    expect(await entries()).toHaveLength(1);
    // …and by the job once it has passed.
    const run = await runRegistrationMaintenance(db, lapsed);
    expect(run.familyEntriesPurged).toBe(1);
    expect(await entries()).toHaveLength(0);
  });

  it("the address fixed by the token wins over anything kept or posted", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const secret = await offer(event, "Maria", 5);
    // A kept form that somehow carried another address still registers on the token's.
    await db.update(pendingFamilyEntries).set({ fields: sql`${pendingFamilyEntries.fields} || '{"email":"somebody.else@example.ro"}'::jsonb` });
    await press(secret, at(7));
    expect(await db.select().from(participants)).toHaveLength(1);
    expect(new Set((await rowsOf(event.id)).map((row) => row.participantId)).size).toBe(1);
  });

  it("the address is throttled behind the confirmation too, in its own bucket: a family of four spends neither hour", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    for (const [index, name] of ["Maria", "Ioana", "Elena"].entries()) {
      const minute = 5 + index * 3;
      const secret = await offer(event, name, minute);
      expect(await press(secret, at(minute + 2))).toMatchObject({ ok: true });
    }
    expect(await rowsOf(event.id)).toHaveLength(4);
    const buckets = await db.select().from(rateLimitBuckets);
    const counted = buckets.filter((row) => row.scope.startsWith("registration-")).map((row) => [row.scope, row.count]).sort();
    expect(counted).toEqual([
      ["registration-link-submit", 3],
      ["registration-submit", 4],
    ]);
  });
});

/**
 * §421 — the kept form carries no consent that only the other adult can give (GDPR art. 4(11), 7(1),
 * 9(2)(a)): the ordinary form asked them, and for another adult they are dropped before anything is
 * kept; the address holder's acknowledgement stands in for the statement, on the confirmation page.
 * A minor's parent still consents for the child.
 */
describe("§421 the kept form and another adult's own consents", () => {
  const everything = { healthNotes: "astm", healthConsent: true, stravaUrl: "https://www.strava.com/athletes/12345", instagramHandle: "maria.pop", listOptOut: false, fitnessDeclared: true };

  it("keeps and stores none of them for an adult, whatever was posted, and records no fitness statement", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await submitRegistration(db, event, submission("Maria", at(5), everything), at(5));
    const [entry] = await entries();
    expect(JSON.stringify(entry.fields)).not.toContain("astm");
    expect(JSON.stringify(entry.fields)).not.toContain("strava");
    const { secret } = await linkFromLatestOffer(at(6));
    expect(await press(secret!, at(7))).toMatchObject({ ok: true });

    const maria = (await rowsOf(event.id)).find((row) => row.registeredName === "Maria Pop")!;
    expect(maria).toMatchObject({ healthNotes: null, healthConsentAt: null, stravaUrl: null, instagramHandle: null, listOptOut: true, fitnessDeclaredAt: null });
    // The terms and the event's rules were accepted on the form (§421).
    expect(maria.termsVersion).toBe(1);
    expect(maria.rulesAcknowledgedAt).not.toBeNull();
  });

  it("keeps a minor's, which the parent gives, with the parent's fitness statement — and asks no acknowledgement", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    const child = { birthDate: "2011-05-10", guardianName: "Ana Pop" };
    const secret = await offer(event, "Ioana", 5, { ...everything, ...child });
    expect((await readFamilyEntryLink(db, secret, "ro", at(6))) as { adult?: boolean }).toMatchObject({ adult: false });
    expect(await press(secret, at(8), false)).toMatchObject({ ok: true });

    const ioana = (await rowsOf(event.id)).find((row) => row.registeredName === "Ioana Pop")!;
    expect(ioana.healthNotes).toBe("astm");
    expect(ioana.listOptOut).toBe(false);
    expect(ioana.fitnessDeclaredAt).not.toBeNull();
    expect(ioana.guardianName).toBe("Ana Pop");
    // A minor's socials are never kept (§323), on any form.
    expect(ioana.stravaUrl).toBeNull();
  });
});

describe("§389 the club's limit of registrations per address", () => {
  it("at the limit, the email says so and carries no button — nothing kept and nothing minted", async () => {
    await updateAddressCap(db, await admin(), { registrationsPerAddress: "2" }, NOW);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await press(await offer(event, "Ion", 1), at(3));
    expect(await rowsOf(event.id)).toHaveLength(2);

    await submitRegistration(db, event, submission("Maria", at(10)), at(10));
    const last = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
    expect(last.payloadJson).toEqual({ atCap: true, registrationsPerAddress: 2 });
    expect(await entries()).toHaveLength(0);
    const tokensBefore = (await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"))).length;
    const { text, secret } = await linkFromLatestOffer(at(11));
    expect(secret).toBeNull();
    expect(text).toContain("pe o adresă de email se pot înscrie cel mult 2 persoane la un eveniment, iar adresa ta le are deja");
    expect(text).toContain("one email address may register at most 2 people for an event");
    const tokensAfter = (await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"))).length;
    expect(tokensAfter).toBe(tokensBefore);
  });

  it("is enforced under the lock when the button is pressed: an older link at a full address is refused, and works again once a slot frees", async () => {
    await updateAddressCap(db, await admin(), { registrationsPerAddress: "2" }, NOW);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    // Two links out at once, for two different people, both decided with room.
    const ion = await offer(event, "Ion", 1);
    const dan = await offer(event, "Dan", 3);
    expect(await press(ion, at(5))).toMatchObject({ ok: true });
    expect(await refusal(press(dan, at(6)))).toEqual({ code: "VALIDATION_ERROR", fields: ["addressAtCap"] });
    expect(await rowsOf(event.id)).toHaveLength(2);

    // Ion cannot come after all: his slot on the address frees, and the same link now works.
    const [, ionRow] = await rowsOf(event.id);
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: at(7), cancellationSource: "PARTICIPANT" }).where(eq(registrations.id, ionRow.id));
    expect(await press(dan, at(8))).toMatchObject({ ok: true });
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

describe("§389 each person is their own registration afterwards", () => {
  it("erasing one leaves the other exactly as it was", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await press(await offer(event, "Maria", 5), at(7));
    const [ana, maria] = await rowsOf(event.id);
    await confirmEmail(db, event, ana.id, at(8));
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
    await press(await offer(event, "Maria", 5), at(7));
    const [, maria] = await rowsOf(event.id);
    const staff = await admin();
    expect(await refusal(correctRegisteredName(db, staff, maria.id, "ANA POP", at(8)))).toEqual({ code: "VALIDATION_ERROR", fields: ["registeredName"] });
    const renamed = await correctRegisteredName(db, staff, maria.id, "Maria Ioana Pop", at(9));
    expect(renamed).toMatchObject({ registeredName: "Maria Ioana Pop", nameKey: "maria ioana pop" });
  });

  it("asking for the link again sends each person on the address their own", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana"), NOW);
    await press(await offer(event, "Maria", 5), at(7));
    const before = (await outbox()).length;
    await requestRegistrationLink(db, { email: EMAIL, eventId: event.id }, at(20));
    const resent = (await outbox()).slice(before);
    const [ana, maria] = await rowsOf(event.id);
    // Ana still owes her address link; Maria owes her declaration.
    expect(resent.map((row) => [row.registrationId, row.messageType]).sort()).toEqual(
      [
        [ana.id, "VERIFY_REGISTRATION_EMAIL"],
        [maria.id, "COMPLETE_DECLARATION"],
      ].sort(),
    );
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
