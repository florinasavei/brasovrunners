import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN, BR-REQ-037-08, BR-REQ-060-01, BR-REQ-041-01 criterion 6 — «Adaugă pe cineva» is the organizers' (the owner, 2026-11-20:
 * «Si voluntarii nu pot adauga pe cineva, doar organizatorii si administratorii pot»), and the desk's line of free spares carries
 * an «i» that says how a spare is given («scrie aici și ceva tooltip cum se dau aceste numere de rezervă libere»), walked on a
 * production build at 320 pixels and on a desktop:
 *
 * - a «Voluntar» sees no «Adaugă pe cineva», reads in its place that an organizer adds them, opens the spares' «i» — a thumb's
 *   44 pixels — and reads the volunteer's words; the entry page is a 404 for them;
 * - an «Organizator» presses «Adaugă pe cineva», finds the lowest free spare chosen, adds the walk-in, and the desk shows them
 *   confirmed on that number, the spares' line one shorter.
 *
 * The race is written straight into the database — the setup, not the subject — a week ahead so the desk lists it, its spares
 * 154–156 printed, one per project and test, and removed after. Never a real person.
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

/** A published race a week away, taking entries here, its sheet of spares printed: 154–156. */
async function seedRace(tag: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, walk_in_bib_start, walk_in_bib_count, editorial_status, published_at)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 50, 'Parcul Tractorul', 154, 3, 'PUBLISHED', now() - interval '1 day') RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `masa-rezerve-${tag}`,
      `Crosul rezervelor ${tag}`,
      `desk-spares-${tag}`,
      `The spares race ${tag}`,
    ]);
    return eventId;
  });
}

/** The race and whoever a test entered on it, with what the entry wrote beside them. */
async function removeRace(eventId: string): Promise<void> {
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string; participant_id: string }>("SELECT id, participant_id FROM registrations WHERE event_id = $1", [eventId]);
    const ids = rows.map((row) => row.id);
    const participantIds = [...new Set(rows.map((row) => row.participant_id))];
    await client.query("DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[]) OR entity_id = $2", [ids, eventId]);
    await client.query("DELETE FROM declaration_acceptances WHERE registration_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM email_outbox WHERE registration_id = ANY($1::uuid[]) OR participant_id = ANY($2::uuid[])", [ids, participantIds]);
    await client.query("DELETE FROM registrations WHERE event_id = $1", [eventId]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM registrations WHERE participant_id = participants.id)", [participantIds]);
    await client.query("DELETE FROM events WHERE id = $1", [eventId]);
  });
}

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

/**
 * A thumb on the «i»: touched, resting a moment, lifted. `tap()` lifts in the same instant, and the house's tooltip opens on
 * its touch timer (`InfoTip`'s `enterTouchDelay`, 0 ms), which a lift before it runs cancels — a real thumb rests longer.
 */
async function thumbOn(page: Page, target: Locator): Promise<void> {
  // On a phone the line sits below the fold: in sight first, as a thumb finds it, so the touch lands on the «i».
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("the «i» has no box");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const input = await page.context().newCDPSession(page);
  await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(300);
  await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await input.detach();
}

/** Opens the spares' «i» the way the device does: a thumb on a phone, the pointer on a desktop. */
async function openTip(page: Page, tip: Locator): Promise<Locator> {
  if (test.info().project.use.hasTouch) await thumbOn(page, tip);
  else await tip.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  return tooltip;
}

