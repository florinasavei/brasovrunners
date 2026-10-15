import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN — «I can't export the participants as excel anymore!» (the owner, 2026-10-15). The race
 * «CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026» has an «Ș», a «Ț» and an en dash; an HTTP header
 * is Latin-1 bytes, and the Excel export answered 500 for any such title. Here the button on the
 * registrations list is pressed for such an event, and the browser is handed a workbook whose suggested name
 * keeps the diacritics (the header's `filename*`), while the plain `filename` beside it is ASCII.
 *
 * The event and its one registration are written straight into the database — the setup, not the subject,
 * as `promo-filter.spec.ts` argues — and removed afterwards, so no other spec's counts change.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

const TITLE = "CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026";

type Seeded = { eventId: string; registrationId: string; participantId: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, surface, starts_at, timezone, capacity, registration_mode, editorial_status, published_at)
       VALUES ('RACE', 'ASPHALT', now() + interval '60 days', 'Europe/Bucharest', 50, 'INTERNAL', 'PUBLISHED', now() - interval '1 day')
       RETURNING id`,
    );
    const eventId = eventRows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $4), ($1, 'en', $3, $4)`,
      [eventId, `diacritice-${tag}-ro`, `diacritics-${tag}-en`, TITLE],
    );
    const email = `diacritice-${tag}@test.invalid`;
    const name = `Ștefan Țepeș ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now(), false, 1, now())
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    return { eventId, registrationId: rows[0].id, participantId: participantRows[0].id };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM event_translations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  } finally {
    await client.end();
  }
}

test.describe("BR-REQ-060-01 §NNN the participants' Excel export, for an event whose title has diacritics", () => {
  test("downloads a workbook whose name keeps the diacritics, its plain name beside it in ASCII", async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}`);
      await hydrated(page);

      // The button on the list: the browser saves what the route answers.
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#main").getByRole("link", { name: "Exportă Excel" }).click()]);
      expect(download.suggestedFilename()).toMatch(/^CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026 \d{4}-\d{2}-\d{2}\.xlsx$/);
      // A real workbook: a zip, which opens with «PK».
      expect(readFileSync(await download.path()).subarray(0, 2).toString("latin1")).toBe("PK");

      // The header itself: 200, the ASCII name first, the real one in `filename*`.
      const response = await page.request.get(`/api/admin/registrations/export?eventId=${seeded.eventId}&format=xlsx`);
      expect(response.status()).toBe(200);
      const header = response.headers()["content-disposition"];
      expect(header).toMatch(/^attachment; filename="CROSUL ANIVERSAR BRASOV RUNNERS - EDITIA A II-A 2026 \d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/);
      expect(header).toContain("BRA%C8%98OV");
      // The CSV beside it keeps its plain name.
      const csv = await page.request.get(`/api/admin/registrations/export?eventId=${seeded.eventId}`);
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-disposition"]).toContain('filename="registrations.csv"');
    } finally {
      await cleanup(seeded);
    }
  });
});
