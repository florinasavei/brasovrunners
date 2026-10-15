import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { EmailSender } from "@/infrastructure/email/delivery";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import {
  ROAD_FAILING_ALARM_MS,
  ROAD_STATUS_KEY,
  readRoadLastSuccess,
  readRoadStates,
  recordRoadFailure,
  recordRoadSuccess,
  roadFailingLong,
  roadFailureOf,
  withRoadStatus,
} from "@/modules/notifications/road-status";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — what each road last did, for `/devs`, `/admin/tasks` and the relay: a refusal of the service starts a «failing since»
 * that only a message the road carries ends, and a bounce for an address says nothing about the road.
 */
const T0 = new Date("2026-10-15T09:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const MESSAGE: OutgoingEmail = { to: "x@example.org", subject: "s", text: "t", html: "t", locale: "ro", idempotencyKey: "k" };

describe("§NNN the roads' state", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  it("starts «failing since» at the first failure, keeps it through the next ones, and says the last code", async () => {
    expect((await readRoadStates(db)).gmail).toEqual({ failingSince: null, lastFailureAt: null, lastError: null });
    await recordRoadFailure(db, "gmail", "gmail: smtp EAUTH", minutes(0));
    await recordRoadFailure(db, "gmail", "gmail: smtp ETIMEDOUT", minutes(30));
    const states = await readRoadStates(db);
    expect(states.gmail).toEqual({ failingSince: minutes(0), lastFailureAt: minutes(30), lastError: "gmail: smtp ETIMEDOUT" });
    // The other road is untouched.
    expect(states.mailgun).toEqual({ failingSince: null, lastFailureAt: null, lastError: null });
  });

  it("ends it with a message the road carried — and writes nothing while the road was not failing", async () => {
    await recordRoadSuccess(db, "mailgun", minutes(1));
    expect(await db.select().from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY))).toHaveLength(1); // the row's first write is the empty record
    const before = (await db.select().from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY)))[0].updatedAt;
    await recordRoadSuccess(db, "mailgun", minutes(5));
    expect((await db.select().from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY)))[0].updatedAt).toEqual(before);

    await recordRoadFailure(db, "mailgun", "mailgun 503", minutes(10));
    await recordRoadSuccess(db, "mailgun", minutes(20));
    // The last refusal stays on the record as history; the road is no longer failing.
    expect((await readRoadStates(db)).mailgun).toEqual({ failingSince: null, lastFailureAt: minutes(10), lastError: "mailgun 503" });
  });

  it("rings after an hour of failing, not before, and not after the road works again", () => {
    const failing = { failingSince: T0, lastFailureAt: T0, lastError: "x" };
    expect(roadFailingLong(failing, new Date(T0.getTime() + ROAD_FAILING_ALARM_MS - 1))).toBe(false);
    expect(roadFailingLong(failing, new Date(T0.getTime() + ROAD_FAILING_ALARM_MS))).toBe(true);
    expect(roadFailingLong({ ...failing, failingSince: null }, minutes(600))).toBe(false);
  });

  describe("which answers are a road's failure", () => {
    it("the service's: a 5xx or an unreachable service, a refused login, a spent allowance — by the adapters' own words", () => {
      expect(roadFailureOf({ outcome: "transient_failure", error: "mailgun 503: x" })).toEqual({ road: "mailgun", error: "mailgun 503: x" });
      expect(roadFailureOf({ outcome: "transient_failure", error: "mailgun unreachable: TimeoutError", mayHaveBeenAccepted: true })).toEqual({ road: "mailgun", error: "mailgun unreachable: TimeoutError" });
      expect(roadFailureOf({ outcome: "transient_failure", error: "gmail: smtp EAUTH" })).toEqual({ road: "gmail", error: "gmail: smtp EAUTH" });
      expect(roadFailureOf({ outcome: "permanent_failure", error: "mailgun 401: Forbidden", notTheAddress: true })?.road).toBe("mailgun");
      expect(roadFailureOf({ outcome: "throttled", error: "mailgun 420: limit exceeded" })?.road).toBe("mailgun");
      expect(roadFailureOf({ outcome: "throttled", error: "mailgun 429", paced: true, rateRefused: true })?.road).toBe("mailgun");
    });

    it("never an address that bounced, the club's own pace, a send, or an answer that names no road", () => {
      expect(roadFailureOf({ outcome: "permanent_failure", error: "mailgun 400: 'to' parameter is not a valid address" })).toBeNull();
      expect(roadFailureOf({ outcome: "permanent_failure", error: "gmail: the address was refused (5.1.1)" })).toBeNull();
      expect(roadFailureOf({ outcome: "throttled", error: "gmail pace: handed to the next run", paced: true })).toBeNull();
      expect(roadFailureOf({ outcome: "sent", providerMessageId: "m" })).toBeNull();
      expect(roadFailureOf({ outcome: "transient_failure", error: "unknown error" })).toBeNull();
    });
  });

  describe("the outbox's sender, noting what each road did", () => {
    const sender = (answers: SendResult[]): EmailSender & { close: () => void } => {
      let n = 0;
      return { send: async () => answers[Math.min(n++, answers.length - 1)], close: vi.fn() };
    };

    it("notes a refusal, then the first message the road carries again clears it, and the answer is passed on untouched", async () => {
      const inner = sender([
        { outcome: "transient_failure", error: "mailgun 503: down" },
        { outcome: "sent", providerMessageId: "m1", transport: "mailgun", recipients: 1 },
        { outcome: "sent", providerMessageId: "m2", transport: "mailgun", recipients: 1 },
      ]);
      let at = 0;
      const wrapped = withRoadStatus(db, inner, () => minutes(at++));
      expect(await wrapped.send(MESSAGE)).toEqual({ outcome: "transient_failure", error: "mailgun 503: down" });
      expect((await readRoadStates(db)).mailgun.failingSince).toEqual(minutes(0));
      await wrapped.send(MESSAGE);
      expect((await readRoadStates(db)).mailgun.failingSince).toBeNull();
      // Once seen working in a batch, the rest of it writes nothing.
      const row = (await db.select().from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY)))[0];
      await wrapped.send(MESSAGE);
      expect((await db.select().from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY)))[0].updatedAt).toEqual(row.updatedAt);
      wrapped.close?.();
      expect(inner.close).toHaveBeenCalledTimes(1);
    });

    it("a captured message reached nobody: it proves nothing about the road, and a bounce is not the road's", async () => {
      await recordRoadFailure(db, "gmail", "gmail: smtp EAUTH", minutes(0));
      const wrapped = withRoadStatus(
        db,
        sender([
          { outcome: "sent", providerMessageId: "c", transport: "gmail", recipients: 0 },
          { outcome: "permanent_failure", error: "gmail: the address was refused (5.1.1)" },
        ]),
      );
      await wrapped.send(MESSAGE);
      await wrapped.send(MESSAGE);
      expect((await readRoadStates(db)).gmail.failingSince).toEqual(minutes(0));
    });

    it("never changes the message's own outcome when noting the road fails", async () => {
      const inner = sender([{ outcome: "sent", providerMessageId: "m", transport: "gmail", recipients: 1 }]);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const broken = { ...db, transaction: () => Promise.reject(new Error("db away")) } as unknown as TestDatabase;
      const wrapped = withRoadStatus(broken, inner);
      expect(await wrapped.send(MESSAGE)).toMatchObject({ outcome: "sent" });
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });

  it("reads each road's last success from the outbox: a message that reached somebody, not a captured one", async () => {
    const base = { messageType: "CONTACT_MESSAGE" as const, locale: "ro" as const, recipientEmail: "club@example.org", payloadJson: {}, status: "SENT" as const };
    await db.insert(emailOutbox).values([
      { ...base, idempotencyKey: "a", transport: "gmail", recipientCount: 1, sentAt: minutes(5) },
      { ...base, idempotencyKey: "b", transport: "gmail", recipientCount: 1, sentAt: minutes(9) },
      { ...base, idempotencyKey: "c", transport: "gmail", recipientCount: 0, sentAt: minutes(30) },
      { ...base, idempotencyKey: "d", transport: "mailgun", recipientCount: 1, sentAt: minutes(7) },
    ]);
    expect(await readRoadLastSuccess(db)).toEqual({ gmail: minutes(9), mailgun: minutes(7) });
  });
});
