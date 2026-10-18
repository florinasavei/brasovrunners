import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";

/**
 * A «Vin!» link, for a spec that has to walk past the inbox (`action-link.ts`' reasoning, applied to an answer).
 *
 * The captured messages that carry the real links live in the server's memory and never on disk, so a browser test cannot read the
 * link the email would have carried. What it can do is what the platform does when it sends one: store the SHA-256 of a fresh secret
 * as the answer's one live link of that purpose, and keep the secret. The link is then a real link — the page reads it, the throttle
 * charges it, the consume statement spends it — and nothing about the flow under test is bypassed. It is the setup, not the subject.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: an RSVP spec needs the database the server uses");
  return url;
}

export async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export type RsvpRow = { id: string; eventId: string; confirmedAt: Date | null; displayName: string | null; showName: boolean };

/** The answer an address gave at an event, once the request that wrote it has committed. */
export async function rsvpRow(email: string, eventId: string): Promise<RsvpRow | null> {
  return withDatabase(async (client) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { rows } = await client.query<RsvpRow>(
        `SELECT id, event_id AS "eventId", confirmed_at AS "confirmedAt", display_name AS "displayName", show_name AS "showName"
           FROM event_rsvps WHERE canonical_email = lower($1) AND event_id = $2`,
        [email, eventId],
      );
      if (rows[0]) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  });
}

/** How many answers an address has, across events — for the one-tap checks. */
export async function rsvpCount(email: string): Promise<number> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM event_rsvps WHERE canonical_email = lower($1)", [email]);
    return Number(rows[0].n);
  });
}

/** The messages of one type queued for an address, whatever their state. */
export async function rsvpMessages(email: string): Promise<number> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM email_outbox WHERE message_type = 'RSVP_CONFIRM' AND lower(recipient_email) = lower($1)", [email]);
    return Number(rows[0].n);
  });
}

/** The remembered browsers of an address. */
export async function rememberedBrowsers(email: string): Promise<number> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM person_sessions WHERE canonical_email = lower($1)", [email]);
    return Number(rows[0].n);
  });
}

/**
 * A live link of `purpose` for the answer, returned as its secret. Waits first for the message that would have carried the real one to
 * leave the outbox — the request that queued it drains it just after its response, and that send mints links of its own, which this one
 * would otherwise race (one live link per answer and purpose).
 */
export async function mintRsvpLink(rsvpId: string, purpose: "RSVP_CONFIRM" | "RSVP_WITHDRAW"): Promise<string> {
  return withDatabase(async (client) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM email_outbox
          WHERE message_type = 'RSVP_CONFIRM' AND payload_json->>'rsvpId' = $1 AND status IN ('PENDING', 'PROCESSING')
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
        [rsvpId],
      );
      if (Number(rows[0].n) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const secret = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(secret, "utf8").digest("hex");
    await client.query("BEGIN");
    try {
      await client.query(`UPDATE event_rsvp_tokens SET invalidated_at = now() WHERE rsvp_id = $1 AND purpose = $2 AND used_at IS NULL AND invalidated_at IS NULL`, [rsvpId, purpose]);
      await client.query(`INSERT INTO event_rsvp_tokens (rsvp_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '2 hours')`, [rsvpId, purpose, hash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return secret;
  });
}
