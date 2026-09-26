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
import { currentFamilyStep, familySigningSteps } from "@/modules/registrations/domain/family-signing";
import { issueActionToken } from "@/modules/action-tokens/repository";
import type { FamilySigningPass } from "@/modules/registrations/family-signing";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §471 (over §389, §446, §330) — the declarations of a family on one address, signed as a wizard
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
const { familyPassHolds, familyStepsOfPass, listFamilySigningRows, nextFamilyPass } = await import("@/modules/registrations/family-signing");
const { skipFamilyDeclaration, startFamilySigningFromMine, readRegistrationTokenContext, spentLinkHasFamilyLeft } = await import(
  "@/modules/registrations/token-actions"
);
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

const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Maria: "1990-07-11", Ion: "1987-02-14", Vecina: "1979-01-01", Ionut: "2011-05-20" };

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
async function addPerson(event: EventInput, firstName: string, minute: number, overrides: Record<string, unknown> = {}) {
  await submitRegistration(db, event, submission(firstName, at(minute), overrides), at(minute));
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

/** A link's pass after its own person signed, over the three people of `family()`. */
const passOf = (
  people: { ana: { id: string; participantId: string; eventId: string }; maria: { id: string }; ion: { id: string } },
  signedIds: string[],
  overrides: Partial<FamilySigningPass> = {},
): FamilySigningPass => ({
  binding: "link",
  participantId: people.ana.participantId,
  eventId: people.ana.eventId,
  originId: people.ana.id,
  eligibleIds: [people.ana.id, people.maria.id, people.ion.id],
  signedIds,
  skippedIds: [],
  done: false,
  expiresAt: at(90),
  ...overrides,
});

describe("§471 the declaration request names the address's other declarations", () => {
  it("says the one link signs them all, first name and initial, in both languages — never a person alone", async () => {
    const { ana, maria } = await family();
    const { text } = await declarationLink(ana.id, at(20));
    expect(text).toContain("Pe această adresă mai așteaptă semnătura declarațiile pentru: Maria P., Ion P.");
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
    expect(text).not.toContain("așteaptă semnătura declarațiile");
    expect(text).not.toContain("Vecina");
  });
});

describe("§471 the wizard: one link, one person per step, one acceptance and one PDF each", () => {
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

    let pass = passOf({ ana, maria, ion }, [ana.id]);
    expect(await familyPassHolds(db, secret, pass, at(22))).toBe(true);

    // Maria's step checks Maria's name: Ana's own is refused, nothing recorded.
    expect(await refusal(consumeAndSignFamilyDeclaration(secret, pass, maria.id, await signing("Ana Pop"), at(22)))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["typedName"],
    });
    expect(await db.select().from(declarationAcceptances)).toHaveLength(1);

    const second = await consumeAndSignFamilyDeclaration(secret, pass, maria.id, await signing("Maria Pop"), at(23));
    expect(second).toMatchObject({ ok: true, registration: { id: maria.id, status: "CONFIRMED" } });
    pass = passOf({ ana, maria, ion }, [ana.id, maria.id]);
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

  it("a person who signed from their own link before the wizard began is a step shown as signed, counted in «din M» (found in review)", async () => {
    const { event, ana, maria } = await family();
    // Maria signs alone, from her own email, before anybody opens a wizard.
    const own = await declarationLink(maria.id, at(20));
    expect(await consumeAndSignDeclaration(own.secret, await signing("Maria Pop"), at(21))).toMatchObject({ ok: true });

    const rows = await listFamilySigningRows(db, ana.participantId, event.id);
    expect(rows.find((row) => row.id === maria.id)?.declared).toBe(true);
    expect(rows.find((row) => row.id === ana.id)?.declared).toBe(false);
    // Ana's link opened afterwards: Maria is on the list, signed, and the count is three.
    const steps = familySigningSteps(rows, { originId: ana.id, originSignable: true, signedIds: [] });
    expect(steps.map((step) => [step.registeredName, step.state])).toEqual([
      ["Ana Pop", "current"],
      ["Maria Pop", "signed"],
      ["Ion Pop", "next"],
    ]);
  });

  it("a family walks the spent link's page more often than its ten attempts an hour: the pass is never charged", async () => {
    const { ana, maria, ion } = await family();
    const { secret } = await declarationLink(ana.id, at(20));
    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(21));
    // The link's allowance spent by the pages of a large family (§19.4: ten an hour).
    for (let attempt = 0; attempt < 12; attempt++) await tokenAttemptAllowed(db, secret, at(22));
    expect(await tokenAttemptAllowed(db, secret, at(22))).toBe(false);

    const signed = await consumeAndSignFamilyDeclaration(secret, passOf({ ana, maria, ion }, [ana.id]), maria.id, await signing("Maria Pop"), at(23));
    expect(signed).toMatchObject({ ok: true, registration: { id: maria.id, status: "CONFIRMED" } });
  });

  it("the pass alone, the link alone, or a pass beside another link signs nobody", async () => {
    const { event, ana, maria, ion } = await family();
    const { secret } = await declarationLink(ana.id, at(20));
    const pass = passOf({ ana, maria, ion }, [ana.id]);

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
    const { event, ana, maria, ion } = await family();
    await submitRegistration(db, event, submission("Vecina", at(30), { lastName: "Străină", email: "vecina@example.ro" }), at(30));
    const vecina = (await rowsOf(event.id)).find((row) => row.registeredName === "Vecina Străină")!;
    await confirmEmail(db, event, vecina.id, at(31));

    const { secret } = await declarationLink(ana.id, at(32));
    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(33));
    const pass = passOf({ ana, maria, ion }, [ana.id]);

    expect(await consumeAndSignFamilyDeclaration(secret, pass, ana.id, await signing("Ana Pop"), at(34))).toMatchObject({ ok: false });
    expect(await consumeAndSignFamilyDeclaration(secret, pass, vecina.id, await signing("Vecina Străină"), at(34))).toMatchObject({ ok: false });
    const neighbour = (await rowsOf(event.id)).find((row) => row.id === vecina.id)!;
    expect(neighbour.status).toBe("PENDING_DECLARATION");
  });

  it("a person the wizard signed is closed: their own emailed link no longer signs, and says so rather than dying", async () => {
    const { ana, maria, ion } = await family();
    const anaLink = await declarationLink(ana.id, at(20));
    const mariaLink = await declarationLink(maria.id, at(20));
    await consumeAndSignDeclaration(anaLink.secret, await signing("Ana Pop"), at(21));
    await consumeAndSignFamilyDeclaration(anaLink.secret, passOf({ ana, maria, ion }, [ana.id]), maria.id, await signing("Maria Pop"), at(22));

    // Maria's own link is still a live token on a confirmed registration: the page reads the state
    // (§420), and a press is a conflict that records nothing.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, maria.id));
    expect(token.usedAt).toBeNull();
    expect(await refusal(consumeAndSignDeclaration(mariaLink.secret, await signing("Maria Pop"), at(23)))).toMatchObject({ code: "CONFLICT" });
    expect((await db.select().from(declarationAcceptances)).filter((row) => row.registrationId === maria.id)).toHaveLength(1);
  });
});

