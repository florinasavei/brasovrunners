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
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §519 — a family registered in one sitting, with one email (the owner, 2026-09-27: "niciun email
 * instant: unul singur, după ce apeși «Gata» sau după fereastra din Termene"; «asta cu wizzardul de
 * confirmare si claritate e top prio!»).
 *
 * The public form, sent several times in a row from one browser for people on one address. Since
 * §NNN (the owner, 2026-09-28: «sa inteleg ca nu primesc mailu daca nu apas pe „Nu, gata, trimite
 * mailul”?») the first form is an ordinary form — its email due at once, no sitting written — and
 * «Da, încă o persoană» opens the sitting, holding that email if it has not left. From that press
 * on, nothing the sitting holds leaves before «Gata» or the club's window, and from the second
 * person on the held messages are one — «Înscriere de familie: N persoane la …» — whose
 * one button confirms the address and everybody on it, and hands the browser the wizard's pass over
 * their declarations (§471). The same person sent twice in the sitting is one person; the club's limit
 * counts the sitting's kept forms; each person's refusal at the press is theirs alone.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";
const WINDOW_MS = 10 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration } = await import("@/modules/registrations/service");
const { continueFamilySitting, releaseFamilySitting } = await import("@/modules/registrations/family-sitting");
const { familySigningSteps } = await import("@/modules/registrations/domain/family-signing");
const { listFamilySigningRows } = await import("@/modules/registrations/family-signing");
const { updateDeadlines } = await import("@/modules/deadlines/deadlines");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");
const { confirmFamilySitting, readFamilySittingLink } = await import("@/modules/registrations/family-sitting-confirm");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { OutboxMessageWithdrawn } = await import("@/modules/notifications/outbox");
const { familyPassHolds } = await import("@/modules/registrations/family-signing");
const { listActiveRegistrationsForParticipant, listPendingPeopleForParticipant } = await import("@/modules/registrations/my-registrations");
const { consumeAndConfirmFamilySitting, consumeAndSignFamilyDeclaration } = await import("@/modules/registrations/token-actions");
const { readOutboxQueue } = await import("@/modules/notifications/queue");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  // The club's deadlines as unset: a case below changes them, and the instance's memo would keep them.
  forgetCachedDeadlines();
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationTrailRo },
    { locale: "en", title: "Declaration", body: declarationTrailEn },
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
  country: "RO",
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

/** A first form, before any «Da» (§NNN): an ordinary form, which hands back what «Da» would open a sitting with. */
async function first(event: EventInput, firstName: string, minute: number, overrides: Record<string, unknown> = {}) {
  const result = await submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute), "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
  return { sittingId: result.sittingId ?? null, seed: result.sittingSeed ?? null };
}

/** «Da, încă o persoană» (§NNN): opens the sitting from the first form's seed, or starts an open one's window again. */
async function yes(event: EventInput, press: { sittingId?: string | null; seed?: Awaited<ReturnType<typeof first>>["seed"] }, minute: number) {
  return continueFamilySitting(db, { sittingId: press.sittingId ?? null, seed: press.seed ?? null, eventId: event.id, locale: "ro" }, new Date(at(minute).getTime() + WINDOW_MS), at(minute));
}

/** The first form and «Da» at the same minute: the sitting the next forms are sent in. */
async function start(event: EventInput, firstName: string, minute: number, overrides: Record<string, unknown> = {}) {
  const { seed } = await first(event, firstName, minute, overrides);
  return yes(event, { seed }, minute);
}

/** One form of a sitting, after «Da», as the public action sends it; the sitting's id comes back for the next. */
async function send(event: EventInput, firstName: string, minute: number, sittingId: string | null, overrides: Record<string, unknown> = {}) {
  const result = await submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true } });
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

