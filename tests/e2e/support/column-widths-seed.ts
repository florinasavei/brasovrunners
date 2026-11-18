import { existsSync } from "node:fs";
import pg from "pg";
import { FEATURED } from "./featured-event";

/**
 * The registration the backoffice table's walks write straight into the database so the list is not empty — the setup,
 * not the subject (`promo-filter.spec.ts` argues it) — and remove afterwards, with the emails a confirmed participant has
 * had, so the Administrator's «Emailuri» column (§960) draws the cell of somebody emailed. Shared by
 * `admin-column-widths.spec.ts` (§650, §661, §943) and `admin-top-scrollbar.spec.ts` (§977), which needs a file of its
 * own: its Chromium draws scrollbars, a launch option Playwright takes only at a file's top level.
 */

export function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

export type Seeded = { eventId: string; registrationId: string; participantId: string; tag: string };

/** What the seeded registration was emailed, oldest first: each left a minute after it was queued; the newest's delivery not reported. */
export const EMAILS: readonly { type: string; ago: string; delivered: boolean }[] = [
  { type: "VERIFY_REGISTRATION_EMAIL", ago: "6 days", delivered: true },
  { type: "COMPLETE_DECLARATION", ago: "5 days 23 hours", delivered: true },
  { type: "DECLARATION_SIGNED", ago: "5 days", delivered: true },
  { type: "REGISTRATION_CONFIRMED", ago: "4 days 23 hours", delivered: true },
  { type: "EVENT_UPDATE_NOTICE", ago: "1 day", delivered: false },
];

export async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>(
      "SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1",
      [FEATURED.slug],
    );
    const eventId = eventRows[0].id;
    const email = `columns-${tag}@test.invalid`;
    const name = `Coloane ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
         promo_consent, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED'::registration_status, 'ro', $3, $3, 'PUBLIC', 1, now(), false, 1, true, false, now())
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    // Left and settled, never waiting: nothing here is the outbox's to send. Removed with the registration (on delete cascade).
    for (const [index, mail] of EMAILS.entries()) {
      await client.query(
        `INSERT INTO email_outbox (participant_id, registration_id, message_type, locale, recipient_email, payload_json, idempotency_key,
           status, attempt_count, transport, recipient_count, created_at, sent_at, delivered_at)
         VALUES ($1, $2, $3, 'ro', $4, '{}'::jsonb, $5, 'SENT', 1, 'mailgun', 1, now() - $6::interval,
           now() - $6::interval + interval '1 minute', CASE WHEN $7::boolean THEN now() - $6::interval + interval '2 minutes' END)`,
        [participantRows[0].id, rows[0].id, mail.type, email, `e2e-column-widths-${tag}-${index}`, mail.ago, mail.delivered],
      );
    }
    return { eventId, registrationId: rows[0].id, participantId: participantRows[0].id, tag };
  } finally {
    await client.end();
  }
}

export async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}
