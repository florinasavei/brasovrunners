import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * BR-REQ-033-01 (`DECISIONS.md` §NNN, amending §104 and §407) — a changed confirmation window moves the
 * holds it gave. On the editor: the «Fereastra de confirmare» card says what the next save moves, and
 * after the save the banner says what it moved.
 *
 * The race and the runner are written straight into the database — the setup, not the subject
 * (`hidden-list.spec.ts`) — one of each per project and run: a draft race forty days off with the
 * window 15 / 5 already saved, and a place still held until the start, as a deadline of 0 gave it.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
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

async function seed(tag: string): Promise<{ eventId: string; registrationId: string; startsAt: Date }> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string; starts_at: Date }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name,
         confirmation_opens_days_before, confirmation_deadline_days_before)
       VALUES ('RACE', date_trunc('hour', now()) + interval '40 days', 'INTERNAL', 10, 'Parcul Tractorul', 15, 5)
       RETURNING id, starts_at`,
    );
    const { id: eventId, starts_at: startsAt } = eventRows[0];
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`,
      [eventId, `fereastra-muta-${tag}`, `Crosul ferestrei ${tag}`, `window-moves-${tag}`, `The window race ${tag}`],
    );
    const email = `window-holds-${tag}@test.invalid`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, `Semnatar ${tag}`],
    );
    // Held until the start: the place a deadline of 0 gave before somebody set 5.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, hold_expires_at)
       VALUES ($1, $2, 'PENDING_DECLARATION', 'ro', $3, $3, 1, now(), false, 1, $4) RETURNING id`,
      [eventId, participantRows[0].id, `Semnatar ${tag}`, startsAt],
    );
    return { eventId, registrationId: rows[0].id, startsAt };
  });
}

test.describe("BR-REQ-033-01 the window's card and the save's banner (§NNN)", () => {
  test("the card says the save moves the place held until the start; the save moves it and says so", async ({ page }) => {
    test.setTimeout(90_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, registrationId, startsAt } = await seed(tag);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    const card = await openEditorBox(page, "Fereastra de confirmare");
    await expect(card.getByTestId("confirmation-holds")).toContainText("Salvarea mută 1 loc rezervat la termenul ferestrei");

    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);
    await expect(page.getByTestId("holds-moved")).toContainText("Salvarea a mutat 1 loc rezervat la termenul nou");

    // The row now holds the window's deadline, five days before the start; the card says it holds there.
    const hold = await withDatabase(
      async (client) => (await client.query<{ hold_expires_at: Date }>(`SELECT hold_expires_at FROM registrations WHERE id = $1`, [registrationId])).rows[0].hold_expires_at,
    );
    expect(hold.getTime()).toBe(startsAt.getTime() - 5 * 86_400_000);
    const after = await openEditorBox(page, "Fereastra de confirmare");
    await expect(after.getByTestId("confirmation-holds")).toContainText("1 loc rezervat ține până");
  });
});
