import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { newsletterSubscribers } from "@/db/schema/newsletter";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesPromotionalMaterials } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Vreau să primesc materiale promoționale de la club și de la partenerii lui»: the owner,
 * 2026-09-29, «I need an extra check on the registration for participants to optionally receive
 * promotional materials from us and from clients (this also has to be reflected in the GDPR notice)».
 *
 * What is protected:
 * - the tick is stored, with its moment, only from a public form whose privacy notice names
 *   `{{promotionalMaterials}}` (AGENTS.md §10.8) — never from staff, never for another adult on a
 *   family's address (§421), and a posted value is ignored while the notice does not describe it;
 * - a test registration is kept exactly the same way (AGENTS.md §12.6) and listed nowhere;
 * - the signer may say yes on the declaration page — the family wizard's steps included;
 * - withdrawal: the manage link and «Înscrierile mele» write once, with one audit row carrying the
 *   new value; an Administrator withdraws for a person who wrote; a yes waits for the notice;
 * - two consents, two switches: a newsletter unsubscribe leaves it alone;
 * - the newsletter page's second fold lists only proved, standing, real registrations, and only for
 *   the Organizer and the Administrator (§550's rule; Tehnic gets nothing).
 */
const NOW = new Date("2026-09-29T10:00:00.000Z");
const LATER = new Date("2026-09-29T11:00:00.000Z");
const STARTS_AT = new Date("2026-10-18T07:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

// The family's sitting and the staff helpers read the database through the client, as the actions do.
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { submitRegistration, confirmEmail, signDeclaration, continueFamilySittingAndReserve } = await import("@/modules/registrations/service");
const { setPromoConsent, setPromoConsentFromManageLink, setPromoConsentFromMyRegistrations } = await import("@/modules/registrations/promo-consent");
const { withdrawOptionalData, createRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { unsubscribeNewsletterSubscriber } = await import("@/modules/newsletter/service");
const { listPromoConsenters, exportPromoConsenters } = await import("@/modules/newsletter/promo-consenters");
const { listManagedPeople } = await import("@/modules/registrations/manage-family");
const { listActiveRegistrationsForParticipant } = await import("@/modules/registrations/my-registrations");
const { findRegistrationDetailForAdmin } = await import("@/modules/registrations/admin-repository");

type EventInput = Parameters<typeof submitRegistration>[1];

const plain = { sections: [{ paragraphs: ["Trimitem doar mesaje despre înscrierea ta."] }] };
const withMarker = { sections: [{ paragraphs: ["Materiale promoționale: doar dacă bifezi {{promotionalMaterials}}."] }] };

async function approve(key: "TERMS" | "PRIVACY_NOTICE" | "EVENT_DECLARATION", version: number, body: object = plain, effectiveAt = new Date("2026-01-01T00:00:00.000Z")) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: body as LegalDocumentTranslationInput["body"] },
    { locale: "en", title: "Text", body: body as LegalDocumentTranslationInput["body"] },
  ];
  await insertLegalDocumentVersion(db, { key, version, effectiveAt, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
}

/** The texts a registration needs; the notice names the marker unless said otherwise. */
async function texts(notice: object = withMarker) {
  await approve("TERMS", 1);
  await approve("PRIVACY_NOTICE", 1, notice);
  await approve("EVENT_DECLARATION", 1);
}

async function createEvent(): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: STARTS_AT, registrationMode: "INTERNAL", capacity: 50, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul toamnei", slug: `crosul-toamnei-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The autumn cross", slug: `autumn-cross-${event.id.slice(0, 8)}` },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const BIRTH_DATES: Record<string, string> = { Ana: "1985-03-02", Mihai: "1987-02-14", Ioana: "2010-07-11" };

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
  ...(firstName === "Ioana" ? { guardianName: "Ana Pop" } : {}),
  email: "ana.pop@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: true,
  promoConsent: true,
  honeypot: "",
  renderedAt: new Date(at.getTime() - 30_000).toISOString(),
  ...overrides,
});

