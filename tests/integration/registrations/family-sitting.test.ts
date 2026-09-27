import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — a family registered in one sitting, with one email (the owner, 2026-09-27: "niciun email
 * instant: unul singur, după ce apeși «Gata» sau după fereastra din Termene"; «asta cu wizzardul de
 * confirmare si claritate e top prio!»).
 *
 * The public form, sent several times in a row from one browser for people on one address, mails
 * nothing until «Gata» or the club's window: every message its forms queue waits in the outbox, and
 * from the second person on they are one message — «Înscriere de familie: N persoane la …» — whose
 * one button confirms the address and everybody on it, and hands the browser the wizard's pass over
 * their declarations (§471). The same person sent twice in the sitting is one person; the club's limit
 * counts the sitting's kept forms; each person's refusal at the press is theirs alone.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";
const WINDOW_MS = 15 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration } = await import("@/modules/registrations/service");
const { releaseFamilySitting } = await import("@/modules/registrations/family-sitting");
const { confirmFamilySitting, readFamilySittingLink } = await import("@/modules/registrations/family-sitting-confirm");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { OutboxMessageWithdrawn } = await import("@/modules/notifications/outbox");
const { familyPassHolds } = await import("@/modules/registrations/family-signing");
const { listActiveRegistrationsForParticipant, listPendingPeopleForParticipant } = await import("@/modules/registrations/my-registrations");
const { consumeAndConfirmFamilySitting, consumeAndSignFamilyDeclaration } = await import("@/modules/registrations/token-actions");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
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
});

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

const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Maria: "2010-07-11", Ion: "1987-02-14", Dan: "2011-05-20" };

const submission = (firstName: string, at: Date, overrides: Record<string, unknown> = {}) => ({
  firstName,
  lastName: "Pop",
  birthDate: BIRTH_DATES[firstName] ?? "1980-01-01",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  // A minor on the form is registered by a parent (§108).
  ...(firstName === "Maria" || firstName === "Dan" ? { guardianName: "Ana Pop" } : {}),
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
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

/** One form of a sitting, as the public action sends it; the sitting's id comes back for the next. */
async function send(event: EventInput, firstName: string, minute: number, sittingId: string | null, overrides: Record<string, unknown> = {}) {
  const result = await submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute), "REAL", { ...PUBLIC, sitting: { id: sittingId } });
  return result.sittingId ?? null;
}

async function outbox() {
  return db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
}

async function render(row: Awaited<ReturnType<typeof outbox>>[number], now: Date) {
  return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
}

/** The family message's link, as the outbox renders it at `now`. */
async function familyLink(now: Date) {
  const [row] = (await outbox()).filter((candidate) => (candidate.payloadJson as { familySittingId?: string }).familySittingId);
  const message = await render(row, now);
  const secret = /\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1] ?? null;
  return { message, secret };
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

describe("§NNN one person in a sitting", () => {
  it("holds the verification email until the club's window, and «Gata» sends it now", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    expect(sittingId).not.toBeNull();

    const [row] = await outbox();
    expect(row.messageType).toBe("VERIFY_REGISTRATION_EMAIL");
    expect(row.nextAttemptAt?.toISOString()).toBe(new Date(NOW.getTime() + WINDOW_MS).toISOString());

    await releaseFamilySitting(db, sittingId!, at(2));
    const [released] = await outbox();
    expect(released.nextAttemptAt?.toISOString()).toBe(at(2).toISOString());
    const [sitting] = await db.select().from(familySittings);
    expect(sitting.releasedAt?.toISOString()).toBe(at(2).toISOString());

    // Released, the sitting takes no more forms: the next one opens its own.
    const next = await send(event, "Ion", 3, sittingId);
    expect(next).not.toBe(sittingId);
  });

  it("queues nothing more for the same person sent again in the sitting — its held message says it", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Ana", 1, sittingId);
    expect(await outbox()).toHaveLength(1);
    expect(await db.select().from(registrations)).toHaveLength(1);
    // The window moved with the second form.
    const [row] = await outbox();
    expect(row.nextAttemptAt?.toISOString()).toBe(new Date(at(1).getTime() + WINDOW_MS).toISOString());
  });
});

