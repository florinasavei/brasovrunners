import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { confirmEmail, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-02 criterion 15, §314 — the signature is the declarant's name, and a signature that
 * is not is refused where the acceptance is written, with nothing recorded and the link unspent.
 *
 * Through `consumeAndSignDeclaration`, the function the declaration page's action calls, because
 * the property that matters is the transaction boundary: the token spend and the signature are
 * one transaction, so a refused name must leave the token exactly as live as it was — the same
 * link signs with the right name a moment later — and must leave no acceptance behind.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

// A getter, resolved when the module under test calls it (`spent-link-page.test.ts` does the same).
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { consumeAndSignDeclaration } = await import("@/modules/registrations/token-actions");

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

async function createEvent(capacity = 10): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: "crosul-aniversar" },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: "anniversary-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: event.registrationMode, registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (overrides: Record<string, unknown>) => ({
  firstName: "Florin",
  lastName: "Munca",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "florin@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  ...overrides,
});

/** A registration waiting for its declaration, and the link the email would have carried. */
async function awaitingDeclaration(event: EventForRegistration, overrides: Record<string, unknown> = {}) {
  await submitRegistration(db, event, submission(overrides), NOW);
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
  await confirmEmail(db, event, row.id, NOW);
  const { secret } = await issueActionToken(db, {
    participantId: row.participantId,
    registrationId: row.id,
    purpose: "COMPLETE_DECLARATION",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    now: NOW,
  });
  return { row, secret };
}

/** What the page posts, with the version it rendered. */
async function signing(typedName: string) {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
  return { accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 };
}

