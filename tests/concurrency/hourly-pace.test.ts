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

/**
 * §NNN — one claim takes no more than its limit, whatever join the planner picks.
 *
 * The test above failed one CI run in eight with 6 claimed: not two counts reading the same room,
 * but ONE claimer taking six rows under a limit of three. When the table's statistics say the
 * outbox is empty while its pages remain — what autovacuum leaves after a drained outbox, and what
 * the rounds above produce on a busy runner — `UPDATE … WHERE id IN (SELECT … LIMIT 3 FOR UPDATE
 * SKIP LOCKED)` was planned as a nested-loop semi join with the sub-select re-run for every outer
 * row, each re-run skipping the rows the UPDATE had just changed and returning the next ones. Here
 * those statistics are made on purpose (a vacuum that leaves the pages), so the plan is the bad one
 * on every run rather than on one in eight: the claim must still take exactly its limit.
 */
describe("BR-REQ-080-02 §NNN one claim takes no more than its limit, whatever the statistics say", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const db = drizzle(pool, { schema: { emailOutbox, registrations } });
  const NOW = new Date("2026-10-01T09:30:00.000Z");

  afterAll(async () => {
    await db.delete(emailOutbox);
    // The empty pages handed back and the statistics taken again, for whatever runs next here.
    await pool.query("vacuum analyze email_outbox");
    await pool.end();
  });

  it("claims exactly the room, and exactly the batch, on a table the planner believes empty", async () => {
    await db.delete(emailOutbox);
    await pool.query(
      `insert into email_outbox (message_type, locale, recipient_email, payload_json, idempotency_key)
       select 'REGISTRATION_CONFIRMED', 'ro', 'bulk' || g || '@example.com', '{}', 'stats:' || g from generate_series(1, 3000) g`,
    );
    await db.delete(emailOutbox);
    await pool.query("vacuum (truncate false, analyze) email_outbox");

    for (let round = 0; round < 5; round += 1) {
      await db.delete(emailOutbox);
      await db.insert(emailOutbox).values(
        Array.from({ length: 30 }, (_, i) => ({
          messageType: "REGISTRATION_CONFIRMED" as const,
          locale: "ro" as const,
          recipientEmail: `s${round}-${i}@example.com`,
          payloadJson: {},
          idempotencyKey: `stats:${round}:${i}`,
          createdAt: new Date(NOW.getTime() - (30 - i) * 60_000),
        })),
      );
      const paced = await claimOutboxBatch(db, { now: NOW, batchSize: 20, hourlyAllowance: 3 });
      expect(paced.map((row) => row.recipientEmail)).toEqual([0, 1, 2].map((i) => `s${round}-${i}@example.com`));
      const batch = await claimOutboxBatch(db, { now: NOW, batchSize: 5, hourlyAllowance: null });
      expect(batch.map((row) => row.recipientEmail)).toEqual([3, 4, 5, 6, 7].map((i) => `s${round}-${i}@example.com`));
    }
  });
});