/**
 * The brief's scenario (§471, found in review): Ana (A), Maria (B) and Ionuț (C), a minor whose
 * parent is Ana, on one address. The wizard is entered from B's link; the steps are B, A, C; B is
 * signed, A is put off with «Semnez mai târziu», C is signed with the parent's and the minor's
 * parts (§330). Two acceptances, two confirmations, two numbers — and A's own link still signs A.
 */
describe("§471 the brief's scenario: entered from B, A put off, the minor signed by two", () => {
  async function familyWithMinor() {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const [ana] = await rowsOf(event.id);
    await confirmEmail(db, event, ana.id, at(1));
    await addPerson(event, "Maria", 5);
    await addPerson(event, "Ionut", 10, { guardianName: "Ana Pop" });
    const [a, b, c] = await rowsOf(event.id);
    expect([a, b, c].map((row) => [row.registeredName, row.status, row.guardianName])).toEqual([
      ["Ana Pop", "PENDING_DECLARATION", null],
      ["Maria Pop", "PENDING_DECLARATION", null],
      ["Ionut Pop", "PENDING_DECLARATION", "Ana Pop"],
    ]);
    return { event, a, b, c };
  }

  it("B, A, C in that order; B signed, A later, C signed by parent and minor; A's own link signs A afterwards", async () => {
    const { event, a, b, c } = await familyWithMinor();
    const bLink = await declarationLink(b.id, at(20));
    const aLink = await declarationLink(a.id, at(20));

    // The page B's link opens: B first, then the others in the order they registered.
    const opened = familySigningSteps(await listFamilySigningRows(db, b.participantId, event.id), {
      originId: b.id,
      originSignable: true,
      signedIds: [],
    });
    expect(opened.map((step) => [step.registeredName, step.state])).toEqual([
      ["Maria Pop", "current"],
      ["Ana Pop", "next"],
      ["Ionut Pop", "next"],
    ]);

    // B signs from her link; the action then issues the pass over the three, fixed now.
    expect(await consumeAndSignDeclaration(bLink.secret, await signing("Maria Pop"), at(21))).toMatchObject({ ok: true });
    let { pass, steps } = await nextFamilyPass(
      db,
      { binding: "link", participantId: b.participantId, eventId: event.id, originId: b.id, eligibleIds: opened.map((step) => step.id), signedIds: [b.id], skippedIds: [] },
      at(21),
    );
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      [b.id, "signed"],
      [a.id, "current"],
      [c.id, "next"],
    ]);

    // «Semnez mai târziu» on A: nothing written anywhere but the pass.
    const before = await rowsOf(event.id);
    const skipped = await skipFamilyDeclaration(bLink.secret, pass, a.id, at(22));
    if (!skipped.ok) throw new Error("the skip was refused");
    ({ pass, steps } = skipped);
    expect(await rowsOf(event.id)).toEqual(before);
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      [b.id, "signed"],
      [a.id, "later"],
      [c.id, "current"],
    ]);
    // A is never current again in this pass: signing A through it is refused.
    expect(await consumeAndSignFamilyDeclaration(bLink.secret, pass, a.id, await signing("Ana Pop"), at(22))).toMatchObject({ ok: false });

    // C, the minor: the parent's signature and document, and the minor's own.
    const minor = { ...(await signing("Ana Pop")), minorTypedName: "Ionut Pop", minorIdDocument: "MP 123456" };
    expect(await consumeAndSignFamilyDeclaration(bLink.secret, pass, c.id, minor, at(23))).toMatchObject({
      ok: true,
      registration: { id: c.id, status: "CONFIRMED" },
    });
    ({ pass, steps } = await nextFamilyPass(db, { ...pass, signedIds: [...pass.signedIds, c.id] }, at(23)));
    expect(pass.done).toBe(true);
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      [b.id, "signed"],
      [a.id, "later"],
      [c.id, "signed"],
    ]);

    const acceptances = await db.select().from(declarationAcceptances).orderBy(declarationAcceptances.acceptedAt);
    expect(acceptances.map((row) => [row.registrationId, row.typedName, row.minorTypedName])).toEqual([
      [b.id, "Maria Pop", null],
      [c.id, "Ana Pop", "Ionut Pop"],
    ]);
    expect((await outbox("REGISTRATION_CONFIRMED")).map((row) => row.registrationId).sort()).toEqual([b.id, c.id].sort());
    const numbered = (await rowsOf(event.id)).filter((row) => row.status === "CONFIRMED" && (row.bibNumber ?? row.provisionalBibNumber) !== null);
    expect(numbered.map((row) => row.id).sort()).toEqual([b.id, c.id].sort());

    // A done pass signs nobody, and puts nobody off.
    expect(await consumeAndSignFamilyDeclaration(bLink.secret, pass, a.id, await signing("Ana Pop"), at(24))).toMatchObject({ ok: false });
    expect(await skipFamilyDeclaration(bLink.secret, pass, a.id, at(24))).toMatchObject({ ok: false });

    // A's own emailed link, untouched by the skip, still signs A: three acceptances.
    expect(await consumeAndSignDeclaration(aLink.secret, await signing("Ana Pop"), at(25))).toMatchObject({
      ok: true,
      registration: { id: a.id, status: "CONFIRMED" },
    });
    expect(await db.select().from(declarationAcceptances)).toHaveLength(3);
  });

  it("«Semnez mai târziu» on the opened link's own person starts the wizard without spending the link", async () => {
    const { event, a, b, c } = await familyWithMinor();
    const aLink = await declarationLink(a.id, at(20));

    const skipped = await skipFamilyDeclaration(aLink.secret, null, a.id, at(21));
    if (!skipped.ok) throw new Error("the skip was refused");
    expect(skipped.pass).toMatchObject({ binding: "link", originId: a.id, skippedIds: [a.id], signedIds: [], done: false });
    expect(skipped.steps.map((step) => [step.id, step.state])).toEqual([
      [a.id, "later"],
      [b.id, "current"],
      [c.id, "next"],
    ]);
    // The link is live — nothing spent — and the pass holds beside it only because A was put off.
    const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, a.id));
    expect(tokens.find((row) => row.purpose === "COMPLETE_DECLARATION")?.usedAt).toBeNull();
    expect(await familyPassHolds(db, aLink.secret, skipped.pass, at(21))).toBe(true);
    expect(await familyPassHolds(db, aLink.secret, { ...skipped.pass, skippedIds: [] }, at(21))).toBe(false);

    expect(await consumeAndSignFamilyDeclaration(aLink.secret, skipped.pass, b.id, await signing("Maria Pop"), at(22))).toMatchObject({ ok: true });
    // Another person's id is refused as a skip on a link that is not theirs, without a pass.
    expect(await skipFamilyDeclaration(aLink.secret, null, c.id, at(22))).toMatchObject({ ok: false });
    expect((await rowsOf(event.id)).find((row) => row.id === a.id)?.status).toBe("PENDING_DECLARATION");
  });

  it("a GET — the page's read path — records nothing, with or without the pass", async () => {
    const { event, a, b } = await familyWithMinor();
    const bLink = await declarationLink(b.id, at(20));
    await consumeAndSignDeclaration(bLink.secret, await signing("Maria Pop"), at(21));
    const { pass } = await nextFamilyPass(
      db,
      { binding: "link", participantId: b.participantId, eventId: event.id, originId: b.id, eligibleIds: (await rowsOf(event.id)).map((row) => row.id), signedIds: [b.id], skippedIds: [] },
      at(21),
    );
    const rowsBefore = await rowsOf(event.id);
    const acceptancesBefore = await db.select().from(declarationAcceptances);
    const outboxBefore = await db.select().from(emailOutbox);

    for (let view = 0; view < 3; view++) {
      await readRegistrationTokenContext(bLink.secret, "COMPLETE_DECLARATION", { charge: false });
      expect(await familyPassHolds(db, bLink.secret, pass, at(22))).toBe(true);
      expect(currentFamilyStep(await familyStepsOfPass(db, pass))?.id).toBe(a.id);
      expect(await spentLinkHasFamilyLeft(bLink.secret, at(22))).toBe(true);
    }

    expect(await rowsOf(event.id)).toEqual(rowsBefore);
    expect(await db.select().from(declarationAcceptances)).toEqual(acceptancesBefore);
    expect(await db.select().from(emailOutbox)).toEqual(outboxBefore);
  });

  it("the pass dies with the earliest hold still running, and a stranger's address never enters", async () => {
    const { event, a, b, c } = await familyWithMinor();
    const bLink = await declarationLink(b.id, at(20));
    await consumeAndSignDeclaration(bLink.secret, await signing("Maria Pop"), at(21));

    // A's hold ends in ten minutes: the pass issued now lapses then, not in thirty.
    const holdEnds = at(31);
    await db.update(registrations).set({ holdExpiresAt: holdEnds }).where(eq(registrations.id, a.id));
    const { pass } = await nextFamilyPass(
      db,
      { binding: "link", participantId: b.participantId, eventId: event.id, originId: b.id, eligibleIds: [b.id, a.id, c.id], signedIds: [b.id], skippedIds: [] },
      at(21),
    );
    expect(pass.expiresAt).toEqual(holdEnds);
    const { openFamilyPass, sealFamilyPass } = await import("@/modules/registrations/family-signing");
    const sealed = sealFamilyPass(pass, "k") as string;
    expect(openFamilyPass(sealed, at(30), "k")).not.toBeNull();
    expect(openFamilyPass(sealed, at(31), "k")).toBeNull();

    // A stranger at the same event: a pass naming her is refused, and so is signing her through it.
    await submitRegistration(db, event, submission("Vecina", at(40), { lastName: "Străină", email: "vecina@example.ro" }), at(40));
    const vecina = (await rowsOf(event.id)).find((row) => row.registeredName === "Vecina Străină")!;
    await confirmEmail(db, event, vecina.id, at(41));
    expect(await familyPassHolds(db, bLink.secret, { ...pass, eligibleIds: [...pass.eligibleIds, vecina.id] }, at(22))).toBe(false);
    expect(await consumeAndSignFamilyDeclaration(bLink.secret, pass, vecina.id, await signing("Vecina Străină"), at(22))).toMatchObject({ ok: false });
    // Nor does somebody added to the address after the pass was issued become one of its steps.
    await addPerson(event, "Ion", 45);
    const ion = (await rowsOf(event.id)).find((row) => row.registeredName === "Ion Pop")!;
    expect((await familyStepsOfPass(db, pass)).map((step) => step.id)).not.toContain(ion.id);
  });

  it("a pass with no hold behind it charges an attempt; one that holds beside this very link does not", async () => {
    const { event, a, b, c } = await familyWithMinor();
    const bLink = await declarationLink(b.id, at(20));
    const aLink = await declarationLink(a.id, at(20));
    await consumeAndSignDeclaration(bLink.secret, await signing("Maria Pop"), at(21));
    const pass: FamilySigningPass = {
      binding: "link", participantId: b.participantId, eventId: event.id, originId: b.id,
      eligibleIds: [b.id, a.id, c.id], signedIds: [b.id], skippedIds: [], done: false, expiresAt: at(50),
    };
    // Beside A's live link (not the pass's link), each press is refused and charged.
    for (let press = 0; press < 10; press++) {
      expect(await consumeAndSignFamilyDeclaration(aLink.secret, pass, a.id, await signing("Ana Pop"), at(22))).toMatchObject({ ok: false });
    }
    expect(await tokenAttemptAllowed(db, aLink.secret, at(22))).toBe(false);
  });
});

