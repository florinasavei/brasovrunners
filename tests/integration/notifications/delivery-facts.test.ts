import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { selectConfirmationRetryRows } from "@/modules/notifications/confirmation-retry";
import { listClubMailboxRejections, readDeliveryEvidence } from "@/modules/notifications/delivery-evidence";
import { noteSentAgain } from "@/modules/notifications/delivery-facts";
import { applyMailgunEvent, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import {
  countNeedingEmailActionForAdmin,
  findRegistrationDetailForAdmin,
  listDeskRegistrations,
  listOutboxHistory,
  listRegistrationsForAdmin,
} from "@/modules/registrations/admin-repository";
import { needsEmailAction } from "@/modules/registrations/domain/email-state";
import { countNeedingEmailActionByEvent } from "@/modules/registrations/email-state";
import { resolveDisplayName } from "@/modules/registrations/names";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-04, BR-REQ-080-02, BR-REQ-038-01 (§NNN; amending §663, §76/§83, §320, §622, §653) — the stored
 * facts tell the truth, and one email state per registration is read from them:
 *
 * - the webhook keeps a delivery once, a refusal with its instant, cause, code and redacted words, an event
 *   for a copy on the archive's envelope apart from the row, and settles the participant's earlier refusals
 *   the same way whatever order the events arrive in;
 * - the send keeps a refusal at the send the same way, and a message sent again marks the refusal before it;
 * - the registration's state: the club's own mail never lights it; the club's account refused it is
 *   «not sent»; the address working again leaves the message «missing» until the same one is delivered; a
 *   message sent again waits («retried»); a family member's refusal at the same event marks the address.
 * - what a message carries answers a refusal of what it carries (the confirmation the race number and the
 *   signed declaration), written when it is sent or delivered; a refusal the registration no longer needs
 *   asks nobody to act; a family member's refusal reads the same on every registration it shows on.
 */
const T0 = new Date("2026-10-08T08:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function race(startsAt = new Date("2099-11-21T08:00:00.000Z")) {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt,
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-${serial}-ro`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cros-${serial}-en`, title: "Crosul" },
  ]);
  return event;
}

async function person(email: string) {
  const [row] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email.toLowerCase(), canonicalEmail: email.toLowerCase(), canonicalizationVersion: 2, defaultName: "Ana Pop", preferredLocale: "ro" })
    .returning();
  return row.id;
}

async function register(eventId: string, participantId: string, overrides: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date("2026-09-30T08:00:00.000Z"),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      emailConfirmedAt: new Date("2026-10-01T08:00:00.000Z"),
      confirmedAt: new Date("2026-10-01T08:00:00.000Z"),
      ...overrides,
    })
    .returning({ id: registrations.id });
  return row.id;
}

type RowInput = {
  participantId: string | null;
  registrationId: string | null;
  messageType: EmailMessageType;
  recipientEmail?: string;
  status?: "PENDING" | "SENT" | "BOUNCED" | "COMPLAINED";
  sentAt?: Date | null;
  createdAt?: Date;
  payloadJson?: Record<string, unknown>;
  providerMessageId?: string | null;
  lastError?: string | null;
  rejectionCause?: string | null;
  transport?: "mailgun" | "gmail" | null;
};

async function outboxRow(input: RowInput) {
  serial += 1;
  const status = input.status ?? "SENT";
  const sentAt = input.sentAt === undefined ? (status === "PENDING" ? null : (input.createdAt ?? T0)) : input.sentAt;
  const [row] = await db
    .insert(emailOutbox)
    .values({
      participantId: input.participantId,
      registrationId: input.registrationId,
      messageType: input.messageType,
      locale: "ro",
      recipientEmail: input.recipientEmail ?? "ana@example.org",
      payloadJson: input.payloadJson ?? {},
      idempotencyKey: `row-${serial}`,
      status,
      sentAt,
      createdAt: input.createdAt ?? T0,
      providerMessageId: input.providerMessageId === undefined ? `msg-${serial}@mail.example.org` : input.providerMessageId,
      lastError: input.lastError ?? null,
      rejectionCause: input.rejectionCause ?? null,
      transport: input.transport ?? (sentAt ? "mailgun" : null),
    })
    .returning();
  return row;
}

const read = async (id: string) => (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];

function event(row: { providerMessageId: string | null }, kind: "delivered" | "failed" | "complained", at: Date, extra: Partial<Parameters<typeof applyMailgunEvent>[1]> = {}) {
  return applyMailgunEvent(db, {
    providerMessageId: row.providerMessageId,
    event: kind,
    severity: kind === "failed" ? "permanent" : null,
    reason: kind === "failed" ? "bounce" : null,
    recipient: "ana@example.org",
    occurredAt: at,
    now: minutes(24 * 60),
    ...extra,
  });
}

