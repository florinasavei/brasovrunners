import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens, type EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { familyPlaceHolds, pendingFamilyEntries } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { ADDRESS_CHANGED_MEANWHILE, ADDRESS_FAMILY_FORM_PENDING, ADDRESS_INVITED, signedAfterStaffAddressChange } from "@/modules/registrations/domain/address-change";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS } from "@/modules/registrations/domain/family";
import { ANSWERS_UNCHANGED } from "@/modules/registrations/answers";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Schimbă adresa» — an Administrator moves one registration to another address (the owner, 2026-11-11: «aparent nu pot
 * modifica mailul unei persoane???», choosing «Orice adresă, oricând»; BR-REQ-037-03, BR-REQ-036-02, BR-REQ-060-01).
 *
 * Through the real service on PGlite, with made-up people only. What these hold:
 * - the registration is re-pointed to the participant of the new canonical address — reused unchanged, or created — and
 *   no participant row is rewritten or merged; its state, place, waiting position and number do not move, in each state;
 * - the new address gets its state's own message (a fresh verification window, the waiting list, the offer, the
 *   declaration, the confirmation with a NEW check-in code), and a cancelled or lapsed row the two notices alone;
 * - every old link is dead for every purpose, answered as a missing token — never «a newer email exists», never «already
 *   used»; the old address's queued mail is withdrawn and a claimed retry is withdrawn at render;
 * - the new links work end to end, and a signature from them reads, in the trail, as given after a staff address change;
 * - both notices are queued, the old one despite an open refusal, with no token and without the new address;
 * - each refusal writes nothing; the trail holds ids and counts, no address, and the erase scrubs the ids;
 * - the person's record of each address shows only that address's mail; the family on the old address is re-sent its
 *   message; the orphan sweep keeps the old address while its notice waits; the deadline rule never passes over a waiter.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const STARTS = new Date("2026-10-11T07:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

vi.mock("@/db/client", () => ({ getDb: () => db }));
/** Check-in codes a test forces on the next draws, before the real ones resume. */
const forcedCheckinCodes = vi.hoisted(() => [] as string[]);
/**
 * Every draw counted; armed, the eleventh throws a named error, so a loop that never ends fails at once instead of hanging
 * (PGlite's awaits keep such a loop going past any per-test timeout).
 */
const checkinDraws = vi.hoisted(() => ({ count: 0, armed: false }));
vi.mock("@/modules/registrations/checkin-code", async (original) => {
  const actual = await original<typeof import("@/modules/registrations/checkin-code")>();
  return {
    ...actual,
    newCheckinCode: () => {
      if (++checkinDraws.count > 10 && checkinDraws.armed) throw new Error("unbounded");
      return forcedCheckinCodes.shift() ?? actual.newCheckinCode();
    },
  };
});
/**
 * A registration a test takes away right after the move's read under the lock — which the row lock now keeps an erase or
 * retention's sweep from doing, so this pins the guard behind it: an UPDATE that matches nothing ends the move, never a
 * retry — deleted through the move's own transaction.
 */
const takenAfterRead = vi.hoisted(() => ({ id: null as string | null, reads: 0 }));
vi.mock("@/modules/registrations/repository", async (original) => {
  const actual = await original<typeof import("@/modules/registrations/repository")>();
  return {
    ...actual,
    findRegistrationById: async (...args: Parameters<typeof actual.findRegistrationById>) => {
      const row = await actual.findRegistrationById(...args);
      // The second read of the row is the one under the event's lock: the row is gone the moment after it.
      if (row && row.id === takenAfterRead.id && ++takenAfterRead.reads === 2) {
        const [tx] = args;
        // As the erase does: its declaration first (a confirmed row's), then the row.
        await tx.delete(declarationAcceptances).where(eq(declarationAcceptances.registrationId, row.id));
        await tx.delete(registrations).where(eq(registrations.id, row.id));
        takenAfterRead.id = null;
      }
      return row;
    },
  };
});
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));

const { submitRegistration, confirmEmail, signDeclaration, unregister, changeRegistrationAddressByStaff } = await import("@/modules/registrations/service");
const { changeRegistrationAddress, createRegistrationByStaff, deleteRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { forgetCachedAddressCap } = await import("@/modules/registrations/address-cap-memo");
const { updateAddressCap } = await import("@/modules/registrations/address-cap");
const { consumeActionToken, issueActionToken, readActionTokenContext, readSpentActionTokenScope, readSupersededActionTokenScope } = await import("@/modules/action-tokens/repository");
const { consumeAndConfirmEmail, consumeAndSignDeclaration } = await import("@/modules/registrations/token-actions");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { findSignedDeclaration, renderSignedDeclarationPdf } = await import("@/modules/registrations/signed-declaration");
const { declarationWords } = await import("@/modules/registrations/declaration-labels");
const { OutboxMessageWithdrawn } = await import("@/modules/notifications/outbox");
const { listDeclarationAcceptances } = await import("@/modules/registrations/admin-repository");
const { viewPersonData } = await import("@/modules/registrations/person-data");
const { pruneExpiredRows } = await import("@/modules/jobs/retention");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  await db.delete(familyPlaceHolds);
  forgetCachedDeadlines();
  forgetCachedAddressCap();
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

async function createEvent(capacity: number | null, options: { auto?: boolean; startsAt?: Date; raceId?: string } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: options.auto ?? false,
      raceId: options.raceId ?? null,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: event.raceId,
    capacity: event.capacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  };
}

const submission = (firstName: string, email: string, sentAt: Date, promo = false) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: "1985-03-02",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  promoConsent: promo,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 30_000).toISOString(),
});

async function rowOf(id: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}
async function byName(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}
const mail = (name: string) => `${name.toLowerCase()}@example.ro`;

