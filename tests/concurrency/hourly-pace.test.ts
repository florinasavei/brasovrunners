import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { registrations } from "@/db/schema/registrations";
import { claimOutboxBatch } from "@/modules/notifications/outbox";

/**
 * §605 — Mailgun's hourly pace holds under two workers claiming at the same moment.
 *
 * The count and the claim run in READ COMMITTED; without the advisory lock the claim takes first,
 * two after-response drains on registration morning read the same room (3) and each claim up to it
 * through SKIP LOCKED — together over the hour, which is what disables an account on probation.
 * With the lock the second claimer waits, and its count sees the first's rows as in flight.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§605 two workers claiming Mailgun's hour at once, on two connections", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
  const db = drizzle(pool, { schema: { emailOutbox, registrations } });
  const NOW = new Date("2026-10-01T09:30:00.000Z");

  beforeEach(async () => {
    await db.delete(emailOutbox);
  });
  afterAll(async () => {
    await db.delete(emailOutbox);
    await pool.end();
  });

  it("claims no more than the room left, together", async () => {
    for (let round = 0; round < 5; round += 1) {
      await db.delete(emailOutbox);
      await db.insert(emailOutbox).values(
        Array.from({ length: 30 }, (_, i) => ({
          messageType: "REGISTRATION_CONFIRMED" as const,
          locale: "ro" as const,
          recipientEmail: `r${round}-${i}@example.com`,
          payloadJson: {},
          idempotencyKey: `pace:${round}:${i}`,
          createdAt: new Date(NOW.getTime() - (30 - i) * 60_000),
        })),
      );
      const claims = await Promise.all(
        Array.from({ length: 4 }, () => claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: 3 })),
      );
      const ids = claims.flat().map((r) => r.id);
      expect(ids.length).toBe(3);
      expect(new Set(ids).size).toBe(3);
    }
  });
});