describe("the webhook keeps what the provider said (BR-REQ-080-04)", () => {
  it("a delivery is kept once, never moves the status, and needs a recipient", async () => {
    const p = await person("ana@example.org");
    const row = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK" });
    await event(row, "delivered", minutes(1));
    await event(row, "delivered", minutes(5));
    const after = await read(row.id);
    expect(after.deliveredAt).toEqual(minutes(1));
    expect(after.status).toBe("SENT");

    const nameless = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK" });
    await event(nameless, "delivered", minutes(2), { recipient: null });
    expect((await read(nameless.id)).deliveredAt).toBeNull();
  });

  it("a refusal keeps its instant, cause, code and redacted words; never later than now", async () => {
    const p = await person("ana@example.org");
    const row = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK" });
    await event(row, "failed", minutes(3), { code: "550 5.1.1", detail: "<address> unknown", cause: "no-such-address" });
    const after = await read(row.id);
    expect(after).toMatchObject({ status: "BOUNCED", rejectionCause: "no-such-address", providerCode: "550 5.1.1", providerDetail: "<address> unknown", lastError: "bounce" });
    expect(after.rejectedAt).toEqual(minutes(3));

    const future = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK" });
    await event(future, "failed", minutes(10 * 24 * 60));
    expect((await read(future.id)).rejectedAt).toEqual(minutes(24 * 60));
    // Without a cause from the route, the stored words are read: a bare «bounce» is refused, the cause not recorded.
    expect((await read(future.id)).rejectionCause).toBe("refused");
  });

  it("a failure after a delivery is BOUNCED and keeps the delivery; a complaint is not overwritten by a bounce", async () => {
    const p = await person("ana@example.org");
    const late = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK" });
    await event(late, "delivered", minutes(1));
    await event(late, "failed", minutes(30));
    expect(await read(late.id)).toMatchObject({ status: "BOUNCED", deliveredAt: minutes(1), rejectedAt: minutes(30) });

    const spam = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK" });
    await event(spam, "complained", minutes(2));
    await event(spam, "failed", minutes(3));
    expect(await read(spam.id)).toMatchObject({ status: "COMPLAINED", rejectionCause: "complained", rejectedAt: minutes(2) });
  });

  it("an event for a copy on the archive's envelope leaves the row alone; a participant's message takes a respelled recipient", async () => {
    const p = await person("ana@example.org");
    const archive = await outboxRow({
      participantId: p,
      registrationId: null,
      messageType: "DECLARATION_ARCHIVE",
      recipientEmail: "archive@example.org",
      payloadJson: { cc: ["office@example.org"], bcc: [] },
    });
    await event(archive, "failed", minutes(2), { recipient: "office@example.org" });
    expect((await read(archive.id)).status).toBe("SENT");
    await event(archive, "failed", minutes(3), { recipient: "Archive@Example.org" });
    expect((await read(archive.id)).status).toBe("BOUNCED");

    const own = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", recipientEmail: "Ana@Example.org" });
    await event(own, "failed", minutes(4), { recipient: "someone-else@example.org" });
    expect((await read(own.id)).status).toBe("BOUNCED");
  });

  it("finds a row by its own key when no row carries the provider's id — only one that left", async () => {
    const p = await person("ana@example.org");
    const left = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", providerMessageId: null });
    await applyMailgunEvent(db, { providerMessageId: "unknown", idempotencyKey: left.idempotencyKey, event: "failed", severity: "permanent", reason: "bounce", recipient: "ana@example.org", occurredAt: minutes(1), now: minutes(60) });
    expect((await read(left.id)).status).toBe("BOUNCED");
    const queued = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", status: "PENDING", providerMessageId: null });
    await applyMailgunEvent(db, { providerMessageId: null, idempotencyKey: queued.idempotencyKey, event: "failed", severity: "permanent", reason: "bounce", recipient: "ana@example.org", now: minutes(60) });
    expect((await read(queued.id)).status).toBe("PENDING");
  });

  it("settles the same whatever order the events arrive in", async () => {
    for (const order of ["refusal first", "delivery first"] as const) {
      await resetTables(db);
      const p = await person("ana@example.org");
      const refused = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", createdAt: minutes(0) });
      const before = await outboxRow({ participantId: p, registrationId: null, messageType: "REGISTRATION_MANAGE_LINK", createdAt: minutes(0) });
      const later = await outboxRow({ participantId: p, registrationId: null, messageType: "REGISTRATION_MANAGE_LINK", createdAt: minutes(20) });
      const steps = [() => event(refused, "failed", minutes(10)), () => event(later, "delivered", minutes(25)), () => event(before, "delivered", minutes(5))];
      if (order === "delivery first") steps.reverse();
      for (const step of steps) await step();
      // Only the delivery after the refusal answers it, whichever was processed first.
      expect((await read(refused.id)).laterDeliveredAt, order).toEqual(minutes(25));
    }
  });

  it("the same message delivered later resolves a refusal; another message only says the address works", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    const qr = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", createdAt: minutes(0) });
    await event(qr, "failed", minutes(1));
    const reminder = await outboxRow({ participantId: p, registrationId: reg, messageType: "EVENT_REMINDER", createdAt: minutes(10) });
    await event(reminder, "delivered", minutes(11));
    expect(await read(qr.id)).toMatchObject({ laterDeliveredAt: minutes(11), resolvedAt: null });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState?.kind).toBe("missing");

    const again = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", createdAt: minutes(20) });
    await event(again, "delivered", minutes(21));
    expect((await read(qr.id)).resolvedAt).toEqual(minutes(21));
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toBeNull();
  });

  it("never clears a complaint, and never gives the club's account refusal a later delivery", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    const spam = await outboxRow({ participantId: p, registrationId: reg, messageType: "ORGANIZER_MESSAGE", createdAt: minutes(0) });
    await event(spam, "complained", minutes(1));
    const account = await outboxRow({
      participantId: p,
      registrationId: reg,
      messageType: "BIB_ASSIGNED",
      status: "BOUNCED",
      sentAt: null,
      createdAt: minutes(2),
      lastError: "mailgun 401: Forbidden",
      rejectionCause: "account",
    });
    const later = await outboxRow({ participantId: p, registrationId: reg, messageType: "EVENT_REMINDER", createdAt: minutes(10) });
    await event(later, "delivered", minutes(11));
    expect(await read(spam.id)).toMatchObject({ status: "COMPLAINED", laterDeliveredAt: null, resolvedAt: null });
    expect((await read(account.id)).laterDeliveredAt).toBeNull();
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "unreachable", status: "COMPLAINED", cause: "complained" });
  });
});