async function unconfirmed(event: EventInput, name: string, minute = 0, email = mail(name)) {
  await submitRegistration(db, event, submission(name, email, at(minute)), at(minute), "REAL", PUBLIC);
  const row = await byName(name);
  expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
  return row;
}
async function confirmedAddress(event: EventInput, name: string, minute = 0) {
  const row = await unconfirmed(event, name, minute);
  return confirmEmail(db, event, row.id, at(minute));
}
async function confirmedRow(event: EventInput, name: string, minute = 0) {
  const held = await confirmedAddress(event, name, minute);
  expect(held.status).toBe("PENDING_DECLARATION");
  return signDeclaration(db, event, held.id, await signingInput(db, at(minute), `${name} Munteanu`), at(minute));
}

async function participantOf(email: string) {
  const [row] = await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalizeEmail(email).canonicalEmail));
  return row;
}
const queued = (registrationId: string) => db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registrationId));
const trailOf = (registrationId: string) =>
  db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.address_changed_by_staff"), eq(auditLogs.entityId, registrationId)));

/** Everything a refusal must leave as it was. */
async function snapshot() {
  return {
    registrations: await db.select().from(registrations),
    participants: (await db.select().from(participants)).length,
    outbox: (await db.select().from(emailOutbox)).length,
    tokens: await db.select({ id: emailActionTokens.id, invalidatedAt: emailActionTokens.invalidatedAt }).from(emailActionTokens),
    audit: (await db.select().from(auditLogs)).length,
  };
}

