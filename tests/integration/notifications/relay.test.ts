import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { staffUsers } from "@/db/schema/staff-users";
import type { SendResult } from "@/infrastructure/email/adapter";
import { DELETED_RELAY_PAYLOAD, RELAY_GIVE_UP_MS } from "@/modules/notifications/domain/relay";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { retryFailedEmails } from "@/modules/notifications/retry-failed";
import { checkEmailHealth } from "@/modules/notifications/health";
import { enqueueRelay, type EnqueueRelayParams, readRelayPayload } from "@/modules/notifications/relay";
import { countLostRelayMessages, readRelayView } from "@/modules/notifications/relay-view";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { deliverRelay, fakeRoads, relayRow, relayRows, sent } from "../../helpers/relay";

/**
 * §778 — a visitor's message is an outbox row: sent by the road the club chose, the other road when the chosen one is
 * down, deleted the moment it has left. Every address is made up, on `example.org`.
 */
const T0 = new Date("2026-10-15T09:00:00.000Z");
const after = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const WORDS = { subject: "Cum a fost: Crosul de toamnă", text: "Foarte frumos, mulțumim.", html: "<p>Foarte frumos, mulțumim.</p>" };

/** What a test may say of a message; `content` is merged over an anonymous feedback message that may take the other road. */
type Over = Omit<Partial<EnqueueRelayParams>, "content"> & { content?: Record<string, unknown> };

function params(over: Over = {}): EnqueueRelayParams {
  const { content, ...rest } = over;
  return {
    type: "FEEDBACK_MESSAGE",
    road: "mailgun",
    to: "club@example.org",
    locale: "ro",
    content: { ...WORDS, fallbackAllowed: true, form: "feedback", noReplyTo: true, ...content } as EnqueueRelayParams["content"],
    now: T0,
    ...rest,
  };
}

/** What a road was handed for the visitor — not the Administrators' notices, which the working road carries in the same batch. */
const visitorMail = <T extends { to: string }>(messages: readonly T[]): T[] => messages.filter((message) => message.to === "club@example.org");

const serviceDown = (error: string): SendResult => ({ outcome: "transient_failure", error });
const timedOut = (error: string): SendResult => ({ outcome: "transient_failure", error, mayHaveBeenAccepted: true });