async function rowsOf(eventId: string): Promise<Registration[]> {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId)).orderBy(asc(registrations.createdAt), asc(registrations.id));
}

async function rowById(id: string): Promise<Registration> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

async function onlyRow(eventId: string): Promise<Registration> {
  const rows = await rowsOf(eventId);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function promoAudit(registrationId: string) {
  return db
    .select({ actor: auditLogs.actorStaffUserId, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "registration.promo_consent_changed"), eq(auditLogs.entityId, registrationId)))
    .orderBy(asc(auditLogs.createdAt));
}

async function staff(role: StaffUser["role"]): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function refusal(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
    return undefined;
  } catch (caught) {
    if (isDomainError(caught)) return caught.code;
    throw caught;
  }
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await db.execute(sql`ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique`);
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await db.delete(familyPlaceHolds);
  await db.delete(newsletterSubscribers);
});

describe("§NNN the form keeps the tick only under a notice that describes it", () => {
  it("stores the tick with its moment from a public form under a notice naming the marker", async () => {
    await texts();
    expect(await noticeDescribesPromotionalMaterials(db, NOW)).toBe(true);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const row = await onlyRow(event.id);
    expect(row.promoConsent).toBe(true);
    expect(row.promoConsentAt?.toISOString()).toBe(NOW.toISOString());
    // The notice it was given under is the row's own version.
    expect(row.privacyNoticeVersion).toBe(1);
  });

  it("stores nothing when the box was left unticked — never pre-ticked, never required", async () => {
    await texts();
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW, { promoConsent: false }), NOW);
    const row = await onlyRow(event.id);
    expect(row.promoConsent).toBe(false);
    expect(row.promoConsentAt).toBeNull();
  });

  it("ignores a posted tick while the notice in force does not describe the materials", async () => {
    await texts(plain);
    expect(await noticeDescribesPromotionalMaterials(db, NOW)).toBe(false);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const row = await onlyRow(event.id);
    expect(row.promoConsent).toBe(false);
    expect(row.promoConsentAt).toBeNull();
  });

  it("keeps a test registration's tick exactly as a real one's (AGENTS.md §12.6)", async () => {
    await texts();
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW, "TEST");
    const row = await onlyRow(event.id);
    expect(row.kind).toBe("TEST");
    expect(row.promoConsent).toBe(true);
  });

  it("never sets it from a staff entry — staff cannot consent for a person", async () => {
    await texts();
    const event = await createEvent();
    const admin = await staff("ADMIN");
    await createRegistrationByStaff(
      db,
      admin,
      {
        eventId: event.id,
        firstName: "Ana",
        lastName: "Pop",
        email: "ana.pop@example.ro",
        locale: "ro",
        listOptOut: true,
        relayedByParticipantRequest: true,
        // A crafted post: the staff form has no such box, and the service ignores one anyway.
        details: { promoConsent: true } as never,
      },
      NOW,
    );
    const row = await onlyRow(event.id);
    expect(row.source).toBe("STAFF");
    expect(row.promoConsent).toBe(false);
    expect(row.promoConsentAt).toBeNull();
  });
});

describe("§NNN per person on a family's sitting", () => {
  it("keeps the first person's and a minor's tick, and never another adult's (§421)", async () => {
    await texts();
    const event = await createEvent();
    const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };
    const first = await submitRegistration(db, event, submission("Ana", NOW), NOW, "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const cookieId = first.sittingId ?? randomUUID();
    const windowEnd = new Date(NOW.getTime() + 10 * 60_000);
    const pressed = await continueFamilySittingAndReserve(
      db,
      { sittingId: cookieId, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" },
      windowEnd,
      NOW,
      { firstWindowEnd: windowEnd, firstName: "Ana Pop", email: "ana.pop@example.ro" },
    );
    const sittingId = pressed.sittingId ?? cookieId;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    await submitRegistration(db, event, submission("Mihai", at(1)), at(1), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true, newPerson: true } });
    await submitRegistration(db, event, submission("Ioana", at(2)), at(2), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true, newPerson: true } });

    const byName = Object.fromEntries((await rowsOf(event.id)).map((row) => [row.firstName, row]));
    expect(Object.keys(byName).sort()).toEqual(["Ana", "Ioana", "Mihai"]);
    expect(byName.Ana.promoConsent).toBe(true);
    // Another adult's own consent: the address holder cannot give it.
    expect(byName.Mihai.promoConsent).toBe(false);
    expect(byName.Mihai.promoConsentAt).toBeNull();
    // A minor: the parent consents for the child, as for the list.
    expect(byName.Ioana.promoConsent).toBe(true);
    // The trail: the form's tick for the two it kept, nothing for the adult it did not.
    expect(await promoAudit(byName.Ana.id)).toEqual([{ actor: null, metadata: { to: true, via: "FORM" } }]);
    expect(await promoAudit(byName.Ioana.id)).toEqual([{ actor: null, metadata: { to: true, via: "FORM" } }]);
    expect(await promoAudit(byName.Mihai.id)).toEqual([]);
  });
});