/** An adapter that answers however the test needs. */
function sender(result: SendResult): EmailSender {
  return { send: async () => result };
}

async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: row.messageType, html: row.messageType, text: row.messageType, locale: row.locale, idempotencyKey: row.idempotencyKey };
}

describe("the send keeps what the provider said (BR-REQ-080-02)", () => {
  it("a refusal at the send is BOUNCED with its instant, its cause and its code", async () => {
    const p = await person("ana@example.org");
    const row = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", status: "PENDING", providerMessageId: null });
    await processOutboxBatch(db, { sender: sender({ outcome: "permanent_failure", error: "mailgun 400: 'to' parameter is not a valid address. please check documentation" }), render, now: minutes(1) });
    const after = await read(row.id);
    expect(after).toMatchObject({ status: "BOUNCED", sentAt: null, rejectionCause: "no-such-address", providerCode: "400" });
    expect(after.rejectedAt?.getTime()).toBeGreaterThanOrEqual(minutes(1).getTime());
  });

  it("the same message sent again marks the refusal, by its road; the club's account refusal is over with it", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    const account = await outboxRow({
      participantId: p,
      registrationId: reg,
      messageType: "REGISTRATION_CONFIRMED",
      status: "BOUNCED",
      sentAt: null,
      createdAt: minutes(0),
      lastError: "mailgun 400: Domain mail.example.org is not allowed to send: recipient limit exceeded",
      rejectionCause: "account",
    });
    const bounced = await outboxRow({ participantId: p, registrationId: reg, messageType: "BIB_ASSIGNED", status: "BOUNCED", createdAt: minutes(1), rejectionCause: "mailbox-full" });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "unreachable", messageType: "BIB_ASSIGNED" });

    await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", status: "PENDING", createdAt: minutes(5), providerMessageId: null });
    await outboxRow({ participantId: p, registrationId: reg, messageType: "BIB_ASSIGNED", status: "PENDING", createdAt: minutes(6), providerMessageId: null });
    await processOutboxBatch(db, { sender: sender({ outcome: "sent", providerMessageId: "gmail-1", transport: "gmail", acceptedAt: minutes(7) }), render, now: minutes(7) });

    expect(await read(account.id)).toMatchObject({ retriedAt: minutes(7), retriedVia: "gmail", resolvedAt: minutes(7) });
    expect(await read(bounced.id)).toMatchObject({ retriedAt: minutes(7), retriedVia: "gmail", resolvedAt: null });
    // The race number's refusal waits — by Gmail, whose delivery is never known.
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "retried", messageType: "BIB_ASSIGNED", retriedVia: "gmail" });
  });
});

describe("a complaint sent again", () => {
  it("takes `retried_at`, whichever is processed first, and stays the person's word", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    // The send after the complaint is recorded.
    const spam = await outboxRow({ participantId: p, registrationId: reg, messageType: "ORGANIZER_MESSAGE", createdAt: minutes(0) });
    await event(spam, "complained", minutes(1));
    await outboxRow({ participantId: p, registrationId: reg, messageType: "ORGANIZER_MESSAGE", status: "PENDING", createdAt: minutes(5), providerMessageId: null });
    await processOutboxBatch(db, { sender: sender({ outcome: "sent", providerMessageId: "mg-again", transport: "mailgun", acceptedAt: minutes(6) }), render, now: minutes(6) });
    expect(await read(spam.id)).toMatchObject({ status: "COMPLAINED", retriedAt: minutes(6), retriedVia: "mailgun", resolvedAt: null, laterDeliveredAt: null });

    // The complaint reported after the send.
    const first = await outboxRow({ participantId: p, registrationId: reg, messageType: "EVENT_UPDATE_NOTICE", createdAt: minutes(10) });
    await outboxRow({ participantId: p, registrationId: reg, messageType: "EVENT_UPDATE_NOTICE", createdAt: minutes(11), sentAt: minutes(12), transport: "gmail" });
    await event(first, "complained", minutes(13));
    expect(await read(first.id)).toMatchObject({ status: "COMPLAINED", retriedAt: minutes(12), retriedVia: "gmail", resolvedAt: null, laterDeliveredAt: null });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "unreachable", status: "COMPLAINED" });
  });
});