async function refusal(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

/** The secret an outbox row's action link carries, rendered as the drain would render it. */
async function secretOf(row: typeof emailOutbox.$inferSelect, when: Date): Promise<string> {
  const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
  const match = /[/=]([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
  if (!match) throw new Error(`no action link in the ${row.messageType} message`);
  return match[1];
}

const NEW = "noua.adresa@example.org";

describe("«Schimbă adresa»: the registration moves, each state keeps what it has", () => {
  it("a row waiting for its address: re-pointed to a new participant, a fresh email-link window, the verification to the new address", async () => {
    const event = await createEvent(5);
    const ana = await unconfirmed(event, "Ana");
    const moved = await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));

    const target = await participantOf(NEW);
    expect(moved.newParticipant).toBe(true);
    expect(target).toMatchObject({ defaultName: "Ana Munteanu", preferredLocale: "ro", emailVerifiedAt: null });
    const row = await rowOf(ana.id);
    expect(row.participantId).toBe(target.id);
    expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(row.addressChangedAt?.toISOString()).toBe(at(60).toISOString());
    expect(row.addressChangedByStaffUserId).toBe(admin.id);
    // The club's window again, from the move (48 hours unset, §377).
    expect(row.emailLinkExpiresAt?.toISOString()).toBe(new Date(at(60).getTime() + 48 * HOUR).toISOString());
    // The vouching columns are the old address's facts: untouched.
    expect(row.emailConfirmedAt).toBeNull();
    expect(row.emailConfirmedByStaffUserId).toBeNull();

    const rows = await queued(ana.id);
    expect(rows.filter((r) => r.participantId === target.id).map((r) => r.messageType).sort()).toEqual(["REGISTRATION_ADDRESS_ADDED", "VERIFY_REGISTRATION_EMAIL"]);
    expect(moved.stateMessage).toBe("VERIFY_REGISTRATION_EMAIL");
    // The first verification email, never tried, withdrawn with the old address.
    expect(rows.filter((r) => r.participantId === ana.participantId).map((r) => r.messageType)).toEqual(["REGISTRATION_ADDRESS_REMOVED"]);
    expect(moved.messagesWithdrawn).toBe(1);
  });

  it("a held place: the same hold and the declaration to the new address; the old participant row is not rewritten", async () => {
    const event = await createEvent(5);
    const held = await confirmedAddress(event, "Ana");
    const oldParticipant = (await db.select().from(participants).where(eq(participants.id, held.participantId)))[0];
    const moved = await changeRegistrationAddressByStaff(db, admin, held.id, NEW, at(60));
    const row = await rowOf(held.id);
    expect(row.status).toBe("PENDING_DECLARATION");
    expect(row.holdExpiresAt?.toISOString()).toBe(held.holdExpiresAt?.toISOString());
    expect(moved.holdLengthened).toBe(false);
    expect(moved.stateMessage).toBe("COMPLETE_DECLARATION");
    // The old participant is exactly what it was: nothing moves the address of a participant row.
    expect((await db.select().from(participants).where(eq(participants.id, held.participantId)))[0]).toEqual(oldParticipant);
  });

  it("on the waiting list: the same position and the waiting-list message; nothing in the line moves", async () => {
    const event = await createEvent(1);
    await confirmedAddress(event, "Ana", 0);
    const elena = await confirmedAddress(event, "Elena", 1);
    const luca = await confirmedAddress(event, "Luca", 2);
    expect(elena.status).toBe("WAITLISTED");
    const moved = await changeRegistrationAddressByStaff(db, admin, elena.id, NEW, at(60));
    const row = await rowOf(elena.id);
    expect(row.status).toBe("WAITLISTED");
    expect(row.waitlistedAt?.toISOString()).toBe(elena.waitlistedAt?.toISOString());
    expect((await rowOf(luca.id)).waitlistedAt?.toISOString()).toBe(luca.waitlistedAt?.toISOString());
    expect(moved.stateMessage).toBe("WAITLIST_JOINED");
  });

  it("offered a place: the offer and its deadline kept, the offer's email to the new address", async () => {
    const event = await createEvent(1, { auto: true });
    const ana = await confirmedAddress(event, "Ana", 0);
    const elena = await confirmedAddress(event, "Elena", 1);
    await unregister(db, event, ana.id, "ADMIN", at(5));
    const offered = await rowOf(elena.id);
    expect(offered.status).toBe("WAITLIST_OFFERED");
    // Moved the moment it was made: a whole day still left, so the deadline is the offer's own.
    const moved = await changeRegistrationAddressByStaff(db, admin, elena.id, NEW, at(5));
    expect(moved.holdLengthened).toBe(false);
    expect((await rowOf(elena.id)).holdExpiresAt?.toISOString()).toBe(offered.holdExpiresAt?.toISOString());
    expect(moved.stateMessage).toBe("WAITLIST_SPOT_OFFER");
  });

  it("confirmed: the number kept, a NEW check-in code, the confirmation to the new address", async () => {
    const event = await createEvent(5);
    const confirmed = await confirmedRow(event, "Ana");
    expect(confirmed.status).toBe("CONFIRMED");
    const moved = await changeRegistrationAddressByStaff(db, admin, confirmed.id, NEW, at(60));
    const row = await rowOf(confirmed.id);
    expect(row.status).toBe("CONFIRMED");
    expect(row.bibNumber).toBe(confirmed.bibNumber);
    expect(row.checkinCode).not.toBeNull();
    expect(row.checkinCode).not.toBe(confirmed.checkinCode);
    expect(moved.stateMessage).toBe("REGISTRATION_CONFIRMED");
  });

  it("cancelled or lapsed: allowed, the two notices alone", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await unregister(db, event, ana.id, "ADMIN", at(5));
    const lena = await unconfirmed(event, "Lena", 6);
    await db.update(registrations).set({ status: "EXPIRED", expiredAt: at(7), expiryReason: "EMAIL_CONFIRMATION_LAPSED" }).where(eq(registrations.id, lena.id));

    for (const [id, status] of [[ana.id, "CANCELLED"], [lena.id, "EXPIRED"]] as const) {
      const moved = await changeRegistrationAddressByStaff(db, admin, id, `${status.toLowerCase()}@example.org`, at(60));
      expect(moved.stateMessage).toBeNull();
      expect((await rowOf(id)).status).toBe(status);
      const types = (await queued(id)).filter((r) => r.createdAt.getTime() === at(60).getTime()).map((r) => r.messageType).sort();
      expect(types).toEqual(["REGISTRATION_ADDRESS_ADDED", "REGISTRATION_ADDRESS_REMOVED"]);
    }
  });

  it("after the event has ended: the two notices alone, whatever the state", async () => {
    const event = await createEvent(5, { startsAt: new Date(NOW.getTime() + 2 * HOUR) });
    const confirmed = await confirmedRow(event, "Ana");
    // No end of its own: it ends at the next midnight of its start day in its zone, as everywhere else (`eventEndSql`).
    const moved = await changeRegistrationAddressByStaff(db, admin, confirmed.id, NEW, new Date(NOW.getTime() + 24 * HOUR));
    expect(moved.stateMessage).toBeNull();
    expect((await rowOf(confirmed.id)).status).toBe("CONFIRMED");
  });

  it("on race day after the start, an event with no end is not over: a confirmed runner still gets the confirmation and a new code", async () => {
    const event = await createEvent(5, { startsAt: new Date(NOW.getTime() + 2 * HOUR) });
    const confirmed = await confirmedRow(event, "Ana");
    const moved = await changeRegistrationAddressByStaff(db, admin, confirmed.id, NEW, new Date(NOW.getTime() + 3 * HOUR));
    expect(moved.stateMessage).toBe("REGISTRATION_CONFIRMED");
    expect((await rowOf(confirmed.id)).checkinCode).not.toBe(confirmed.checkinCode);
  });

  it("a confirmed row moved to an address nobody confirmed: the confirmation's declaration masks the identity document until the new address is confirmed", async () => {
    const event = await createEvent(5);
    const held = await confirmedAddress(event, "Ana");
    await signDeclaration(db, event, held.id, await signingInput(db, at(1), "Ana Munteanu"), at(1));
    // The test's declaration asks for no document; the signed row is given one, as a text naming it would have asked.
    await db.update(declarationAcceptances).set({ idDocument: "BV 123456" }).where(eq(declarationAcceptances.registrationId, held.id));
    await changeRegistrationAddressByStaff(db, admin, held.id, NEW, at(60));
    const [confirmation] = (await queued(held.id)).filter((row) => row.messageType === "REGISTRATION_CONFIRMED" && row.recipientEmail === NEW);
    const signed = await findSignedDeclaration(db, held.id);
    const copy = (audience: "club" | "participant", when: Date) => renderSignedDeclarationPdf(db, signed!, held.eventId, declarationWords(signed!.locale, when), when, audience);
    const attached = async (when: Date) => {
      const message = await renderOutboxMessage({ ...confirmation, status: "PROCESSING", attemptCount: 1, lockedAt: when }, db, when);
      return message.attachments?.find((file) => file.contentType === "application/pdf")?.data;
    };
    // The whole copy and the masked one differ: the comparison below tells them apart.
    expect((await copy("club", at(61)))!.equals((await copy("participant", at(61)))!)).toBe(false);
    expect((await attached(at(61)))!.equals((await copy("club", at(61)))!)).toBe(true);
    // Confirmed by its own link after the move: the whole copy, as on every confirmed address.
    await db.update(participants).set({ emailVerifiedAt: at(70) }).where(eq(participants.canonicalEmail, NEW));
    expect((await attached(at(71)))!.equals((await copy("participant", at(71)))!)).toBe(true);
  });

  it("reuses an existing participant of the new address exactly as it is — its name and language untouched", async () => {
    const event = await createEvent(5);
    const other = await createEvent(5);
    // Somebody else already registered elsewhere on the new address, in English, under another name.
    await submitRegistration(db, other, { ...submission("Dora", NEW, at(0)), locale: "en" }, at(0), "REAL", PUBLIC);
    const before = await participantOf(NEW);
    const ana = await confirmedAddress(event, "Ana", 1);
    const moved = await changeRegistrationAddressByStaff(db, admin, ana.id, "Noua.Adresa@Example.org", at(60));
    expect(moved.newParticipant).toBe(false);
    expect(await participantOf(NEW)).toEqual(before);
    expect((await rowOf(ana.id)).participantId).toBe(before.id);
    expect((await db.select().from(participants)).length).toBe(2);
  });

  it("withdraws «oferte și beneficii», on the old address's trail as staff's withdrawal", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await db.update(registrations).set({ promoConsent: true, promoConsentAt: NOW }).where(eq(registrations.id, ana.id));
    const moved = await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    expect(moved.promoWithdrawn).toBe(true);
    expect((await rowOf(ana.id)).promoConsent).toBe(false);
    const [withdrawal] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.promo_consent_changed"), eq(auditLogs.entityId, ana.id)));
    expect(withdrawal).toMatchObject({ actorStaffUserId: admin.id, participantId: ana.participantId, metadataJson: { to: false, via: "STAFF" } });
  });
});