describe("§471 «Semnează declarațiile» on «Înscrierile mele» (§77)", () => {
  it("exchanges the live link on the server for a pass over the event's declarations, and signs through it", async () => {
    const { event, ana, maria, ion } = await family();
    const mine = (await issueActionToken(db, { participantId: ana.participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: at(600), now: at(20) })).secret;

    const started = await startFamilySigningFromMine(mine, event.id, at(21));
    if (!started.ok) throw new Error("the exchange was refused");
    expect(started.pass).toMatchObject({ binding: "mine", originId: null, eligibleIds: [ana.id, maria.id, ion.id], signedIds: [], done: false });
    expect(await familyPassHolds(db, mine, started.pass, at(21))).toBe(true);
    expect(currentFamilyStep(await familyStepsOfPass(db, started.pass))?.id).toBe(ana.id);

    expect(await consumeAndSignFamilyDeclaration(mine, started.pass, ana.id, await signing("Ana Pop"), at(22))).toMatchObject({
      ok: true,
      registration: { id: ana.id, status: "CONFIRMED" },
    });
    // The link was read, never spent.
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "MANAGE_PROFILE"));
    expect(token.usedAt).toBeNull();

    // Another address's «Înscrierile mele» link opens nothing here.
    await submitRegistration(db, event, submission("Vecina", at(30), { lastName: "Străină", email: "vecina@example.ro" }), at(30));
    const vecina = (await rowsOf(event.id)).find((row) => row.registeredName === "Vecina Străină")!;
    const strangers = (await issueActionToken(db, { participantId: vecina.participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: at(600), now: at(30) })).secret;
    expect(await familyPassHolds(db, strangers, started.pass, at(31))).toBe(false);
    expect(await startFamilySigningFromMine(strangers, event.id, at(31))).toMatchObject({ ok: false });
  });

  it("is refused for an event with fewer than two declarations waiting, and says which refusal it is (found in review)", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const [ana] = await rowsOf(event.id);
    await confirmEmail(db, event, ana.id, at(1));
    const mine = (await issueActionToken(db, { participantId: ana.participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: at(600), now: at(2) })).secret;
    // One person alone: their own emailed link signs them.
    expect(await startFamilySigningFromMine(mine, event.id, at(3))).toEqual({ ok: false, reason: "ONE_LEFT" });
    // Nobody left to sign (an event with nobody of this address, or a posted id that is not one).
    expect(await startFamilySigningFromMine(mine, "00000000-0000-4000-8000-000000000000", at(3))).toEqual({ ok: false, reason: "NOTHING_LEFT" });
    expect(await startFamilySigningFromMine(mine, "not-an-id", at(3))).toEqual({ ok: false, reason: "NOTHING_LEFT" });
    // A link that is not one: the page's own «link expired» notice, never a toast.
    expect(await startFamilySigningFromMine("A".repeat(43), event.id, at(3))).toEqual({ ok: false, reason: "LINK" });
  });
});