describe("the registration's emails, as its page reads them (§NNN)", () => {
  it("newest first, by role, with every fact, who asked for a resend, and the provider's words on a refused row only", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    const [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@example.org", displayName: "Maria Admin", role: "ADMIN" })
      .returning();
    const qr = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", createdAt: minutes(0) });
    await event(qr, "failed", minutes(1), { code: "552 5.2.2", detail: "mailbox full", cause: "mailbox-full" });
    await outboxRow({ participantId: p, registrationId: reg, messageType: "DECLARATION_ARCHIVE", recipientEmail: "archive@example.org", createdAt: minutes(2) });
    await outboxRow({ participantId: null, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", recipientEmail: "office@example.org", payloadJson: { clubCopy: true }, createdAt: minutes(3) });
    await outboxRow({ participantId: p, registrationId: reg, messageType: "CLUB_CONFIRMATION_NOTICE", recipientEmail: "office@example.org", createdAt: minutes(4) });
    const resend = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", createdAt: minutes(5), transport: "gmail" });
    await db.update(emailOutbox).set({ isManualResend: true, requestedByStaffUserId: admin.id }).where(eq(emailOutbox.id, resend.id));
    await db.update(emailOutbox).set({ retriedAt: minutes(5), retriedVia: "gmail" }).where(eq(emailOutbox.id, qr.id));

    const history = await listOutboxHistory(db, reg);
    expect(history.map((row) => [row.messageType, row.recipientRole])).toEqual([
      ["REGISTRATION_CONFIRMED", "participant"],
      ["CLUB_CONFIRMATION_NOTICE", "notice"],
      ["REGISTRATION_CONFIRMED", "copy"],
      ["DECLARATION_ARCHIVE", "archive"],
      ["REGISTRATION_CONFIRMED", "participant"],
    ]);
    expect(history[0]).toMatchObject({ isManualResend: true, requestedByName: "Maria Admin", transport: "gmail", providerDetail: null, rejectionCause: null });
    expect(history[4]).toMatchObject({
      status: "BOUNCED",
      requestedByName: null,
      rejectedAt: minutes(1),
      rejectionCause: "mailbox-full",
      providerCode: "552 5.2.2",
      providerDetail: "mailbox full",
      retriedAt: minutes(5),
      retriedVia: "gmail",
    });
    // Never a club mailbox's address: the role says whose it was.
    expect(JSON.stringify(history)).not.toContain("example.org");
  });
});

describe("the registration's one email state (BR-REQ-038-01)", () => {
  it("the club's own mail never lights it: the archive copy, the confirmation notice, a club copy", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    for (const messageType of ["DECLARATION_ARCHIVE", "CLUB_CONFIRMATION_NOTICE"] as const) {
      await outboxRow({ participantId: p, registrationId: reg, messageType, recipientEmail: "club@example.org", status: "BOUNCED", rejectionCause: "no-such-address" });
    }
    await outboxRow({ participantId: null, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", recipientEmail: "club@example.org", status: "BOUNCED", payloadJson: { clubCopy: true } });
    const [row] = await listRegistrationsForAdmin(db, { eventId: r.id });
    expect(row.emailState).toBeNull();
    expect(await listRegistrationsForAdmin(db, { eventId: r.id, emailBounced: true })).toHaveLength(0);
  });

  it("the club's account refused it: «not sent», until the same message left again", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    await outboxRow({
      participantId: p,
      registrationId: reg,
      messageType: "REGISTRATION_CONFIRMED",
      status: "BOUNCED",
      sentAt: null,
      lastError: "mailgun 401: Forbidden",
      rejectionCause: "account",
    });
    expect((await listRegistrationsForAdmin(db, { eventId: r.id }))[0].emailState).toMatchObject({ kind: "not-sent", sent: false, cause: "account", own: true });
    expect(await countNeedingEmailActionByEvent(db, T0)).toEqual([{ eventId: r.id, count: 1 }]);
  });

  it("a family member's refusal at the same event marks the address; another event's does not", async () => {
    const r = await race();
    const other = await race(new Date("2099-12-01T08:00:00.000Z"));
    const p = await person("family@example.org");
    const parent = await register(r.id, p);
    const child = await register(r.id, p);
    const elsewhere = await register(other.id, p);
    await outboxRow({ participantId: p, registrationId: parent, messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", rejectionCause: "mailbox-full" });
    const child_ = await findRegistrationDetailForAdmin(db, child);
    expect(child_?.emailState).toMatchObject({ kind: "unreachable", own: false, messageType: "REGISTRATION_CONFIRMED" });
    expect((await findRegistrationDetailForAdmin(db, elsewhere))?.emailState).toBeNull();
  });

  it("the address first: a refusal with nothing delivered since outranks a message sent again", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    await outboxRow({ participantId: p, registrationId: reg, messageType: "EVENT_REMINDER", status: "BOUNCED", createdAt: minutes(0), rejectionCause: "blocked" });
    const qr = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", status: "BOUNCED", createdAt: minutes(5), rejectionCause: "blocked" });
    await db.update(emailOutbox).set({ retriedAt: minutes(10), retriedVia: "mailgun" }).where(eq(emailOutbox.id, qr.id));
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "unreachable", messageType: "EVENT_REMINDER" });
    // A retried state waits: it asks nobody to act.
    await db.update(emailOutbox).set({ laterDeliveredAt: minutes(11), resolvedAt: minutes(11) }).where(eq(emailOutbox.messageType, "EVENT_REMINDER"));
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "retried", messageType: "REGISTRATION_CONFIRMED" });
    expect(await countNeedingEmailActionByEvent(db, T0)).toEqual([]);
    // «Doar cu un email respins», its count and the export read the same: a message sent again is not kept.
    expect(await listRegistrationsForAdmin(db, { eventId: r.id, emailBounced: true })).toHaveLength(0);
    expect(await countNeedingEmailActionForAdmin(db, { eventId: r.id })).toBe(0);
    expect(needsEmailAction((await listRegistrationsForAdmin(db, { eventId: r.id }))[0].emailState)).toBe(false);
  });

  it("«Doar cu un email respins» keeps what asks somebody to act, and its count says how many", async () => {
    const r = await race();
    const states = ["unreachable", "not-sent", "missing", "retried", "none"] as const;
    for (const state of states) {
      const p = await person(`${state}@example.org`);
      const reg = await register(r.id, p);
      if (state === "none") continue;
      const row = await outboxRow({
        participantId: p,
        registrationId: reg,
        messageType: "REGISTRATION_CONFIRMED",
        status: "BOUNCED",
        sentAt: state === "not-sent" ? null : minutes(0),
        lastError: state === "not-sent" ? "mailgun 401: Forbidden" : "bounce",
        rejectionCause: state === "not-sent" ? "account" : "refused",
      });
      if (state === "missing") await db.update(emailOutbox).set({ laterDeliveredAt: minutes(5) }).where(eq(emailOutbox.id, row.id));
      if (state === "retried") await db.update(emailOutbox).set({ retriedAt: minutes(5), retriedVia: "mailgun" }).where(eq(emailOutbox.id, row.id));
    }
    const listed = await listRegistrationsForAdmin(db, { eventId: r.id });
    expect(listed.map((row) => row.emailState?.kind ?? "none").sort()).toEqual([...states].sort());
    const kept = await listRegistrationsForAdmin(db, { eventId: r.id, emailBounced: true });
    expect(kept.map((row) => row.emailState?.kind).sort()).toEqual(["missing", "not-sent", "unreachable"]);
    expect(await countNeedingEmailActionForAdmin(db, { eventId: r.id })).toBe(3);
    expect(listed.filter((row) => needsEmailAction(row.emailState))).toHaveLength(3);
  });

  it("the desk reads what did not arrive and why, never the provider's words; the page reads them", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p, { bibNumber: 17 });
    const qr = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED" });
    await event(qr, "failed", minutes(1), { code: "550 5.1.1", detail: "mailbox <address> unknown at relay", cause: "no-such-address" });
    const [desk] = await listDeskRegistrations(db, { eventId: r.id, query: "", locale: "ro" });
    expect(desk.emailState).toEqual({
      kind: "unreachable",
      messageType: "REGISTRATION_CONFIRMED",
      at: minutes(1),
      sent: true,
      status: "BOUNCED",
      cause: "no-such-address",
      own: true,
      press: "confirmation",
      laterDeliveredAt: null,
      retriedAt: null,
      retriedVia: null,
    });
    expect(JSON.stringify(desk)).not.toContain("relay");
    const [listed] = await listRegistrationsForAdmin(db, { eventId: r.id });
    expect(JSON.stringify(listed)).not.toContain("relay");
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ code: "550 5.1.1", detail: "mailbox <address> unknown at relay" });
  });
});