describe("«Schimbă adresa»: each refusal writes nothing", () => {
  const refusedWith = async (work: Promise<unknown>, marker: string | null, code = "VALIDATION_ERROR") => {
    const before = await snapshot();
    const error = await refusal(work);
    expect(isDomainError(error) && error.code, String(error)).toBe(code);
    if (marker && isDomainError(error)) expect(error.fields).toContain(marker);
    expect(await snapshot()).toEqual(before);
  };

  it("an address that is not one", async () => {
    const ana = await confirmedAddress(await createEvent(5), "Ana");
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, "nu-e-o-adresa", at(60)), "email");
  });

  it("the same address, a provider's variant of it included", async () => {
    const event = await createEvent(5);
    const ana = await unconfirmed(event, "Ana", 0, "ana.munteanu@gmail.com");
    for (const variant of ["ana.munteanu@gmail.com", "ANA.Munteanu+cros@googlemail.com", "anamunteanu@gmail.com"]) {
      await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, variant, at(60)), ANSWERS_UNCHANGED);
    }
  });

  it("the same runner already on the new address at the event — active, or cancelled", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    // The same runner, on the new address: an active row, then a cancelled one.
    await submitRegistration(db, event, submission("Ana", NEW, at(1)), at(1), "REAL", PUBLIC);
    const twin = (await db.select().from(registrations).where(eq(registrations.participantId, (await participantOf(NEW)).id)))[0];
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), ALREADY_ON_ADDRESS);
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: at(2), cancellationSource: "ADMIN" }).where(eq(registrations.id, twin.id));
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), ALREADY_ON_ADDRESS);
  });

  it("the same runner on the new address at another event of the race, while this one is active", async () => {
    const raceId = randomUUID();
    const tenK = await createEvent(5, { raceId });
    const fiveK = await createEvent(5, { raceId });
    const ana = await confirmedAddress(tenK, "Ana", 0);
    await submitRegistration(db, fiveK, submission("Dora", NEW, at(1)), at(1), "REAL", PUBLIC);
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), ALREADY_ON_ADDRESS);
  });

  it("the new address at the club's limit per address", async () => {
    await updateAddressCap(db, admin, { registrationsPerAddress: 1 }, NOW);
    forgetCachedAddressCap();
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    await submitRegistration(db, event, submission("Dora", NEW, at(1)), at(1), "REAL", PUBLIC);
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), ADDRESS_AT_CAP);
  });

  it("a family form waiting on the row", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    await db.insert(pendingFamilyEntries).values({ eventId: event.id, participantId: ana.participantId, registrationId: ana.id, locale: "ro", fields: {}, expiresAt: at(600) });
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), ADDRESS_FAMILY_FORM_PENDING);
  });

  it("an open invitation of the new address to the event", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    await submitRegistration(db, await createEvent(5), submission("Dora", NEW, at(1)), at(1), "REAL", PUBLIC);
    const dora = await participantOf(NEW);
    await db.insert(eventInvitations).values({ eventId: event.id, participantId: dora.id, name: "Dora Munteanu", email: NEW, canonicalEmail: dora.canonicalEmail, sentAt: NOW, lastSentAt: NOW, expiresAt: at(600) });
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), ADDRESS_INVITED);
  });

  it("an erased registration is NOT_FOUND", async () => {
    const ana = await confirmedAddress(await createEvent(5), "Ana");
    await deleteRegistrationByStaff(db, admin, ana.id, "cerere de ștergere", at(10));
    await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), null, "NOT_FOUND");
    await refusedWith(changeRegistrationAddressByStaff(db, admin, randomUUID(), NEW, at(60)), null, "NOT_FOUND");
  });

  it("a row taken between the read and the UPDATE (a cancelled one, erased meanwhile): NOT_FOUND, nothing written, and the call returns", { timeout: 10_000 }, async () => {
    const event = await createEvent(5);
    const ana = await unconfirmed(event, "Ana", 0);
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: at(1), cancellationSource: "ADMIN" }).where(eq(registrations.id, ana.id));
    takenAfterRead.id = ana.id;
    takenAfterRead.reads = 0;
    try {
      // The new address's participant the move creates is rolled back with it: no orphan is left for the sweep.
      await refusedWith(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)), null, "NOT_FOUND");
      expect(takenAfterRead.reads).toBe(2);
      expect(await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalizeEmail(NEW).canonicalEmail))).toEqual([]);
      expect((await rowOf(ana.id)).participantId).toBe(ana.participantId);
    } finally {
      takenAfterRead.id = null;
    }
  });

  it("a confirmed row taken between the read and the UPDATE: NOT_FOUND after one draw of a check-in code, never a loop", { timeout: 10_000 }, async () => {
    const event = await createEvent(5);
    const ana = await confirmedRow(event, "Ana", 0);
    takenAfterRead.id = ana.id;
    takenAfterRead.reads = 0;
    checkinDraws.count = 0;
    checkinDraws.armed = true;
    try {
      // Each pass of the UPDATE draws a code: a loop that retried a missing row would throw «unbounded» on the eleventh.
      const error = await refusal(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)));
      expect(isDomainError(error) ? error.code : String(error)).toBe("NOT_FOUND");
      expect(checkinDraws.count).toBeLessThanOrEqual(1);
      expect(takenAfterRead.reads).toBe(2);
      expect(await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalizeEmail(NEW).canonicalEmail))).toEqual([]);
      expect((await rowOf(ana.id)).participantId).toBe(ana.participantId);
    } finally {
      takenAfterRead.id = null;
      checkinDraws.armed = false;
    }
  });

  it("every role but the Administrator's, by the service and by its wrapper", async () => {
    const ana = await confirmedAddress(await createEvent(5), "Ana");
    for (const role of STAFF_ROLES.filter((role: StaffRole) => role !== "ADMIN" && role !== "SUPERADMIN")) {
      const actor = { id: admin.id, role };
      await refusedWith(changeRegistrationAddressByStaff(db, actor, ana.id, NEW, at(60)), null, "FORBIDDEN");
      await refusedWith(changeRegistrationAddress(db, actor, ana.id, NEW, at(60)), null, "FORBIDDEN");
    }
  });
});