test.describe("§NNN the desk: «Adaugă pe cineva» for the organizers, and the spares explained", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a «Voluntar» sees no «Adaugă pe cineva», reads who adds a walk-in, and opens the spares' «i»", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    try {
      await signIn(page, "Dev Contributor");
      await page.goto(`/ro/admin/checkin?eventId=${eventId}`);
      await hydrated(page);

      // No press of the organizers', and the line in its place.
      await expect(page.getByRole("link", { name: "Adaugă pe cineva" })).toHaveCount(0);
      await expect(page.getByTestId("desk-walk-in-call")).toHaveText("Cineva care nu e pe listă? Cheamă un organizator: doar el îl poate adăuga.");
      await expect(page.getByTestId("desk-spares")).toHaveText("Numere de rezervă libere (3): 154–156");

      // The «i» beside the spares: a thumb's target, and the volunteer's words.
      const tip = page.getByTestId("desk-spares-tip").getByRole("button");
      const box = await tip.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      const tooltip = await openTip(page, tip);
      await expect(tooltip).toContainText("Rezervele sunt BIB-uri tipărite dinainte");
      await expect(tooltip).toContainText("«Confirmă pe hârtie» și «Salvează nr.»");
      await expect(tooltip).toContainText("Cineva care nu e pe listă: cheamă un organizator.");
      await expect(tooltip).toContainText("Rezervele le tipărește un Administrator");
      await expect(tooltip).not.toContainText("Adaugă pe cineva");
      await expect(tooltip).not.toContainText("Dă-i un BIB gol");
      await fitsTheScreen(page);

      // The entry page is not theirs: the 404 an unknown page gets.
      expect((await page.goto(`/ro/admin/registrations/new?eventId=${eventId}&back=desk`))?.status()).toBe(404);
    } finally {
      await removeRace(eventId);
    }
  });

  test("an «Organizator» adds a walk-in and hands the lowest free spare", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    try {
      await signIn(page, "Dev Moderator");
      await page.goto(`/ro/admin/checkin?eventId=${eventId}`);
      await hydrated(page);
      await expect(page.getByTestId("desk-walk-in-call")).toHaveCount(0);
      await expect(page.getByTestId("desk-spares")).toHaveText("Numere de rezervă libere (3): 154–156");

      // The Organizer's «i» names the press it has.
      const tooltip = await openTip(page, page.getByTestId("desk-spares-tip").getByRole("button"));
      await expect(tooltip).toContainText("La «Adaugă pe cineva», «Numărul dat acum» are deja aleasă cea mai mică rezervă liberă");
      await expect(tooltip).toContainText("«Dă-i un BIB gol» dă o rezervă unui alergător confirmat care nu are încă număr");
      await page.keyboard.press("Escape");

      const walkIn = page.getByRole("link", { name: "Adaugă pe cineva" });
      const box = await walkIn.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await walkIn.click();
      await expect(page).toHaveURL(new RegExp(`/admin/registrations/new\\?eventId=${eventId}&back=desk`));
      await hydrated(page);

      // The lowest free spare, chosen; the person at the desk.
      await expect(page.locator('select[name="bibNumber"]')).toHaveValue("154");
      await expect(page.getByRole("checkbox", { name: /Persoana este la masă/ })).toBeChecked();
      await page.locator('[name="firstName"]').fill("Venit");
      await page.locator('[name="lastName"]').fill(`Rezerva ${tag}`);
      await page.locator('[name="email"]').fill(`walkin-spare-${tag}@test.invalid`);
      await page.getByRole("checkbox", { name: /a cerut/ }).check();
      await page.getByRole("button", { name: "Adaugă înscrierea" }).click();
      await confirmDialog(page);

      // Back at the desk: confirmed, wearing 154, and the line one shorter.
      await expect(page).toHaveURL(/\/ro\/admin\/checkin\?.*eventId=/, { timeout: 30_000 });
      await expect(page.locator("#admin-alert")).toContainText("Persoana a fost adăugată", { timeout: 15_000 });
      await hydrated(page);
      const row = page.getByTestId("desk-row").filter({ hasText: `Rezerva ${tag}` });
      await expect(row).toHaveCount(1);
      await expect(row.getByText("Confirmată", { exact: true })).toBeVisible();
      await expect(row).toContainText("154");
      await expect(page.getByTestId("desk-spares")).toHaveText("Numere de rezervă libere (2): 155–156");
      await fitsTheScreen(page);
    } finally {
      await removeRace(eventId);
    }
  });
});