describe("§519 one person in a sitting", () => {
  it("one form, no press: the verification email is due at once and no sitting is written (§NNN)", async () => {
    const event = await createEvent();
    const { sittingId, seed } = await first(event, "Ana", 0);
    expect(sittingId).toBeNull();
    const [row] = await outbox();
    expect(row.messageType).toBe("VERIFY_REGISTRATION_EMAIL");
    // Due at once, on the club's ordinary timing: nothing waits for a press.
    expect(row.nextAttemptAt).toBeNull();
    // Never held, so never marked held (the review of 2026-09-28, nit F1): only the link's start.
    expect(row.payloadJson).toEqual({ startsDeadline: true });
    expect(await db.select().from(familySittings)).toHaveLength(0);
    // What «Da» would take in: this registration and its message.
    const [ana] = await db.select().from(registrations);
    expect(seed).toEqual({ kind: "registration", id: ana.id, outboxId: row.id });
  });

  it("a second plain form from the same browser, with no «Da», is a first form again: nothing held, nothing merged (§NNN)", async () => {
    const event = await createEvent();
    await first(event, "Ana", 0);
    await first(event, "Ion", 1);
    const rows = await outbox();
    expect(rows.map((row) => row.messageType)).toEqual(["VERIFY_REGISTRATION_EMAIL", "REGISTER_ANOTHER_PERSON"]);
    for (const row of rows) expect(row.nextAttemptAt).toBeNull();
    expect(await db.select().from(familySittings)).toHaveLength(0);
  });

  it("the same person sent twice with no «Da» is the ordinary re-send, never «already waiting to leave» (§NNN)", async () => {
    const event = await createEvent();
    await first(event, "Ana", 0);
    await first(event, "Ana", 1);
    const rows = await outbox();
    expect(rows.map((row) => row.messageType)).toEqual(["VERIFY_REGISTRATION_EMAIL", "VERIFY_REGISTRATION_EMAIL"]);
    for (const row of rows) expect(row.nextAttemptAt).toBeNull();
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.resubmitted"));
    expect(audit.metadataJson).toEqual({ status: "PENDING_EMAIL_CONFIRMATION", resent: "VERIFY_REGISTRATION_EMAIL" });
  });

  it("«Da» opens the sitting and holds the first email until the club's window, and «Gata» sends it now", async () => {
    const event = await createEvent();
    const { seed } = await first(event, "Ana", 0);
    const sittingId = await yes(event, { seed }, 1);
    expect(sittingId).not.toBeNull();

    const [row] = await outbox();
    expect(row.nextAttemptAt?.toISOString()).toBe(new Date(at(1).getTime() + WINDOW_MS).toISOString());
    // «Da» took it in while it still waited, so it is marked held now, and only now (nit F1).
    expect(row.payloadJson).toEqual({ startsDeadline: true, sittingHeld: true });
    const [open] = await db.select().from(familySittings);
    expect(open.heldOutboxIds).toEqual([row.id]);
    expect(open.registrationIds).toHaveLength(1);

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
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Ana", 1, sittingId);
    expect(await outbox()).toHaveLength(1);
    expect(await db.select().from(registrations)).toHaveLength(1);
    // The window moved with the second form.
    const [row] = await outbox();
    expect(row.nextAttemptAt?.toISOString()).toBe(new Date(at(1).getTime() + WINDOW_MS).toISOString());
    // The club's record says the truth (the second review): the held email is the one that leaves.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.resubmitted"));
    expect(audit.metadataJson).toEqual({ status: "PENDING_EMAIL_CONFIRMATION", resent: "VERIFY_REGISTRATION_EMAIL", held: true });
  });

  it("a kept form a one-person sitting held lives the club's window from its message's send (the second review)", async () => {
    const event = await createEvent();
    // Ana registered before, outside any sitting; Ion's form, in a sitting of his own, is kept.
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", PUBLIC);
    const sittingId = await start(event, "Ion", 1);
    const [entryHeld] = (await outbox()).filter((candidate) => candidate.messageType === "REGISTER_ANOTHER_PERSON");
    // «Da» held the kept form's message and tied the form to the sitting.
    expect(entryHeld.nextAttemptAt?.toISOString()).toBe(new Date(at(1).getTime() + WINDOW_MS).toISOString());
    // …marked as the family's hold (the review of 2026-09-28, round two), never as `sittingHeld`,
    // which changes a verification link's life: the queue panel counts it as the family's, not a retry.
    expect(entryHeld.payloadJson).toMatchObject({ familyHeld: true });
    expect(entryHeld.payloadJson).not.toHaveProperty("sittingHeld");
    // Ana's own email thrown back for a retry, with no flag: a retry, and only a retry.
    const [anaEmail] = (await outbox()).filter((candidate) => candidate.messageType === "VERIFY_REGISTRATION_EMAIL");
    await db.update(emailOutbox).set({ attemptCount: 1, nextAttemptAt: at(30) }).where(eq(emailOutbox.id, anaEmail.id));
    const queue = await readOutboxQueue(db, 50, at(2));
    expect(queue.held).toMatchObject({ total: 2, family: 1, retry: 1, reserve: 0 });
    expect(queue.rows.find((row) => row.id === entryHeld.id)?.familyHeld).toBe(true);
    expect(queue.rows.find((row) => row.id === anaEmail.id)?.familyHeld).toBe(false);
    await db.update(emailOutbox).set({ attemptCount: 0, nextAttemptAt: null }).where(eq(emailOutbox.id, anaEmail.id));
    expect((await db.select().from(pendingFamilyEntries))[0].sittingId).toBe(sittingId);
    await releaseFamilySitting(db, sittingId!, at(2));
    const [row] = (await outbox()).filter((candidate) => candidate.messageType === "REGISTER_ANOTHER_PERSON");
    expect((row.payloadJson as { familyEntryId?: string }).familyEntryId).toBeTruthy();
    const sentAt = at(9);
    await render(row, sentAt);
    const lapse = new Date(sentAt.getTime() + 48 * 3_600_000).toISOString();
    const [entry] = await db.select().from(pendingFamilyEntries);
    expect(entry.expiresAt.toISOString()).toBe(lapse);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.expiresAt.toISOString()).toBe(lapse);
  });
});