describe("«Schimbă adresa»: a unique-key failure is ALREADY_ON_ADDRESS only when it is about the address", () => {
  /** A trigger that fails the move's UPDATE as the named unique index would, so the mapping itself is what is tested. */
  async function failingUpdateAs(constraint: string, work: () => Promise<void>) {
    await db.execute(
      sql.raw(`CREATE FUNCTION test_forced_unique_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'duplicate key value violates unique constraint "${constraint}"' USING ERRCODE = 'unique_violation', CONSTRAINT = '${constraint}'; END $$`),
    );
    await db.execute(sql.raw("CREATE TRIGGER test_forced_unique_failure BEFORE UPDATE OF participant_id ON registrations FOR EACH ROW EXECUTE FUNCTION test_forced_unique_failure()"));
    try {
      await work();
    } finally {
      await db.execute(sql.raw("DROP TRIGGER test_forced_unique_failure ON registrations"));
      await db.execute(sql.raw("DROP FUNCTION test_forced_unique_failure()"));
    }
  }

  it("the fresh check-in code meets another row's: another code is drawn and the row moves, never ALREADY_ON_ADDRESS", async () => {
    const event = await createEvent(5);
    const ana = await confirmedRow(event, "Ana", 0);
    const dora = await confirmedRow(event, "Dora", 1);
    expect(dora.checkinCode).not.toBeNull();
    forcedCheckinCodes.push(dora.checkinCode as string);
    const moved = await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    expect(forcedCheckinCodes).toEqual([]);
    expect(moved.stateMessage).toBe("REGISTRATION_CONFIRMED");
    const row = await rowOf(ana.id);
    expect(row.participantId).toBe((await participantOf(NEW)).id);
    expect(row.checkinCode).not.toBeNull();
    expect([ana.checkinCode, dora.checkinCode]).not.toContain(row.checkinCode);
    expect((await rowOf(dora.id)).checkinCode).toBe(dora.checkinCode);
  });

  it("the fresh check-in code meets another row's on every draw: the move ends after the bound, not about the address, nothing written", { timeout: 10_000 }, async () => {
    const event = await createEvent(5);
    const ana = await confirmedRow(event, "Ana", 0);
    const dora = await confirmedRow(event, "Dora", 1);
    const before = await snapshot();
    // One more forced draw than the bound allows: the one left over proves the move stopped drawing.
    for (let draw = 0; draw < 6; draw++) forcedCheckinCodes.push(dora.checkinCode as string);
    try {
      const error = await refusal(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)));
      expect(isDomainError(error) && error.fields.includes(ALREADY_ON_ADDRESS), String(error)).toBeFalsy();
      expect(forcedCheckinCodes).toHaveLength(1);
      expect(await snapshot()).toEqual(before);
    } finally {
      forcedCheckinCodes.length = 0;
    }
  });

  it("the address's own unique indexes still answer ALREADY_ON_ADDRESS, writing nothing", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    for (const constraint of ["registrations_event_participant_name_unique", "registrations_race_participant_active_unique"]) {
      await failingUpdateAs(constraint, async () => {
        const before = await snapshot();
        const error = await refusal(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)));
        expect(isDomainError(error) && error.fields, String(error)).toContain(ALREADY_ON_ADDRESS);
        expect(await snapshot()).toEqual(before);
      });
    }
  });

  it("any other unique index is rethrown as it is, never answered as ALREADY_ON_ADDRESS", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana", 0);
    await failingUpdateAs("registrations_event_bib_number_unique", async () => {
      const error = await refusal(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)));
      expect(isDomainError(error)).toBe(false);
    });
  });
});

