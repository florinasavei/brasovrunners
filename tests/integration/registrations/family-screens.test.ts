import { and, eq, sql } from "drizzle-orm";
import type { ReactElement, ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { staffUsers } from "@/db/schema/staff-users";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { familyStepWordsKey } from "@/modules/registrations/domain/family-signing";
import { issueActionToken } from "@/modules/action-tokens/repository";
import type { FamilySigningPass } from "@/modules/registrations/family-signing";
import { isDomainError } from "@/shared/errors/domain-error";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §547 — the family's screens after the owner's walk on QA (2026-09-28, 17:45–18:00), amending §471
 * and §77 (BR-REQ-036-01, BR-REQ-036-04, BR-REQ-033-02, BR-REQ-034-01):
 *
 * - «Renunț la înscrierea pentru <nume>» in the declarations wizard cancels that person through the
 *   allocator — the place released, the audit row, the cancellation email — and the wizard goes on;
 * - «Gestionează înscrierea» lists the address's people at the event, each with their own QR, name,
 *   number, list choice and cancel, and never the signed declaration's PDF; a press names a person,
 *   and the server accepts only the same address at the same event (§39);
 * - every cancellation by its owner queues one email naming the person, the event, the place
 *   released and who the address still holds.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const EMAIL = "familia.pop@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;
/** The language the pages are rendered in: Română unless a test asks for English (§1016 renders both). */
let intlLocale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The manage page, rendered with the real catalogues, in the language the test names.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) => createTranslator({ locale: intlLocale, messages: intlLocale === "ro" ? ro : en, namespace: namespace as "Registrations" }),
    getLocale: async () => intlLocale,
    setRequestLocale: () => {},
  };
});
// «Înscrierile mele»'s toast slot reads the request's cookies: none here.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});

const { submitRegistration, confirmEmail, readPublicAvailability } = await import("@/modules/registrations/service");
const { confirmFamilyEntry } = await import("@/modules/registrations/family-confirm");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { familyPassHolds, nextFamilyPass } = await import("@/modules/registrations/family-signing");
const { consumeAndCancel, consumeAndSignDeclaration, consumeAndSignFamilyDeclaration, readRaceDayContext, withdrawFromFamilyWizard } = await import(
  "@/modules/registrations/token-actions"
);
const { setListConsentFromManageLink } = await import("@/modules/registrations/list-consent");
const { confirmRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");
const { default: MyRegistrationsPage } = await import("@/app/[locale]/registrations/mine/[token]/page");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  // The token pages read their own clock; the test's instants are the clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  intlLocale = "ro";
  await resetTables(db);
  await approve();
});
afterEach(() => {
  vi.useRealTimers();
});

async function approve() {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationTrailRo },
    { locale: "en", title: "Declaration", body: declarationTrailEn },
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
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
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
  return rows.filter((row) => row.messageType === type && row.participantId !== null);
}

async function render(row: Awaited<ReturnType<typeof outbox>>[number], now: Date) {
  return renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: now }, db, now);
}

async function addPerson(event: EventInput, firstName: string, minute: number) {
  vi.setSystemTime(at(minute));
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

async function declarationLink(registrationId: string, now: Date) {
  const request = (await outbox("COMPLETE_DECLARATION")).filter((row) => row.registrationId === registrationId).at(-1)!;
  const message = await render(request, now);
  const secret = /\/inregistrari\/declaratie\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
  if (!secret) throw new Error("the email carried no declaration link");
  return secret;
}

async function signing(typedName: string) {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
  return { accepted: true, typedName, idDocument: "BV 123456", documentId: document!.id, contentSha256: document!.contentSha256 };
}

const passOf = (people: { ana: { id: string; participantId: string; eventId: string }; maria: { id: string }; ion: { id: string } }, signedIds: string[]): FamilySigningPass => ({
  binding: "link",
  participantId: people.ana.participantId,
  eventId: people.ana.eventId,
  originId: people.ana.id,
  eligibleIds: [people.ana.id, people.maria.id, people.ion.id],
  signedIds,
  skippedIds: [],
  done: false,
  expiresAt: at(90),
});

async function auditOf(registrationId: string) {
  return db
    .select({ action: auditLogs.action, actor: auditLogs.actorStaffUserId, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "registration"), eq(auditLogs.entityId, registrationId)));
}

async function thrown(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "no error";
}