describe("§NNN a kept form held inside a live sitting says it is the family's hold", () => {
  it("the REGISTER_ANOTHER_PERSON queued in the sitting carries `familyHeld`, and the queue counts it as the family's", async () => {
    const event = await createEvent();
    // Ana registered before, outside any sitting; Ion's form is sent after «Da» (joined), the seed spent:
    // the form opens its own sitting, and its kept form's message is held in it.
    await submitRegistration(db, event, submission("Ana", at(0)), at(0), "REAL", PUBLIC);
    const sittingId = await send(event, "Ion", 1, null);
    expect(sittingId).not.toBeNull();
    const [held] = (await outbox()).filter((row) => row.messageType === "REGISTER_ANOTHER_PERSON");
    expect(held.nextAttemptAt?.toISOString()).toBe(new Date(at(1).getTime() + WINDOW_MS).toISOString());
    expect(held.payloadJson).toMatchObject({ familyHeld: true, startsDeadline: true });
    expect(held.payloadJson).not.toHaveProperty("sittingHeld");
    const queue = await readOutboxQueue(db, 50, at(2));
    expect(queue.held).toMatchObject({ family: 1, retry: 0, reserve: 0 });
    expect(queue.rows.find((row) => row.id === held.id)?.familyHeld).toBe(true);
  });
});