describe("«Schimbă adresa»: the old links die, the old mail is withdrawn, the new links work", () => {
  const PURPOSES: readonly EmailActionTokenPurpose[] = ["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION", "WAITLIST_OFFER", "MANAGE_REGISTRATION", "LIST_CONSENT"];

  it("every old link, for each purpose, is a missing token — never «a newer email exists», never «already used»", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    const issue = (purpose: EmailActionTokenPurpose, now = at(1)) =>
      issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose, expiresAt: new Date(now.getTime() + 7 * DAY), now });
    // One replaced by a newer one (§619), and one spent: before the move each page would say so.
    const superseded = (await issue("COMPLETE_DECLARATION", at(1))).secret;
    const live = new Map<EmailActionTokenPurpose, string>();
    for (const purpose of PURPOSES) live.set(purpose, (await issue(purpose, at(2))).secret);
    const spent = (await issue("MANAGE_REGISTRATION", at(3))).secret;
    live.delete("MANAGE_REGISTRATION");
    expect((await consumeActionToken(db, { secret: spent, purpose: "MANAGE_REGISTRATION", now: at(4) })).ok).toBe(true);
    expect(await readSupersededActionTokenScope(db, { secret: superseded, purpose: "COMPLETE_DECLARATION", now: at(5) })).not.toBeNull();
    expect(await readSpentActionTokenScope(db, { secret: spent, purpose: "MANAGE_REGISTRATION", now: at(5) })).not.toBeNull();

    const moved = await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    expect(moved.linksRevoked).toBe(live.size);
    // Revoked for cause: invalidated, superseded by nothing.
    for (const token of await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, ana.id))) {
      if (token.usedAt) continue;
      expect(token.invalidatedAt).not.toBeNull();
    }
    const notFound = { ok: false, code: "TOKEN_INVALID", reason: "NOT_FOUND" };
    for (const [purpose, secret] of live) {
      expect(await readActionTokenContext(db, { secret, purpose, now: at(61) }), purpose).toEqual(notFound);
      expect(await consumeActionToken(db, { secret, purpose, now: at(61) }), purpose).toEqual(notFound);
    }
    expect(await readActionTokenContext(db, { secret: superseded, purpose: "COMPLETE_DECLARATION", now: at(61) })).toEqual(notFound);
    expect(await readSupersededActionTokenScope(db, { secret: superseded, purpose: "COMPLETE_DECLARATION", now: at(61) })).toBeNull();
    expect(await readSpentActionTokenScope(db, { secret: spent, purpose: "MANAGE_REGISTRATION", now: at(61) })).toBeNull();
    // A link the old address still holds, minted after the move by anything, opens nothing either: the binding.
    const late = await issueActionToken(db, { participantId: ana.participantId, registrationId: ana.id, purpose: "MANAGE_REGISTRATION", expiresAt: at(9_000), now: at(62) });
    expect(await readActionTokenContext(db, { secret: late.secret, purpose: "MANAGE_REGISTRATION", now: at(63) })).toEqual(notFound);
    expect(await consumeActionToken(db, { secret: late.secret, purpose: "MANAGE_REGISTRATION", now: at(63) })).toEqual(notFound);
  });

  it("a claimed retry of the old address's mail is withdrawn at render; the old address's notice renders, with no token and no new address", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    const [declaration] = (await queued(ana.id)).filter((row) => row.messageType === "COMPLETE_DECLARATION");
    // Claimed once already: not the move's to delete, the renderer's to withdraw.
    await db.update(emailOutbox).set({ status: "PROCESSING", attemptCount: 1, lockedAt: at(30) }).where(eq(emailOutbox.id, declaration.id));
    const moved = await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    // The verification still waiting, never tried, is the move's to delete; the claimed declaration is not.
    expect(moved.messagesWithdrawn).toBe(1);
    const [claimed] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, declaration.id));
    await expect(renderOutboxMessage(claimed, db, at(61))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);

    const [notice] = (await queued(ana.id)).filter((row) => row.messageType === "REGISTRATION_ADDRESS_REMOVED");
    expect(notice.recipientEmail).toBe(mail("Ana"));
    const tokensBefore = (await db.select().from(emailActionTokens)).length;
    const message = await renderOutboxMessage({ ...notice, status: "PROCESSING", attemptCount: 1, lockedAt: at(61) }, db, at(61));
    expect(message.to).toBe(mail("Ana"));
    expect(`${message.subject}\n${message.text}\n${message.html}`).not.toContain(NEW);
    expect(message.text).not.toMatch(/[/=][A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/);
    expect((await db.select().from(emailActionTokens)).length).toBe(tokensBefore);
    expect(message.text).toContain("Linkurile primite la această adresă pentru această înscriere nu mai funcționează.");
  });

  it("the event's own news still waiting follows the registration to the new address; a link-bearing message is withdrawn", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    for (const messageType of ["EVENT_REMINDER", "ORGANIZER_MESSAGE"] as const) {
      await db.insert(emailOutbox).values({
        participantId: ana.participantId,
        registrationId: ana.id,
        messageType,
        locale: "ro",
        recipientEmail: mail("Ana"),
        payloadJson: {},
        idempotencyKey: `test:${messageType}:${ana.id}`,
        status: "PENDING",
        attemptCount: 0,
        createdAt: at(30),
      });
    }
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const target = await participantOf(NEW);
    const rows = await queued(ana.id);
    for (const messageType of ["EVENT_REMINDER", "ORGANIZER_MESSAGE"]) {
      expect(rows.filter((row) => row.messageType === messageType), messageType).toEqual([
        expect.objectContaining({ participantId: target.id, recipientEmail: NEW, status: "PENDING" }),
      ]);
    }
    // The old address's declaration request, which carries a link, is gone; the new address has its own.
    expect(rows.filter((row) => row.messageType === "COMPLETE_DECLARATION").map((row) => row.recipientEmail)).toEqual([NEW]);
    const [trail] = await trailOf(ana.id);
    expect(trail.metadataJson).toMatchObject({ messagesReaddressed: 2 });
  });

  it("the organizers' message between two attempts follows the move and renders for the new address; a claimed one is withdrawn", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    const organizerMessage = (key: string, status: "PENDING" | "PROCESSING") => ({
      participantId: ana.participantId,
      registrationId: ana.id,
      messageType: "ORGANIZER_MESSAGE" as const,
      locale: "ro" as const,
      recipientEmail: mail("Ana"),
      payloadJson: {},
      idempotencyKey: `test:organizer:${key}:${ana.id}`,
      status,
      attemptCount: 1,
      lockedAt: status === "PROCESSING" ? at(50) : null,
      createdAt: at(30),
    });
    // Tried once and waiting for its next attempt: not claimed, so it follows the registration.
    const [retry] = await db.insert(emailOutbox).values(organizerMessage("retry", "PENDING")).returning();
    // Claimed by a worker at the moment of the move: the renderer's to withdraw.
    const [claimed] = await db.insert(emailOutbox).values(organizerMessage("claimed", "PROCESSING")).returning();
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const target = await participantOf(NEW);

    const [followed] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, retry.id));
    expect(followed).toMatchObject({ participantId: target.id, recipientEmail: NEW, status: "PENDING", attemptCount: 1 });
    const message = await renderOutboxMessage({ ...followed, status: "PROCESSING", attemptCount: 2, lockedAt: at(61) }, db, at(61));
    expect(message.to).toBe(NEW);

    const [stillOld] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, claimed.id));
    expect(stillOld).toMatchObject({ participantId: ana.participantId, recipientEmail: mail("Ana") });
    await expect(renderOutboxMessage(stillOld, db, at(61))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
  });

  it("moved away and back: the first notice to the address that holds the registration again is withdrawn at render", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    await changeRegistrationAddressByStaff(db, admin, ana.id, mail("Ana"), at(61));
    const [first] = (await queued(ana.id)).filter((row) => row.messageType === "REGISTRATION_ADDRESS_REMOVED" && row.recipientEmail === mail("Ana"));
    await expect(renderOutboxMessage({ ...first, status: "PROCESSING", attemptCount: 1, lockedAt: at(62) }, db, at(62))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    // The second address's notice of losing it is true, and leaves.
    const [second] = (await queued(ana.id)).filter((row) => row.messageType === "REGISTRATION_ADDRESS_REMOVED" && row.recipientEmail === NEW);
    expect((await renderOutboxMessage({ ...second, status: "PROCESSING", attemptCount: 1, lockedAt: at(62) }, db, at(62))).to).toBe(NEW);
  });

  it("the old address's notice is queued even while that address has an open refusal", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await db.update(emailOutbox).set({ status: "BOUNCED", attemptCount: 1, rejectedAt: at(20), rejectionCause: "no-such-address" }).where(eq(emailOutbox.registrationId, ana.id));
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const notices = (await queued(ana.id)).filter((row) => row.messageType === "REGISTRATION_ADDRESS_REMOVED");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ status: "PENDING", participantId: ana.participantId, recipientEmail: mail("Ana") });
  });

  it("the new links work end to end, and the signature shows as given after the staff address change", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const target = await participantOf(NEW);
    const [declaration] = (await queued(ana.id)).filter((row) => row.messageType === "COMPLETE_DECLARATION" && row.participantId === target.id);
    expect(declaration.recipientEmail).toBe(NEW);
    const secret = await secretOf(declaration, at(61));
    const signed = await consumeAndSignDeclaration(secret, await signingInput(db, at(62), "Ana Munteanu"), at(62));
    expect(signed.ok).toBe(true);
    expect((await rowOf(ana.id)).status).toBe("CONFIRMED");
    const [acceptance] = await listDeclarationAcceptances(db, ana.id);
    expect(acceptance.method).toBe("EMAIL_LINK");
    expect(signedAfterStaffAddressChange(acceptance, (await rowOf(ana.id)).addressChangedAt)).toBe(true);
    // The confirmation goes to the new address too.
    const confirmations = (await queued(ana.id)).filter((row) => row.messageType === "REGISTRATION_CONFIRMED");
    expect(confirmations.map((row) => row.recipientEmail)).toEqual([NEW]);
  });

  it("a row waiting for its address: the new verification link confirms the new address", async () => {
    const event = await createEvent(5);
    const ana = await unconfirmed(event, "Ana");
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const target = await participantOf(NEW);
    const [verification] = (await queued(ana.id)).filter((row) => row.messageType === "VERIFY_REGISTRATION_EMAIL" && row.participantId === target.id);
    const confirmed = await consumeAndConfirmEmail(await secretOf(verification, at(61)), at(62));
    expect(confirmed.ok).toBe(true);
    expect((await rowOf(ana.id)).status).toBe("PENDING_DECLARATION");
    expect((await participantOf(NEW)).emailVerifiedAt?.toISOString()).toBe(at(62).toISOString());
  });
});