/** The refusal, as the action sees it: a VALIDATION_ERROR that names the field and nothing else. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
  throw new Error("the signature was accepted");
}

async function state(registrationId: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
  const acceptances = await db.select().from(declarationAcceptances);
  const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
  return { status: row.status, acceptances: acceptances.length, spent: tokens.filter((t) => t.usedAt !== null).length, live: tokens.filter((t) => t.usedAt === null && t.invalidatedAt === null).length };
}

describe("BR-REQ-033-02 §314 a signature that is not the declarant's name", () => {
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("is refused with nothing recorded and the link unspent, and the same link then signs with the right name", async () => {
    await approve();
    const event = await createEvent();
    const { row, secret } = await awaitingDeclaration(event);
    expect(row.registeredName).toBe("Florin Munca");

    // The signature the owner saw.
    expect(await refusal(consumeAndSignDeclaration(secret, await signing("Florin Munca2"), NOW))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["typedName"],
    });
    expect(await state(row.id)).toEqual({ status: "PENDING_DECLARATION", acceptances: 0, spent: 0, live: 1 });

    // The names in the other order, and a blank one: each its own refusal of the same field.
    expect((await refusal(consumeAndSignDeclaration(secret, await signing("Munca Florin"), NOW))).fields).toEqual(["typedName"]);
    expect((await refusal(consumeAndSignDeclaration(secret, await signing("   "), NOW))).fields).toEqual(["typedName"]);
    expect(await state(row.id)).toEqual({ status: "PENDING_DECLARATION", acceptances: 0, spent: 0, live: 1 });

    // The right name, as a phone types it: lower case, a stray space. Signed, from the same link.
    const signed = await consumeAndSignDeclaration(secret, await signing("florin  munca "), NOW);
    expect(signed.ok).toBe(true);
    expect(await state(row.id)).toEqual({ status: "CONFIRMED", acceptances: 1, spent: 1, live: 0 });

    // What is recorded is what was typed (trimmed, as every typed name is): the rule decides
    // acceptance, it never rewrites the signature into the registered spelling.
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance.typedName).toBe("florin  munca");
  });

  /**
   * §NNN — a minor's declaration is signed by two at one press: the minor, with the name they
   * were registered under and their own document, and the parent or guardian, with theirs (the
   * owner: "I wanna have the ID document of the minor and the parent, and also 2 signatures!").
   * Each wrong or missing piece is refused on its own field, before anything moves, with nothing
   * recorded and the link as live as it was.
   */
  it("wants both signatures and both documents for a minor, and refuses each wrong one on its own field", async () => {
    await approve();
    const event = await createEvent();
    const { row, secret } = await awaitingDeclaration(event, {
      firstName: "Maria",
      lastName: "Popescu",
      // Fifteen on the race day: a minor, over the minimum age of fourteen (§321).
      birthDate: "2011-03-02",
      email: "maria@example.ro",
      guardianName: "Ion Popescu",
    });
    expect(row.guardianName).toBe("Ion Popescu");
    const both = async (overrides: Partial<{ typedName: string; idDocument: string; minorTypedName: string; minorIdDocument: string }>) => ({
      ...(await signing("Ion Popescu")),
      idDocument: "BV 654321",
      minorTypedName: "Maria Popescu",
      minorIdDocument: "MP 123456",
      ...overrides,
    });
    const untouched = { status: "PENDING_DECLARATION", acceptances: 0, spent: 0, live: 1 };

    // The parent's signature alone, as a minor's declaration was signed before: the minor's box is missing.
    expect(await refusal(consumeAndSignDeclaration(secret, await signing("Ion Popescu"), NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["minorTypedName"] });
    // The child's own name in the parent's box: the parent signs as the declarant (§108).
    expect(await refusal(consumeAndSignDeclaration(secret, await both({ typedName: "Maria Popescu" }), NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["typedName"] });
    // The parent's name in the minor's box.
    expect(await refusal(consumeAndSignDeclaration(secret, await both({ minorTypedName: "Ion Popescu" }), NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["minorTypedName"] });
    // Both wrong: both named at once, the minor's first, as the page shows them.
    expect(await refusal(consumeAndSignDeclaration(secret, await both({ typedName: "Ion Popescu2", minorTypedName: "   " }), NOW))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["minorTypedName", "typedName"],
    });
    // The documents: each missing one named, each malformed one refused on its own box.
    expect(await refusal(consumeAndSignDeclaration(secret, await both({ minorIdDocument: undefined }), NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["minorIdDocument"] });
    expect(await refusal(consumeAndSignDeclaration(secret, await both({ idDocument: undefined }), NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["idDocument"] });
    expect(await refusal(consumeAndSignDeclaration(secret, await both({ minorIdDocument: "!!" }), NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["minorIdDocument"] });
    expect(await state(row.id)).toEqual(untouched);

    // Both names as a phone types them, both documents: signed, from the same link.
    const signed = await consumeAndSignDeclaration(secret, await both({ typedName: "ION POPESCU", minorTypedName: "maria popescu" }), NOW);
    expect(signed.ok).toBe(true);
    expect(await state(row.id)).toEqual({ status: "CONFIRMED", acceptances: 1, spent: 1, live: 0 });
    const [acceptance] = await db.select().from(declarationAcceptances);
    // What was typed, each in its own column: the declarant's (the parent's) where it always was.
    expect(acceptance).toMatchObject({ typedName: "ION POPESCU", idDocument: "BV 654321", minorTypedName: "maria popescu", minorIdDocument: "MP 123456" });
  });

  it("asks an adult for one signature and one document, exactly as before, and ignores a minor's boxes", async () => {
    await approve();
    const event = await createEvent();
    const { secret } = await awaitingDeclaration(event);
    // A post that carries the minor's boxes too (a hand-made one): an adult has no second signer.
    const signed = await consumeAndSignDeclaration(secret, { ...(await signing("Florin Munca")), minorTypedName: "Somebody", minorIdDocument: "XX 999999" }, NOW);
    expect(signed.ok).toBe(true);
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance).toMatchObject({ typedName: "Florin Munca", idDocument: "BV 123456", minorTypedName: null, minorIdDocument: null });
  });

  /*
    Found in review: the name used to be checked after the hold expiry and the re-allocation, and
    a lapsed hold that re-allocates to the waiting list returns early — so a wrong name there was
    never checked, and the early return committed the token spend and the move to the queue. The
    check now comes before either: a refused name never reaches the allocator.
  */
  it("refuses a wrong name on a lapsed hold before the allocator runs, and the link still works", async () => {
    await approve();
    const event = await createEvent(1);
    const { row, secret } = await awaitingDeclaration(event);

    // The one place is held; the next person, a minute later, waits for it.
    await submitRegistration(db, event, submission({ firstName: "Ana", lastName: "Pop", email: "ana@example.ro" }), NOW);
    const [waiting] = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).filter((r) => r.id !== row.id);
    expect((await confirmEmail(db, event, waiting.id, new Date(NOW.getTime() + 60_000))).status).toBe("WAITLISTED");

    // Past the thirty minutes, with somebody waiting: the hold is one the signing would release.
    const lapsed = new Date(NOW.getTime() + 31 * 60_000);
    expect(await refusal(consumeAndSignDeclaration(secret, await signing("Florin Munca2"), lapsed))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["typedName"],
    });
    // Nothing moved: the hold not released, the queue untouched, the link unspent.
    expect(await state(row.id)).toEqual({ status: "PENDING_DECLARATION", acceptances: 0, spent: 0, live: 1 });
    const [stillWaiting] = await db.select().from(registrations).where(eq(registrations.id, waiting.id));
    expect(stillWaiting.status).toBe("WAITLISTED");

    // The same link with the right name reaches the allocator, which does what it always did
    // with a hold that lapsed while somebody waited: the place is offered on, this one queues.
    const signed = await consumeAndSignDeclaration(secret, await signing("Florin Munca"), lapsed);
    expect(signed.ok).toBe(true);
    expect(await state(row.id)).toEqual({ status: "WAITLISTED", acceptances: 0, spent: 1, live: 0 });
  });

  it("forgives the diacritics a phone keyboard leaves out", async () => {
    await approve();
    const event = await createEvent();
    const { row, secret } = await awaitingDeclaration(event, { firstName: "Ștefan", lastName: "Tănase", email: "stefan@example.ro" });
    expect(row.registeredName).toBe("Ștefan Tănase");

    const signed = await consumeAndSignDeclaration(secret, await signing("Stefan Tanase"), NOW);
    expect(signed.ok).toBe(true);
  });
});