describe("§NNN the declaration page: the signer's own yes", () => {
  async function pendingDeclaration(notice: object = withMarker, overrides: Record<string, unknown> = { promoConsent: false }) {
    await texts(notice);
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW, overrides), NOW);
    const confirmed = await confirmEmail(db, event, (await onlyRow(event.id)).id, NOW);
    expect(confirmed.status).toBe("PENDING_DECLARATION");
    return { event, id: confirmed.id };
  }

  it("records the yes with the signature, in the same transaction, through the one write", async () => {
    const { event, id } = await pendingDeclaration();
    const signed = await signDeclaration(db, event, id, { ...(await signingInput(db, LATER, "Ana Pop")), promoConsent: true }, LATER);
    expect(signed.status).toBe("CONFIRMED");
    const row = await rowById(id);
    expect(row.promoConsent).toBe(true);
    expect(row.promoConsentAt?.toISOString()).toBe(LATER.toISOString());
    expect(await promoAudit(id)).toEqual([{ actor: null, metadata: { to: true, via: "DECLARATION" } }]);
  });

  it("ignores the box while the notice does not describe the materials — and the signature goes on", async () => {
    const { event, id } = await pendingDeclaration(plain);
    const signed = await signDeclaration(db, event, id, { ...(await signingInput(db, LATER, "Ana Pop")), promoConsent: true }, LATER);
    expect(signed.status).toBe("CONFIRMED");
    expect((await rowById(id)).promoConsent).toBe(false);
    expect(await promoAudit(id)).toEqual([]);
  });

  it("leaves a yes given on the form as it was: the form's row, and no second one", async () => {
    const { event, id } = await pendingDeclaration(withMarker, {});
    expect((await rowById(id)).promoConsent).toBe(true);
    await signDeclaration(db, event, id, { ...(await signingInput(db, LATER, "Ana Pop")), promoConsent: true }, LATER);
    expect((await rowById(id)).promoConsentAt?.toISOString()).toBe(NOW.toISOString());
    expect(await promoAudit(id)).toEqual([{ actor: null, metadata: { to: true, via: "FORM" } }]);
  });
});

