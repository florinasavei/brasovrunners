import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * «Locuri păstrate pentru club» (§914; BR-REQ-034-01, BR-REQ-050-02): what only a browser can see. The Administrator types
 * K in the event editor and presses «Salvează»; the save first says each place setting it changes «before → after» and
 * what the site will announce («Controlul înscrierilor e foarte sensibil»), and a save that changes no place setting asks
 * nothing. Then the public event page reads full — «Toate cele 7 locuri s-au ocupat», the waiting list's door — while
 * three of the ten places are still free for the club, and nothing public names them.
 *
 * The race and its seven confirmed runners are written straight into the database — the setup, not the subject — one per
 * project and test, so the two projects never share a row.
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

/** A published race on the site, ten places, seven of them taken by confirmed runners, nobody waiting. */
async function seedRace(tag: string): Promise<{ eventId: string; slug: string }> {
  const slug = `locuri-pastrate-${tag}`;
  const eventId = await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 10, 'Parcul Tractorul', 'PUBLISHED', now()) RETURNING id`,
    );
    const id = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      id,
      slug,
      `Crosul clubului ${tag}`,
      `kept-places-${tag}`,
      `The club's race ${tag}`,
    ]);
    for (let n = 1; n <= 7; n += 1) {
      const email = `alergator${n}-${tag}@example.ro`;
      const person = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, `Alergător ${n}`],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, privacy_notice_version,
           privacy_acknowledged_at, results_name_consent, results_consent_version, confirmed_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, now())`,
        [id, person.rows[0].id, `Alergător ${n}`],
      );
    }
    return id;
  });
  return { eventId, slug };
}

const keptOf = (eventId: string) =>
  withDatabase(async (client) => (await client.query<{ kept: number }>("SELECT places_kept_for_club AS kept FROM events WHERE id = $1", [eventId])).rows[0].kept);

/** No page wider than the screen: the 320-pixel rule (§1.5). */
async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("§914 «Locuri păstrate pentru club» from the editor to the public page", () => {
  test.describe.configure({ timeout: 180_000 });

  test("K typed in the editor: the save says the change and what the site announces, and the event page reads full while kept places remain", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, slug } = await seedRace(tag);

    // Before: seven of ten taken, the site's own button.
    expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);
    await expect(page.locator("#main").getByTestId("registration-waitlist-message")).toHaveCount(0);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await openEditorBox(page, "Participare, înscrieri și regulament");
    const kept = page.locator('[name="event.placesKeptForClub"]');
    await kept.scrollIntoViewIfNeeded();
    await kept.fill("3");
    // A published event: the save asks for the live-edit tick first.
    await page.locator('[name="acknowledgeLiveEdit"]').check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();

    // One question, listing the change before → after and what the site will announce — free places split.
    const dialog = page.getByRole("dialog", { name: "Verifică ce se schimbă la locuri" });
    await expect(dialog).toBeVisible();
    const lines = dialog.getByTestId("confirm-lines");
    await expect(lines).toContainText("Locuri păstrate pentru club: 0 → 3.");
    await expect(lines).toContainText("Locuri anunțate pe site: 7, adică 10 minus 3 păstrate pentru club.");
    await expect(lines).toContainText("Libere după salvare: 3 din 10 — pe site 0, păstrate pentru club 3.");
    await fitsTheScreen(page);
    await confirmDialog(page, "Verifică ce se schimbă la locuri");
    await expect(page.getByTestId("toast")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => keptOf(eventId), { timeout: 30_000 }).toBe(3);

    // A save that changes no place setting asks nothing about the places: it saves at once.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await page.locator('[name="acknowledgeLiveEdit"]').check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Verifică ce se schimbă la locuri" })).toHaveCount(0);
    await expect(page.getByTestId("toast")).toBeVisible({ timeout: 30_000 });

    // The public page: full at the site's seven, the waiting list's door — nothing public names the kept places.
    expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);
    const main = page.locator("#main");
    const full = main.getByTestId("registration-waitlist-message");
    await expect(full).toContainText("Toate cele 7 locuri s-au ocupat");
    await expect(main).not.toContainText("păstrate pentru club");
    await expect(main).not.toContainText("Toate cele 10");
    await fitsTheScreen(page);
  });
});
