import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";

/**
 * An email action link, for a spec that has to walk past the inbox.
 *
 * The captured messages that carry the real links live in the server's memory and never on disk
 * (`capture-adapter.ts`, on purpose: a file of live tokens outlives the process), so a browser
 * test cannot read the link the email would have carried. What it can do is what the platform
 * does when it sends one: store the SHA-256 of a fresh secret as the one live token of that
 * purpose (`issueActionToken`), and keep the secret. The link is then a real link — the page
 * reads it, the throttle charges it, the consume statement spends it — and nothing about the
 * flow under test is bypassed. It is the setup, not the subject.
 *
 * Reads `DATABASE_URL` from the environment (CI sets it), falling back to `.env.local` for a
 * laptop run started from the repository root.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: an action-link spec needs the database the server uses");
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

export type RegistrationRow = { id: string; participantId: string; registeredName: string; status: string };

/** The registration a public submission from this address produced (the newest, if several). */
export async function registrationByEmail(email: string): Promise<RegistrationRow> {
  return withDatabase(async (client) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { rows } = await client.query<RegistrationRow>(
        `SELECT r.id, r.participant_id AS "participantId", r.registered_name AS "registeredName", r.status
           FROM registrations r JOIN participants p ON p.id = r.participant_id
          WHERE lower(p.delivery_email) = lower($1)
          ORDER BY r.created_at DESC LIMIT 1`,
        [email],
      );
      if (rows[0]) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("no registration was recorded for the submitted address");
  });
}

export async function registrationStatus(id: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ status: string }>("SELECT status FROM registrations WHERE id = $1", [id]);
    return rows[0]?.status ?? "GONE";
  });
}

/**
 * Backdates a `PENDING_EMAIL_CONFIRMATION` row's link so it reads as lapsed (§420, e2e for
 * finding (7)) — the setup for "an expired verification link renders the lapsed notice, not
 * 'confirmed'", never the subject itself: the page under test still does the lapsing, through
 * `confirmEmailAction`, when the link is pressed.
 */
export async function expireEmailConfirmationLink(id: string): Promise<void> {
  await withDatabase((client) =>
    client.query(`UPDATE registrations SET email_link_expires_at = now() - interval '1 hour' WHERE id = $1`, [id]),
  );
}

/**
 * Moves a registration straight to a state a live declaration link can then find moved on
 * (§420, e2e for finding (8)) — the setup, not the subject: the declare page's own notice is
 * what the spec asserts on.
 */
export async function setRegistrationStatus(id: string, status: string): Promise<void> {
  await withDatabase((client) => client.query(`UPDATE registrations SET status = $2 WHERE id = $1`, [id, status]));
}

/** The two telephone numbers as stored — E.164, whatever the boxes showed (§84). */
export async function registrationPhones(id: string): Promise<{ phone: string | null; emergencyContactPhone: string | null }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ phone: string | null; emergencyContactPhone: string | null }>(
      `SELECT phone, emergency_contact_phone AS "emergencyContactPhone" FROM registrations WHERE id = $1`,
      [id],
    );
    return rows[0] ?? { phone: null, emergencyContactPhone: null };
  });
}

/**
 * The latest declaration acceptance of a registration, as the signing recorded it: both typed
 * names and both documents (§330 — a minor's declaration is signed by the minor and a parent).
 */
export async function latestAcceptance(registrationId: string): Promise<{
  typedName: string;
  idDocument: string | null;
  minorTypedName: string | null;
  minorIdDocument: string | null;
} | null> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ typedName: string; idDocument: string | null; minorTypedName: string | null; minorIdDocument: string | null }>(
      `SELECT typed_name AS "typedName", id_document AS "idDocument",
              minor_typed_name AS "minorTypedName", minor_id_document AS "minorIdDocument"
         FROM declaration_acceptances WHERE registration_id = $1
        ORDER BY accepted_at DESC LIMIT 1`,
      [registrationId],
    );
    return rows[0] ?? null;
  });
}

