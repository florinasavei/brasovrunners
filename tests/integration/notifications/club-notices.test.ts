import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { readClubNotices, updateClubNotices } from "@/modules/notifications/club-notices";
import { readOutboxQueue } from "@/modules/notifications/queue";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §244, §245 and §243 — the club's own copies, set in the backoffice; the
 * notice that somebody confirmed; and the queue the club can now read.
 *
 * The environment is deliberately *not* mocked here: `DECLARATIONS_ARCHIVE_TO` is unset in
 * tests, so everything below is the setting doing the work that the variable used to do —
 * which is the whole point of §244. `declaration-archive.test.ts` is the other half: the same
 * behaviour with the variable set and no setting written.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const ARCHIVE = "arhiva@example.test";
const AMALIA = "amalia@example.test";
const HIDDEN = "contabil@example.test";
const PRESIDENT = "presedinte@example.test";

async function approve(db: TestDatabase) {
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

async function createEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10, locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: "crosul-aniversar" },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: "anniversary-cross" },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: event.registrationMode,
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
  };
}

const submission = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

describe("the club's copies and the notice that somebody confirmed (§244, §245)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function administrator(db: TestDatabase) {
    const [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
    return admin;
  }

  async function setNotices(db: TestDatabase, value: Parameters<typeof updateClubNotices>[2]) {
    return updateClubNotices(db, await administrator(db), value, NOW);
  }

  async function signed(db: TestDatabase, event: EventForRegistration) {
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    return row;
  }

  it("sends the declaration to the mailbox the club named, with the copies it asked for", async () => {
    await approve(db);
    await setNotices(db, {
      declarations: { to: ARCHIVE, cc: [AMALIA], bcc: [HIDDEN] },
      confirmations: { to: [] },
    });
    const event = await createEvent(db);
    const row = await signed(db, event);

    const [archive] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.messageType, "DECLARATION_ARCHIVE"));
    expect(archive.recipientEmail).toBe(ARCHIVE);
    // The lists travel on the row, so a list edited tomorrow cannot redirect today's copy.
    expect(archive.payloadJson).toEqual({ cc: [AMALIA], bcc: [HIDDEN] });
    expect(archive.registrationId).toBe(row.id);

    const message = await renderOutboxMessage({ ...archive, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.to).toBe(ARCHIVE);
    expect(message.cc).toEqual([AMALIA]);
    expect(message.bcc).toEqual([HIDDEN]);
    // Still the club's copy: the PDF, and nothing a participant could act on (§12.8).
    expect(message.attachments).toHaveLength(1);
    expect(message.html).not.toMatch(/\/registrations\/manage\//);
  });

  it("tells each of the club's mailboxes that somebody confirmed, once each", async () => {
    await approve(db);
    await setNotices(db, {
      declarations: { to: "", cc: [], bcc: [] },
      confirmations: { to: [PRESIDENT, AMALIA] },
    });
    const event = await createEvent(db);
    const row = await signed(db, event);

    const notices = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.messageType, "CLUB_CONFIRMATION_NOTICE"));
    expect(notices.map((notice) => notice.recipientEmail).sort()).toEqual([AMALIA, PRESIDENT].sort());
    // No archive mailbox named: nothing was sent there, and the Cc list was not promoted.
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DECLARATION_ARCHIVE"))).toHaveLength(0);

    const rendered = await renderOutboxMessage({ ...notices[0], status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(rendered.subject).toContain("Înscriere confirmată: Ana Popescu — Crosul aniversar");
    expect(rendered.text).toContain("Crosul aniversar");
    // A club mailbox gets no token, no QR and no check-in code — none of it means anything there.
    expect(rendered.html).not.toMatch(/\/registrations\/manage\//);
    expect(rendered.html).not.toMatch(/\/api\/registrations\/qr\//);
    expect(rendered.attachments ?? []).toHaveLength(0);
    expect(notices[0].registrationId).toBe(row.id);
  });

  it("tells the club nothing about a test registration", async () => {
    await approve(db);
    await setNotices(db, {
      declarations: { to: ARCHIVE, cc: [], bcc: [] },
      confirmations: { to: [PRESIDENT] },
    });
    const event = await createEvent(db);
    const [admin] = await db.select().from(staffUsers);
    await addTestRegistrations(db, admin, { eventId: event.id, count: 1, now: NOW });
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Runner Test")), idDocument: "BV 000000" }, NOW);

    const types = (await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, row.id))).map((r) => r.messageType);
    expect(types).toContain("REGISTRATION_CONFIRMED");
    expect(types).not.toContain("DECLARATION_ARCHIVE");
    expect(types).not.toContain("CLUB_CONFIRMATION_NOTICE");
  });

  it("keeps who receives what, and audits the change", async () => {
    await setNotices(db, {
      declarations: { to: ARCHIVE, cc: [AMALIA, AMALIA], bcc: [] },
      confirmations: { to: [PRESIDENT] },
    });
    const stored = await readClubNotices(db);
    // The same mailbox twice is one mailbox, and what is stored is what will be sent.
    expect(stored.declarations).toEqual({ to: ARCHIVE, cc: [AMALIA], bcc: [] });
    expect(stored.confirmations.to).toEqual([PRESIDENT]);
    expect(stored.updatedAt).toEqual(NOW);
  });

  it("refuses the whole change when one address is not one", async () => {
    await setNotices(db, { declarations: { to: ARCHIVE, cc: [], bcc: [] }, confirmations: { to: [] } });
    await expect(
      setNotices(db, { declarations: { to: ARCHIVE, cc: ["not an address"], bcc: [] }, confirmations: { to: [] } }),
    ).rejects.toThrow();
    // The stored list is the one that validated, not a half-applied edit.
    expect((await readClubNotices(db)).declarations.to).toBe(ARCHIVE);
  });

  it("shows the club what is queued: the unsent rows, oldest first (§243)", async () => {
    await approve(db);
    await setNotices(db, {
      declarations: { to: ARCHIVE, cc: [], bcc: [] },
      confirmations: { to: [PRESIDENT] },
    });
    const event = await createEvent(db);
    await signed(db, event);

    // One row has already gone; the queue is what is still owed.
    const [first] = await db.select().from(emailOutbox);
    await db.update(emailOutbox).set({ status: "SENT", sentAt: NOW }).where(eq(emailOutbox.id, first.id));

    const queue = await readOutboxQueue(db);
    const rows = await db.select().from(emailOutbox);
    expect(queue.total).toBe(rows.length - 1);
    expect(queue.rows.map((row) => row.id)).not.toContain(first.id);
    expect(queue.rows.map((row) => row.messageType)).toContain("CLUB_CONFIRMATION_NOTICE");
    // Oldest first: the queue's own order, so what has waited longest is explained first.
    const queuedAt = queue.rows.map((row) => row.createdAt.getTime());
    expect([...queuedAt].sort((a, b) => a - b)).toEqual(queuedAt);
    // What the panel prints, and nothing the row does not hold: no body, no token.
    expect(queue.rows[0]).toMatchObject({ attemptCount: 0, lastError: null, isManualResend: false });
  });

  it("counts a failed row into the queue, because a count of what is waiting hides it", async () => {
    await db.insert(emailOutbox).values({
      messageType: "REGISTRATION_CONFIRMED",
      locale: "ro",
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: "failed-one",
      status: "FAILED",
      attemptCount: 6,
      lastError: "550 mailbox unavailable",
      createdAt: NOW,
    });
    await db.insert(emailOutbox).values({
      messageType: "REGISTRATION_CONFIRMED",
      locale: "ro",
      recipientEmail: "ion@example.ro",
      payloadJson: {},
      idempotencyKey: "sent-one",
      status: "SENT",
      sentAt: NOW,
      createdAt: NOW,
    });

    const queue = await readOutboxQueue(db);
    expect(queue.total).toBe(1);
    expect(queue.rows[0]).toMatchObject({ status: "FAILED", attemptCount: 6, lastError: "550 mailbox unavailable" });
  });
});
