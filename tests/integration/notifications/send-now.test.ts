import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { staffUsers } from "@/db/schema/staff-users";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-09-18T10:00:00.000Z");

/**
 * `DECISIONS.md` §80 — "send now" from the backoffice: the same worker, an Administrator's
 * session, audited, throttled, and bounded by the day's counter. In `APP_ENV=test` the sender
 * captures, so every claimed row is "sent" without a provider.
 */
describe("§80 the outbox sent by hand", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let admin: { id: string; role: "ADMIN" };
  let volunteer: { id: string; role: "CONTRIBUTOR" };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = participant.id;
    const [a] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    const [v] = await db.insert(staffUsers).values({ email: "vol@dev.test", displayName: "Vol", role: "CONTRIBUTOR" }).returning();
    admin = { id: a.id, role: "ADMIN" };
    volunteer = { id: v.id, role: "CONTRIBUTOR" };
  });

  const queue = (n: number, prefix = "send-now") =>
    db.transaction(async (tx) => {
      for (let i = 0; i < n; i++) {
        await enqueueEmail(tx, {
          participantId,
          registrationId: null,
          messageType: "REGISTRATION_STATE_NOTICE",
          locale: "ro",
          recipientEmail: "ana@example.ro",
          payload: {},
          idempotencyKey: `${prefix}:${i}`,
          now: NOW,
        });
      }
    });

  it("sends what is waiting, across batches, and leaves an audit row with the counts", async () => {
    await queue(25);
    expect((await readEmailVolumeToday(db, NOW)).waitingMessages).toBe(25);

    const result = await sendOutboxNow(db, admin, NOW);
    expect(result.sent).toBe(25);
    expect(result.batches).toBe(2);
    expect(result.sentToday).toBe(25);
    expect(result.remaining).toBe((result.allowance ?? 0) - 25);
    expect((await readEmailVolumeToday(db, NOW)).waitingMessages).toBe(0);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "outbox.sent_by_staff"));
    expect(audit.actorStaffUserId).toBe(admin.id);
    expect(audit.metadataJson).toMatchObject({ sent: 25, batches: 2 });
  });

  it("stops at the day's allowance and never sends past it", async () => {
    // A hundred already sent today, by whatever path.
    await queue(100, "earlier");
    await db.update(emailOutbox).set({ status: "SENT", sentAt: NOW });
    await queue(5, "late");

    const result = await sendOutboxNow(db, admin, NOW);
    expect(result.sent).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.remaining).toBe(0);
    expect((await readEmailVolumeToday(db, NOW)).waitingMessages).toBe(5);
  });

  it("is an Administrator's button, and a throttled one", async () => {
    const forbidden = await sendOutboxNow(db, volunteer, NOW).catch((e: unknown) => e);
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");

    for (let i = 0; i < RATE_LIMITS["admin-send-now"].limit; i++) await sendOutboxNow(db, admin, NOW);
    const throttled = await sendOutboxNow(db, admin, NOW).catch((e: unknown) => e);
    expect(isDomainError(throttled) && throttled.code).toBe("VALIDATION_ERROR");
  });
});
