import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { familySigningSteps } from "@/modules/registrations/domain/family-signing";
import type { FamilySigningPass } from "@/modules/registrations/family-signing";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (over §389, §446, §330) — the declarations of a family on one address, signed as a wizard
 * (BR-REQ-033-02, BR-REQ-036-02, AGENTS.md §13.2).
 *
 * The owner, 2026-09-26: "ai înțeles cum trebuie să faci cu semnarea declarațiilor pentru familie?
 * trebuie să fie ca un wizard". Each person on the address keeps their own registration, their own
 * declaration and their own PDF; the parent signs them one after the other from one link. The first
 * signature spends the opened link, as always; the pass it hands the browser, together with that
 * spent link, signs the address's other declarations at the event — and nothing else.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration, confirmEmail } = await import("@/modules/registrations/service");
const { confirmFamilyEntry } = await import("@/modules/registrations/family-confirm");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { consumeAndSignDeclaration, consumeAndSignFamilyDeclaration } = await import("@/modules/registrations/token-actions");
const { familyPassHolds, listFamilySigningRows } = await import("@/modules/registrations/family-signing");
const { tokenAttemptAllowed } = await import("@/modules/action-tokens/throttle");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
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
  const effectiveAt = new Date("2026-01-01T00:00:00Z");
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt, isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt, isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt, isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

async function createEvent(): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 20, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul familiei", slug: "crosul-familiei" },
    { eventId: event.id, locale: "en", title: "The family cross", slug: "family-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Maria: "1990-07-11", Ion: "1987-02-14", Vecina: "1979-01-01" };

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

async function rowsOf(eventId: string) {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId)).orderBy(registrations.createdAt);
}

async function outbox(type: string) {
  const rows = await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt);
  return rows.filter((row) => row.messageType === type);
}

async function render(row: Awaited<ReturnType<typeof outbox>>[number], now: Date) {
  return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
}

/** Another person on the address, through §446's email and its one button. */
async function addPerson(event: EventInput, firstName: string, minute: number) {
  await submitRegistration(db, event, submission(firstName, at(minute)), at(minute));
  const offer = (await outbox("REGISTER_ANOTHER_PERSON")).at(-1)!;
  const message = await render(offer, at(minute + 1));
  const secret = /\/inregistrari\/familie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
  if (!secret) throw new Error("the email carried no confirmation");
  const pressed = await confirmFamilyEntry(db, secret, { fitnessAcknowledged: true }, at(minute + 2));
  if (!pressed.ok) throw new Error("the family confirmation was refused");
}

/** Ana, Maria and Ion on one address, each waiting for a declaration. */
async function family() {
  const event = await createEvent();
  await submitRegistration(db, event, submission("Ana", NOW), NOW);
  const [ana] = await rowsOf(event.id);
  await confirmEmail(db, event, ana.id, at(1));
  await addPerson(event, "Maria", 5);
  await addPerson(event, "Ion", 10);
  const [a, m, i] = await rowsOf(event.id);
  expect([a, m, i].map((row) => [row.registeredName, row.status])).toEqual([
    ["Ana Pop", "PENDING_DECLARATION"],
    ["Maria Pop", "PENDING_DECLARATION"],
    ["Ion Pop", "PENDING_DECLARATION"],
  ]);
  return { event, ana: a, maria: m, ion: i };
}

/** The declaration link the latest request for this registration carries, as the outbox renders it. */
async function declarationLink(registrationId: string, now: Date) {
  const request = (await outbox("COMPLETE_DECLARATION")).filter((row) => row.registrationId === registrationId).at(-1)!;
  const message = await render(request, now);
  const secret = /\/inregistrari\/declaratie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
  if (!secret) throw new Error("the email carried no declaration link");
  return { text: message.text, secret };
}

