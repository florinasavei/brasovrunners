import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";

/**
 * A newsletter link for a spec that has to walk past the inbox (§NNN) — the shape of
 * `action-link.ts`: the captured message lives in the server's memory, so the spec stores the
 * SHA-256 of a fresh secret as the platform would at send time and keeps the secret. The pages
 * then read, throttle and spend it exactly as a real link; only the inbox is skipped.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: a newsletter spec needs the database the server uses");
  return url;
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * A live link of `purpose` for the address the pop-up took, as its secret. Waits first for the
 * confirmation message to leave the outbox: its send mints a confirmation link, which would
 * supersede this one if it landed second.
 */
export async function mintNewsletterLink(email: string, purpose: "CONFIRM" | "MANAGE"): Promise<string> {
  return withDatabase(async (client) => {
    let subscriberId: string | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { rows } = await client.query<{ id: string; waiting: string }>(
        `SELECT s.id,
                (SELECT count(*) FROM email_outbox o
                  WHERE o.message_type = 'NEWSLETTER_CONFIRM' AND o.status IN ('PENDING', 'PROCESSING')
                    AND o.payload_json->>'subscriberId' = s.id::text
                    AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now())) AS waiting
           FROM newsletter_subscribers s WHERE lower(s.delivery_email) = lower($1)`,
        [email],
      );
      if (rows[0] && Number(rows[0].waiting) === 0) {
        subscriberId = rows[0].id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!subscriberId) throw new Error("the pop-up recorded no subscriber for the address");
    const secret = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(secret, "utf8").digest("hex");
    if (purpose === "CONFIRM") {
      await client.query(
        `UPDATE newsletter_tokens SET invalidated_at = now()
          WHERE subscriber_id = $1 AND purpose = 'CONFIRM' AND used_at IS NULL AND invalidated_at IS NULL`,
        [subscriberId],
      );
    }
    await client.query(
      `INSERT INTO newsletter_tokens (subscriber_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [subscriberId, purpose, hash],
    );
    return secret;
  });
}

/**
 * A confirmed subscriber, written as the pop-up and the confirmation page would leave one — the
 * setup for the backoffice's composer, never its subject.
 */
export async function seedConfirmedSubscriber(email: string, topics: string[]): Promise<void> {
  await withDatabase((client) =>
    client.query(
      `INSERT INTO newsletter_subscribers (delivery_email, canonical_email, canonicalization_version, locale, topics, privacy_notice_version, confirmed_at)
       VALUES ($1, lower($1), 2, 'ro', $2::newsletter_topic[], 1, now())`,
      [email, topics],
    ),
  );
}

/** How many newsletter messages were queued for an address. */
export async function newsletterMessagesTo(email: string): Promise<number> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM email_outbox WHERE message_type = 'NEWSLETTER' AND lower(recipient_email) = lower($1)`,
      [email],
    );
    return Number(rows[0]?.n ?? 0);
  });
}

/** The subscription as stored: its topics, and whether it is confirmed — or null once it is gone. */
export async function newsletterSubscription(email: string): Promise<{ topics: string[]; confirmed: boolean } | null> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ topics: string; confirmed: boolean }>(
      `SELECT topics::text AS topics, confirmed_at IS NOT NULL AS confirmed FROM newsletter_subscribers WHERE lower(delivery_email) = lower($1)`,
      [email],
    );
    if (!rows[0]) return null;
    return { topics: rows[0].topics.replace(/[{}]/g, "").split(",").filter(Boolean), confirmed: rows[0].confirmed };
  });
}