describe("what the club's side reads", () => {
  it("lists every club mailbox's refusal by its role, the address only while it is still the club's", async () => {
    const p = await person("ana@example.org");
    await outboxRow({ participantId: p, registrationId: null, messageType: "DECLARATION_ARCHIVE", recipientEmail: "Archive@example.org", status: "BOUNCED", rejectionCause: "mailbox-full", createdAt: minutes(1) });
    await outboxRow({ participantId: null, registrationId: null, messageType: "REGISTRATION_CONFIRMED", recipientEmail: "office@example.org", status: "BOUNCED", payloadJson: { clubCopy: true }, createdAt: minutes(2) });
    // A mailbox the club has since removed: listed by its role, without its address.
    await outboxRow({ participantId: null, registrationId: null, messageType: "CLUB_CONFIRMATION_NOTICE", recipientEmail: "former@example.org", status: "BOUNCED", lastError: "bounce", createdAt: minutes(3) });
    // Never a subscriber's, nor a participant's own.
    await outboxRow({ participantId: null, registrationId: null, messageType: "NEWSLETTER", recipientEmail: "archive@example.org", status: "BOUNCED", createdAt: minutes(4) });
    await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", recipientEmail: "archive@example.org", status: "BOUNCED", createdAt: minutes(5) });
    // Before the window.
    await outboxRow({ participantId: null, registrationId: null, messageType: "DECLARATION_ARCHIVE", recipientEmail: "archive@example.org", status: "BOUNCED", createdAt: minutes(-60) });
    const listed = await listClubMailboxRejections(db, { since: T0, mailboxes: ["archive@example.org", "office@example.org"] });
    expect(listed.map((row) => [row.role, row.messageType, row.recipientEmail, row.cause])).toEqual([
      ["notice", "CLUB_CONFIRMATION_NOTICE", null, "refused"],
      ["copy", "REGISTRATION_CONFIRMED", "office@example.org", "other"],
      ["archive", "DECLARATION_ARCHIVE", "Archive@example.org", "mailbox-full"],
    ]);
    // Nothing configured: the refusals are still the club's to see, without an address.
    expect((await listClubMailboxRejections(db, { since: T0, mailboxes: [] })).map((row) => row.recipientEmail)).toEqual([null, null, null]);
  });

  it("applies its limit in SQL, newest first, so a busy mailbox cannot push another out after the fact", async () => {
    for (let index = 0; index < 5; index += 1) {
      await outboxRow({ participantId: null, registrationId: null, messageType: "DECLARATION_ARCHIVE", recipientEmail: `old-${index}@example.org`, status: "BOUNCED", createdAt: minutes(index) });
    }
    await outboxRow({ participantId: null, registrationId: null, messageType: "DECLARATION_ARCHIVE", recipientEmail: "archive@example.org", status: "BOUNCED", createdAt: minutes(10) });
    const listed = await listClubMailboxRejections(db, { since: T0, mailboxes: ["archive@example.org"], limit: 2 });
    expect(listed.map((row) => row.recipientEmail)).toEqual(["archive@example.org", null]);
  });

  it("counts the participants' Mailgun messages of the last seven days against those delivered", async () => {
    const p = await person("ana@example.org");
    const now = minutes(24 * 60);
    await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", createdAt: minutes(60), transport: "mailgun" });
    // Gmail's road reports no delivery; the club's own and an older send are not read.
    await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", createdAt: minutes(61), transport: "gmail" });
    await outboxRow({ participantId: p, registrationId: null, messageType: "DECLARATION_ARCHIVE", recipientEmail: "archive@example.org", createdAt: minutes(61), transport: "mailgun" });
    await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", createdAt: minutes(-8 * 24 * 60), transport: "mailgun" });
    expect(await readDeliveryEvidence(db, now)).toEqual({ mailgunSent: 1, delivered: 0, lastDeliveredAt: null });
    const delivered = await outboxRow({ participantId: p, registrationId: null, messageType: "PROFILE_MANAGE_LINK", createdAt: minutes(62) });
    await event(delivered, "delivered", minutes(63));
    expect(await readDeliveryEvidence(db, now)).toEqual({ mailgunSent: 2, delivered: 1, lastDeliveredAt: minutes(63) });
  });
});