describe("«Schimbă adresa»: the deadline kept, a day given only to a place nobody waits for", () => {
  it("an offer with less than a day left gets a day from the move while nobody waits", async () => {
    const event = await createEvent(1, { auto: true });
    const ana = await confirmedAddress(event, "Ana", 0);
    const elena = await confirmedAddress(event, "Elena", 1);
    await unregister(db, event, ana.id, "ADMIN", at(5));
    const offered = await rowOf(elena.id);
    const late = new Date((offered.holdExpiresAt as Date).getTime() - 2 * HOUR);
    const moved = await changeRegistrationAddressByStaff(db, admin, elena.id, NEW, late);
    expect(moved.holdLengthened).toBe(true);
    expect((await rowOf(elena.id)).holdExpiresAt?.toISOString()).toBe(new Date(late.getTime() + DAY).toISOString());
  });

  it("the same offer is NOT lengthened while somebody waits for a place: the move never passes over them", async () => {
    const event = await createEvent(1, { auto: true });
    const ana = await confirmedAddress(event, "Ana", 0);
    const elena = await confirmedAddress(event, "Elena", 1);
    const luca = await confirmedAddress(event, "Luca", 2);
    await unregister(db, event, ana.id, "ADMIN", at(5));
    const offered = await rowOf(elena.id);
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect((await rowOf(luca.id)).status).toBe("WAITLISTED");
    const late = new Date((offered.holdExpiresAt as Date).getTime() - 2 * HOUR);
    const moved = await changeRegistrationAddressByStaff(db, admin, elena.id, NEW, late);
    expect(moved.holdLengthened).toBe(false);
    expect((await rowOf(elena.id)).holdExpiresAt?.toISOString()).toBe(offered.holdExpiresAt?.toISOString());
  });
});

