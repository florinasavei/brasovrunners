import { and, eq } from "drizzle-orm";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §558 — «Nu mai pot ajunge» in every email about a live registration (BR-REQ-036-01, BR-REQ-036-02,
 * BR-REQ-080-01; the owner, 2026-09-29): the renderer mints the message's own manage link — or reuses
 * the one it already carries — and the button's link, opened, is the manage page that asks first; the
 * press cancels the registration and queues the §547 cancellation email. Never on a club copy, never
 * after the start, never on a registration that is no longer active.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
// The manage page, rendered with the real catalogue.
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

const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { readActionTokenContext } = await import("@/modules/action-tokens/repository");
const { consumeAndCancel } = await import("@/modules/registrations/token-actions");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");

/** The button's link in a rendered message: the manage page at its own person's cancel. */
const CANNOT_COME_LINK = /Nu mai pot ajunge: (https?:\/\/\S+\/inregistrari\/gestionare\/([A-Za-z0-9_-]+)#cancel)/;

let participantId: string;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetTables(db);
  participantId = await participantFor("ana@example.ro", "Ana Pop");
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 20, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
});

async function participantFor(email: string, name: string) {
  const identity = canonicalizeEmail(email);
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: name,
    })
    .returning();
  return participant.id;
}

async function registration(status: RegistrationStatus) {
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      status,
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: "Ana P.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      listOptOut: false,
      resultsConsentVersion: 1,
      ...(status === "CONFIRMED" ? { confirmedAt: NOW, checkinCode: "ABC123" } : {}),
      ...(status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? { holdExpiresAt: new Date(NOW.getTime() + 30 * 60_000) } : {}),
    })
    .returning();
  return row;
}

function row(messageType: EmailMessageType, registrationId: string, payloadJson: Record<string, unknown> = {}, rowParticipant: string | null = participantId) {
  return {
    id: `row-${messageType}`,
    participantId: rowParticipant,
    registrationId,
    messageType,
    locale: "ro" as const,
    recipientEmail: "ana@example.ro",
    payloadJson,
    idempotencyKey: `test:${messageType}`,
    requestedByStaffUserId: null,
    isManualResend: false,
    status: "PROCESSING" as const,
    attemptCount: 1,
    nextAttemptAt: null,
    lockedAt: NOW,
    providerMessageId: null,
    transport: null,
    recipientCount: null,
    lastError: null,
    createdAt: NOW,
    sentAt: null,
  };
}

async function manageTokens(registrationId: string) {
  return db
    .select()
    .from(emailActionTokens)
    .where(and(eq(emailActionTokens.registrationId, registrationId), eq(emailActionTokens.purpose, "MANAGE_REGISTRATION")));
}