describe("the automatic re-send's refusal (§653)", () => {
  it("holds back an address whose refusal stands; not the club's account, not a refusal answered by a delivery", async () => {
    const r = await race();
    const from = minutes(0);
    const candidates = await Promise.all(
      ["standing@example.org", "account@example.org", "answered@example.org", "complained@example.org"].map(async (email) => {
        const p = await person(email);
        await register(r.id, p, { status: "PENDING_EMAIL_CONFIRMATION", emailConfirmedAt: null, confirmedAt: null, emailLinkExpiresAt: minutes(40 * 60) });
        return p;
      }),
    );
    const [standing, account, answered, complained] = candidates;
    await outboxRow({ participantId: standing, registrationId: null, messageType: "PROFILE_MANAGE_LINK", status: "BOUNCED", rejectionCause: "no-such-address" });
    await outboxRow({ participantId: account, registrationId: null, messageType: "PROFILE_MANAGE_LINK", status: "BOUNCED", sentAt: null, rejectionCause: "account", lastError: "mailgun 401: Forbidden" });
    const cleared = await outboxRow({ participantId: answered, registrationId: null, messageType: "PROFILE_MANAGE_LINK", status: "BOUNCED", rejectionCause: "mailbox-full" });
    await db.update(emailOutbox).set({ laterDeliveredAt: minutes(5) }).where(eq(emailOutbox.id, cleared.id));
    const spam = await outboxRow({ participantId: complained, registrationId: null, messageType: "PROFILE_MANAGE_LINK", status: "COMPLAINED", rejectionCause: "complained" });
    await db.update(emailOutbox).set({ laterDeliveredAt: minutes(5) }).where(eq(emailOutbox.id, spam.id));
    // A club mailbox's refusal of the archive copy says nothing about the person.
    await outboxRow({ participantId: answered, registrationId: null, messageType: "DECLARATION_ARCHIVE", recipientEmail: "archive@example.org", status: "BOUNCED" });
    const { refused } = await selectConfirmationRetryRows(db, from, { confirmationHours: 48 });
    expect([...refused].sort()).toEqual([standing, complained].sort());
  });
});

/** A participant's message queued now and sent by the outbox, as «Retrimite QR» queues the confirmation. */
async function sendNow(input: { participantId: string; registrationId: string; messageType: EmailMessageType; at: Date; transport?: "mailgun" | "gmail" }) {
  const row = await outboxRow({ ...input, status: "PENDING", createdAt: input.at, providerMessageId: null });
  await processOutboxBatch(db, {
    sender: sender({ outcome: "sent", providerMessageId: `mg-${row.idempotencyKey}`, transport: input.transport ?? "mailgun", acceptedAt: input.at }),
    render,
    now: input.at,
  });
  return read(row.id);
}

describe("what a message carries answers a refusal of it (BR-REQ-038-01, §NNN)", () => {
  it("a race number refused on 1-2 October, then «Retrimite QR»: sent again, and over once the confirmation arrives", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p, { bibNumber: 17 });
    // The account's refusal, as the 1-2 October rows read now; and a refusal of the address answered since.
    const account = await outboxRow({
      participantId: p,
      registrationId: reg,
      messageType: "BIB_ASSIGNED",
      status: "BOUNCED",
      sentAt: null,
      createdAt: minutes(0),
      lastError: "mailgun 400: Domain mail.example.org is not allowed to send: recipient limit exceeded",
      rejectionCause: "account",
    });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "not-sent", messageType: "BIB_ASSIGNED", press: "confirmation" });

    const confirmation = await sendNow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", at: minutes(10) });
    // The confirmation carries the number and its QR: the account's refusal is over, and it says it was sent again.
    expect(await read(account.id)).toMatchObject({ retriedAt: minutes(10), retriedVia: "mailgun", resolvedAt: minutes(10) });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toBeNull();
    await event(confirmation, "delivered", minutes(11));
    expect((await read(account.id)).resolvedAt).toEqual(minutes(10));
  });

  it("a race number the address refused: «Retrimite QR» waits for its delivery, which ends it — whichever is processed first — and the ending outlives the sent rows", async () => {
    for (const order of ["refusal first", "delivery first"] as const) {
      await resetTables(db);
      const r = await race();
      const p = await person("ana@example.org");
      const reg = await register(r.id, p, { bibNumber: 17 });
      const bib = await outboxRow({ participantId: p, registrationId: reg, messageType: "BIB_ASSIGNED", createdAt: minutes(0) });
      const notice = await outboxRow({ participantId: p, registrationId: reg, messageType: "ORGANIZER_MESSAGE", createdAt: minutes(2) });
      const confirmation = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", createdAt: minutes(10), transport: "mailgun" });
      const steps = [() => event(bib, "failed", minutes(1)), () => event(notice, "delivered", minutes(3)), () => event(confirmation, "delivered", minutes(11))];
      if (order === "delivery first") steps.reverse();
      for (const step of steps) await step();
      // A delivered «Mesaj de la organizatori» says only that the address works; the confirmation carries the number.
      expect(await read(bib.id), order).toMatchObject({ laterDeliveredAt: minutes(3), resolvedAt: minutes(11) });
      expect((await findRegistrationDetailForAdmin(db, reg))?.emailState, order).toBeNull();
      // The retention sweep deletes sent rows after 90 days: the refusal stays answered.
      await db.delete(emailOutbox).where(inArray(emailOutbox.id, [notice.id, confirmation.id]));
      expect((await findRegistrationDetailForAdmin(db, reg))?.emailState, order).toBeNull();
      expect(await listRegistrationsForAdmin(db, { eventId: r.id, emailBounced: true }), order).toHaveLength(0);
    }
  });

  it("the signed declaration refused: the confirmation, which carries the PDF, answers it; another message does not", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    const signed = await outboxRow({ participantId: p, registrationId: reg, messageType: "DECLARATION_SIGNED", createdAt: minutes(0) });
    await event(signed, "failed", minutes(1));
    const reminder = await outboxRow({ participantId: p, registrationId: reg, messageType: "EVENT_REMINDER", createdAt: minutes(5) });
    await event(reminder, "delivered", minutes(6));
    expect(await read(signed.id)).toMatchObject({ laterDeliveredAt: minutes(6), resolvedAt: null });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "missing", messageType: "DECLARATION_SIGNED", press: "confirmation" });
    const confirmation = await sendNow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", at: minutes(20) });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "retried", messageType: "DECLARATION_SIGNED" });
    await event(confirmation, "delivered", minutes(21));
    expect((await read(signed.id)).resolvedAt).toEqual(minutes(21));
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toBeNull();
  });
});