describe("«Schimbă adresa»: the trail, the person's record, the family and the sweep", () => {
  it("one audit row with ids and counts, no address; the erase scrubs the participants' ids", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const target = await participantOf(NEW);
    const [trail] = await trailOf(ana.id);
    expect(trail).toMatchObject({ actorStaffUserId: admin.id, participantId: ana.participantId, entityType: "registration" });
    expect(trail.metadataJson).toMatchObject({ fromParticipantId: ana.participantId, toParticipantId: target.id, status: "PENDING_DECLARATION", newParticipant: true });
    expect(JSON.stringify(trail.metadataJson)).not.toContain("@");

    await deleteRegistrationByStaff(db, admin, ana.id, "cerere de ștergere", at(70));
    const [scrubbed] = await trailOf(ana.id);
    expect(scrubbed.participantId).toBeNull();
    expect(scrubbed.metadataJson).not.toHaveProperty("fromParticipantId");
    expect(scrubbed.metadataJson).not.toHaveProperty("toParticipantId");
  });

  it("«Toate datele unei persoane»: each address sees its own mail and nothing of the other's", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    const target = await participantOf(NEW);
    const [old] = await db.select().from(participants).where(eq(participants.id, ana.participantId));

    const fresh = await viewPersonData(db, admin, target.canonicalEmail, at(61));
    expect(fresh.registrations.map((row) => row.id)).toEqual([ana.id]);
    const freshMail = await db.select().from(emailOutbox).where(eq(emailOutbox.participantId, target.id));
    expect(fresh.messages.map((row) => row.messageType).sort()).toEqual(freshMail.map((row) => row.messageType).sort());
    expect(fresh.messages.some((row) => row.messageType === "REGISTRATION_ADDRESS_REMOVED")).toBe(false);

    const former = await viewPersonData(db, admin, old.canonicalEmail, at(61));
    expect(former.registrations).toEqual([]);
    expect(former.messages.map((row) => row.messageType)).toContain("REGISTRATION_ADDRESS_REMOVED");
    expect(former.messages.some((row) => row.messageType === "REGISTRATION_ADDRESS_ADDED")).toBe(false);
    expect(former.auditTrail.some((row) => row.action === "registration.address_changed_by_staff")).toBe(true);
  });

  it("the family left on the old address is sent its message again; one registration moves per press", async () => {
    const event = await createEvent(5);
    const ana = await unconfirmed(event, "Ana", 0, "familie@example.ro");
    await createRegistrationByStaff(db, admin, { eventId: event.id, firstName: "Maria", lastName: "Munteanu", email: "familie@example.ro", locale: "ro", listOptOut: false, relayedByParticipantRequest: true }, at(1));
    const maria = await byName("Maria");
    expect(maria.participantId).toBe(ana.participantId);
    await changeRegistrationAddressByStaff(db, admin, maria.id, NEW, at(60));
    // Ana stays on the old address, and gets its message again.
    expect((await rowOf(ana.id)).participantId).toBe(ana.participantId);
    const again = (await queued(ana.id)).filter((row) => row.idempotencyKey.includes(":address-changed-family:"));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ messageType: "VERIFY_REGISTRATION_EMAIL", participantId: ana.participantId, recipientEmail: "familie@example.ro" });
    const [trail] = await trailOf(maria.id);
    expect((trail.metadataJson as Record<string, unknown>).familyResentFor).toBe(ana.id);
  });

  it("after the event is over, the family on the old address is sent nothing, and the trail names no family resend", async () => {
    const event = await createEvent(5, { startsAt: new Date(NOW.getTime() + 2 * HOUR) });
    const ana = await unconfirmed(event, "Ana", 0, "familie@example.ro");
    await createRegistrationByStaff(db, admin, { eventId: event.id, firstName: "Maria", lastName: "Munteanu", email: "familie@example.ro", locale: "ro", listOptOut: false, relayedByParticipantRequest: true }, at(1));
    const maria = await byName("Maria");
    expect(maria.participantId).toBe(ana.participantId);
    // The next midnight after its start day: over.
    await changeRegistrationAddressByStaff(db, admin, maria.id, NEW, new Date(NOW.getTime() + 24 * HOUR));
    expect((await queued(ana.id)).filter((row) => row.idempotencyKey.includes(":address-changed-family:"))).toEqual([]);
    const [trail] = await trailOf(maria.id);
    expect(trail.metadataJson).not.toHaveProperty("familyResentFor");
  });

  it("the orphan sweep keeps the old address while its notice waits, and takes it once the notice has left", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    await changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60));
    // Something for the sweep to delete, so it looks for orphans: a registration lapsed long ago.
    const lapse = async (name: string) => {
      const row = await unconfirmed(event, name, 1);
      await db.update(registrations).set({ status: "EXPIRED", expiryReason: "EMAIL_CONFIRMATION_LAPSED", expiredAt: new Date(NOW.getTime() - 400 * DAY) }).where(eq(registrations.id, row.id));
    };
    await lapse("Lena");
    await pruneExpiredRows(db, at(90));
    expect(await db.select().from(participants).where(eq(participants.id, ana.participantId))).toHaveLength(1);
    expect(await participantOf(mail("Lena"))).toBeUndefined();

    await db.update(emailOutbox).set({ status: "SENT", sentAt: at(91) }).where(and(eq(emailOutbox.participantId, ana.participantId), eq(emailOutbox.status, "PENDING")));
    await lapse("Mira");
    await pruneExpiredRows(db, at(92));
    expect(await db.select().from(participants).where(eq(participants.id, ana.participantId))).toHaveLength(0);
    expect(await db.select().from(registrations).where(and(eq(registrations.id, ana.id), isNull(registrations.cancelledAt)))).toHaveLength(1);
  });
});

describe("«Schimbă adresa»: a lock clash inside the move is a plain «press again»", () => {
  for (const [code, condition] of [["40P01", "deadlock_detected"], ["40001", "serialization_failure"]] as const) {
    it(`${code} raised inside the transaction: the try-again refusal, nothing written`, async () => {
      const event = await createEvent(5);
      const ana = await confirmedAddress(event, "Ana");
      const before = await snapshot();
      // A statement of the move fails as PostgreSQL fails the side of a lock cycle it breaks, or a serialization.
      await db.execute(sql.raw(`CREATE FUNCTION test_forced_clash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced ${condition}' USING ERRCODE = '${condition}'; END $$`));
      await db.execute(sql.raw("CREATE TRIGGER test_forced_clash BEFORE UPDATE OF participant_id ON registrations FOR EACH ROW EXECUTE FUNCTION test_forced_clash()"));
      let error: unknown;
      try {
        error = await refusal(changeRegistrationAddressByStaff(db, admin, ana.id, NEW, at(60)));
      } finally {
        await db.execute(sql.raw("DROP TRIGGER test_forced_clash ON registrations"));
        await db.execute(sql.raw("DROP FUNCTION test_forced_clash()"));
      }
      expect(isDomainError(error) && error.code === "CONFLICT" && error.fields.includes(ADDRESS_CHANGED_MEANWHILE), String(error)).toBe(true);
      // Never the address's field: the sentence is «press again», not «check what you typed».
      expect(isDomainError(error) && error.fields.includes("email")).toBe(false);
      expect(await snapshot()).toEqual(before);
    });
  }
});