describe("§NNN a family in one sitting", () => {
  it("becomes one held message from the second person on, and a corrected form replaces the kept one", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    expect(await send(event, "Maria", 2, sittingId)).toBe(sittingId);
    expect(await send(event, "Ion", 4, sittingId)).toBe(sittingId);
    // Ion again, the birth date corrected: the same person as the kept form, which it replaces.
    expect(await send(event, "Ion", 6, sittingId, { birthDate: "1987-02-15" })).toBe(sittingId);

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].messageType).toBe("REGISTER_ANOTHER_PERSON");
    expect(rows[0].payloadJson).toEqual({ familySittingId: sittingId });
    expect(rows[0].nextAttemptAt?.toISOString()).toBe(new Date(at(6).getTime() + WINDOW_MS).toISOString());

    expect((await db.select().from(registrations)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);
    const kept = await db.select().from(pendingFamilyEntries).orderBy(pendingFamilyEntries.createdAt);
    expect(kept.map((entry) => [entry.fields.firstName, entry.fields.birthDate, entry.sittingId])).toEqual([
      ["Maria", "2010-07-11", sittingId],
      ["Ion", "1987-02-15", sittingId],
    ]);
  });

  it("never overwrites a kept form with another name on its birth date (§493: twins, or a corrected name)", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Maria", 2, sittingId);
    // Twins: another name on Maria's birth date. Maria is kept as she was, and Ioana is not added.
    expect(await send(event, "Ioana", 3, sittingId, { birthDate: "2010-07-11", guardianName: "Ana Pop" })).toBe(sittingId);
    // A corrected name, the same birth date: read the same way — Maria stays, nothing is added.
    expect(await send(event, "Mariana", 4, sittingId, { birthDate: "2010-07-11", guardianName: "Ana Pop" })).toBe(sittingId);
    const kept = await db.select().from(pendingFamilyEntries);
    expect(kept.map((entry) => [entry.fields.firstName, entry.fields.birthDate])).toEqual([["Maria", "2010-07-11"]]);
    // Another name on the birth date of the sitting's own registration: nothing created, nothing kept.
    expect(await send(event, "Anca", 5, sittingId, { birthDate: "1985-03-02" })).toBe(sittingId);
    expect((await db.select().from(registrations)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(1);
    // Still one message, and it names the two the screen lists: Ana and Maria.
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    const { message } = await familyLink(at(20));
    expect(message.subject).toContain("2 persoane");
    expect(message.text).toContain("Maria Pop");
    expect(message.text).not.toContain("Ioana Pop");
    expect(message.text).not.toContain("Mariana Pop");
  });

  it("the family link lives the club's email-link window from the send, not from the first form", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Maria", 2, sittingId);
    const sentAt = at(75);
    await familyLink(sentAt);
    const lapse = new Date(sentAt.getTime() + 48 * 3_600_000).toISOString();
    const [ana] = await db.select().from(registrations);
    expect(ana.emailLinkExpiresAt?.toISOString()).toBe(lapse);
    const [maria] = await db.select().from(pendingFamilyEntries);
    expect(maria.expiresAt.toISOString()).toBe(lapse);
    const [sitting] = await db.select().from(familySittings);
    expect(sitting.expiresAt.toISOString()).toBe(lapse);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.expiresAt.toISOString()).toBe(lapse);
  });

  it("a press that registers nobody says so: every kept form unticked, the address not confirmed", async () => {
    const event = await createEvent();
    // Ana registered outside any sitting; the sitting holds two kept forms and no registration of its own.
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", PUBLIC);
    const sittingId = await send(event, "Maria", 1, null);
    await send(event, "Dan", 2, sittingId);
    const { secret } = await familyLink(at(20));
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: [], fitnessAcknowledged: false }, at(21));
    if (!press.ok) throw new Error("the press did nothing");
    expect(press.joined).toBe(0);
    expect(press.refused).toEqual([]);
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(0);
    const [participant] = await db.select().from(participants);
    expect(participant.emailVerifiedAt).toBeNull();
  });

  it("renders one family message: the subject, everybody by name and birth date, one button, and «Toate înscrierile mele»", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Maria", 2, sittingId);
    await send(event, "Ion", 4, sittingId);

    const { message, secret } = await familyLink(at(20));
    expect(message.subject).toContain("Înscriere de familie: 3 persoane la Crosul familiei");
    for (const line of ["Ana Pop", "Maria Pop", "11 iulie 2010", "Ion Pop", "Confirm și semnez declarațiile (3)", "Toate înscrierile mele", "/inscrieri/ale-mele/"]) {
      expect(message.text).toContain(line);
    }
    // The English half says the same in its own words (§96).
    expect(message.text).toContain("Person 2 of 3: Maria Pop, date of birth 11 July 2010");
    expect(message.text).toContain("Confirm and sign the declarations (3)");
    expect(secret).not.toBeNull();
    const [sitting] = await db.select().from(familySittings);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(sitting.actionTokenId).toBe(token.id);
    expect(token.registrationId).toBe(sitting.registrationId);
  });

  it("the one button confirms the address and everybody ticked, deletes the unticked, holds the declaration requests and binds the wizard", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Maria", 2, sittingId);
    await send(event, "Ion", 4, sittingId);
    await send(event, "Dan", 5, sittingId);
    const { secret } = await familyLink(at(20));

    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");
    expect(page.people.map((person) => [person.name, person.optional, person.adultEntry])).toEqual([
      ["Ana Pop", false, false],
      ["Maria Pop", true, false],
      ["Ion Pop", true, true],
      ["Dan Pop", true, false],
    ]);
    const keyOf = (name: string) => page.people.find((person) => person.name === name)!.key;

    // Ion is an adult: without the holder's acknowledgement nothing happens, and the link still works (§421).
    expect(await refusal(confirmFamilySitting(db, secret!, { includedKeys: [keyOf("Maria Pop"), keyOf("Ion Pop")], fitnessAcknowledged: false }, at(22)))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["fitnessAcknowledged"],
    });
    expect((await readFamilySittingLink(db, secret!, "ro", at(22))).ok).toBe(true);

    // Dan unticked: his form is deleted, nobody registered for him.
    const result = await confirmFamilySitting(db, secret!, { includedKeys: [keyOf("Maria Pop"), keyOf("Ion Pop")], fitnessAcknowledged: true }, at(23));
    if (!result.ok) throw new Error("the press did nothing");
    expect(result.refused).toEqual([]);
    // In the press's order: Maria and Ion are created at one instant, so `created_at` cannot order them.
    const rows = result.registrations;
    expect(await db.select().from(registrations)).toHaveLength(3);
    expect(rows.map((row) => [row.registeredName, row.status])).toEqual([
      ["Ana Pop", "PENDING_DECLARATION"],
      ["Maria Pop", "PENDING_DECLARATION"],
      ["Ion Pop", "PENDING_DECLARATION"],
    ]);
    const [participant] = await db.select().from(participants);
    expect(participant.emailVerifiedAt).not.toBeNull();
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(0);
    const [sitting] = await db.select().from(familySittings);
    expect(sitting.confirmedAt?.toISOString()).toBe(at(23).toISOString());
    const declined = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.family_entry_declined"));
    expect(declined).toHaveLength(1);
    expect(declined[0].metadataJson).toEqual({ by: "family_sitting" });

    // The declaration requests wait the wizard's half hour, and go only to whoever is still unsigned then.
    const requests = (await outbox()).filter((row) => row.messageType === "COMPLETE_DECLARATION" && row.participantId !== null);
    expect(requests).toHaveLength(3);
    for (const row of requests) {
      expect(row.payloadJson).toEqual({ familyHeld: true });
      expect(row.nextAttemptAt?.toISOString()).toBe(new Date(at(23).getTime() + 30 * 60_000).toISOString());
    }
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.id, rows[0].id));
    const signedRequest = requests.find((row) => row.registrationId === rows[0].id)!;
    await expect(render(signedRequest, at(60))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    const unsigned = await render(requests.find((row) => row.registrationId === rows[1].id)!, at(60));
    expect(unsigned.subject.length).toBeGreaterThan(0);

    // The spent link is what the wizard's pass is bound to (§471): this participant, this event.
    const eligibleIds = rows.map((row) => row.id);
    const pass = { binding: "family" as const, participantId: participant.id, eventId: event.id, originId: null, eligibleIds, signedIds: [], skippedIds: [], done: false, expiresAt: at(90) };
    expect(await familyPassHolds(db, secret!, pass, at(24))).toBe(true);
    expect(await familyPassHolds(db, secret!, { ...pass, participantId: rows[0].id }, at(24))).toBe(false);

    // Spent: the page reads nothing more, the press does nothing more.
    expect((await readFamilySittingLink(db, secret!, "ro", at(25))).ok).toBe(false);
    expect((await confirmFamilySitting(db, secret!, { includedKeys: [], fitnessAcknowledged: true }, at(25))).ok).toBe(false);
  });

  it("counts the sitting's kept forms in the club's limit, and says at once when the address is full", async () => {
    const event = await createEvent();
    const { updateAddressCap } = await import("@/modules/registrations/address-cap");
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
    await updateAddressCap(db, admin, { registrationsPerAddress: 2 }, NOW);

    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Maria", 1, sittingId);
    // A third person on an address of two: the limit's own message, at once, and no kept form.
    await send(event, "Ion", 2, sittingId);
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(1);
    const atCap = (await outbox()).find((row) => (row.payloadJson as { atCap?: boolean }).atCap === true);
    expect(atCap?.nextAttemptAt).toBeNull();
  });

  it("a person refused at the press is theirs alone: the others join", async () => {
    const event = await createEvent(1);
    // The waiting list closed: one place, no line.
    await db.update(events).set({ waitlistCapacity: 0 }).where(eq(events.id, event.id));
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Ion", 1, sittingId);
    const { secret } = await familyLink(at(20));
    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");
    const result = await confirmFamilySitting(db, secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(22));
    if (!result.ok) throw new Error("the press did nothing");
    expect(result.refused).toEqual(["waitlist"]);
    expect((await db.select().from(registrations)).map((row) => [row.registeredName, row.status])).toEqual([["Ana Pop", "PENDING_DECLARATION"]]);
    expect(await db.select().from(pendingFamilyEntries)).toHaveLength(0);
  });

  it("the press opens the wizard (§471): the pass it hands the browser signs each person in turn under the spent link", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Ion", 1, sittingId);
    const { secret } = await familyLink(at(20));
    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");

    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(22));
    if (!press.ok || !press.pass) throw new Error("the press opened no wizard");
    expect(press.pass.binding).toBe("family");
    const rows = await db.select().from(registrations).orderBy(registrations.createdAt);
    expect(press.pass.eligibleIds).toEqual(rows.map((row) => row.id));

    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
    const signing = (typedName: string) => ({ accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 });
    const first = await consumeAndSignFamilyDeclaration(secret!, press.pass, rows[0].id, signing("Ana Pop"), at(23));
    expect(first).toMatchObject({ ok: true, registration: { id: rows[0].id, status: "CONFIRMED" } });
    const second = await consumeAndSignFamilyDeclaration(secret!, { ...press.pass, signedIds: [rows[0].id] }, rows[1].id, signing("Ion Pop"), at(24));
    expect(second).toMatchObject({ ok: true, registration: { id: rows[1].id, status: "CONFIRMED" } });

    // Both signed in the wizard: the held requests are withdrawn at their turn, never sent.
    const requests = (await outbox()).filter((row) => row.messageType === "COMPLETE_DECLARATION" && row.participantId !== null);
    for (const row of requests) await expect(render(row, at(60))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
  });

  it("«Toate înscrierile mele» lists the kept people, and each registration's declaration state", async () => {
    const event = await createEvent();
    const sittingId = await send(event, "Ana", 0, null);
    await send(event, "Ion", 1, sittingId);
    const [participant] = await db.select().from(participants);
    const pending = await listPendingPeopleForParticipant(db, participant.id, "ro", at(2));
    expect(pending.map((person) => [person.name, person.eventTitle])).toEqual([["Ion Pop", "Crosul familiei"]]);
    const [mine] = await listActiveRegistrationsForParticipant(db, participant.id, "ro", at(2));
    expect(mine).toMatchObject({ registeredName: "Ana Pop", status: "PENDING_EMAIL_CONFIRMATION", declarationSignedAt: null });
  });
});
