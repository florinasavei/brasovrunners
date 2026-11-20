import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN (amending §949 and §953 for the desk), BR-REQ-037-08, BR-REQ-060-01 — a «Voluntar» at the race-day desk takes a runner off the
 * event's raffle and puts them back, asked first, the press kept with who did it — walked at 320 pixels and on a desktop against
 * the production build:
 *
 * - on the scanned person's view the line says «Tombolă: participă» with «Scoate de la tombolă» under it, a thumb's 44 pixels;
 * - pressed, the house's question opens, naming the person and the number, «Anulează» focused: «Anulează» leaves everything as it
 *   was — the mark, the line and the trail;
 * - pressed again and confirmed, the line says «Tombolă: nu participă — scos de la tombolă», the mark is off and the trail holds one
 *   row with the volunteer's account and the desk's door;
 * - on the desk's list, under the row a search finds, «Pune înapoi la tombolă», asked the same way, puts the runner back.
 *
 * No page scrolls sideways. The race and its runner are written straight into the database — the setup, not the subject — one
 * set per project and test, and removed after. Never a real person.
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

type Seeded = { eventId: string; registrationId: string; participantId: string; name: string; code: string };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const deskCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** A published race a week away that holds a raffle «Din oficiu», and one confirmed runner with number 7. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number, has_raffle)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `tombola-masa-${tag}`,
      `Crosul mesei ${tag}`,
      `raffle-desk-${tag}`,
      `The desk race ${tag}`,
    ]);
    const name = `Ana Scoasa ${tag}`;
    const email = `ana-scoasa-${tag}@test.invalid`;
    const { rows: participants } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const code = deskCode();
    const { rows: registrations } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
         results_name_consent, results_consent_version, confirmed_at, bib_number, checkin_code)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'Ana', $4, 1, now(), false, 1, now(), 7, $5) RETURNING id`,
      [eventId, participants[0].id, name, `Scoasa ${tag}`, code],
    );
    return { eventId, registrationId: registrations[0].id, participantId: participants[0].id, name, code };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])", [[seeded.registrationId, seeded.eventId]]);
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  });
}

const inRaffleOf = (id: string) => withDatabase(async (client) => (await client.query<{ in_raffle: boolean }>("SELECT in_raffle FROM registrations WHERE id = $1", [id])).rows[0].in_raffle);
type TrailRow = { action: string; actor: string | null; metadata: Record<string, unknown> };
const raffleTrail = (id: string) =>
  withDatabase(
    async (client) =>
      (
        await client.query<TrailRow>(
          `SELECT action, actor_staff_user_id AS actor, metadata_json AS metadata FROM audit_logs
            WHERE entity_type = 'registration' AND entity_id = $1 AND action IN ('registration.raffle_excluded', 'registration.raffle_included') ORDER BY created_at`,
          [id],
        )
      ).rows,
  );
const volunteerId = () => withDatabase(async (client) => (await client.query<{ id: string }>("SELECT id FROM staff_users WHERE email = 'dev-contributor@dev.test'")).rows[0]?.id);

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

async function tall(locator: Locator, what: string): Promise<void> {
  expect((await locator.boundingBox())?.height ?? 0, `${what} is a thumb's 44 pixels`).toBeGreaterThanOrEqual(44);
}