describe("§519 a family in one sitting", () => {
  it("becomes one held message from the second person on, and a corrected form replaces the kept one", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
    expect(await send(event, "Maria", 2, sittingId)).toBe(sittingId);
    expect(await send(event, "Ion", 4, sittingId)).toBe(sittingId);
    // Ion again, the birth date corrected: the same person as the kept form, which it replaces.
    expect(await send(event, "Ion", 6, sittingId, { birthDate: "1987-02-15" })).toBe(sittingId);

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].messageType).toBe("REGISTER_ANOTHER_PERSON");
    // Flagged as the family's hold (§NNN): the queue panel (§529) counts it there, never as a retry.
    expect(rows[0].payloadJson).toEqual({ familySittingId: sittingId, familyHeld: true });
    expect(rows[0].nextAttemptAt?.toISOString()).toBe(new Date(at(6).getTime() + WINDOW_MS).toISOString());
    expect((await readOutboxQueue(db, 50, at(7))).held).toMatchObject({ total: 1, family: 1, retry: 0, reserve: 0 });

    expect((await db.select().from(registrations)).map((row) => row.registeredName)).toEqual(["Ana Pop"]);
    const kept = await db.select().from(pendingFamilyEntries).orderBy(pendingFamilyEntries.createdAt);
    expect(kept.map((entry) => [entry.fields.firstName, entry.fields.birthDate, entry.sittingId])).toEqual([
      ["Maria", "2010-07-11", sittingId],
      ["Ion", "1987-02-15", sittingId],
    ]);
  });

  it("never overwrites a kept form with another name on its birth date (§493: twins, or a corrected name)", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
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
    const sittingId = await start(event, "Ana", 0);
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
    const sittingId = await start(event, "Maria", 1);
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
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Maria", 2, sittingId);
    await send(event, "Ion", 4, sittingId);

    const { message, secret } = await familyLink(at(20));
    expect(message.subject).toContain("Înscriere de familie: 3 persoane la Crosul familiei");
    // The first line says the one button does everything (§NNN; the owner, 2026-09-28), before anybody is named.
    const lead = "Un singur buton: confirmi adresa și cele 3 înscrieri, apoi semnezi pe rând declarațiile celor care mai au loc.";
    expect(message.text).toContain(lead);
    expect(message.text.indexOf(lead)).toBeLessThan(message.text.indexOf("Persoana 1 din 3: Ana Pop"));
    // One line per person, the birth date in words, no «la» before it (§452).
    expect(message.text).toContain("Persoana 2 din 3: Maria Pop, data nașterii 11 iulie 2010");
    for (const line of ["Ion Pop", "Confirm și semnez declarațiile (3)", "Toate înscrierile mele", "/inscrieri/ale-mele/"]) {
      expect(message.text).toContain(line);
    }
    // Nobody got an email of their own before «Da»: no line about an earlier one.
    expect(message.text).not.toContain("emailul anterior");
    // The English half says the same in its own words (§96).
    expect(message.text).toContain("One button: you confirm the address and the 3 registrations, then sign, one by one, the declarations of those who still have a place.");
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
    const sittingId = await start(event, "Ana", 0);
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
    // Each starts its hold (`startsDeadline`): the hold counts from when the request leaves.
    const requests = (await outbox()).filter((row) => row.messageType === "COMPLETE_DECLARATION" && row.participantId !== null);
    expect(requests).toHaveLength(3);
    for (const row of requests) {
      expect(row.payloadJson).toEqual({ familyHeld: true, startsDeadline: true });
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

    const sittingId = await start(event, "Ana", 0);
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
    const sittingId = await start(event, "Ana", 0);
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
    const sittingId = await start(event, "Ana", 0);
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
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Ion", 1, sittingId);
    const [participant] = await db.select().from(participants);
    const pending = await listPendingPeopleForParticipant(db, participant.id, "ro", at(2));
    expect(pending.map((person) => [person.name, person.eventTitle])).toEqual([["Ion Pop", "Crosul familiei"]]);
    const [mine] = await listActiveRegistrationsForParticipant(db, participant.id, "ro", at(2));
    expect(mine).toMatchObject({ registeredName: "Ana Pop", status: "PENDING_EMAIL_CONFIRMATION", declarationSignedAt: null });
  });
});