describe("a refusal speaks only while the registration still needs what it refused (BR-REQ-038-01, §NNN)", () => {
  /** A refusal of `messageType` to an address that has answered since (a later message delivered): owed, if still needed. */
  async function owed(registrationId: string, participantId: string, messageType: EmailMessageType, extra: Partial<RowInput> = {}) {
    const row = await outboxRow({ participantId, registrationId, messageType, status: "BOUNCED", createdAt: minutes(0), rejectionCause: "mailbox-full", ...extra });
    await db.update(emailOutbox).set({ laterDeliveredAt: minutes(5) }).where(eq(emailOutbox.id, row.id));
    return row;
  }

  it("a verification, a declaration link and an offer the registration has moved past ask nobody to act; while it waits on them, they do", async () => {
    const r = await race();
    const cases: Array<[EmailMessageType, "PENDING_EMAIL_CONFIRMATION" | "PENDING_DECLARATION" | "WAITLIST_OFFERED"]> = [
      ["VERIFY_REGISTRATION_EMAIL", "PENDING_EMAIL_CONFIRMATION"],
      ["COMPLETE_DECLARATION", "PENDING_DECLARATION"],
      ["WAITLIST_SPOT_OFFER", "WAITLIST_OFFERED"],
    ];
    for (const [messageType, waiting] of cases) {
      const p = await person(`${messageType.toLowerCase()}@example.org`);
      const reg = await register(r.id, p, { status: waiting, confirmedAt: null });
      const row = await owed(reg, p, messageType);
      expect((await findRegistrationDetailForAdmin(db, reg))?.emailState, messageType).toMatchObject({ kind: "missing", messageType, press: "resend" });
      // The registration moves on: confirmed. Nothing the page can send would clear it, and nothing is owed.
      await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: minutes(6) }).where(eq(registrations.id, reg));
      expect((await findRegistrationDetailForAdmin(db, reg))?.emailState, messageType).toBeNull();
      // The same for the account's refusal of it, sent never: «not sent» asks nothing once it is not needed.
      await db.update(emailOutbox).set({ rejectionCause: "account", sentAt: null, laterDeliveredAt: null }).where(eq(emailOutbox.id, row.id));
      expect((await findRegistrationDetailForAdmin(db, reg))?.emailState, messageType).toBeNull();
      // It stays in the registration's history.
      expect((await listOutboxHistory(db, reg)).map((entry) => entry.messageType), messageType).toContain(messageType);
    }
    expect(await listRegistrationsForAdmin(db, { eventId: r.id, emailBounced: true })).toHaveLength(0);
    expect(await countNeedingEmailActionForAdmin(db, { eventId: r.id })).toBe(0);
    expect(await countNeedingEmailActionByEvent(db, T0)).toEqual([]);
    expect((await listRegistrationsForAdmin(db, { eventId: r.id })).some((row) => needsEmailAction(row.emailState))).toBe(false);
  });

  it("an address that refuses the club's mail stays the call list, whatever the message and the registration's state", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    await outboxRow({ participantId: p, registrationId: reg, messageType: "VERIFY_REGISTRATION_EMAIL", status: "BOUNCED", createdAt: minutes(0), rejectionCause: "no-such-address" });
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "unreachable", messageType: "VERIFY_REGISTRATION_EMAIL" });
    expect(await countNeedingEmailActionForAdmin(db, { eventId: r.id })).toBe(1);
  });

  it("the reminder is owed only while «Trimite reminderul» can send it: the event ahead, never past or cancelled", async () => {
    const ahead = await race();
    const past = await race(new Date("2026-09-01T08:00:00.000Z"));
    for (const event_ of [ahead, past]) {
      const p = await person(`reminder-${event_.id}@example.org`);
      const reg = await register(event_.id, p);
      await owed(reg, p, "EVENT_REMINDER");
    }
    const [aheadRow] = await listRegistrationsForAdmin(db, { eventId: ahead.id });
    expect(aheadRow.emailState).toMatchObject({ kind: "missing", messageType: "EVENT_REMINDER", press: "reminder" });
    const [pastRow] = await listRegistrationsForAdmin(db, { eventId: past.id });
    expect(pastRow.emailState).toBeNull();

    // A cancelled event's links lead nowhere: the confirmation is not sent again, so its refusal asks nothing.
    const p = await person("cancelled@example.org");
    const reg = await register(ahead.id, p);
    await owed(reg, p, "REGISTRATION_CONFIRMED");
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toMatchObject({ kind: "missing", press: "confirmation" });
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, ahead.id));
    expect((await findRegistrationDetailForAdmin(db, reg))?.emailState).toBeNull();
  });
});