test.describe("§NNN the desk takes a runner off the raffle, asked first, and puts them back", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a «Voluntar» presses «Scoate de la tombolă», «Anulează» leaves it as it was, then confirms, then puts the runner back", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await signIn(page, "Dev Contributor");
      const takeOutTitle = `Scoți pe ${seeded.name} (nr. 7) de la tombolă?`;

      await test.step("the scanned view says «Tombolă: participă» with «Scoate de la tombolă» under it", async () => {
        await page.goto(`/ro/admin/checkin/${seeded.code}`);
        await hydrated(page);
        const line = page.getByTestId("desk-raffle");
        await expect(line.getByTestId("desk-raffle-line")).toHaveText("Tombolă: participă");
        const press = line.getByRole("button", { name: `Scoate de la tombolă: ${seeded.name}` });
        await expect(press).toHaveText("Scoate de la tombolă");
        await tall(press, "«Scoate de la tombolă»");
        await fitsTheScreen(page);
      });

      await test.step("pressed, the question names the person and the number, «Anulează» focused — and «Anulează» leaves it as it was", async () => {
        await page.getByRole("button", { name: `Scoate de la tombolă: ${seeded.name}` }).click();
        const dialog = page.getByRole("dialog", { name: takeOutTitle });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("Numărul lui nu mai intră la tragere. Rămâne scris cine a decis.");
        await expect(dialog).toContainText(`Nu pleacă niciun email către ${seeded.name}.`);
        const cancel = dialog.getByRole("button", { name: "Anulează" });
        await expect(cancel).toBeFocused();
        await expect(dialog.getByRole("button", { name: "Da, scoate de la tombolă" })).toBeVisible();
        await tall(cancel, "«Anulează»");
        await fitsTheScreen(page);
        await cancel.click();
        await expect(dialog).toBeHidden();
        // Nothing was sent: the mark, the line and the trail as they were.
        await expect(page.getByTestId("desk-raffle-line")).toHaveText("Tombolă: participă");
        expect(await inRaffleOf(seeded.registrationId)).toBe(true);
        expect(await raffleTrail(seeded.registrationId)).toEqual([]);
      });

      await test.step("pressed again and confirmed: «nu participă — scos de la tombolă», the mark off, one trail row with who and the desk's door", async () => {
        await page.getByRole("button", { name: `Scoate de la tombolă: ${seeded.name}` }).click();
        const dialog = page.getByRole("dialog", { name: takeOutTitle });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Da, scoate de la tombolă" }).click();
        await expect(page).toHaveURL(/[?&]saved=raffleTakenOut/, { timeout: 30_000 });
        await hydrated(page);
        await expect(page.getByText("Scos de la tombolă: numărul nu mai intră la tragere.").first()).toBeVisible();
        const line = page.getByTestId("desk-raffle-line");
        await expect(line).toContainText("Tombolă: nu participă");
        await expect(line).toContainText("— scos de la tombolă");
        await expect(page.getByTestId("desk-raffle").getByRole("button", { name: `Pune înapoi la tombolă: ${seeded.name}` })).toBeVisible();
        expect(await inRaffleOf(seeded.registrationId)).toBe(false);
        const trail = await raffleTrail(seeded.registrationId);
        expect(trail).toEqual([{ action: "registration.raffle_excluded", actor: await volunteerId(), metadata: { inRaffle: false, door: "desk" } }]);
        await fitsTheScreen(page);
      });

      await test.step("on the desk's list, under the row a search finds, «Pune înapoi la tombolă» puts the runner back, asked the same way", async () => {
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.name)}`);
        await hydrated(page);
        const row = page.getByTestId("desk-row").filter({ hasText: seeded.name });
        await expect(row.getByTestId("desk-raffle-line")).toContainText("— scos de la tombolă");
        const press = row.getByRole("button", { name: `Pune înapoi la tombolă: ${seeded.name}` });
        await tall(press, "«Pune înapoi la tombolă»");
        await press.click();
        const dialog = page.getByRole("dialog", { name: `Pui înapoi pe ${seeded.name} (nr. 7) la tombolă?` });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Anulează" })).toBeFocused();
        await dialog.getByRole("button", { name: "Da, pune înapoi la tombolă" }).click();
        await expect(page).toHaveURL(/[?&]saved=rafflePutBack/, { timeout: 30_000 });
        await hydrated(page);
        await expect(page.getByTestId("desk-row").filter({ hasText: seeded.name }).getByTestId("desk-raffle-line")).toHaveText("Tombolă: participă");
        expect(await inRaffleOf(seeded.registrationId)).toBe(true);
        expect((await raffleTrail(seeded.registrationId)).map((row) => [row.action, row.metadata])).toEqual([
          ["registration.raffle_excluded", { inRaffle: false, door: "desk" }],
          ["registration.raffle_included", { inRaffle: true, door: "desk" }],
        ]);
        await fitsTheScreen(page);
      });

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