describe("§547 «Renunț la înscrierea pentru <nume>» in the declarations wizard", () => {
  it("cancels the step's person through the allocator — place released, audit row, one email — and goes on to the next", async () => {
    const { event, ana, maria, ion } = await family();
    vi.setSystemTime(at(20));
    const secret = await declarationLink(ana.id, at(20));
    vi.setSystemTime(at(21));
    expect(await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(21))).toMatchObject({ ok: true });
    const { pass } = await nextFamilyPass(db, { ...passOf({ ana, maria, ion }, [ana.id]) }, at(21));
    const before = await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(22));

    // Only the current step: Ion is next, not current, and Ana is signed.
    vi.setSystemTime(at(22));
    expect(await withdrawFromFamilyWizard(secret, pass, ion.id, at(22), { kind: "OTHER_PLANS", text: null })).toMatchObject({ ok: false });
    expect(await withdrawFromFamilyWizard(secret, pass, ana.id, at(22), { kind: "OTHER_PLANS", text: null })).toMatchObject({ ok: false });
    expect(await withdrawFromFamilyWizard(secret, pass, "not-an-id", at(22), { kind: "OTHER_PLANS", text: null })).toMatchObject({ ok: false });

    const withdrawn = await withdrawFromFamilyWizard(secret, pass, maria.id, at(22), { kind: "INJURY_OR_ILLNESS", text: null });
    if (!withdrawn.ok) throw new Error("the withdrawal was refused");
    // The next step is reached: Maria is listed as cancelled, Ion is current.
    expect(withdrawn.steps.map((step) => [step.registeredName, step.state, familyStepWordsKey(step)])).toEqual([
      ["Ana Pop", "signed", "signed"],
      ["Maria Pop", "closed", "cancelled"],
      ["Ion Pop", "current", "current"],
    ]);
    expect(withdrawn.pass.done).toBe(false);

    const rows = await rowsOf(event.id);
    expect(rows.map((row) => [row.registeredName, row.status])).toEqual([
      ["Ana Pop", "CONFIRMED"],
      ["Maria Pop", "CANCELLED"],
      ["Ion Pop", "PENDING_DECLARATION"],
    ]);
    expect(rows[1].cancellationSource).toBe("PARTICIPANT");
    // Why (§558): the wizard asks as every door does, and the row keeps the answer.
    expect([rows[1].cancelReasonKind, rows[1].cancelReason]).toEqual(["INJURY_OR_ILLNESS", null]);
    // The place went back through the allocator: one more free place.
    expect(await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(22))).toBe((before ?? 0) + 1);
    // The audit row: no staff actor, the state it left and the door, never a name.
    expect(await auditOf(maria.id)).toEqual([
      { action: "registration.cancelled_by_participant", actor: null, metadata: { from: "PENDING_DECLARATION", via: "FAMILY_WIZARD", reasonKind: "INJURY_OR_ILLNESS" } },
    ]);

    // One email for Maria, naming her, the event, the place released and who the address still holds.
    const [cancelled] = (await outbox("REGISTRATION_CANCELLED")).filter((row) => row.registrationId === maria.id);
    expect(cancelled.payloadJson).toEqual({ previousStatus: "PENDING_DECLARATION" });
    const message = await render(cancelled, at(23));
    expect(message.subject).toContain("Înscrierea pentru Maria Pop la Crosul familiei a fost anulată");
    expect(message.text).toContain("Locul a fost eliberat.");
    expect(message.text).toContain("Pe această adresă rămân înscriși: Ana P. (confirmat), Ion P. (semnează declarația).");
    expect(message.text).toContain("The registration for Maria Pop at The family cross");

    // The last person: withdrawn too, the wizard ends.
    const last = await withdrawFromFamilyWizard(secret, withdrawn.pass, ion.id, at(24), { kind: "OTHER_PLANS", text: null });
    if (!last.ok) throw new Error("the last withdrawal was refused");
    expect(last.pass.done).toBe(true);
    expect((await rowsOf(event.id)).map((row) => row.status)).toEqual(["CONFIRMED", "CANCELLED", "CANCELLED"]);
    expect((await outbox("REGISTRATION_CANCELLED")).map((row) => row.registrationId).sort()).toEqual([maria.id, ion.id].sort());
  });

  it("on the opened link's own person, before any signature, starts the wizard with them withdrawn and the link not spent", async () => {
    const { event, ana, maria } = await family();
    vi.setSystemTime(at(20));
    const secret = await declarationLink(ana.id, at(20));
    vi.setSystemTime(at(21));
    // A person the link does not name, or the address's next one, is not the link's to withdraw.
    expect(await withdrawFromFamilyWizard(secret, null, maria.id, at(21), { kind: "OTHER_PLANS", text: null })).toMatchObject({ ok: false });

    const withdrawn = await withdrawFromFamilyWizard(secret, null, ana.id, at(21), { kind: "OTHER_PLANS", text: null });
    if (!withdrawn.ok) throw new Error("the withdrawal was refused");
    expect(withdrawn.pass).toMatchObject({ binding: "link", originId: ana.id, skippedIds: [ana.id], signedIds: [], done: false });
    expect(withdrawn.steps.map((step) => [step.registeredName, familyStepWordsKey(step)])).toEqual([
      ["Ana Pop", "cancelled"],
      ["Maria Pop", "current"],
      ["Ion Pop", "next"],
    ]);
    expect((await rowsOf(event.id))[0].status).toBe("CANCELLED");
    const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, ana.id));
    expect(tokens.find((row) => row.purpose === "COMPLETE_DECLARATION")?.usedAt).toBeNull();
    // The pass walks on beside the live link, and signs Maria.
    expect(await familyPassHolds(db, secret, withdrawn.pass, at(22))).toBe(true);
    vi.setSystemTime(at(22));
    expect(await consumeAndSignFamilyDeclaration(secret, withdrawn.pass, maria.id, await signing("Maria Pop"), at(22))).toMatchObject({
      ok: true,
      registration: { id: maria.id, status: "CONFIRMED" },
    });
  });
});