describe("§558 «Nu mai pot ajunge» from the email to the cancelled registration", () => {
  it("mints the organizer's message its own manage link; opened, the page asks first; the press cancels and queues the cancellation email", async () => {
    const ana = await registration("CONFIRMED");
    const message = await renderOutboxMessage(
      row("ORGANIZER_MESSAGE", ana.id, { subject: { ro: "Parcare", en: "Parking" }, body: { ro: "Parcarea e la intrare.", en: "Parking is at the gate." } }),
      db,
      NOW,
    );
    const found = CANNOT_COME_LINK.exec(message.text);
    expect(found, "the organizer's message carries «Nu mai pot ajunge»").not.toBeNull();
    const secret = found![2];
    // Both halves, each in its own words, and the sentence under the button.
    expect(message.text).toContain("Locul se eliberează pentru altcineva.");
    expect(message.text).toContain("I can't make it any more: ");
    expect(message.html).toContain('data-email-part="cannot-come"');
    expect(message.html).toContain("/brand/email-cannot-come.png");

    // Minted at send time, hashed at rest, scoped to this registration, a fortnight's life (§12.8, §14.5).
    const tokens = await manageTokens(ana.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).not.toContain(secret);
    expect(tokens[0].expiresAt).toEqual(new Date(NOW.getTime() + 14 * 24 * 60 * 60_000));

    // Opened (a GET): the manage page, with the cancel that asks first — nothing changes.
    const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
    const html = renderToStaticMarkup(element);
    expect(html).toContain('id="cancel"');
    expect(html).toContain("Anulează înscrierea pentru Ana Pop");
    expect((await db.select().from(registrations).where(eq(registrations.id, ana.id)))[0].status).toBe("CONFIRMED");

    // The page asks why, before the cancel (§558).
    expect(html).toContain('name="cancelReasonKind"');

    // The confirm press (the POST): cancelled through the allocator, the §547 email queued.
    const cancelled = await consumeAndCancel(secret, NOW, { kind: "OTHER_PLANS", text: null });
    expect(cancelled).toMatchObject({ ok: true, registration: { id: ana.id, status: "CANCELLED", cancelReasonKind: "OTHER_PLANS" } });
    const queued = await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, ana.id), eq(emailOutbox.messageType, "REGISTRATION_CANCELLED")));
    expect(queued.filter((entry) => entry.participantId === participantId)).toHaveLength(1);
    // Single use (§12.8): the same link cancels nothing twice.
    expect((await consumeAndCancel(secret, NOW, { kind: "OTHER_PLANS", text: null })).ok).toBe(false);
  });

  it("reuses the reminder's own manage link — one token, and the reminder's one button is the cancel", async () => {
    const ana = await registration("CONFIRMED");
    const message = await renderOutboxMessage(row("EVENT_REMINDER", ana.id), db, NOW);
    expect(CANNOT_COME_LINK.exec(message.text)).not.toBeNull();
    expect(await manageTokens(ana.id)).toHaveLength(1);
    // «Nu pot veni — anulez înscrierea» is gone: one cancel per message.
    expect(message.text).not.toContain("Nu pot veni — anulez înscrierea");
    expect(message.html.match(/data-email-part="cannot-come"/g)).toHaveLength(2);
  });

  it("draws the button on the address to confirm, the declaration request and the waiting list — each its own manage link", async () => {
    for (const [status, messageType] of [
      ["PENDING_EMAIL_CONFIRMATION", "VERIFY_REGISTRATION_EMAIL"],
      ["PENDING_DECLARATION", "COMPLETE_DECLARATION"],
      ["WAITLISTED", "WAITLIST_JOINED"],
      ["WAITLIST_OFFERED", "WAITLIST_SPOT_OFFER"],
    ] as const) {
      await db.delete(registrations);
      const ana = await registration(status);
      const message = await renderOutboxMessage(row(messageType, ana.id), db, NOW);
      expect(CANNOT_COME_LINK.exec(message.text), messageType).not.toBeNull();
      expect(await manageTokens(ana.id), messageType).toHaveLength(1);
    }
  });

  it("the real chain: the address to confirm, then the declaration request on the same registration — each email's button is its own manage page, the newest link the live one", async () => {
    const ana = await registration("PENDING_EMAIL_CONFIRMATION");
    const verify = await renderOutboxMessage(row("VERIFY_REGISTRATION_EMAIL", ana.id), db, NOW);
    const first = CANNOT_COME_LINK.exec(verify.text)![2];

    // The address confirmed: the declaration to sign, on the same registration, with no deletion between.
    await db.update(registrations).set({ status: "PENDING_DECLARATION", emailConfirmedAt: NOW, holdExpiresAt: new Date(NOW.getTime() + 30 * 60_000) }).where(eq(registrations.id, ana.id));
    const declaration = await renderOutboxMessage(row("COMPLETE_DECLARATION", ana.id), db, NOW);
    const found = CANNOT_COME_LINK.exec(declaration.text);
    expect(found, "the declaration request lands on the manage page, never «Înscrierile mele» by address").not.toBeNull();
    expect(declaration.text).not.toMatch(/Nu mai pot ajunge: \S+\/inscrieri\/ale-mele/);
    const second = found![2];
    expect(second).not.toBe(first);
    // The newer link supersedes the older (BR-REQ-036-02 criterion 5): one live manage link, the newest email's.
    expect((await readActionTokenContext(db, { secret: second, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(true);
    expect((await readActionTokenContext(db, { secret: first, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(false);

    // The waiting list's messages the same way, one after the other on one registration.
    await db.update(registrations).set({ status: "WAITLISTED", holdExpiresAt: null, waitlistedAt: NOW }).where(eq(registrations.id, ana.id));
    const joined = await renderOutboxMessage(row("WAITLIST_JOINED", ana.id), db, NOW);
    expect(CANNOT_COME_LINK.exec(joined.text), "WAITLIST_JOINED").not.toBeNull();
    const expired = await renderOutboxMessage(row("WAITLIST_OFFER_EXPIRED", ana.id), db, NOW);
    expect(CANNOT_COME_LINK.exec(expired.text), "WAITLIST_OFFER_EXPIRED").not.toBeNull();
  });

  it("a retry after a failed send mints again, and the retry's link is the one that works", async () => {
    const ana = await registration("PENDING_DECLARATION");
    const failed = await renderOutboxMessage(row("COMPLETE_DECLARATION", ana.id), db, NOW);
    const retried = await renderOutboxMessage(row("COMPLETE_DECLARATION", ana.id), db, NOW);
    const failedSecret = CANNOT_COME_LINK.exec(failed.text)![2];
    const retriedSecret = CANNOT_COME_LINK.exec(retried.text)?.[2];
    expect(retriedSecret, "the retry carries the manage page too").toBeDefined();
    expect((await readActionTokenContext(db, { secret: retriedSecret!, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(true);
    expect((await readActionTokenContext(db, { secret: failedSecret, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(false);
  });

  it("an organizer's message after the confirmation lands on the registration's own manage page: its link is the live one, with the QR and «Am ajuns»", async () => {
    const ana = await registration("CONFIRMED");
    const confirmation = await renderOutboxMessage(row("REGISTRATION_CONFIRMED", ana.id), db, NOW);
    const confirmationSecret = CANNOT_COME_LINK.exec(confirmation.text)![2];

    // Race week: «Parcarea e la intrare» to every participant.
    const message = await renderOutboxMessage(
      row("ORGANIZER_MESSAGE", ana.id, { subject: { ro: "Parcare", en: "Parking" }, body: { ro: "Parcarea e la intrare.", en: "Parking is at the gate." } }),
      db,
      NOW,
    );
    const found = CANNOT_COME_LINK.exec(message.text);
    expect(found, "the organizer's message lands on the manage page, never «Înscrierile mele» by address").not.toBeNull();
    expect(message.text).not.toMatch(/Nu mai pot ajunge: \S+\/inscrieri\/ale-mele/);
    const newest = found![2];

    // The newest email's link is live and opens the registration's page — the QR and the check-in are there.
    expect((await readActionTokenContext(db, { secret: newest, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(true);
    const html = renderToStaticMarkup(
      (await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token: newest }), searchParams: Promise.resolve({}) })) as ReactElement,
    );
    expect(html).toContain("ABC123");
    expect(html).toContain('id="cancel"');
    // The confirmation's older link is superseded, as every newer manage link supersedes it.
    expect((await readActionTokenContext(db, { secret: confirmationSecret, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(false);

    // The organizer's update notice the same way.
    const update = await renderOutboxMessage(row("EVENT_UPDATE_NOTICE", ana.id, { changes: ["time"] }), db, NOW);
    expect(CANNOT_COME_LINK.exec(update.text)).not.toBeNull();
  });

  it("the family link: no button beside «Nu înscriu această persoană», at the limit or once the form is gone — and no manage link minted", async () => {
    const ana = await registration("CONFIRMED");
    for (const payload of [{ atCap: true, registrationsPerAddress: 4 }, { familyEntryId: "00000000-0000-4000-8000-000000000000" }]) {
      const message = await renderOutboxMessage(row("REGISTER_ANOTHER_PERSON", ana.id, payload), db, NOW);
      expect(message.text, JSON.stringify(payload)).not.toContain("Nu mai pot ajunge");
      expect(message.html).not.toContain('data-email-part="cannot-come"');
    }
    expect(await manageTokens(ana.id)).toHaveLength(0);
  });

  it("never on a club copy, never after the fact, never after the start, never to another address", async () => {
    const ana = await registration("CONFIRMED");
    // The club's copy of the reminder (§320): no token at all, no button.
    const copy = await renderOutboxMessage(row("EVENT_REMINDER", ana.id, { clubCopy: true }, null), db, NOW);
    expect(copy.text).not.toContain("Nu mai pot ajunge");
    expect(copy.html).not.toContain('data-email-part="cannot-come"');
    expect(await manageTokens(ana.id)).toHaveLength(0);

    // A message to an address that is not the registration's.
    const other = await participantFor("vecina@example.ro", "Vecina");
    const misaddressed = await renderOutboxMessage(row("ORGANIZER_MESSAGE", ana.id, {}, other), db, NOW);
    expect(misaddressed.text).not.toContain("Nu mai pot ajunge");
    expect(await manageTokens(ana.id)).toHaveLength(0);

    // After the start the page refuses a participant's cancel: no button promising it.
    const afterStart = new Date("2026-10-11T08:00:00.000Z");
    const late = await renderOutboxMessage(row("ORGANIZER_MESSAGE", ana.id), db, afterStart);
    expect(late.text).not.toContain("Nu mai pot ajunge");

    // A registration no longer active: its cancellation says so, and offers nothing to cancel.
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: NOW, cancellationSource: "PARTICIPANT" }).where(eq(registrations.id, ana.id));
    const cancelled = await renderOutboxMessage(row("REGISTRATION_CANCELLED", ana.id), db, NOW);
    expect(cancelled.text).not.toContain("Nu mai pot ajunge");
    const organizer = await renderOutboxMessage(row("ORGANIZER_MESSAGE", ana.id), db, NOW);
    expect(organizer.text).not.toContain("Nu mai pot ajunge");
    expect(await manageTokens(ana.id)).toHaveLength(0);

    // An event that will not run: nothing to give up.
    await db.update(registrations).set({ status: "CONFIRMED", cancelledAt: null, cancellationSource: null }).where(eq(registrations.id, ana.id));
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, eventId));
    const update = await renderOutboxMessage(row("EVENT_UPDATE_NOTICE", ana.id), db, NOW);
    expect(update.text).not.toContain("Nu mai pot ajunge");
  });
});