async function signing(typedName: string) {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
  return { accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
  throw new Error("the signature was accepted");
}

const passOf = (participantId: string, eventId: string, originId: string, signedIds: string[], expiresAt = at(90)): FamilySigningPass => ({
  participantId,
  eventId,
  originId,
  signedIds,
  expiresAt,
});

describe("§NNN the declaration request names the address's other declarations", () => {
  it("says the one link signs them all, first name and initial, in both languages — never a person alone", async () => {
    const { ana, maria } = await family();
    const { text } = await declarationLink(ana.id, at(20));
    expect(text).toContain("Pe această adresă așteaptă semnătura și declarațiile pentru: Maria P., Ion P.");
    expect(text).toContain("The declarations of Maria P., Ion P. on this address are waiting for a signature too.");
    expect((await declarationLink(maria.id, at(20))).text).toContain("declarațiile pentru: Ana P., Ion P.");
  });

  it("is not said to an address alone at the event, nor about a neighbour's address", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    await submitRegistration(db, event, submission("Vecina", at(1), { lastName: "Străină", email: "vecina@example.ro" }), at(1));
    const [ana, vecina] = await rowsOf(event.id);
    await confirmEmail(db, event, ana.id, at(2));
    await confirmEmail(db, event, vecina.id, at(2));
    const { text } = await declarationLink(ana.id, at(3));
    expect(text).not.toContain("așteaptă semnătura și declarațiile");
    expect(text).not.toContain("Vecina");
  });
});