describe("§547 «Gestionează înscrierea» per person, and safe", () => {
  /** The family of three, every declaration signed through the wizard: three confirmed, three QR codes. */
  async function confirmedFamily() {
    const people = await family();
    const { event, ana, maria, ion } = people;
    vi.setSystemTime(at(20));
    const secret = await declarationLink(ana.id, at(20));
    vi.setSystemTime(at(21));
    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(21));
    await consumeAndSignFamilyDeclaration(secret, passOf(people, [ana.id]), maria.id, await signing("Maria Pop"), at(22));
    await consumeAndSignFamilyDeclaration(secret, passOf(people, [ana.id, maria.id]), ion.id, await signing("Ion Pop"), at(23));
    // A neighbour at the same event, on another address: never on this page.
    vi.setSystemTime(at(24));
    await submitRegistration(db, event, submission("Vecina", at(24), { lastName: "Străină", email: "vecina@example.ro" }), at(24));
    const vecina = (await rowsOf(event.id)).find((row) => row.registeredName === "Vecina Străină")!;
    const manage = await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(60 * 24 * 7), now: at(25) });
    vi.setSystemTime(at(26));
    return { ...people, vecina, secret: manage.secret };
  }

  async function page(token: string, searchParams: Record<string, string> = {}) {
    const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token }), searchParams: Promise.resolve(searchParams) })) as ReactElement;
    return renderToStaticMarkup(element).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  }

  it("lists every person on the address at the event with their own QR, name and number, and no PDF link", async () => {
    const { ana, maria, ion, secret } = await confirmedFamily();
    const context = await readRaceDayContext(secret, at(26));
    if (!context.ok) throw new Error("the manage link was refused");
    expect(context.people.map((person) => [person.registeredName, person.status, person.own])).toEqual([
      ["Ana Pop", "CONFIRMED", true],
      ["Maria Pop", "CONFIRMED", false],
      ["Ion Pop", "CONFIRMED", false],
    ]);

    const html = await page(secret);
    expect(html.match(/data-testid="manage-person"/g)).toHaveLength(3);
    expect(html.match(/data-testid="qr-with-name"/g)).toHaveLength(3);
    for (const row of [ana, maria, ion]) {
      const fresh = (await db.select().from(registrations).where(eq(registrations.id, row.id)))[0];
      expect(html).toContain(`/api/registrations/qr/${fresh.checkinCode}.png`);
      expect(html).toContain(`Anulează înscrierea pentru ${row.registeredName}`);
      // The registration's own race number beside its QR, «—» before one — never «provizoriu».
      expect(html).toContain(`Număr de concurs: ${fresh.bibNumber ?? "—"}`);
    }
    expect(html).toContain("Înscrierile de pe această adresă");
    // The signed declaration only in the email that delivered it: no link to the PDF on this page.
    expect(html).not.toContain("/api/registrations/declaration/");
    expect(html).not.toContain("provizoriu");
    expect(html).toContain("Declarația semnată ți-a fost trimisă pe email.");
    // Nothing about another address (§39).
    expect(html).not.toContain("Vecina");
  });

  it("sets one person's list choice and cancels one person, with their email — never another address's registration", async () => {
    const { event, ana, maria, ion, vecina, secret } = await confirmedFamily();

    // Another adult registered on the address keeps off the list until they say otherwise (§421): Maria says so, Ion does not.
    const listedBefore = await rowsOf(event.id);
    expect(listedBefore.find((row) => row.id === maria.id)?.listOptOut).toBe(true);
    expect(await setListConsentFromManageLink(db, secret, true, at(27), maria.id)).toMatchObject({ ok: true, listed: true, changed: true });
    const rows = await rowsOf(event.id);
    expect(rows.find((row) => row.id === maria.id)?.listOptOut).toBe(false);
    expect(rows.find((row) => row.id === ion.id)?.listOptOut).toBe(listedBefore.find((row) => row.id === ion.id)?.listOptOut);
    expect(rows.find((row) => row.id === ana.id)?.listOptOut).toBe(false);
    // A registration id is not a secret: another address's is refused, and so is its cancel.
    expect(await thrown(setListConsentFromManageLink(db, secret, false, at(27), vecina.id))).toBe("NOT_FOUND");
    expect(await thrown(consumeAndCancel(secret, at(27), { kind: "OTHER_PLANS", text: null }, vecina.id))).toBe("NOT_FOUND");
    expect((await rowsOf(event.id)).find((row) => row.id === vecina.id)?.status).not.toBe("CANCELLED");
    // …and the refusal spent nothing: the link still reads.
    expect((await readRaceDayContext(secret, at(27))).ok).toBe(true);

    const before = await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(28));
    const cancelled = await consumeAndCancel(secret, at(28), { kind: "OTHER", text: "Nunta fratelui" }, maria.id);
    expect(cancelled).toMatchObject({ ok: true, family: true, registration: { id: maria.id, status: "CANCELLED" } });
    const after = await rowsOf(event.id);
    expect(after.find((row) => row.id === maria.id)?.status).toBe("CANCELLED");
    expect(after.find((row) => row.id === ana.id)?.status).toBe("CONFIRMED");
    expect(await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(28))).toBe((before ?? 0) + 1);
    expect(await auditOf(maria.id)).toContainEqual({ action: "registration.cancelled_by_participant", actor: null, metadata: { from: "CONFIRMED", via: "MANAGE_LINK", reasonKind: "OTHER" } });
    // The answer and the words on the row (§558); the audit row keeps the answer alone, never the words.
    expect(after.find((row) => row.id === maria.id)).toMatchObject({ cancelReasonKind: "OTHER", cancelReason: "Nunta fratelui" });
    expect(JSON.stringify(await auditOf(maria.id))).not.toContain("Nunta");

    const [email] = (await outbox("REGISTRATION_CANCELLED")).filter((row) => row.registrationId === maria.id);
    const message = await render(email, at(29));
    expect(message.subject).toContain("Înscrierea pentru Maria Pop la Crosul familiei a fost anulată");
    expect(message.text).toContain("Pe această adresă rămân înscriși: Ana P. (confirmat), Ion P. (confirmat).");
    expect(message.text).not.toContain("Vecina");
    // The participant's own copy says nothing of the reason — the club's copy quotes it (§558).
    expect(message.text).not.toContain("Motivul anulării");
    const clubCopy = await render({ ...email, participantId: null, payloadJson: { ...(email.payloadJson as object), clubCopy: true } }, at(29));
    expect(clubCopy.text).toContain("Motivul anulării: Alt motiv — „Nunta fratelui”.");
    expect(clubCopy.text).toContain("Cancellation reason: Another reason — “Nunta fratelui”.");

    // The cancel spent the link (§12.8), as «Înscrierile mele» spends its own.
    expect((await readRaceDayContext(secret, at(29))).ok).toBe(false);
  });

  it("refuses a sibling already cancelled without spending the link — no false «Gata» from a stale page", async () => {
    const { event, maria, secret } = await confirmedFamily();
    await db.update(registrations).set({ status: "CANCELLED" }).where(eq(registrations.id, maria.id));
    expect(await thrown(consumeAndCancel(secret, at(27), { kind: "OTHER_PLANS", text: null }, maria.id))).toBe("NOT_FOUND");
    expect((await auditOf(maria.id)).some((row) => row.action === "registration.cancelled_by_participant")).toBe(false);
    expect((await rowsOf(event.id)).find((row) => row.id === maria.id)?.status).toBe("CANCELLED");
    expect((await readRaceDayContext(secret, at(27))).ok).toBe(true);
  });

  it("says per person how the declaration was accepted — sent by email, signed on paper at the desk, or nothing yet (§553)", async () => {
    const people = await family();
    const { ana, maria, ion } = people;
    // Ana signs online, from the link; Maria signs the paper form at the desk; Ion has signed nothing.
    vi.setSystemTime(at(20));
    const secret = await declarationLink(ana.id, at(20));
    vi.setSystemTime(at(21));
    await consumeAndSignDeclaration(secret, await signing("Ana Pop"), at(21));
    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    expect((await confirmRegistrationByStaff(db, volunteer, maria.id, at(22))).status).toBe("CONFIRMED");
    const [paper] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, maria.id));
    expect(paper).toMatchObject({ method: "PAPER", attestedByStaffUserId: volunteer.id });

    const manage = await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(60 * 24 * 7), now: at(23) });
    vi.setSystemTime(at(24));
    const html = await page(manage.secret);
    const cards = html.split('data-testid="manage-person"').slice(1);
    expect(cards).toHaveLength(3);
    const card = (name: string) => cards.find((text) => text.includes(`Anulează înscrierea pentru ${name}`)) ?? "";
    expect(card(ana.registeredName)).toContain('data-testid="manage-declaration-sent"');
    expect(card(ana.registeredName)).not.toContain('data-testid="manage-declaration-paper"');
    expect(card(maria.registeredName)).toContain('data-testid="manage-declaration-paper"');
    expect(card(maria.registeredName)).toContain("Declarația a fost semnată pe hârtie.");
    // A paper declaration had no email: the page never says one was sent.
    expect(card(maria.registeredName)).not.toContain('data-testid="manage-declaration-sent"');
    expect(card(ion.registeredName)).not.toMatch(/data-testid="manage-declaration-(sent|paper)"/);
    expect(html.match(/Declarația semnată ți-a fost trimisă pe email\./g)).toHaveLength(1);
    expect(html.match(/Declarația a fost semnată pe hârtie\./g)).toHaveLength(1);
  });

  it("keeps a one-person page for a single registration", async () => {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Vecina", NOW, { lastName: "Singură", email: "singura@example.ro" }), NOW);
    const [alone] = await rowsOf(event.id);
    const manage = await issueActionToken(db, { participantId: alone.participantId, registrationId: alone.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(60 * 24), now: NOW });
    const html = await page(manage.secret);
    expect(html.match(/data-testid="manage-person"/g)).toHaveLength(1);
    expect(html).not.toContain("Înscrierile de pe această adresă");
    expect(html).toContain("Anulează înscrierea pentru Vecina Singură");
  });
});

