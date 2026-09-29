import { and, eq, sql } from "drizzle-orm";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The manage page, rendered with the real catalogues.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Registrations" }),
    getLocale: async () => "ro",
    setRequestLocale: () => {},
  };
});
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
  sex: "UNSPECIFIED",
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
    expect(await withdrawFromFamilyWizard(secret, pass, ion.id, at(22))).toMatchObject({ ok: false });
    expect(await withdrawFromFamilyWizard(secret, pass, ana.id, at(22))).toMatchObject({ ok: false });
    expect(await withdrawFromFamilyWizard(secret, pass, "not-an-id", at(22))).toMatchObject({ ok: false });

    const withdrawn = await withdrawFromFamilyWizard(secret, pass, maria.id, at(22));
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
    // The place went back through the allocator: one more free place.
    expect(await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(22))).toBe((before ?? 0) + 1);
    // The audit row: no staff actor, the state it left and the door, never a name.
    expect(await auditOf(maria.id)).toEqual([
      { action: "registration.cancelled_by_participant", actor: null, metadata: { from: "PENDING_DECLARATION", via: "FAMILY_WIZARD" } },
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
    const last = await withdrawFromFamilyWizard(secret, withdrawn.pass, ion.id, at(24));
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
    expect(await withdrawFromFamilyWizard(secret, null, maria.id, at(21))).toMatchObject({ ok: false });

    const withdrawn = await withdrawFromFamilyWizard(secret, null, ana.id, at(21));
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
    expect(await thrown(consumeAndCancel(secret, at(27), vecina.id))).toBe("NOT_FOUND");
    expect((await rowsOf(event.id)).find((row) => row.id === vecina.id)?.status).not.toBe("CANCELLED");
    // …and the refusal spent nothing: the link still reads.
    expect((await readRaceDayContext(secret, at(27))).ok).toBe(true);

    const before = await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(28));
    const cancelled = await consumeAndCancel(secret, at(28), maria.id);
    expect(cancelled).toMatchObject({ ok: true, family: true, registration: { id: maria.id, status: "CANCELLED" } });
    const after = await rowsOf(event.id);
    expect(after.find((row) => row.id === maria.id)?.status).toBe("CANCELLED");
    expect(after.find((row) => row.id === ana.id)?.status).toBe("CONFIRMED");
    expect(await readPublicAvailability(db, { id: event.id, capacity: 20 }, at(28))).toBe((before ?? 0) + 1);
    expect(await auditOf(maria.id)).toContainEqual({ action: "registration.cancelled_by_participant", actor: null, metadata: { from: "CONFIRMED", via: "MANAGE_LINK" } });

    const [email] = (await outbox("REGISTRATION_CANCELLED")).filter((row) => row.registrationId === maria.id);
    const message = await render(email, at(29));
    expect(message.subject).toContain("Înscrierea pentru Maria Pop la Crosul familiei a fost anulată");
    expect(message.text).toContain("Pe această adresă rămân înscriși: Ana P. (confirmat), Ion P. (confirmat).");
    expect(message.text).not.toContain("Vecina");

    // The cancel spent the link (§12.8), as «Înscrierile mele» spends its own.
    expect((await readRaceDayContext(secret, at(29))).ok).toBe(false);
  });

  it("refuses a sibling already cancelled without spending the link — no false «Gata» from a stale page", async () => {
    const { event, maria, secret } = await confirmedFamily();
    await db.update(registrations).set({ status: "CANCELLED" }).where(eq(registrations.id, maria.id));
    expect(await thrown(consumeAndCancel(secret, at(27), maria.id))).toBe("NOT_FOUND");
    expect((await auditOf(maria.id)).some((row) => row.action === "registration.cancelled_by_participant")).toBe(false);
    expect((await rowsOf(event.id)).find((row) => row.id === maria.id)?.status).toBe("CANCELLED");
    expect((await readRaceDayContext(secret, at(27))).ok).toBe(true);
  });

  it("says per person how the declaration was accepted — sent by email, signed on paper at the desk, or nothing yet (§NNN)", async () => {
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