describe("§NNN the wizard: one link, one person per step, one acceptance and one PDF each", () => {
  it("the first signature spends the link; the pass and the spent link then sign the others, each against their own name", async () => {
    const { event, ana, maria, ion } = await family();
    const { secret } = await declarationLink(ana.id, at(20));

    const first = await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(21));
    expect(first).toMatchObject({ ok: true, registration: { id: ana.id, status: "CONFIRMED" } });

    // What the action does next: the steps after Ana, with Maria current.
    const steps = familySigningSteps(await listFamilySigningRows(db, ana.participantId, event.id), {
      originId: ana.id,
      originSignable: false,
      signedIds: [ana.id],
    });
    expect(steps.map((step) => [step.registeredName, step.state])).toEqual([
      ["Ana Pop", "signed"],
      ["Maria Pop", "current"],
      ["Ion Pop", "next"],
    ]);

    let pass = passOf(ana.participantId, event.id, ana.id, [ana.id]);
    expect(await familyPassHolds(db, secret, pass, at(22))).toBe(true);

    // Maria's step checks Maria's name: Ana's own is refused, nothing recorded.
    expect(await refusal(consumeAndSignFamilyDeclaration(secret, pass, maria.id, await signing("Ana Pop"), at(22)))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["typedName"],
    });
    expect(await db.select().from(declarationAcceptances)).toHaveLength(1);

    const second = await consumeAndSignFamilyDeclaration(secret, pass, maria.id, await signing("Maria Pop"), at(23));
    expect(second).toMatchObject({ ok: true, registration: { id: maria.id, status: "CONFIRMED" } });
    pass = passOf(ana.participantId, event.id, ana.id, [ana.id, maria.id]);
    const third = await consumeAndSignFamilyDeclaration(secret, pass, ion.id, await signing("ion  pop"), at(24));
    expect(third).toMatchObject({ ok: true, registration: { id: ion.id, status: "CONFIRMED" } });

    // One acceptance per person, each with the name that person typed, and one confirmation each —
    // the message that carries that person's own PDF (§126).
    const acceptances = await db.select().from(declarationAcceptances).orderBy(declarationAcceptances.acceptedAt);
    expect(acceptances.map((row) => [row.registrationId, row.typedName])).toEqual([
      [ana.id, "Ana Pop"],
      [maria.id, "Maria Pop"],
      [ion.id, "ion  pop"],
    ]);
    expect((await outbox("REGISTRATION_CONFIRMED")).map((row) => row.registrationId).sort()).toEqual([ana.id, maria.id, ion.id].sort());

    const done = familySigningSteps(await listFamilySigningRows(db, ana.participantId, event.id), {
      originId: ana.id,
      originSignable: false,
      signedIds: [ana.id, maria.id, ion.id],
    });
    expect(done.every((step) => step.state === "signed")).toBe(true);
  });

  it("a family walks the spent link's page more often than its ten attempts an hour: the pass is never charged", async () => {
    const { event, ana, maria } = await family();
    const { secret } = await declarationLink(ana.id, at(20));
    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(21));
    // The link's allowance spent by the pages of a large family (§19.4: ten an hour).
    for (let attempt = 0; attempt < 12; attempt++) await tokenAttemptAllowed(db, secret, at(22));
    expect(await tokenAttemptAllowed(db, secret, at(22))).toBe(false);

    const signed = await consumeAndSignFamilyDeclaration(secret, passOf(ana.participantId, event.id, ana.id, [ana.id]), maria.id, await signing("Maria Pop"), at(23));
    expect(signed).toMatchObject({ ok: true, registration: { id: maria.id, status: "CONFIRMED" } });
  });

  it("the pass alone, the link alone, or a pass beside another link signs nobody", async () => {
    const { event, ana, maria } = await family();
    const { secret } = await declarationLink(ana.id, at(20));
    const pass = passOf(ana.participantId, event.id, ana.id, [ana.id]);

    // Before the first signature the link is live, not spent: the pass is not honoured beside it.
    expect(await consumeAndSignFamilyDeclaration(secret, pass, maria.id, await signing("Maria Pop"), at(21))).toMatchObject({ ok: false });
    expect(await familyPassHolds(db, secret, pass, at(21))).toBe(false);

    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(22));

    // A pass for another origin, another address or another event, beside this spent link: refused.
    expect(await consumeAndSignFamilyDeclaration(secret, { ...pass, originId: maria.id }, maria.id, await signing("Maria Pop"), at(23))).toMatchObject({ ok: false });
    expect(await consumeAndSignFamilyDeclaration(secret, { ...pass, participantId: "00000000-0000-4000-8000-000000000000" }, maria.id, await signing("Maria Pop"), at(23))).toMatchObject({ ok: false });
    expect(await consumeAndSignFamilyDeclaration(secret, { ...pass, eventId: "00000000-0000-4000-8000-000000000000" }, maria.id, await signing("Maria Pop"), at(23))).toMatchObject({ ok: false });
    // A posted id that is not one: the same refusal, never the database's parse error.
    expect(await consumeAndSignFamilyDeclaration(secret, pass, "not-an-id", await signing("Maria Pop"), at(23))).toMatchObject({ ok: false });
    // A made-up secret beside a real pass: refused.
    expect(await consumeAndSignFamilyDeclaration("A".repeat(43), pass, maria.id, await signing("Maria Pop"), at(23))).toMatchObject({ ok: false });

    const [, stillMaria] = await rowsOf(event.id);
    expect(stillMaria.status).toBe("PENDING_DECLARATION");
    expect(await db.select().from(declarationAcceptances)).toHaveLength(1);
  });

  it("never signs the link's own person a second time, nor a registration of another address", async () => {
    const { event, ana } = await family();
    await submitRegistration(db, event, submission("Vecina", at(30), { lastName: "Străină", email: "vecina@example.ro" }), at(30));
    const vecina = (await rowsOf(event.id)).find((row) => row.registeredName === "Vecina Străină")!;
    await confirmEmail(db, event, vecina.id, at(31));

    const { secret } = await declarationLink(ana.id, at(32));
    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(33));
    const pass = passOf(ana.participantId, event.id, ana.id, [ana.id]);

    expect(await consumeAndSignFamilyDeclaration(secret, pass, ana.id, await signing("Ana Pop"), at(34))).toMatchObject({ ok: false });
    expect(await consumeAndSignFamilyDeclaration(secret, pass, vecina.id, await signing("Vecina Străină"), at(34))).toMatchObject({ ok: false });
    const neighbour = (await rowsOf(event.id)).find((row) => row.id === vecina.id)!;
    expect(neighbour.status).toBe("PENDING_DECLARATION");
  });

  it("a person the wizard signed is closed: their own emailed link no longer signs, and says so rather than dying", async () => {
    const { event, ana, maria } = await family();
    const anaLink = await declarationLink(ana.id, at(20));
    const mariaLink = await declarationLink(maria.id, at(20));
    await consumeAndSignDeclaration(anaLink.secret, await signing("Ana Pop"), at(21));
    await consumeAndSignFamilyDeclaration(anaLink.secret, passOf(ana.participantId, event.id, ana.id, [ana.id]), maria.id, await signing("Maria Pop"), at(22));

    // Maria's own link is still a live token on a confirmed registration: the page reads the state
    // (§420), and a press is a conflict that records nothing.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, maria.id));
    expect(token.usedAt).toBeNull();
    expect(await refusal(consumeAndSignDeclaration(mariaLink.secret, await signing("Maria Pop"), at(23)))).toMatchObject({ code: "CONFLICT" });
    expect((await db.select().from(declarationAcceptances)).filter((row) => row.registrationId === maria.id)).toHaveLength(1);
  });
});
