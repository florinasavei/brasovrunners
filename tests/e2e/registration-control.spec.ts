import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §906 — «Înscrieri publice deschise» beside «Locuri» (the owner, 2026-11-03: «cumva trebuie să pot controla mai
 * bine»). What only a browser can see, and the unit and PGlite tests cannot: the tick is a real check box in an
 * `ActionForm` whose two questions are chosen by the box's state — unticked asks «Oprești înscrierile de pe site?»,
 * ticked «Redeschizi înscrierile de pe site?» — saved by its own button, 44 pixels tall; «Pe site acum» says the
 * public door the press left; and the public event page and its register page, already visited (so cached), say the
 * door is shut — `registration-paused`, no button, no form — and open again once the tick is back. The Organizer
 * reads the state and is handed no form.
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

/** A published race taking registrations on the site, ten places, nobody registered. */
async function seedRace(tag: string): Promise<{ eventId: string; slug: string }> {
  const slug = `usa-site-${tag}`;
  const eventId = await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 10, 'Parcul Tractorul', 'PUBLISHED', now()) RETURNING id`,
    );
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      rows[0].id,
      slug,
      `Crosul ușii ${tag}`,
      `site-door-${tag}`,
      `The door race ${tag}`,
    ]);
    return rows[0].id;
  });
  return { eventId, slug };
}

const doorOf = (eventId: string) =>
  withDatabase(async (client) => (await client.query<{ open: boolean }>("SELECT public_registration_open AS open FROM events WHERE id = $1", [eventId])).rows[0].open);

const trailOf = (eventId: string) =>
  withDatabase(async (client) =>
    (
      await client.query<{ metadata: { from: boolean; to: boolean; via?: string } }>(
        "SELECT metadata_json AS metadata FROM audit_logs WHERE action = 'event.public_registration_changed' AND entity_id = $1 ORDER BY created_at",
        [eventId],
      )
    ).rows.map((row) => row.metadata),
  );

/** No page wider than the screen: the 320-pixel rule (§1.5). */
async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The event's page and its register page, as a visitor meets them: shut (`registration-paused`) or not. */
async function publicPagesSay(page: Page, slug: string, shut: boolean) {
  expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);
  const paused = page.locator("#main").getByTestId("registration-paused");
  if (shut) {
    await expect(paused.first()).toContainText("Înscrierile pe site sunt oprite de organizatori.");
    await expect(page.locator("#main").getByRole("link", { name: /Înscrie-te la eveniment/ })).toHaveCount(0);
  } else {
    await expect(paused).toHaveCount(0);
  }
  await fitsTheScreen(page);
  expect((await page.goto(`/ro/evenimente/${slug}/inscriere`))?.status()).toBe(200);
  if (shut) {
    await expect(page.getByTestId("registration-paused")).toContainText("Înscrierile pe site sunt oprite de organizatori.");
  } else {
    await expect(page.getByTestId("registration-paused")).toHaveCount(0);
  }
  await fitsTheScreen(page);
}

test.describe("§906 «Înscrieri publice deschise» beside «Locuri»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Administrator shuts the site's door and opens it again; the public pages and «Pe site acum» follow", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, slug } = await seedRace(tag);

    // The public pages first, so the shut door below is read through whatever they cached.
    await publicPagesSay(page, slug, false);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    const main = page.locator("#main");
    await expect(main.getByTestId("registrations-public-now-line")).toHaveText("Pe site acum: butonul «Înscrie-te» — primul venit ia un loc liber.");

    // The tick: a real check box, ticked as the row stands, and its own save button with a thumb's target and a glyph.
    let form = main.getByTestId("registrations-public-door-form");
    let tick = form.getByRole("checkbox", { name: "Înscrieri publice deschise" });
    await expect(tick).toBeChecked();
    const save = form.getByTestId("registrations-public-door-save");
    expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(save.locator("svg")).toHaveCount(1);
    await fitsTheScreen(page);

    // Unticked and saved: the closing question, then the toast, the line and the row.
    await tick.uncheck();
    await save.click();
    await confirmDialog(page, "Oprești înscrierile de pe site?");
    await expect(page.getByTestId("toast-live")).toContainText("Înscrierile pe site sunt oprite. Echipa poate înscrie în continuare.", { timeout: 30_000 });
    await hydrated(page);
    await expect(main.getByTestId("registrations-public-now-line")).toHaveText(
      "Pe site acum: înscrierile sunt închise — bifa «Înscrieri publice deschise» e scoasă.",
    );
    form = main.getByTestId("registrations-public-door-form");
    tick = form.getByRole("checkbox", { name: "Înscrieri publice deschise" });
    await expect(tick).not.toBeChecked();
    expect(await doorOf(eventId)).toBe(false);
    expect(await trailOf(eventId)).toEqual([{ from: true, to: false, via: "registrations" }]);

    await publicPagesSay(page, slug, true);

    // Ticked again: the opening question this time.
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    form = main.getByTestId("registrations-public-door-form");
    await form.getByRole("checkbox", { name: "Înscrieri publice deschise" }).check();
    await form.getByTestId("registrations-public-door-save").click();
    await confirmDialog(page, "Redeschizi înscrierile de pe site?");
    await expect(page.getByTestId("toast-live")).toContainText("Înscrierile pe site sunt deschise din nou.", { timeout: 30_000 });
    await hydrated(page);
    await expect(main.getByTestId("registrations-public-now-line")).toHaveText("Pe site acum: butonul «Înscrie-te» — primul venit ia un loc liber.");
    expect(await doorOf(eventId)).toBe(true);

    await publicPagesSay(page, slug, false);
  });

  test("the Organizer reads the door's state and is handed no tick", async ({ page }) => {
    const tag = `${test.info().project.name}-org-${Date.now().toString(36)}`;
    const { eventId } = await seedRace(tag);
    await withDatabase((client) => client.query("UPDATE events SET public_registration_open = false WHERE id = $1", [eventId]));

    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    const main = page.locator("#main");
    await expect(main.getByTestId("registrations-public-now-line")).toContainText("bifa «Înscrieri publice deschise» e scoasă");
    await expect(main.getByTestId("registrations-public-door-state")).toHaveText("Înscrierile pe site sunt oprite de un Administrator.");
    await expect(main.getByTestId("registrations-public-door-form")).toHaveCount(0);
    await fitsTheScreen(page);
  });
});