/**
 * §1016, BR-REQ-039-01 — «Lista publică și clasamentul»: the public-list choice in a clearly marked block of its own, for every
 * registration on «Gestionează înscrierea» — a family's page too — and on «Înscrierile mele», in both languages. A heading on
 * every registration, the state in bold beside the eye (open when shown, crossed when not), the sentence off the list naming the
 * label the public list prints instead («Participant (nume ascuns)», read from `Event.startList`), and one contained button,
 * the same in both states; placed right under the state, the number and the QR, before the declaration line and the rest.
 */
describe("§1016 «Lista publică și clasamentul», a block of its own on every registration", () => {
  type Locale = "ro" | "en";
  const LOCALES: Locale[] = ["ro", "en"];

  /** A text as React writes it between tags. */
  const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const words = (locale: Locale) => catalogueOf(locale).Registrations.list;
  /** The sentence off the list, the public list's own label in it — never typed here or in the page. */
  const offTheList = (locale: Locale) => words(locale).choice.notListedCountedWithResults.replace("{anonymous}", catalogueOf(locale).Event.startList.anonymous);

  /** The event's public list switched on (`NAMES`): only there is a confirmed person off it a «Participant (nume ascuns)» row (§186). */
  async function showList(eventId: string, shown = true) {
    await db.update(events).set({ participantListVisibility: shown ? "NAMES" : "HIDDEN" }).where(eq(events.id, eventId));
  }

  /** A privacy notice that describes the results, in force from before the registrations: the results print a listed name. */
  async function approveResultsNotice() {
    const privacy: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["Clasamentul: {{results}}"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["The results: {{results}}"] }] } },
    ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 2, effectiveAt: new Date("2026-01-02T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  }

  /** One person, confirmed online: a one-person page with the QR, the number and «Declarația semnată ți-a fost trimisă pe email.» */
  async function singleConfirmed() {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Vecina", NOW, { lastName: "Singură", email: "singura@example.ro" }), NOW);
    const [alone] = await rowsOf(event.id);
    await confirmEmail(db, event, alone.id, at(1));
    vi.setSystemTime(at(20));
    const declare = await declarationLink(alone.id, at(20));
    vi.setSystemTime(at(21));
    await consumeAndSignDeclaration(declare, await signing("Vecina Singură"), at(21));
    const manage = await issueActionToken(db, { participantId: alone.participantId, registrationId: alone.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(60 * 24 * 7), now: at(22) });
    vi.setSystemTime(at(23));
    return { alone, secret: manage.secret };
  }

  /** Ana, Maria and Ion on one address, each confirmed: Ana ticked the list, the two other adults did not (§421). */
  async function confirmedFamily() {
    const people = await family();
    const { ana, maria, ion } = people;
    vi.setSystemTime(at(20));
    const declare = await declarationLink(ana.id, at(20));
    vi.setSystemTime(at(21));
    await consumeAndSignDeclaration(declare, await signing("Ana Pop"), at(21));
    await consumeAndSignFamilyDeclaration(declare, passOf(people, [ana.id]), maria.id, await signing("Maria Pop"), at(22));
    await consumeAndSignFamilyDeclaration(declare, passOf(people, [ana.id, maria.id]), ion.id, await signing("Ion Pop"), at(23));
    const manage = await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(60 * 24 * 7), now: at(24) });
    const mine = await issueActionToken(db, { participantId: ana.participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: at(60 * 24 * 7), now: at(24) });
    vi.setSystemTime(at(25));
    return { ...people, secret: manage.secret, mineSecret: mine.secret };
  }

  async function managePage(token: string, locale: Locale, searchParams: Record<string, string> = {}) {
    intlLocale = locale;
    const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve(searchParams) })) as ReactElement;
    return renderToStaticMarkup(element).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  }

  async function minePage(token: string, locale: Locale) {
    intlLocale = locale;
    const element = (await MyRegistrationsPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve({}) })) as ReactElement;
    const stream = await renderToReadableStream(withClientWords(element, locale));
    await stream.allReady;
    return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  }

  /** Each block on a page: its own `<section>` through its `</section>` — it nests none. */
  function blocks(page: string, testId: string): string[] {
    const found: string[] = [];
    const marker = `data-testid="${testId}"`;
    for (let at = page.indexOf(marker); at >= 0; at = page.indexOf(marker, at + 1)) {
      found.push(page.slice(page.lastIndexOf("<section", at), page.indexOf("</section>", at) + "</section>".length));
    }
    return found;
  }

  /** The block's one button: its MUI classes (the variant, the colour, the size), its type and its words. */
  function press(block: string) {
    const button = /<button([^>]*)>([\s\S]*?)<\/button>/.exec(block);
    if (!button) throw new Error("the block has no button");
    const classes = (/class="([^"]*)"/.exec(button[1])?.[1] ?? "").split(/\s+/).filter((name) => name.startsWith("MuiButton"));
    return { classes: classes.sort(), type: /type="([^"]*)"/.exec(button[1])?.[1], text: button[2] };
  }

  /** One registration's block, read: listed or not, its heading, its sentence and eye, its press and the answer it posts. */
  function read(block: string) {
    const state = /data-testid="[a-z-]+-state"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "";
    return {
      listed: /data-listed="(true|false)"/.exec(block)?.[1],
      own: /^<section[^>]*\sid="list"/.test(block),
      heading: /<(h[2-4])[^>]*>([^<]*)<\/h[2-4]>/.exec(block)?.slice(1, 3),
      state: /<span>([^<]*)<\/span>/.exec(state)?.[1],
      eye: state.includes('data-testid="VisibilityOffIcon"') ? "crossed" : state.includes('data-testid="VisibilityIcon"') ? "open" : "none",
      posts: /name="listed" value="([01])"/.exec(block)?.[1],
      press: press(block),
    };
  }

  it("draws a one-person page's block right under the QR and the check-in, before the declaration line and the cancel, in both languages, listed and not", async () => {
    await approveResultsNotice();
    const { alone, secret } = await singleConfirmed();
    await showList(alone.eventId);
    for (const locale of LOCALES) {
      const list = words(locale);
      const states: ReturnType<typeof read>[] = [];
      for (const listOptOut of [false, true]) {
        await db.update(registrations).set({ listOptOut }).where(eq(registrations.id, alone.id));
        const page = await managePage(secret, locale);
        const found = blocks(page, "manage-list-choice");
        expect(found, `${locale}: one block`).toHaveLength(1);
        const block = read(found[0]);
        states.push(block);
        expect(block.own, "`#list` is the link's own person's").toBe(true);
        expect(block.heading).toEqual(["h2", escaped(list.choice.title)]);
        expect(block.listed).toBe(listOptOut ? "false" : "true");
        // Bold beside the eye: open while shown, crossed while not.
        expect(block.eye).toBe(listOptOut ? "crossed" : "open");
        expect(block.state).toBe(escaped(listOptOut ? offTheList(locale) : list.choice.listedWithResults));
        expect(found[0]).toContain(escaped(list.choice.help));
        // The button sets the other answer.
        expect(block.posts).toBe(listOptOut ? "1" : "0");
        expect(block.press.type).toBe("submit");
        // The tick's own words both ways (§570), as the confirmation email's page and the club's messages name them.
        expect(block.press.text).toContain(escaped(listOptOut ? list.optIn : list.optOut));
        // Order on the page: the QR and «Sunt aici»'s line → the block → the declaration line → the cancel.
        const qr = page.indexOf('data-testid="qr-with-name"');
        const checkIn = page.indexOf(escaped(catalogueOf(locale).Registrations.manage.selfCheckInClosed.split("{")[0]));
        const at = page.indexOf('data-testid="manage-list-choice"');
        const declaration = page.indexOf('data-testid="manage-declaration-sent"');
        const cancel = page.indexOf('data-testid="manage-person-cancel"');
        expect(qr).toBeGreaterThan(0);
        expect(checkIn).toBeGreaterThan(qr);
        expect(at).toBeGreaterThan(checkIn);
        expect(declaration).toBeGreaterThan(at);
        expect(cancel).toBeGreaterThan(declaration);
      }
      // The same prominence both ways: one contained, primary, large button, its classes identical whichever answer it gives.
      const [listed, notListed] = states;
      expect(listed.press.classes).toContain("MuiButton-contained");
      expect(listed.press.classes).toContain("MuiButton-colorPrimary");
      expect(listed.press.classes).toContain("MuiButton-sizeLarge");
      expect(listed.press.classes).toEqual(notListed.press.classes);
    }
  });

  it("says only the list, never «în clasament», while no notice describes the results — the results then print «Participant #…»", async () => {
    const { secret } = await singleConfirmed();
    for (const locale of LOCALES) {
      const [block] = blocks(await managePage(secret, locale), "manage-list-choice");
      expect(read(block).state).toBe(escaped(words(locale).choice.listed));
    }
  });

  it("off the list on an event that publishes no list (the default), names no «Participant (nume ascuns)» row — there is none", async () => {
    await approveResultsNotice();
    const { alone, secret } = await singleConfirmed();
    await db.update(registrations).set({ listOptOut: true }).where(eq(registrations.id, alone.id));
    const mine = await issueActionToken(db, { participantId: alone.participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: at(60 * 24 * 7), now: at(23) });
    vi.setSystemTime(at(24));
    for (const locale of LOCALES) {
      // No row to name; on a race the results print no name either — on the registration's page and on «Înscrierile mele».
      const [hidden] = blocks(await managePage(secret, locale), "manage-list-choice");
      expect(read(hidden).state).toBe(escaped(words(locale).choice.notListedWithResults));
      const [own] = blocks(await minePage(mine.secret, locale), "my-list-choice");
      expect(read(own).state).toBe(escaped(words(locale).choice.notListedWithResults));
    }
  });

  it("off the list on «Lista de invitați speciali», names no «Participant (nume ascuns)» row on either page — the shown list draws none for them (§743)", async () => {
    await approveResultsNotice();
    const { alone, secret } = await singleConfirmed();
    await showList(alone.eventId);
    // Seated outside the places by an Administrator (§643), unticked: not even an anonymous row (BR-REQ-039-01 criteria 30, 37).
    await db.update(registrations).set({ listOptOut: true, outsideCapacity: true }).where(eq(registrations.id, alone.id));
    const mine = await issueActionToken(db, { participantId: alone.participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: at(60 * 24 * 7), now: at(23) });
    vi.setSystemTime(at(24));
    for (const locale of LOCALES) {
      const [manage] = blocks(await managePage(secret, locale), "manage-list-choice");
      expect(read(manage).state).toBe(escaped(words(locale).choice.notListedWithResults));
      const [own] = blocks(await minePage(mine.secret, locale), "my-list-choice");
      expect(read(own).state).toBe(escaped(words(locale).choice.notListedWithResults));
    }
    // Back inside the places, the same person off the same shown list is its «Participant (nume ascuns)» row again, on both pages.
    await db.update(registrations).set({ outsideCapacity: false }).where(eq(registrations.id, alone.id));
    const [manage] = blocks(await managePage(secret, "ro"), "manage-list-choice");
    expect(read(manage).state).toBe(escaped(offTheList("ro")));
    const [own] = blocks(await minePage(mine.secret, "ro"), "my-list-choice");
    expect(read(own).state).toBe(escaped(offTheList("ro")));
  });

  it("off the list while still to sign, names no «Participant (nume ascuns)» row either — the shown list draws none for a pending registration", async () => {
    await approveResultsNotice();
    // Ana, Maria and Ion, each still to sign; Ana ticked the list, the two other adults did not (§421).
    const people = await family();
    await showList(people.event.id);
    vi.setSystemTime(at(20));
    const manage = await issueActionToken(db, { participantId: people.ana.participantId, registrationId: people.ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(60 * 24 * 7), now: at(20) });
    vi.setSystemTime(at(21));
    for (const locale of LOCALES) {
      const found = blocks(await managePage(manage.secret, locale), "manage-list-choice").map(read);
      expect(found.map((block) => [block.listed, block.state])).toEqual([
        ["true", escaped(words(locale).choice.listedWithResults)],
        ["false", escaped(words(locale).choice.notListedWithResults)],
        ["false", escaped(words(locale).choice.notListedWithResults)],
      ]);
    }
  });

  it("names neither the results nor «clasament» on an event that takes none — a group run: the list's own title, the list alone", async () => {
    await approveResultsNotice();
    const { alone, secret } = await singleConfirmed();
    await db.update(events).set({ type: "GROUP_RUN" }).where(eq(events.id, alone.eventId));
    await showList(alone.eventId);
    for (const locale of LOCALES) {
      const list = words(locale);
      const anonymous = catalogueOf(locale).Event.startList.anonymous;
      for (const [listOptOut, shown, sentence] of [
        [false, true, list.choice.listed],
        [true, true, list.choice.notListedCounted.replace("{anonymous}", anonymous)],
        [true, false, list.choice.notListed],
      ] as const) {
        await db.update(registrations).set({ listOptOut }).where(eq(registrations.id, alone.id));
        await showList(alone.eventId, shown);
        const [block] = blocks(await managePage(secret, locale), "manage-list-choice");
        expect(read(block).heading).toEqual(["h2", escaped(list.title)]);
        expect(read(block).state).toBe(escaped(sentence));
        expect(block).not.toContain(escaped(list.choice.title));
      }
    }
  });

  it("draws the block for every person of a family's page, each with its heading, its state and the same button, the anchor on the link's own", async () => {
    await approveResultsNotice();
    const { event, ana, maria, ion, secret } = await confirmedFamily();
    await showList(event.id);
    for (const locale of LOCALES) {
      const list = words(locale);
      const page = await managePage(secret, locale);
      const found = blocks(page, "manage-list-choice").map(read);
      expect(found).toHaveLength(3);
      // A heading on every registration, under the person's own `h3`.
      for (const block of found) expect(block.heading).toEqual(["h4", escaped(list.choice.title)]);
      // Ana ticked the list; the two other adults on the address did not (§421).
      expect(found.map((block) => [block.listed, block.own, block.posts, block.eye])).toEqual([
        ["true", true, "0", "open"],
        ["false", false, "1", "crossed"],
        ["false", false, "1", "crossed"],
      ]);
      expect(found[0].state).toBe(escaped(list.choice.listedWithResults));
      expect(found[1].state).toBe(escaped(offTheList(locale)));
      expect(found[2].state).toBe(escaped(offTheList(locale)));
      expect(found[0].press.text).toContain(escaped(list.optOut));
      expect(found[1].press.text).toContain(escaped(list.optIn));
      for (const block of found) expect(block.press.classes).toEqual(found[0].press.classes);
      expect(found[0].press.classes).toContain("MuiButton-contained");
      // In each person's card: the QR → the block → the declaration line.
      const cards = page.split('data-testid="manage-person"').slice(1);
      expect(cards).toHaveLength(3);
      for (const [index, card] of cards.entries()) {
        const name = [ana, maria, ion][index].registeredName;
        expect(card).toContain(escaped(name));
        const qr = card.indexOf('data-testid="qr-with-name"');
        const at = card.indexOf('data-testid="manage-list-choice"');
        expect(qr, `${name}: QR`).toBeGreaterThan(0);
        expect(at, `${name}: the block under the QR`).toBeGreaterThan(qr);
        expect(card.indexOf('data-testid="manage-declaration-sent"'), `${name}: the declaration under the block`).toBeGreaterThan(at);
      }
      // `#list` once, on the link's own person.
      expect(page.match(/id="list"/g)).toHaveLength(1);
    }
  });

  it("answers a press in the pressed person's block only", async () => {
    const { maria, secret } = await confirmedFamily();
    const found = blocks(await managePage(secret, "ro", { list: "1", person: maria.id }), "manage-list-choice");
    expect(found.map((block) => block.includes('data-testid="manage-list-choice-changed"'))).toEqual([false, true, false]);
    expect(found[1]).toContain(escaped(words("ro").changed));
  });

  it("draws the same block on «Înscrierile mele», per registration, under the QR and before the cancel, in both languages", async () => {
    await approveResultsNotice();
    const { event, mineSecret } = await confirmedFamily();
    await showList(event.id);
    for (const locale of LOCALES) {
      const list = words(locale);
      const page = await minePage(mineSecret, locale);
      const found = blocks(page, "my-list-choice").map(read);
      expect(found).toHaveLength(3);
      for (const block of found) {
        expect(block.heading).toEqual(["h3", escaped(list.choice.title)]);
        expect(block.own).toBe(false);
        expect(block.press.classes).toEqual(found[0].press.classes);
      }
      expect(found[0].press.classes).toContain("MuiButton-contained");
      expect(found.map((block) => [block.listed, block.posts, block.eye])).toEqual([
        ["true", "0", "open"],
        ["false", "1", "crossed"],
        ["false", "1", "crossed"],
      ]);
      expect(found[0].state).toBe(escaped(list.choice.listedWithResults));
      expect(found[1].state).toBe(escaped(offTheList(locale)));
      // The tick's own words both ways (§570), as on the registration's own page.
      expect(found[0].press.text).toContain(escaped(list.optOut));
      expect(found[1].press.text).toContain(escaped(list.optIn));
      expect(page).toContain(escaped(list.choice.helpMine));
      const items = page.split('data-testid="my-registration"').slice(1);
      expect(items).toHaveLength(3);
      for (const item of items) {
        const qr = item.indexOf('data-testid="qr-with-name"');
        const at = item.indexOf('data-testid="my-list-choice"');
        expect(qr).toBeGreaterThan(0);
        expect(at).toBeGreaterThan(qr);
        expect(item.indexOf('data-testid="mine-cancel"')).toBeGreaterThan(at);
      }
    }
  });
});
