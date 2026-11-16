import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { cardOnListing, languageTab, openEditorBox } from "./support/fold";

/**
 * §948, BR-REQ-050-02, BR-REQ-041-01 — «Mesaj cât înscrierile pe site sunt oprite» (the owner, 2026-11-15, of the card's
 * «Înscrierile pe site sunt oprite de organizatori.»: «vreau să scrie mai frumos sau să pot customiza mesajul»).
 *
 * What only a browser can see, and the unit and PGlite tests cannot: the note's two boxes are a language strip inside
 * the editor's one form, under the tick «Înscrieri publice deschise» — so, as the Administrator, the strip is found
 * under the tick, each language's box takes its sentence, and the editor's one «Salvează» writes both; a visitor then
 * reads the club's own sentence, in their language, on the event's page, on its register page and on its card in the
 * listing — where the platform's «Înscrierile pe site sunt închise momentan.» stood before the save, on pages already
 * visited (so cached) — and never the other language's. Written in one language alone, the save is refused and both
 * boxes keep what was typed.
 *
 * The event is written straight into the database — the setup, not the subject — one per project and test, so the two
 * projects never share a row.
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

/** A published race taking registrations on the site, its door shut by the tick, ten places, nobody registered. */
async function seedShutRace(tag: string): Promise<{ eventId: string; slug: string; slugEn: string; title: string }> {
  const slug = `mesaj-oprit-${tag}`;
  const slugEn = `paused-note-${tag}`;
  const title = `Crosul mesajului ${tag}`;
  const eventId = await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, public_registration_open,
         surface, difficulty_level, cost_type, distance_meters)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 10, 'Parcul Tractorul', 'PUBLISHED', now(), false, 'ASPHALT', 5, 'FREE', 10000) RETURNING id`,
    );
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt, location_name)
       VALUES ($1, 'ro', $2, $3, 'O cursă.', 'Parcul Tractorul'), ($1, 'en', $4, $5, 'A race.', 'Tractorul Park')`,
      [rows[0].id, slug, title, slugEn, `The message race ${tag}`],
    );
    return rows[0].id;
  });
  return { eventId, slug, slugEn, title };
}

const notesOf = (eventId: string) =>
  withDatabase(async (client) =>
    Object.fromEntries((await client.query<{ locale: string; note: string | null }>("SELECT locale, paused_note AS note FROM event_translations WHERE event_id = $1", [eventId])).rows.map((row) => [row.locale, row.note])),
  );

const RO_NOTE = "Înscrierile s-au încheiat. Ne vedem la start!";
const EN_NOTE = "Registration has ended. See you at the start!";
const PLATFORM_RO = "Înscrierile pe site sunt închise momentan.";
const PLATFORM_EN = "Registration on the site is closed for now.";

/** The shut door's sentence on the event's page and on its register page, in one language. */
async function publicPagesSay(page: Page, path: string, registerPath: string, said: string, notSaid: readonly string[]) {
  expect((await page.goto(path))?.status()).toBe(200);
  const paused = page.locator("#main").getByTestId("registration-paused");
  await expect(paused.first()).toContainText(said);
  for (const other of notSaid) await expect(paused.first()).not.toContainText(other);
  expect((await page.goto(registerPath))?.status()).toBe(200);
  await expect(page.locator("#main").getByTestId("registration-paused")).toContainText(said);
  for (const other of notSaid) await expect(page.locator("#main").getByTestId("registration-paused")).not.toContainText(other);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test.describe("§948 «Mesaj cât înscrierile pe site sunt oprite»", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the Administrator writes the club's own sentence under the tick, in both languages; the public pages say it, each in its language", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, slug, slugEn, title } = await seedShutRace(tag);
    const roPage = `/ro/evenimente/${slug}`;
    const enPage = `/en/events/${slugEn}`;

    // Before any note: the platform's friendlier sentence, on pages visited now so the save below is read through the cache.
    await publicPagesSay(page, roPage, `${roPage}/inscriere`, PLATFORM_RO, []);
    await publicPagesSay(page, enPage, `${enPage}/register`, PLATFORM_EN, []);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await openEditorBox(page, "Participare, înscrieri și regulament");
    const windowBox = await openEditorBox(page, "Perioada de înscriere");
    // The strip stands under the tick it speaks for, in the same card.
    await expect(windowBox.locator('[name="event.publicRegistrationOpen"]')).not.toBeChecked();
    const roBox = windowBox.locator('[name="translations.ro.pausedNote"]');
    await expect(roBox).toBeVisible();
    await expect(roBox).toHaveAttribute("maxlength", "200");
    await expect(windowBox.getByLabel("Mesaj cât înscrierile pe site sunt oprite (opțional)").first()).toBeVisible();
    await expect(windowBox).toContainText(`Gol: „${PLATFORM_RO}”`);

    // ---- One language alone is refused: both or neither -------------------------------------------------------------
    await roBox.fill(RO_NOTE);
    const acknowledge = page.locator('[name="acknowledgeLiveEdit"]');
    if (await acknowledge.count()) await acknowledge.check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("form-refusal")).toBeVisible({ timeout: 30_000 });
    await expect(roBox).toHaveValue(RO_NOTE);
    expect(await notesOf(eventId)).toEqual({ ro: null, en: null });

    // ---- Both languages: saved by the editor's one button ------------------------------------------------------------
    await languageTab(page, "paused-note", "en").click();
    await page.locator('[name="translations.en.pausedNote"]').fill(EN_NOTE);
    if (await acknowledge.count()) await acknowledge.check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/[?&]saved=/, { timeout: 30_000 });
    await expect.poll(() => notesOf(eventId), { timeout: 30_000 }).toEqual({ ro: RO_NOTE, en: EN_NOTE });

    // ---- A visitor reads the club's words, each language its own, where the platform's stood -------------------------
    await publicPagesSay(page, roPage, `${roPage}/inscriere`, RO_NOTE, [PLATFORM_RO, EN_NOTE]);
    await publicPagesSay(page, enPage, `${enPage}/register`, EN_NOTE, [PLATFORM_EN, RO_NOTE]);
    // …and on the event's card in the listing.
    await page.goto("/ro/evenimente");
    const card = (await cardOnListing(page, title)).first();
    await expect(card).toContainText(RO_NOTE);
    await expect(card).not.toContainText(PLATFORM_RO);
  });
});