describe("§NNN the person's own switch: the manage link and «Înscrierile mele»", () => {
  async function registered(overrides: Record<string, unknown> = {}) {
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW, overrides), NOW);
    const row = await onlyRow(event.id);
    return { event, row };
  }
  const token = (row: Registration, purpose: "MANAGE_REGISTRATION" | "MANAGE_PROFILE") =>
    issueActionToken(db, { participantId: row.participantId, registrationId: purpose === "MANAGE_REGISTRATION" ? row.id : null, purpose, expiresAt: STARTS_AT, now: NOW }).then((issued) => issued.secret);

  it("withdraws from the manage link once, with one audit row carrying the new value; the link is not spent", async () => {
    await texts();
    const { row } = await registered();
    const secret = await token(row, "MANAGE_REGISTRATION");

    expect(await setPromoConsentFromManageLink(db, secret, false, LATER)).toEqual({ ok: true, consent: false, changed: true });
    // The same answer twice is one change and one audit row.
    expect(await setPromoConsentFromManageLink(db, secret, false, LATER)).toEqual({ ok: true, consent: false, changed: false });
    const after = await rowById(row.id);
    expect(after.promoConsent).toBe(false);
    expect(after.promoConsentAt?.toISOString()).toBe(LATER.toISOString());
    expect(await promoAudit(row.id)).toEqual([{ actor: null, metadata: { to: true, via: "FORM" } }, { actor: null, metadata: { to: false, via: "MANAGE_LINK" } }]);
    // The page reads the person's answer per person.
    expect((await listManagedPeople(db, after)).map((person) => person.promoConsent)).toEqual([false]);
  });

  it("«Înscrierile mele» refuses a yes for any row — its own included — and withdraws; the manage link's yes still works (second fix round)", async () => {
    await texts();
    const { row } = await registered({ promoConsent: false });
    const secret = await token(row, "MANAGE_PROFILE");

    // The holder's own row: a yes from the address link is refused, nothing written.
    expect(await refusal(setPromoConsentFromMyRegistrations(db, secret, row.id, true, LATER))).toBe("FORBIDDEN");
    expect((await rowById(row.id)).promoConsent).toBe(false);
    expect(await promoAudit(row.id)).toEqual([]);

    // The yes is given on the registration's own manage link.
    expect(await setPromoConsentFromManageLink(db, await token(row, "MANAGE_REGISTRATION"), true, LATER)).toEqual({ ok: true, consent: true, changed: true });
    const [mine] = await listActiveRegistrationsForParticipant(db, row.participantId, "ro", LATER);
    expect(mine.promoConsent).toBe(true);

    // «Înscrierile mele» takes it back.
    expect(await setPromoConsentFromMyRegistrations(db, secret, row.id, false, LATER)).toEqual({ ok: true, consent: false, changed: true });
    expect(await promoAudit(row.id)).toEqual([
      { actor: null, metadata: { to: true, via: "MANAGE_LINK" } },
      { actor: null, metadata: { to: false, via: "MY_REGISTRATIONS" } },
    ]);

    // Somebody else's registration, through this link: a yes refused before any row is read, a no NOT_FOUND.
    const other = await createEvent();
    await submitRegistration(db, other, submission("Ana", NOW, { email: "alt@example.ro" }), NOW);
    const stranger = await onlyRow(other.id);
    expect(await refusal(setPromoConsentFromMyRegistrations(db, secret, stranger.id, true, LATER))).toBe("FORBIDDEN");
    expect(await refusal(setPromoConsentFromMyRegistrations(db, secret, stranger.id, false, LATER))).toBe("NOT_FOUND");
    expect(await refusal(setPromoConsentFromMyRegistrations(db, secret, "not-a-uuid", false, LATER))).toBe("NOT_FOUND");
    expect((await rowById(stranger.id)).promoConsent).toBe(true);
  });

  it("refuses a yes while the notice in force does not describe the materials, and always accepts a no", async () => {
    await texts();
    const { row } = await registered();
    // The club approves a notice that does not name the marker, effective from now.
    await approve("PRIVACY_NOTICE", 2, plain, new Date(NOW.getTime() + 1_000));
    expect(await noticeDescribesPromotionalMaterials(db, LATER)).toBe(false);
    const secret = await token(row, "MANAGE_REGISTRATION");

    // The yes given under the first notice is still withdrawn.
    expect(await setPromoConsentFromManageLink(db, secret, false, LATER)).toMatchObject({ ok: true, changed: true });
    // A new yes waits for a notice that describes it.
    expect(await refusal(setPromoConsentFromManageLink(db, secret, true, LATER))).toBe("VALIDATION_ERROR");
    expect((await rowById(row.id)).promoConsent).toBe(false);
  });

  it("an Administrator withdraws it for a person who wrote; an Organizer and staff never give it", async () => {
    await texts();
    const { row } = await registered();
    const organizer = await staff("MODERATOR");
    const admin = await staff("ADMIN");

    expect(await refusal(withdrawOptionalData(db, organizer, row.id, { promo: true }, "a cerut în scris", LATER))).toBe("FORBIDDEN");
    expect((await withdrawOptionalData(db, admin, row.id, { promo: true }, "a cerut în scris", LATER)).cleared).toEqual(["promo"]);
    expect((await rowById(row.id)).promoConsent).toBe(false);
    expect(await promoAudit(row.id)).toEqual([{ actor: null, metadata: { to: true, via: "FORM" } }, { actor: admin.id, metadata: { to: false, via: "STAFF", reason: "a cerut în scris" } }]);
    // The staff door only withdraws.
    expect(await refusal(setPromoConsent(db, { registrationId: row.id, consent: true, via: "STAFF", actorStaffUserId: admin.id, now: LATER }))).toBe("FORBIDDEN");
    // The registration's page says it.
    const detail = await findRegistrationDetailForAdmin(db, row.id);
    expect(detail?.promoConsent).toBe(false);
  });
});