describe("a family member's refusal reads the same on every registration it shows on (BR-REQ-038-01, §543, §NNN)", () => {
  async function family() {
    const r = await race();
    const p = await person("family@example.org");
    const parent = await register(r.id, p, { bibNumber: 1 });
    const child = await register(r.id, p, { bibNumber: 2 });
    return { r, p, parent, child };
  }
  const stateOf = async (id: string) => (await findRegistrationDetailForAdmin(db, id))?.emailState ?? null;

  it("the sibling's refusal sent again waits on both", async () => {
    const { r, p, parent, child } = await family();
    await outboxRow({ participantId: p, registrationId: child, messageType: "BIB_ASSIGNED", status: "BOUNCED", createdAt: minutes(0), rejectionCause: "mailbox-full" });
    expect(await stateOf(child)).toMatchObject({ kind: "unreachable", own: true });
    expect(await stateOf(parent)).toMatchObject({ kind: "unreachable", own: false });
    await sendNow({ participantId: p, registrationId: child, messageType: "REGISTRATION_CONFIRMED", at: minutes(10) });
    expect(await stateOf(child)).toMatchObject({ kind: "retried", messageType: "BIB_ASSIGNED", own: true });
    expect(await stateOf(parent)).toMatchObject({ kind: "retried", messageType: "BIB_ASSIGNED", own: false });
    // The list and the desk read the same: waiting, on both, and the filter keeps neither.
    const listed = await listRegistrationsForAdmin(db, { eventId: r.id });
    const desk = await listDeskRegistrations(db, { eventId: r.id, query: "", locale: "ro" });
    for (const id of [parent, child]) {
      expect(listed.find((row) => row.id === id)?.emailState?.kind).toBe("retried");
      expect(desk.find((row) => row.id === id)?.emailState?.kind).toBe("retried");
    }
    expect(await countNeedingEmailActionForAdmin(db, { eventId: r.id })).toBe(0);
  });

  it("resolved by a send that carries it: silent on both", async () => {
    const { p, parent, child } = await family();
    const bib = await outboxRow({ participantId: p, registrationId: child, messageType: "BIB_ASSIGNED", createdAt: minutes(0) });
    await event(bib, "failed", minutes(1));
    const confirmation = await sendNow({ participantId: p, registrationId: child, messageType: "REGISTRATION_CONFIRMED", at: minutes(10) });
    await event(confirmation, "delivered", minutes(11));
    expect(await stateOf(child)).toBeNull();
    expect(await stateOf(parent)).toBeNull();
  });

  it("owed to an address that works: the same state on both, naming the press on the sibling's registration", async () => {
    const { p, parent, child } = await family();
    const bib = await outboxRow({ participantId: p, registrationId: child, messageType: "BIB_ASSIGNED", status: "BOUNCED", createdAt: minutes(0), rejectionCause: "mailbox-full" });
    await db.update(emailOutbox).set({ laterDeliveredAt: minutes(5) }).where(eq(emailOutbox.id, bib.id));
    expect(await stateOf(child)).toMatchObject({ kind: "missing", own: true, press: "confirmation" });
    expect(await stateOf(parent)).toMatchObject({ kind: "missing", own: false, press: "confirmation" });
  });

  it("is read against its own registration's status: the sibling's verification, owed no longer, is silent on both", async () => {
    const { r, p, parent, child } = await family();
    // The parent still waits on its own verification; the child's was refused, and the child is confirmed since.
    await db.update(registrations).set({ status: "PENDING_EMAIL_CONFIRMATION", confirmedAt: null }).where(eq(registrations.id, parent));
    const verify = await outboxRow({ participantId: p, registrationId: child, messageType: "VERIFY_REGISTRATION_EMAIL", status: "BOUNCED", createdAt: minutes(0), rejectionCause: "mailbox-full" });
    await db.update(emailOutbox).set({ laterDeliveredAt: minutes(5) }).where(eq(emailOutbox.id, verify.id));
    expect(await stateOf(child)).toBeNull();
    expect(await stateOf(parent)).toBeNull();
    expect(await listRegistrationsForAdmin(db, { eventId: r.id, emailBounced: true })).toHaveLength(0);
  });
});

describe("a send asks first whether it has a refusal to mark (§NNN)", () => {
  it("opens no transaction when nothing earlier was refused, nor when the refusal was already told of this send; one when there is", async () => {
    const r = await race();
    const p = await person("ana@example.org");
    const reg = await register(r.id, p);
    const handle = { execute: db.execute.bind(db), transaction: vi.fn(db.transaction.bind(db)) as unknown as typeof db.transaction };
    const sent = await outboxRow({ participantId: p, registrationId: reg, messageType: "REGISTRATION_CONFIRMED", createdAt: minutes(10) });
    await noteSentAgain(handle, sent, minutes(10), "mailgun");
    expect(handle.transaction).not.toHaveBeenCalled();

    const bib = await outboxRow({ participantId: p, registrationId: reg, messageType: "BIB_ASSIGNED", status: "BOUNCED", createdAt: minutes(5), rejectionCause: "mailbox-full" });
    await noteSentAgain(handle, sent, minutes(10), "mailgun");
    expect(handle.transaction).toHaveBeenCalledTimes(1);
    expect(await read(bib.id)).toMatchObject({ retriedAt: minutes(10), retriedVia: "mailgun" });
    // Told already: the same send again changes nothing and opens nothing.
    await noteSentAgain(handle, sent, minutes(10), "mailgun");
    expect(handle.transaction).toHaveBeenCalledTimes(1);
  });
});