/** The club's deadlines, as an Administrator saves them on «Termene» (§377). */
async function setDeadlines(changes: Partial<typeof DEFAULT_DEADLINES>) {
  const [admin] = await db.insert(staffUsers).values({ email: "termene@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  await updateDeadlines(db, admin, { ...DEFAULT_DEADLINES, ...changes }, NOW);
}

describe("§519 the fix round of 2026-09-27", () => {
  it("holds each place from the moment its declaration request can leave: a 10-minute hold and the wizard's half hour", async () => {
    await setDeadlines({ holdMinutes: 10 });
    const event = await createEvent();
    // No participation window: the club's minutes are the hold (§104, §377).
    await db.update(events).set({ confirmationOpensDaysBefore: 0 }).where(eq(events.id, event.id));
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Ion", 1, sittingId);
    const { secret } = await familyLink(at(20));
    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");
    const result = await confirmFamilySitting(db, secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(22));
    if (!result.ok) throw new Error("the press did nothing");

    const leaves = new Date(at(22).getTime() + 30 * 60_000);
    const requests = (await outbox()).filter((row) => row.messageType === "COMPLETE_DECLARATION" && row.participantId !== null);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.nextAttemptAt?.toISOString()).toBe(leaves.toISOString());
      const [held] = await db.select().from(registrations).where(eq(registrations.id, request.registrationId!));
      // The hold counts from the send: ten minutes after the request leaves, never before it.
      expect(held.holdExpiresAt?.toISOString()).toBe(new Date(leaves.getTime() + 10 * 60_000).toISOString());
      expect(held.holdExpiresAt!.getTime()).toBeGreaterThan(request.nextAttemptAt!.getTime());
    }
  });

  it("at a window of 0 nothing is held: the verification email is due at once and no sitting is written", async () => {
    await setDeadlines({ familySittingMinutes: 0 });
    const event = await createEvent();
    expect(await first(event, "Ana", 0)).toEqual({ sittingId: null, seed: null });
    const [row] = await outbox();
    expect(row.messageType).toBe("VERIFY_REGISTRATION_EMAIL");
    expect(row.nextAttemptAt).toBeNull();
    expect(await db.select().from(familySittings)).toHaveLength(0);
  });

  it("«Da, încă o persoană» starts the window again: the row and the message it holds move together", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Ion", 1, sittingId);
    const until = new Date(at(8).getTime() + WINDOW_MS);
    expect(await yes(event, { sittingId }, 8)).toBe(sittingId);
    const [sitting] = await db.select().from(familySittings);
    expect(sitting.heldUntil.toISOString()).toBe(until.toISOString());
    const [row] = await outbox();
    expect(row.nextAttemptAt?.toISOString()).toBe(until.toISOString());
    // Sent already: a later «Da» moves nothing.
    await releaseFamilySitting(db, sittingId!, at(9));
    expect(await yes(event, { sittingId }, 12)).toBeNull();
    const [released] = await outbox();
    expect(released.nextAttemptAt?.toISOString()).toBe(at(9).toISOString());
  });

  it("three people, one family email: the window holds it across every form, whatever pass of the outbox comes between (§519, §NNN)", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Maria", 2, sittingId);
    // A scheduled pass at minute 3 finds nothing due: the family message waits for the window.
    const [held] = await outbox();
    expect(held.nextAttemptAt!.getTime()).toBeGreaterThan(at(3).getTime());
    await send(event, "Ion", 4, sittingId);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(held.id);
    expect(rows[0].idempotencyKey).toBe(`family-sitting:${sittingId}`);
    expect(rows[0].nextAttemptAt?.toISOString()).toBe(new Date(at(4).getTime() + WINDOW_MS).toISOString());
    const message = await render(rows[0], at(20));
    expect(message.subject).toContain("3 persoane");
  });

  it("«Da» after the first email has left: the second is held, and the family email's one button confirms both (§NNN)", async () => {
    const event = await createEvent();
    const { seed } = await first(event, "Ana", 0);
    // Ana's own verification email leaves before «Da» — «imediat», or a scheduled pass in between.
    const [anaEmail] = await outbox();
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(1), attemptCount: 1 }).where(eq(emailOutbox.id, anaEmail.id));
    const sittingId = await yes(event, { seed }, 2);
    expect(sittingId).not.toBeNull();
    // Nothing to hold: the email that left is not taken back.
    const [open] = await db.select().from(familySittings);
    expect(open.heldOutboxIds).toEqual([]);
    expect(open.registrationIds).toHaveLength(1);
    // …nor marked held (nit F1): it left as the ordinary email it was.
    expect((await outbox()).find((row) => row.id === anaEmail.id)?.payloadJson).toEqual({ startsDeadline: true });

    await send(event, "Ion", 3, sittingId);
    const family = (await outbox()).filter((row) => row.id !== anaEmail.id);
    expect(family).toHaveLength(1);
    expect(family[0].payloadJson).toEqual({ familySittingId: sittingId, familyHeld: true });
    expect(family[0].nextAttemptAt?.toISOString()).toBe(new Date(at(3).getTime() + WINDOW_MS).toISOString());

    const { message, secret } = await familyLink(at(20));
    expect(message.subject).toContain("2 persoane");
    // Ana's own email left before «Da»: one line says this button covers her too (§NNN) — never that the older one stopped working.
    expect(message.text).toContain("Acest email îi cuprinde pe toți: butonul de mai jos confirmă și înscrierea din emailul anterior.");
    expect(message.text).toContain("This email covers everybody: the button below also confirms the registration from the earlier email.");
    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");
    const result = await confirmFamilySitting(db, secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(22));
    if (!result.ok) throw new Error("the press did nothing");
    expect((await db.select().from(registrations).orderBy(registrations.createdAt)).map((row) => [row.registeredName, row.status])).toEqual([
      ["Ana Pop", "PENDING_DECLARATION"],
      ["Ion Pop", "PENDING_DECLARATION"],
    ]);
  });

  it("«Da» after the first person confirmed from the email that left before it opens nothing from the seed (the review of 2026-09-28)", async () => {
    const event = await createEvent();
    const { seed } = await first(event, "Ana", 0);
    // Ana's email left before «Da», and she confirmed her address from it.
    const [anaEmail] = await outbox();
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(1), attemptCount: 1 }).where(eq(emailOutbox.id, anaEmail.id));
    const [ana] = await db.select().from(registrations);
    await db.update(registrations).set({ status: "PENDING_DECLARATION" }).where(eq(registrations.id, ana.id));
    // «Da» finds no waiting registration under the seed: no sitting, and the browser's list drops her (`peopleAfterYes`).
    expect(await yes(event, { seed }, 2)).toBeNull();
    expect(await db.select().from(familySittings)).toHaveLength(0);
    // The next form opens its own sitting; its email names Ion alone, as the browser's list now does.
    const sittingId = await send(event, "Ion", 3, null);
    const [open] = await db.select().from(familySittings).where(eq(familySittings.id, sittingId!));
    expect(open.registrationIds).not.toContain(ana.id);
  });

  it("a held verification email's link lives the club's window from its send, as the message says", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
    await releaseFamilySitting(db, sittingId!, at(1));
    const [row] = await outbox();
    const sentAt = at(9);
    await render(row, sentAt);
    const lapse = new Date(sentAt.getTime() + 48 * 3_600_000).toISOString();
    const [ana] = await db.select().from(registrations);
    expect(ana.emailLinkExpiresAt?.toISOString()).toBe(lapse);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "VERIFY_REGISTRATION_EMAIL"));
    expect(token.expiresAt.toISOString()).toBe(lapse);
  });

  it("three people, one press: one confirmation with three QR codes and three race numbers, in the order the forms were sent, and the page lists the three numbers", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Ion", 1, sittingId);
    await send(event, "Radu", 2, sittingId);
    const { secret } = await familyLink(at(20));
    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(22));
    if (!press.ok || !press.pass) throw new Error("the press opened no wizard");

    // Ion and Radu were created at one instant: the wizard still follows the order the forms were sent.
    const nameOf = new Map((await db.select().from(registrations)).map((row) => [row.id, row.registeredName]));
    expect(press.pass.eligibleIds.map((id) => nameOf.get(id))).toEqual(["Ana Pop", "Ion Pop", "Radu Pop"]);

    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
    const signing = (typedName: string) => ({ accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 });
    const signedIds: string[] = [];
    for (const [index, id] of press.pass.eligibleIds.entries()) {
      const signed = await consumeAndSignFamilyDeclaration(secret!, { ...press.pass, signedIds: [...signedIds] }, id, signing(nameOf.get(id)!), at(23 + index));
      expect(signed).toMatchObject({ ok: true, registration: { id, status: "CONFIRMED" } });
      signedIds.push(id);
    }

    // One confirmation for the family, never one each; everybody signed, so it is due at the last signature.
    const confirmations = (await outbox()).filter((row) => row.messageType === "REGISTRATION_CONFIRMED" && row.participantId !== null);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].payloadJson).toEqual({ familySittingId: sittingId });
    expect(confirmations[0].nextAttemptAt?.toISOString()).toBe(at(25).toISOString());

    const message = await render(confirmations[0], at(26));
    expect(message.subject).toContain("Confirmat: 3 persoane la Crosul familiei");
    expect(message.html.match(/\/api\/registrations\/qr\//g)).toHaveLength(3);
    const rows = await db.select().from(registrations);
    const inOrder = ["Ana Pop", "Ion Pop", "Radu Pop"].map((name) => rows.find((row) => row.registeredName === name)!);
    // The blocks, after the greeting (which names the person of the first form).
    // One line of intro (§NNN), then one block per person.
    const intro = "Toți cei de mai jos sunt înscriși la Crosul familiei; sub fiecare nume, numărul, codul și QR-ul de arătat la masă.";
    expect(message.text).toContain(intro);
    expect(message.text).toContain("Everybody below is registered for");
    const blocks = message.text.indexOf(intro);
    expect(blocks).toBeGreaterThan(-1);
    const positions = inOrder.map((row) => message.text.indexOf(row.registeredName, blocks));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const row of inOrder) {
      const number = row.bibNumber ?? row.provisionalBibNumber;
      expect(number).not.toBeNull();
      expect(message.text).toContain(`Număr de concurs: ${number}`);
      expect(message.text).toContain(`Codul pentru masă: ${row.checkinCode}`);
    }
    expect(message.text).toContain("Toate înscrierile mele");

    // «Declarațiile de pe această adresă»: the three numbers, in the same order.
    const [participant] = await db.select().from(participants);
    const steps = familySigningSteps(await listFamilySigningRows(db, participant.id, event.id), { originId: null, originSignable: false, signedIds: [] });
    expect(steps.map((step) => step.registeredName)).toEqual(["Ana Pop", "Ion Pop", "Radu Pop"]);
    expect(steps.map((step) => step.raceNumber?.value)).toEqual(inOrder.map((row) => row.bibNumber ?? row.provisionalBibNumber));
  });
  it("a person who signs after the family's confirmation has left gets their own, as before", async () => {
    const event = await createEvent();
    const sittingId = await start(event, "Ana", 0);
    await send(event, "Ion", 1, sittingId);
    const { secret } = await familyLink(at(20));
    const page = await readFamilySittingLink(db, secret!, "ro", at(21));
    if (!page.ok) throw new Error("the page could not read its link");
    const press = await consumeAndConfirmFamilySitting(secret!, { includedKeys: page.people.map((person) => person.key), fitnessAcknowledged: true }, at(22));
    if (!press.ok || !press.pass) throw new Error("the press opened no wizard");
    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
    const signing = (typedName: string) => ({ accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 });
    const [anaId, ionId] = press.pass.eligibleIds;
    await consumeAndSignFamilyDeclaration(secret!, press.pass, anaId, signing("Ana Pop"), at(23));
    // Ion is still to sign: the family's confirmation waits the wizard's half hour for him.
    const [family] = (await outbox()).filter((row) => row.messageType === "REGISTRATION_CONFIRMED" && row.participantId !== null);
    expect(family.nextAttemptAt?.toISOString()).toBe(new Date(at(23).getTime() + 30 * 60_000).toISOString());
    // It left with Ana alone; Ion signs afterwards and hears of his own confirmation.
    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(54), attemptCount: 1 }).where(eq(emailOutbox.id, family.id));
    await consumeAndSignFamilyDeclaration(secret!, { ...press.pass, signedIds: [anaId] }, ionId, signing("Ion Pop"), at(60));
    const confirmations = (await outbox()).filter((row) => row.messageType === "REGISTRATION_CONFIRMED" && row.participantId !== null);
    expect(confirmations).toHaveLength(2);
    expect(confirmations.find((row) => row.id !== family.id)).toMatchObject({ registrationId: ionId, payloadJson: {} });
  });
});
