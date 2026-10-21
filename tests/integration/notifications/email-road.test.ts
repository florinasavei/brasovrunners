import { eq, not } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { isClubCopy } from "@/modules/notifications/domain/club-notices";
import { DEFAULT_EMAIL_TRANSPORT, gmailRoadRows, rowTransport } from "@/modules/notifications/domain/email-transport";
import { enqueueEmail, gmailRoadCondition, type OutboxRoads, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { EMAIL_ROAD_COOKIE, encodeEmailRoadChoice } from "@/shared/feedback/email-road";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §841 — the road a press chose in its confirmation dialog reaches the row: `enqueueEmail` stamps
 * `road` on the rows of the dialog's group and no other, the claim takes a stamped row on the
 * stamped road whatever its group's setting, and the sender's route sends it by that road.
 */
const jar = vi.hoisted(() => ({ cookie: null as string | null, deleted: 0 }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === EMAIL_ROAD_COOKIE && jar.cookie ? { name, value: jar.cookie } : undefined),
    set: () => {},
    delete: () => {
      jar.deleted += 1;
    },
  }),
}));

const NOW = new Date("2026-10-21T15:00:00.000Z");

async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: "s", html: "<p>h</p>", text: "t", locale: row.locale, idempotencyKey: row.idempotencyKey };
}

function roadSender(): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return { outcome: "sent", providerMessageId: `id:${message.idempotencyKey}`, transport: message.transport ?? "mailgun" };
    },
  };
}

describe("§841 the road a press chose, on the row", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    jar.cookie = null;
    jar.deleted = 0;
  });

  const queue = (messageType: "REGISTRATION_CONFIRMED" | "VERIFY_REGISTRATION_EMAIL" | "CLUB_CONFIRMATION_NOTICE", key: string, payload: Record<string, unknown> = {}) =>
    db.transaction((tx) =>
      enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType,
        locale: "ro",
        recipientEmail: `${key}@example.com`,
        payload,
        idempotencyKey: key,
        now: NOW,
        drainAfter: false,
      }),
    );

  it("stamps the dialog's road on the rows of its group alone, and nothing without a press", async () => {
    jar.cookie = encodeEmailRoadChoice({ road: "gmail", group: "confirmations" }, Date.now());
    const confirmed = await queue("REGISTRATION_CONFIRMED", "confirmed");
    const verify = await queue("VERIFY_REGISTRATION_EMAIL", "verify");
    // The club's own copy is the club's group: the participant's dialog does not move it.
    const copy = await queue("REGISTRATION_CONFIRMED", "copy", { clubCopy: true });
    expect(confirmed?.road).toBe("gmail");
    expect(verify?.road).toBeNull();
    expect(copy?.road).toBeNull();
    // Queueing reads the choice and leaves it: the flash of the same request still names the road, then spends it.
    expect(jar.deleted).toBe(0);

    jar.cookie = null;
    expect((await queue("REGISTRATION_CONFIRMED", "quiet"))?.road).toBeNull();
    // A choice past its twenty seconds is none.
    jar.cookie = encodeEmailRoadChoice({ road: "gmail", group: "confirmations" }, Date.now() - 60_000);
    expect((await queue("REGISTRATION_CONFIRMED", "late"))?.road).toBeNull();
  });

  it("claims a stamped row on the stamped road whatever its group's setting, and leaves no row on no road", async () => {
    const base = { participantId: null, registrationId: null, locale: "ro" as const, payloadJson: {}, status: "PENDING" as const, createdAt: new Date(NOW.getTime() - 60_000) };
    await db.insert(emailOutbox).values([
      // A confirmation the press sent «prin Gmail»: Mailgun's group by the default setting.
      { ...base, messageType: "REGISTRATION_CONFIRMED", recipientEmail: "ana@example.com", idempotencyKey: "ana", road: "gmail" },
      // A club notice the press sent «prin Mailgun»: Gmail's group by the default setting.
      { ...base, messageType: "CLUB_CONFIRMATION_NOTICE", recipientEmail: "club@example.com", idempotencyKey: "club", road: "mailgun" },
      // No press: each on its group's road.
      { ...base, messageType: "VERIFY_REGISTRATION_EMAIL", recipientEmail: "ion@example.com", idempotencyKey: "ion" },
      { ...base, messageType: "CLUB_CONFIRMATION_NOTICE", recipientEmail: "club2@example.com", idempotencyKey: "club2" },
    ]);
    const gmail = gmailRoadRows(DEFAULT_EMAIL_TRANSPORT);
    const roads: OutboxRoads = { gmailMessageTypes: gmail.messageTypes, gmailClubCopies: gmail.clubCopies, gmailBatchSize: 10 };

    // The claim's SQL, both sides: every row on exactly one road, a stamp with no `IS NULL` hole.
    const onGmail = (await db.select({ key: emailOutbox.idempotencyKey }).from(emailOutbox).where(gmailRoadCondition(roads))).map((row) => row.key).sort();
    const onMailgun = (await db.select({ key: emailOutbox.idempotencyKey }).from(emailOutbox).where(not(gmailRoadCondition(roads)))).map((row) => row.key).sort();
    expect(onGmail).toEqual(["ana", "club2"]);
    expect(onMailgun).toEqual(["club", "ion"]);

    const sender = roadSender();
    const summary = await processOutboxBatch(db, {
      sender,
      render,
      now: NOW,
      roads,
      route: (row) => rowTransport(DEFAULT_EMAIL_TRANSPORT, row, isClubCopy(row.payloadJson), true),
    });
    expect(summary).toMatchObject({ claimed: 4, sent: 4 });
    const by = Object.fromEntries(sender.calls.map((call) => [call.to, call.transport]));
    expect(by).toEqual({ "ana@example.com": "gmail", "club@example.com": "mailgun", "ion@example.com": "mailgun", "club2@example.com": "gmail" });
    const [ana] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "ana"));
    // The road it left by is the road it was promised: `road` and `transport` agree.
    expect(ana).toMatchObject({ status: "SENT", road: "gmail", transport: "gmail" });
  });
});