describe("§NNN fix round: the form's moment, per registration, and another adult's yes", () => {
  const token = (row: Registration, purpose: "MANAGE_REGISTRATION" | "MANAGE_PROFILE") =>
    issueActionToken(db, { participantId: row.participantId, registrationId: purpose === "MANAGE_REGISTRATION" ? row.id : null, purpose, expiresAt: STARTS_AT, now: NOW }).then((issued) => issued.secret);

  async function trail(registrationId: string) {
    return db
      .select({ at: auditLogs.createdAt, metadata: auditLogs.metadataJson })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "registration.promo_consent_changed"), eq(auditLogs.entityId, registrationId)))
      .orderBy(asc(auditLogs.createdAt));
  }

  it("the moment the form's tick was given survives a withdrawal that rewrites promo_consent_at (finding 3)", async () => {
    await texts();
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const row = await onlyRow(event.id);
    await setPromoConsentFromManageLink(db, await token(row, "MANAGE_REGISTRATION"), false, LATER);

    expect((await rowById(row.id)).promoConsentAt?.toISOString()).toBe(LATER.toISOString());
    const rows = await trail(row.id);
    expect(rows.map((entry) => entry.metadata)).toEqual([{ to: true, via: "FORM" }, { to: false, via: "MANAGE_LINK" }]);
    expect(rows[0].at.toISOString()).toBe(NOW.toISOString());
  });

  it("an unticked form writes no row: nothing changed", async () => {
    await texts();
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW, { promoConsent: false }), NOW);
    const row = await onlyRow(event.id);
    expect(await trail(row.id)).toEqual([]);
  });

  it("switching on B leaves A untouched: the consent is per registration (finding 2)", async () => {
    await texts();
    const first = await createEvent();
    const second = await createEvent();
    await submitRegistration(db, first, submission("Ana", NOW), NOW);
    await submitRegistration(db, second, submission("Ana", NOW, { promoConsent: false }), NOW);
    const a = await onlyRow(first.id);
    const b = await onlyRow(second.id);
    expect(a.participantId).toBe(b.participantId);

    // On B's own manage link: yes, then no from «Înscrierile mele», then yes again — A never moves.
    expect(await setPromoConsentFromManageLink(db, await token(b, "MANAGE_REGISTRATION"), true, LATER)).toMatchObject({ ok: true, changed: true });
    expect(await setPromoConsentFromMyRegistrations(db, await token(b, "MANAGE_PROFILE"), b.id, false, LATER)).toMatchObject({ ok: true, changed: true });
    expect(await setPromoConsentFromManageLink(db, await token(b, "MANAGE_REGISTRATION"), true, LATER)).toMatchObject({ ok: true, changed: true });
    expect((await rowById(b.id)).promoConsent).toBe(true);

    const untouched = await rowById(a.id);
    expect(untouched.promoConsent).toBe(true);
    expect(untouched.promoConsentAt?.toISOString()).toBe(NOW.toISOString());
    expect((await trail(a.id)).map((entry) => entry.metadata)).toEqual([{ to: true, via: "FORM" }]);

    // And the other way: withdrawing A leaves B's yes alone.
    await setPromoConsentFromManageLink(db, await token(a, "MANAGE_REGISTRATION"), false, LATER);
    expect((await rowById(b.id)).promoConsent).toBe(true);
  });

  it("the holder's manage link offers another adult only the way out; the server refuses its yes (finding 4)", async () => {
    await texts();
    const event = await createEvent();
    const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };
    const first = await submitRegistration(db, event, submission("Ana", NOW), NOW, "REAL", { ...PUBLIC, sitting: { id: null, joined: false } });
    const cookieId = first.sittingId ?? randomUUID();
    const windowEnd = new Date(NOW.getTime() + 10 * 60_000);
    const pressed = await continueFamilySittingAndReserve(
      db,
      { sittingId: cookieId, seed: first.sittingSeed ?? null, eventId: event.id, locale: "ro" },
      windowEnd,
      NOW,
      { firstWindowEnd: windowEnd, firstName: "Ana Pop", email: "ana.pop@example.ro" },
    );
    const sittingId = pressed.sittingId ?? cookieId;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    await submitRegistration(db, event, submission("Mihai", at(1)), at(1), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true, newPerson: true } });
    await submitRegistration(db, event, submission("Ioana", at(2), { promoConsent: false }), at(2), "REAL", { ...PUBLIC, sitting: { id: sittingId, joined: true, newPerson: true } });
    const byName = Object.fromEntries((await rowsOf(event.id)).map((row) => [row.firstName, row]));
    const holder = await token(byName.Ana, "MANAGE_REGISTRATION");

    // The page's flag: another adult is Mihai alone — not the link's own row, not the minor.
    const people = await listManagedPeople(db, byName.Ana, LATER);
    expect(Object.fromEntries(people.map((person) => [person.id, person.anotherAdult]))).toEqual({
      [byName.Ana.id]: false,
      [byName.Mihai.id]: true,
      [byName.Ioana.id]: false,
    });

    // The yes for another adult, posted by the holder's link: refused on the server, nothing written.
    expect(await refusal(setPromoConsentFromManageLink(db, holder, true, LATER, byName.Mihai.id))).toBe("FORBIDDEN");
    expect((await rowById(byName.Mihai.id)).promoConsent).toBe(false);
    expect(await promoAudit(byName.Mihai.id)).toEqual([]);
    // «Înscrierile mele» (the address link) cannot tell the holder from Mihai: a yes for any row is refused (second fix round).
    const address = await token(byName.Ana, "MANAGE_PROFILE");
    for (const person of [byName.Ana, byName.Mihai, byName.Ioana]) {
      expect(await refusal(setPromoConsentFromMyRegistrations(db, address, person.id, true, LATER))).toBe("FORBIDDEN");
    }
    expect((await rowById(byName.Mihai.id)).promoConsent).toBe(false);
    expect(await promoAudit(byName.Mihai.id)).toEqual([]);
    // The minor's parent may say yes for the child, as on the form.
    expect(await setPromoConsentFromManageLink(db, holder, true, LATER, byName.Ioana.id)).toMatchObject({ ok: true, changed: true });

    // Mihai says yes on his own link; the holder's link may still take it back (art. 7(3)).
    const own = await token(byName.Mihai, "MANAGE_REGISTRATION");
    expect(await setPromoConsentFromManageLink(db, own, true, LATER)).toMatchObject({ ok: true, changed: true });
    expect(await setPromoConsentFromManageLink(db, holder, false, LATER, byName.Mihai.id)).toMatchObject({ ok: true, changed: true });
    expect((await rowById(byName.Mihai.id)).promoConsent).toBe(false);
  });
});