/**
 * A live link of `purpose` for the registration, returned as its secret.
 *
 * Waits first for the message that would have carried the real one to leave the outbox — the
 * request that queued it drains it just after its response, and that send mints a token of the
 * same purpose, which would supersede this one if it landed second. A message still pending after
 * the wait (a deferred send) mints nothing until something drains it again, which is later than
 * any spec needs the link.
 *
 * `REGISTER_ANOTHER_PERSON` is the exception (§389, §420): every such link stays live beside the
 * others, as `issueActionToken` leaves them — the partial unique index no longer covers that
 * purpose — so minting one here supersedes nothing, exactly as the real send does not.
 *
 * `MANAGE_REGISTRATION` rides on several messages rather than one of its own name (the confirmed
 * email, the reminder…), so for it the wait is for every message of the registration to leave.
 */
export async function mintActionLink(
  registration: Pick<RegistrationRow, "id" | "participantId">,
  purpose: "VERIFY_REGISTRATION_EMAIL" | "COMPLETE_DECLARATION" | "REGISTER_ANOTHER_PERSON" | "MANAGE_REGISTRATION",
): Promise<string> {
  return withDatabase(async (client) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM email_outbox
          WHERE registration_id = $1 AND ($2::text IS NULL OR message_type::text = $2) AND status IN ('PENDING', 'PROCESSING')
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
        // The message type and the purpose share their name for the first three.
        [registration.id, purpose === "MANAGE_REGISTRATION" ? null : purpose],
      );
      if (Number(rows[0].n) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const secret = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(secret, "utf8").digest("hex");
    await client.query("BEGIN");
    try {
      // One live token per registration and purpose (the partial unique index): supersede, then add —
      // for every purpose but the family link, which the index leaves out and the real send never
      // supersedes (§389, §420).
      if (purpose !== "REGISTER_ANOTHER_PERSON") {
        await client.query(
          `UPDATE email_action_tokens SET invalidated_at = now()
            WHERE registration_id = $1 AND purpose = $2 AND used_at IS NULL AND invalidated_at IS NULL`,
          [registration.id, purpose],
        );
      }
      await client.query(
        `INSERT INTO email_action_tokens (participant_id, registration_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '2 hours')`,
        [registration.participantId, registration.id, purpose, hash],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return secret;
  });
}

/**
 * Whether one address may carry a family yet (§389, `registrations/family-gate.ts`): the old
 * one-registration-per-address constraint is gone once the contract release has run. A read of the
 * catalogue, never a change to it — a spec that needs the flow skips, and says why, when it is closed.
 */
export async function familyFlowOpen(): Promise<boolean> {
  return withDatabase(async (client) => {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_constraint WHERE conname = 'registrations_event_participant_unique' AND conrelid = 'registrations'::regclass",
    );
    return rows.length === 0;
  });
}

/** Every registration a public address holds, oldest first (§389: a family on one address). */
export async function registrationsByEmail(email: string): Promise<RegistrationRow[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<RegistrationRow>(
      `SELECT r.id, r.participant_id AS "participantId", r.registered_name AS "registeredName", r.status
         FROM registrations r JOIN participants p ON p.id = r.participant_id
        WHERE lower(p.delivery_email) = lower($1)
        ORDER BY r.created_at ASC`,
      [email],
    );
    return rows;
  });
}

/** The payloads of one message type queued about a registration, oldest first. */
export async function queuedPayloads(registrationId: string, messageType: string): Promise<unknown[]> {
  return withDatabase(async (client) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { rows } = await client.query<{ payload: unknown }>(
        "SELECT payload_json AS payload FROM email_outbox WHERE registration_id = $1 AND message_type = $2 ORDER BY created_at ASC",
        [registrationId, messageType],
      );
      if (rows.length > 0) return rows.map((row) => row.payload);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return [];
  });
}

/**
 * A live "my registrations" link for a participant (§77): `MANAGE_PROFILE`, scoped to the address
 * and to no registration, minted as `mintActionLink` mints the others.
 */
export async function mintProfileLink(participantId: string): Promise<string> {
  return withDatabase(async (client) => {
    const secret = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(secret, "utf8").digest("hex");
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE email_action_tokens SET invalidated_at = now()
          WHERE participant_id = $1 AND registration_id IS NULL AND purpose = 'MANAGE_PROFILE' AND used_at IS NULL AND invalidated_at IS NULL`,
        [participantId],
      );
      await client.query(
        `INSERT INTO email_action_tokens (participant_id, registration_id, purpose, token_hash, expires_at)
         VALUES ($1, NULL, 'MANAGE_PROFILE', $2, now() + interval '2 hours')`,
        [participantId, hash],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return secret;
  });
}