describe("§778 the relay: a visitor's message through the outbox", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(db);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  async function queue(over: Over = {}) {
    const row = await enqueueRelay(db, params(over));
    if (!row) throw new Error("not queued");
    return row;
  }
  const admins = async () => {
    await db.insert(staffUsers).values([
      { email: "admin@dev.test", displayName: "Admin", role: "ADMIN", preferredLocale: "ro" },
      { email: "super@dev.test", displayName: "Super", role: "SUPERADMIN", preferredLocale: "en" },
      { email: "organizer@dev.test", displayName: "Org", role: "MODERATOR", preferredLocale: "ro" },
    ]);
  };

  describe("queued and delivered", () => {
    it("queues one row with its road and its words, no participant, no registration; sent by that road, the words deleted at once", async () => {
      const row = await queue({ type: "CONTACT_MESSAGE", road: "gmail", to: "club@example.org", content: { form: "contact", cc: ["ioana@example.org"], bcc: ["archive@example.org"], replyTo: "ana@example.org", replyToName: "Ana Popescu", noReplyTo: undefined } });
      expect(row).toMatchObject({ messageType: "CONTACT_MESSAGE", road: "gmail", status: "PENDING", participantId: null, registrationId: null, bodyDeletedAt: null, roadFailures: {} });
      expect(readRelayPayload(row.payloadJson)).toMatchObject({ subject: WORDS.subject, text: WORDS.text, cc: ["ioana@example.org"], bcc: ["archive@example.org"], replyTo: "ana@example.org", replyToName: "Ana Popescu" });

      const roads = fakeRoads();
      const summary = await deliverRelay(db, roads, after(1));
      expect(summary).toMatchObject({ claimed: 1, sent: 1, failedOver: 0, retrying: 0 });
      // Gmail alone, never Mailgun; the message as queued, with the row's key — one key for the message, whatever the road.
      expect(roads.by("mailgun")).toHaveLength(0);
      expect(roads.by("gmail")).toHaveLength(1);
      expect(roads.by("gmail")[0]).toMatchObject({
        to: "club@example.org",
        cc: ["ioana@example.org"],
        bcc: ["archive@example.org"],
        subject: WORDS.subject,
        text: WORDS.text,
        replyTo: "ana@example.org",
        replyToName: "Ana Popescu",
        idempotencyKey: row.idempotencyKey,
        locale: "ro",
      });
      expect(roads.by("gmail")[0].noReplyTo).toBeUndefined();
      expect(roads.closed).toBe(1);

      const after1 = await relayRow(db, row.id);
      expect(after1).toMatchObject({ status: "SENT", transport: "gmail", road: "gmail", providerMessageId: "gmail:ok", recipientCount: 1, lockedAt: null, nextAttemptAt: null, lastError: null });
      expect(after1.sentAt).not.toBeNull();
      // The words are gone — the row is the record: the road, the time, the id.
      expect(after1.payloadJson).toEqual(DELETED_RELAY_PAYLOAD);
      expect(after1.bodyDeletedAt).not.toBeNull();
      expect(JSON.stringify(after1)).not.toContain("Foarte frumos");
      expect(readRelayPayload(after1.payloadJson)).toBeNull();
    });

    it("an anonymous message carries no Reply-To at all, on either road (§676)", async () => {
      await queue({ road: "mailgun" });
      const roads = fakeRoads();
      await deliverRelay(db, roads, after(1));
      expect(roads.by("mailgun")[0]).toMatchObject({ noReplyTo: true });
      expect(roads.by("mailgun")[0].replyTo).toBeUndefined();
    });

    it("queues a message once per key: a platform notice cannot be queued twice", async () => {
      const first = await enqueueRelay(db, params({ idempotencyKey: "relay-notice:test:1" }));
      const second = await enqueueRelay(db, params({ idempotencyKey: "relay-notice:test:1" }));
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await relayRows(db)).toHaveLength(1);
    });

    it("a row already delivered is not sent twice, and a claimed one whose worker died is taken back after five minutes", async () => {
      const row = await queue();
      const roads = fakeRoads();
      await deliverRelay(db, roads, after(1));
      expect((await deliverRelay(db, roads, after(2))).claimed).toBe(0);
      expect(roads.calls).toHaveLength(1);

      const stuck = await queue({ idempotencyKey: "relay:stuck" });
      await db.update(emailOutbox).set({ status: "PROCESSING", lockedAt: after(1), attemptCount: 1 }).where(eq(emailOutbox.id, stuck.id));
      expect((await deliverRelay(db, roads, after(60))).claimed).toBe(0);
      expect((await deliverRelay(db, roads, after(1 + 301))).claimed).toBe(1);
      expect((await relayRow(db, stuck.id)).status).toBe("SENT");
      expect(row.id).not.toBe(stuck.id);
    });

    it("sends exactly the ids it is given, and leaves the rest of the relay's queue alone", async () => {
      const one = await queue({ idempotencyKey: "relay:one" });
      const two = await queue({ idempotencyKey: "relay:two" });
      const roads = fakeRoads();
      const summary = await deliverRelay(db, roads, after(1), [two.id]);
      expect(summary.claimed).toBe(1);
      expect((await relayRow(db, one.id)).status).toBe("PENDING");
      expect((await relayRow(db, two.id)).status).toBe("SENT");
    });
  });

  describe("the notifications' worker leaves a visitor's message alone", () => {
    it("never claims a relay row: its own claim, its own sender, its own roads", async () => {
      await queue();
      const send = vi.fn();
      const summary = await processOutboxBatch(db, {
        sender: { send },
        render: async () => {
          throw new Error("the notifications' renderer has no template for a visitor's message");
        },
        now: after(1),
      });
      expect(summary.claimed).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect((await relayRows(db))[0].status).toBe("PENDING");
    });

    it("«Reîncearcă emailurile eșuate» never puts a lost message back: its words are deleted", async () => {
      const row = await queue();
      await db.update(emailOutbox).set({ status: "FAILED", payloadJson: DELETED_RELAY_PAYLOAD, bodyDeletedAt: after(5) }).where(eq(emailOutbox.id, row.id));
      const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
      expect(await retryFailedEmails(db, admin, after(10))).toEqual({ retried: 0 });
      expect((await relayRow(db, row.id)).status).toBe("FAILED");
    });

    it("«/api/health» does not turn a lost visitor's message into a 503 nothing can clear; a message still waiting counts", async () => {
      const lost = await queue({ idempotencyKey: "relay:lost" });
      await db.update(emailOutbox).set({ status: "FAILED", payloadJson: DELETED_RELAY_PAYLOAD, bodyDeletedAt: after(5), lastError: "gave up after a day: x" }).where(eq(emailOutbox.id, lost.id));
      const health = await checkEmailHealth(db, after(60));
      expect(health.failed).toBe(0);
      expect(health.status).toBe("ok");
      await queue({ idempotencyKey: "relay:waiting" });
      expect((await checkEmailHealth(db, after(60))).waiting).toBe(1);
    });
  });

  describe("failover, both ways", () => {
    it("Mailgun fails the message twice, then Gmail carries it once: marked, audited, and the Administrators told", async () => {
      await admins();
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503: unavailable") });

      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ claimed: 1, retrying: 1, sent: 0 });
      // The first retry is seconds away, not minutes.
      const afterFirst = await relayRow(db, row.id);
      expect(afterFirst).toMatchObject({ status: "PENDING", attemptCount: 1, lastError: "mailgun 503: unavailable" });
      expect(afterFirst.nextAttemptAt!.getTime() - after(1).getTime()).toBeLessThanOrEqual(5_000);
      expect(roads.by("gmail")).toHaveLength(0);

      expect(await deliverRelay(db, roads, after(10))).toMatchObject({ retrying: 1, sent: 0 });
      expect(roads.by("mailgun")).toHaveLength(2);
      expect(roads.by("gmail")).toHaveLength(0);

      const third = await deliverRelay(db, roads, after(20));
      expect(third).toMatchObject({ sent: 1, failedOver: 1 });
      expect(roads.by("mailgun")).toHaveLength(2);
      expect(visitorMail(roads.by("gmail"))).toHaveLength(1);
      // The same key, so a provider that saw the first attempt can tell they are one message.
      expect(visitorMail(roads.by("gmail"))[0].idempotencyKey).toBe(row.idempotencyKey);

      const done = await relayRow(db, row.id);
      expect(done).toMatchObject({ status: "SENT", road: "mailgun", transport: "gmail", attemptCount: 3 });
      expect(done.payloadJson).toEqual(DELETED_RELAY_PAYLOAD);
      expect(done.roadFailures).toMatchObject({ mailgun: { count: 2, ambiguous: false, lastError: "mailgun 503: unavailable" } });

      // The operations-log line and the audit row, with no word of the message or its address.
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("left by gmail: mailgun failed it 2 time(s)"));
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "email_road.failed_over"));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorStaffUserId: null, entityType: "email_outbox", entityId: row.id, metadataJson: { type: "FEEDBACK_MESSAGE", chosen: "mailgun", via: "gmail", failures: 2 } });
      expect(JSON.stringify(audits[0].metadataJson)).not.toContain("example.org");

      // One notice to each Administrator and Superadministrator — never the Organizer — carried by the working road, in
      // their own language, naming the road and its answer and nothing of the message.
      const notices = (await relayRows(db)).filter((entry) => entry.messageType === "RELAY_NOTICE");
      expect(notices.map((entry) => entry.recipientEmail).sort()).toEqual(["admin@dev.test", "super@dev.test"]);
      expect(notices.every((entry) => entry.status === "SENT" && entry.transport === "gmail" && entry.road === "gmail")).toBe(true);
      const noticeMails = roads.by("gmail").filter((message) => message.to.endsWith("@dev.test"));
      expect(noticeMails).toHaveLength(2);
      const ro = noticeMails.find((message) => message.to === "admin@dev.test")!;
      const en = noticeMails.find((message) => message.to === "super@dev.test")!;
      expect(ro.subject).toBe("Mailgun nu a trimis un mesaj: a plecat prin Gmail-ul clubului");
      expect(ro.text).toContain("mailgun 503: unavailable");
      expect(en.subject).toBe("Mailgun did not carry a message: it left by the club's Gmail");
      for (const mail of noticeMails) {
        expect(mail.text).not.toContain("Foarte frumos");
        expect(mail.text).toContain("/admin/settings/emails");
        expect(mail.noReplyTo).toBe(true);
      }
      expect(roads.by("mailgun")).toHaveLength(2);
    });

    it("Gmail fails twice, then Mailgun carries it: the other direction", async () => {
      const row = await queue({ type: "CONTACT_MESSAGE", road: "gmail", content: { form: "contact" } });
      const roads = fakeRoads({ gmail: serviceDown("gmail: smtp EAUTH") });
      await deliverRelay(db, roads, after(1));
      await deliverRelay(db, roads, after(10));
      expect(await deliverRelay(db, roads, after(20))).toMatchObject({ sent: 1, failedOver: 1 });
      expect(roads.by("gmail")).toHaveLength(2);
      expect(roads.by("mailgun")).toHaveLength(1);
      expect(await relayRow(db, row.id)).toMatchObject({ status: "SENT", road: "gmail", transport: "mailgun", roadFailures: { gmail: { count: 2, lastError: "gmail: smtp EAUTH" } } });
    });

    it("a refused login is the service's failure: a 401 from Mailgun counts like a 503", async () => {
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: { outcome: "permanent_failure", error: "mailgun 401: Forbidden", notTheAddress: true } });
      await deliverRelay(db, roads, after(1));
      await deliverRelay(db, roads, after(10));
      await deliverRelay(db, roads, after(20));
      expect(await relayRow(db, row.id)).toMatchObject({ status: "SENT", transport: "gmail" });
    });

    it("a road that says stop (an allowance spent) counts as every attempt at once: the next attempt is the other road's", async () => {
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: { outcome: "throttled", error: "mailgun 420: limit exceeded" } });
      await deliverRelay(db, roads, after(1));
      expect((await relayRow(db, row.id)).roadFailures).toMatchObject({ mailgun: { count: 2 } });
      await deliverRelay(db, roads, after(10));
      expect(roads.by("mailgun")).toHaveLength(1);
      expect(roads.by("gmail")).toHaveLength(1);
      expect((await relayRow(db, row.id)).transport).toBe("gmail");
    });

    it("a road that is stopped or missing when the message is claimed is skipped at once, with no attempt on it", async () => {
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ available: { mailgun: false } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ sent: 1, failedOver: 1 });
      expect(roads.by("mailgun")).toHaveLength(0);
      expect((await relayRow(db, row.id)).transport).toBe("gmail");
    });

    it("the other road failing too: the two take turns, and the first to answer carries it", async () => {
      const row = await queue({ road: "mailgun" });
      let gmailUp = false;
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503"), gmail: () => (gmailUp ? sent("gmail") : serviceDown("gmail: smtp ETIMEDOUT")) });
      await deliverRelay(db, roads, after(1));
      await deliverRelay(db, roads, after(10));
      await deliverRelay(db, roads, after(20)); // Gmail's first failure
      expect((await relayRow(db, row.id)).status).toBe("PENDING");
      gmailUp = true;
      await deliverRelay(db, roads, after(20 + 5 * 60));
      expect(await relayRow(db, row.id)).toMatchObject({ status: "SENT", transport: "gmail" });
    });
  });

  describe("never a double send", () => {
    it("a recipient's refusal ends the message BOUNCED: no other road, the words deleted, the Administrators told", async () => {
      await admins();
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: { outcome: "permanent_failure", error: "mailgun 400: 'to' parameter is not a valid address" } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ bounced: 1, sent: 0, retrying: 0 });
      // Nothing of the visitor's went by Gmail: only the Administrators' notices did.
      expect(visitorMail(roads.by("gmail"))).toHaveLength(0);
      expect(roads.by("mailgun")).toHaveLength(1);
      const done = await relayRow(db, row.id);
      expect(done).toMatchObject({ status: "BOUNCED", transport: null, nextAttemptAt: null });
      expect(done.payloadJson).toEqual(DELETED_RELAY_PAYLOAD);
      expect(done.rejectedAt).not.toBeNull();
      // Told once to each Administrator, by the road that works; nothing of the message in it.
      const notices = (await relayRows(db)).filter((entry) => entry.messageType === "RELAY_NOTICE");
      expect(notices).toHaveLength(2);
      expect(await countLostRelayMessages(db, after(60))).toBe(1);
    });

    it("a send that timed out may have gone through: it is retried on that road, and a hanging road does not keep it for good", async () => {
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: timedOut("mailgun unreachable: TimeoutError") });
      let at = 1;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // Pinned to Mailgun for its first three tries: Gmail does not get it while Mailgun may be about to deliver.
        await deliverRelay(db, roads, after(at));
        at += 3600; // far past any backoff, inside the day
      }
      expect(roads.by("mailgun")).toHaveLength(3);
      expect(roads.by("gmail")).toHaveLength(0);
      expect((await relayRow(db, row.id)).roadFailures).toMatchObject({ mailgun: { count: 3, ambiguous: true } });
      // The pin lets go: the fourth try is Gmail's, and the message is delivered by it — not lost at the day's end.
      expect(await deliverRelay(db, roads, after(at))).toMatchObject({ sent: 1, failedOver: 1 });
      expect(roads.by("gmail")).toHaveLength(1);
      expect(await relayRow(db, row.id)).toMatchObject({ status: "SENT", transport: "gmail" });
    });

    it("a message pinned to the only road it may take is still given up on after a day, with the Administrators told", async () => {
      await admins();
      const row = await queue({ road: "mailgun", content: { fallbackAllowed: false } });
      const roads = fakeRoads({ mailgun: timedOut("mailgun unreachable: TimeoutError") });
      let at = 1;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await deliverRelay(db, roads, after(at));
        at += 3600;
      }
      expect(roads.by("gmail").filter((message) => message.subject === "x")).toHaveLength(0);
      expect((await relayRow(db, row.id)).status).toBe("PENDING");
      expect(await deliverRelay(db, roads, after(25 * 3600))).toMatchObject({ lost: 1 });
      expect((await relayRow(db, row.id)).status).toBe("FAILED");
    });

    it("an ambiguous failure after a failover pins the message to the road that went ambiguous, for three tries", async () => {
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503"), gmail: timedOut("gmail: smtp ETIMEDOUT") });
      await deliverRelay(db, roads, after(1));
      await deliverRelay(db, roads, after(10));
      await deliverRelay(db, roads, after(20)); // Gmail, ambiguous
      await deliverRelay(db, roads, after(20 + 3 * 3600));
      await deliverRelay(db, roads, after(20 + 5 * 3600));
      // Gmail alone for its three tries: Mailgun is not tried again while Gmail may have it.
      expect(roads.by("mailgun")).toHaveLength(2);
      expect(roads.by("gmail")).toHaveLength(3);
      expect((await relayRow(db, row.id)).status).toBe("PENDING");
      // Then the pin lets go and the roads take turns: Mailgun, which has failed it less, is tried again.
      await deliverRelay(db, roads, after(20 + 6 * 3600));
      expect(roads.by("mailgun")).toHaveLength(3);
    });

    it("a pinned road that is stopped gives way to the other road when the message may take it", async () => {
      const row = await queue({ road: "mailgun" });
      await db.update(emailOutbox).set({ roadFailures: { mailgun: { count: 1, ambiguous: true, lastError: "mailgun unreachable: TimeoutError" } } }).where(eq(emailOutbox.id, row.id));
      const roads = fakeRoads({ available: { mailgun: false } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ sent: 1, failedOver: 1 });
      expect(roads.by("gmail")).toHaveLength(1);
    });

    it("waits, without an attempt, while the road it is pinned to is unavailable and nothing else may carry it", async () => {
      const row = await queue({ road: "mailgun", content: { fallbackAllowed: false } });
      await db.update(emailOutbox).set({ roadFailures: { mailgun: { count: 1, ambiguous: true, lastError: "mailgun unreachable: TimeoutError" } } }).where(eq(emailOutbox.id, row.id));
      const roads = fakeRoads({ available: { mailgun: false } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ waiting: 1, sent: 0 });
      expect(roads.calls).toHaveLength(0);
      const waiting = await relayRow(db, row.id);
      expect(waiting).toMatchObject({ status: "PENDING", attemptCount: 0 });
      expect(waiting.nextAttemptAt!.getTime()).toBeGreaterThan(after(1).getTime() + 60_000);
    });
  });

  describe("Girl Zone: the other road only when the message may take it", () => {
    it("a message that may not take the other road keeps retrying the chosen one and is never handed over", async () => {
      const row = await queue({ road: "mailgun", content: { fallbackAllowed: false } });
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503") });
      let at = 1;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await deliverRelay(db, roads, after(at));
        at += 3600;
      }
      expect(roads.by("mailgun")).toHaveLength(6);
      expect(roads.by("gmail")).toHaveLength(0);
      expect((await relayRow(db, row.id)).status).toBe("PENDING");
    });

    it("and while the chosen road is stopped it waits for it, rather than the other road taking it", async () => {
      await queue({ road: "mailgun", content: { fallbackAllowed: false } });
      const roads = fakeRoads({ available: { mailgun: false } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ waiting: 1 });
      expect(roads.calls).toHaveLength(0);
    });
  });

  describe("the pace", () => {
    it("a send held back for Gmail's own pace is not a failure: the attempt is given back, the road keeps its clean record", async () => {
      const row = await queue({ road: "gmail" });
      const roads = fakeRoads({ gmail: { outcome: "throttled", error: "gmail pace: handed to the next run", paced: true, retryAfter: after(30) } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ waiting: 1, retrying: 0 });
      const held = await relayRow(db, row.id);
      expect(held).toMatchObject({ status: "PENDING", attemptCount: 0, roadFailures: {} });
      expect(held.nextAttemptAt).toEqual(after(30));
    });
  });

  describe("a day without a road", () => {
    it("gives up after twenty-four hours: FAILED, the words deleted, the Administrators told, a line in the log and an audit row", async () => {
      await admins();
      const row = await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503"), gmail: serviceDown("gmail: smtp EAUTH") });
      // Still inside the day: another attempt, not the end.
      await deliverRelay(db, roads, after(RELAY_GIVE_UP_MS / 1000 - 60));
      expect((await relayRow(db, row.id)).status).toBe("PENDING");
      const summary = await deliverRelay(db, roads, after(RELAY_GIVE_UP_MS / 1000 + 3600 * 2));
      expect(summary).toMatchObject({ lost: 1 });
      const lost = await relayRow(db, row.id);
      expect(lost).toMatchObject({ status: "FAILED", nextAttemptAt: null });
      expect(lost.payloadJson).toEqual(DELETED_RELAY_PAYLOAD);
      expect(lost.bodyDeletedAt).not.toBeNull();
      expect(lost.lastError).toContain("gave up after a day");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not be delivered in a day"));
      expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "email_relay.lost"))).toHaveLength(1);
      const notices = (await relayRows(db)).filter((entry) => entry.messageType === "RELAY_NOTICE");
      expect(notices).toHaveLength(2);
      expect(await countLostRelayMessages(db, after(RELAY_GIVE_UP_MS / 1000 + 7200))).toBe(1);
    });

    it("tells the Administrators once per form per club day, not once per message: a mistyped recipient bouncing every message is one email each", async () => {
      await admins();
      await queue({ road: "mailgun" });
      await queue({ road: "mailgun" });
      const roads = fakeRoads({ mailgun: { outcome: "permanent_failure", error: "mailgun 400: 'to' parameter is not a valid address" } });
      expect(await deliverRelay(db, roads, after(1))).toMatchObject({ bounced: 2 });
      const notices = (await relayRows(db)).filter((entry) => entry.messageType === "RELAY_NOTICE");
      expect(notices).toHaveLength(2);
      // Another form is its own notice.
      await queue({ road: "mailgun", type: "CONTACT_MESSAGE", content: { form: "contact" } });
      await deliverRelay(db, roads, after(2));
      expect((await relayRows(db)).filter((entry) => entry.messageType === "RELAY_NOTICE")).toHaveLength(4);
    });

    it("«a road is down» is once per road per club day, not per UTC date", async () => {
      await admins();
      await queue({ road: "mailgun" });
      await queue({ road: "mailgun" });
      const roads = fakeRoads({ available: { mailgun: false } });
      // 23:30 and 00:10 UTC are 02:30 and 03:10 the same night in Brașov (UTC+3 in October): one day for the club.
      await deliverRelay(db, roads, new Date("2026-10-15T23:30:00.000Z"));
      await deliverRelay(db, roads, new Date("2026-10-16T00:10:00.000Z"));
      expect((await relayRows(db)).filter((entry) => entry.messageType === "RELAY_NOTICE")).toHaveLength(2);
    });

    it("a notice the platform cannot deliver raises no notice of its own", async () => {
      await admins();
      await queue({ type: "RELAY_NOTICE", road: "gmail", content: { notice: true } });
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503"), gmail: serviceDown("gmail: smtp EAUTH") });
      await deliverRelay(db, roads, after(RELAY_GIVE_UP_MS / 1000 + 60));
      const rows = await relayRows(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("FAILED");
    });
  });

  describe("the retention net", () => {
    it("deletes the words of a message still holding them after three days — the net under a worker that never ran — and leaves younger ones and delivered ones alone", async () => {
      const stale = await queue({ idempotencyKey: "relay:stale", now: T0 });
      const young = await queue({ idempotencyKey: "relay:young", now: new Date(T0.getTime() + 2 * 24 * 3_600_000) });
      const later = new Date(T0.getTime() + 3 * 24 * 3_600_000 + 60_000);
      await pruneExpiredRows(db, later);
      const swept = await relayRow(db, stale.id);
      expect(swept).toMatchObject({ status: "FAILED", nextAttemptAt: null, payloadJson: { deleted: true } });
      expect(swept.bodyDeletedAt).not.toBeNull();
      expect(swept.lastError).toContain("retention sweep");
      // Two days old: the relay still has the rest of its day.
      expect(await relayRow(db, young.id)).toMatchObject({ status: "PENDING", bodyDeletedAt: null });
    });
  });

  describe("what the backoffice shows of it", () => {
    it("every row with its road, the road it left by, its tries and whether its words are gone — never an address or a word", async () => {
      const delivered = await queue({ road: "mailgun", to: "club@example.org", idempotencyKey: "relay:a" });
      const waiting = await queue({ road: "gmail", to: "secret.person@example.org", idempotencyKey: "relay:b" });
      const roads = fakeRoads({ mailgun: serviceDown("mailgun 503") });
      await deliverRelay(db, roads, after(1), [delivered.id]);
      await deliverRelay(db, roads, after(10), [delivered.id]);
      await deliverRelay(db, roads, after(20), [delivered.id]);
      const view = await readRelayView(db, after(60));
      expect(view.total).toBe(2);
      expect(view.kept).toBe(1);
      const byId = new Map(view.rows.map((row) => [row.id, row]));
      expect(byId.get(delivered.id)).toMatchObject({ status: "SENT", road: "mailgun", via: "gmail", bodyDeleted: true, attempts: 3 });
      expect(byId.get(delivered.id)?.failures.mailgun).toMatchObject({ count: 2, lastError: "mailgun 503" });
      expect(byId.get(waiting.id)).toMatchObject({ status: "PENDING", road: "gmail", via: null, bodyDeleted: false });
      const json = JSON.stringify(view);
      expect(json).not.toContain("example.org");
      expect(json).not.toContain("Foarte frumos");
      // The roads' own state: Gmail carried one, Mailgun is failing.
      expect(view.lastSuccess.gmail).not.toBeNull();
      expect(view.lastSuccess.mailgun).toBeNull();
    });
  });
});