describe("§NNN two consents, two switches", () => {
  it("a newsletter unsubscribe leaves the offers-and-benefits consent alone", async () => {
    await texts();
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const row = await onlyRow(event.id);
    const identity = canonicalizeEmail("ana.pop@example.ro");
    const [subscriber] = await db
      .insert(newsletterSubscribers)
      .values({
        deliveryEmail: identity.deliveryEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        locale: "ro",
        topics: ["ALL"],
        privacyNoticeVersion: 1,
        confirmedAt: NOW,
      })
      .returning();
    const admin = await staff("ADMIN");

    expect(await unsubscribeNewsletterSubscriber(db, admin, subscriber.id, LATER)).toBe(true);
    const after = await rowById(row.id);
    expect(after.promoConsent).toBe(true);
    expect(after.promoConsentAt?.toISOString()).toBe(NOW.toISOString());
    // Only the form's own row: the unsubscribe wrote nothing here.
    expect(await promoAudit(row.id)).toEqual([{ actor: null, metadata: { to: true, via: "FORM" } }]);
  });

  it("withdrawing the offers and benefits leaves the newsletter alone", async () => {
    await texts();
    const event = await createEvent();
    await submitRegistration(db, event, submission("Ana", NOW), NOW);
    const row = await onlyRow(event.id);
    const identity = canonicalizeEmail("ana.pop@example.ro");
    await db.insert(newsletterSubscribers).values({
      deliveryEmail: identity.deliveryEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      locale: "ro",
      topics: ["ALL"],
      privacyNoticeVersion: 1,
      confirmedAt: NOW,
    });
    await setPromoConsent(db, { registrationId: row.id, consent: false, via: "MY_REGISTRATIONS", now: LATER });
    expect(await db.select().from(newsletterSubscribers)).toHaveLength(1);
  });
});

