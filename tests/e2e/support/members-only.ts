import { existsSync } from "node:fs";
import pg from "pg";

/**
 * The setup of §NNN's spec: one published event for the members alone and one discount code,
 * written straight into the database the server reads, and removed after. The setup, not the
 * subject — what the spec proves is what the pages do with them.
 *
 * One set per Playwright project (`suffix`): the phone and the desktop run at the same time, and a
 * shared fixture would be deleted by one project's cleanup while the other still reads it.
 *
 * Reads `DATABASE_URL` from the environment (CI sets it), falling back to `.env.local` for a laptop
 * run started from the repository root, as `action-link.ts` does.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the members-only spec needs the database the server uses");
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

/** The fixture's words for one project: its slugs, its title, its partner and its code. */
export function membersFixture(suffix: string) {
  const tag = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    ro: `e2e-doar-membri-${tag}`,
    en: `e2e-members-only-${tag}`,
    title: `Alergarea membrilor ${tag}`,
    partner: `Partener e2e ${tag}`,
    code: `E2EBVR10${tag.toUpperCase().replace(/-/g, "")}`,
  };
}

type Fixture = ReturnType<typeof membersFixture>;

/** A published group run for the members alone, three weeks ahead, in both languages, and a code. */
export async function createMembersOnlyFixture(fixture: Fixture): Promise<void> {
  await withDatabase(async (client) => {
    await removeFixture(client, fixture);
    const startsAt = new Date(Date.now() + 21 * 24 * 60 * 60_000);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, location_name, editorial_status, published_at, members_only)
       VALUES ('GROUP_RUN', $1, 'Parcul Titulescu', 'PUBLISHED', now(), true) RETURNING id`,
      [startsAt],
    );
    const id = rows[0]!.id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'Doar pentru membri.'), ($1, 'en', $4, $3, 'Members only.')`,
      [id, fixture.ro, fixture.title, fixture.en],
    );
    await client.query(
      `INSERT INTO member_discount_codes (partner_name, code, description_ro, description_en, position) VALUES ($1, $2, '10% la tot.', '10% off everything.', 1)`,
      [fixture.partner, fixture.code],
    );
  });
}

async function removeFixture(client: pg.Client, fixture: Fixture): Promise<void> {
  const { rows } = await client.query<{ event_id: string }>(`SELECT DISTINCT event_id FROM event_translations WHERE slug IN ($1, $2)`, [fixture.ro, fixture.en]);
  const ids = rows.map((row) => row.event_id);
  if (ids.length > 0) {
    await client.query(`DELETE FROM event_translations WHERE event_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[])`, [ids]);
  }
  await client.query(`DELETE FROM member_discount_codes WHERE code = $1`, [fixture.code]);
}

export async function removeMembersOnlyFixture(fixture: Fixture): Promise<void> {
  await withDatabase((client) => removeFixture(client, fixture));
}