describe("§NNN the newsletter page's second fold", () => {
  async function seedParticipant(email: string): Promise<string> {
    const identity = canonicalizeEmail(email);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: email,
      })
      .returning();
    return participant.id;
  }

  async function seedRow(eventId: string, name: string, status: Registration["status"], kind: Registration["kind"] = "REAL", promoConsent = true) {
    const participantId = await seedParticipant(`${name.toLowerCase().replace(/\s+/g, ".")}@example.ro`);
    await db.insert(registrations).values({
      eventId,
      participantId,
      status,
      kind,
      locale: "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: true,
      promoConsent,
      promoConsentAt: promoConsent ? NOW : null,
    });
  }

  it("lists the proved, standing, real registrations that said yes — never a cancelled, expired, unproved or test one", async () => {
    const event = await createEvent();
    await seedRow(event.id, "Ana Confirmata", "CONFIRMED");
    await seedRow(event.id, "Bogdan Asteapta", "PENDING_DECLARATION");
    await seedRow(event.id, "Carmen Coada", "WAITLISTED");
    await seedRow(event.id, "Dan Anulat", "CANCELLED");
    await seedRow(event.id, "Elena Expirata", "EXPIRED");
    await seedRow(event.id, "Florin Neconfirmat", "PENDING_EMAIL_CONFIRMATION");
    await seedRow(event.id, "Gelu Test", "CONFIRMED", "TEST");
    await seedRow(event.id, "Horia Nu", "CONFIRMED", "REAL", false);

    const organizer = await staff("MODERATOR");
    const list = await listPromoConsenters(db, organizer, "ro");
    expect(list.total).toBe(3);
    expect(list.truncated).toBe(false);
    expect(list.rows.map((row) => row.name).sort()).toEqual(["Ana Confirmata", "Bogdan Asteapta", "Carmen Coada"]);
    expect(list.rows[0]).toMatchObject({ email: expect.stringContaining("@example.ro"), eventTitle: "Crosul toamnei" });
    expect(list.rows[0].consentedAt?.toISOString()).toBe(NOW.toISOString());

    const admin = await staff("ADMIN");
    expect(await exportPromoConsenters(db, admin, "en", 100)).toHaveLength(3);
    expect((await exportPromoConsenters(db, admin, "en", 100))[0].eventTitle).toBe("The autumn cross");
  });

  it.each([["DEV"], ["CONTRIBUTOR"], ["COPYWRITER"], ["MEMBER"]] as const)("refuses the %s role (§550: Organizer and Administrator only)", async (role) => {
    const reader = await staff(role);
    expect(await refusal(listPromoConsenters(db, reader, "ro"))).toBe("FORBIDDEN");
    expect(await refusal(exportPromoConsenters(db, reader, "ro", 100))).toBe("FORBIDDEN");
  });
});
