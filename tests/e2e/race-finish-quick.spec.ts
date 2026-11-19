import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN — «Cronometrare», the finish line of «Ziua cursei» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01, BR-REQ-037-08), walked at
 * 320 pixels and on a desk against a production build: an Organizer, whose row holds the four tabs and fits the phone, taps «Start»
 * twice — one «Start» —; the desk Volunteer — the lowest role, three tabs — types a number and presses an elite's button, sees each
 * saved at once with «introdus de» and its own name, types the same number again and reads the duplicate's line — its own line now
 * saying «Clasament» corrects it, no «Anulează» —, undoes the elite's press, and is told of a press of theirs waiting under another
 * race on the phone. Nothing scrolls sideways.
 *
 * The race, its two runners and its elite line are written straight into the database — the setup, not the subject — one per project
 * and run, so the two projects never meet.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** A race whose planned gun was a few minutes ago, with runners 101 and 102 and an elite line «Andrei <tag>» wearing 7. */
async function seedRace(tag: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name) VALUES ('RACE', now() - interval '3 minutes', 'INTERNAL', 'Parcul Tractorul') RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `cronometrare-${tag}`,
      `Cursa cronometrată ${tag}`,
      `timing-${tag}`,
      `The timed race ${tag}`,
    ]);
    for (const runner of [
      { bib: 101, name: `Ana Popescu ${tag}` },
      { bib: 102, name: `Bia Marin ${tag}` },
    ]) {
      const email = `timing-${runner.bib}-${tag}@test.invalid`;
      const { rows: person } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, runner.name],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
           email_confirmed_at, confirmed_at, bib_number, sex, birth_date)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
           now() - interval '5 days', now() - interval '5 days', $4, 'FEMALE', '1990-01-01')`,
        [eventId, person[0].id, runner.name, runner.bib],
      );
    }
    await client.query(`INSERT INTO event_elite_entries (event_id, name, bib_number) VALUES ($1, $2, 7)`, [eventId, `Andrei ${tag}`]);
    return eventId;
  } finally {
    await client.end();
  }
}

/** One query on the server's database: the setup and the trail read, not the subject. */
async function query<T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Ieși din cont" }).click();
  await expect(page).not.toHaveURL(/\/admin/, { timeout: 30_000 });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("§NNN «Cronometrare»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an Organizer taps «Start» twice and gets one; the desk Volunteer records a number and an elite, sees who entered them, meets a duplicate, undoes a press and is told of one waiting elsewhere", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const timingUrl = `/ro/admin/checkin/cronometrare?eventId=${eventId}`;

    // The Organizer, at the gun — whose row of «Ziua cursei» holds all four tabs, and fits the phone.
    await signIn(page, "Dev Moderator");
    await page.goto(timingUrl);
    await hydrated(page);
    await expect(page.getByTestId("race-day-tabs").getByRole("link")).toHaveCount(4);
    const fourFit = await page.getByTestId("race-day-tabs").locator("nav").evaluate((nav) => nav.scrollWidth <= nav.clientWidth + 1);
    expect(fourFit).toBe(true);
    await noHorizontalScroll(page);
    await expect(page.getByTestId("race-gun-line")).toContainText("Startul planificat:");
    // Tapped twice, the second tap while the first is on its way: one «Start», and the page says it was given — not that it stayed.
    await page.getByTestId("race-gun-start").dblclick();
    await expect(page.getByTestId("timing-banner")).toContainText("Startul a fost dat", { timeout: 15_000 });
    await expect(page.getByTestId("race-gun-line")).toContainText(/Startul: \d\d:\d\d:\d\d · apăsat de Dev Moderator/);
    const starts = await query<{ count: string }>(`SELECT count(*) FROM audit_logs WHERE entity_id = $1 AND action = 'event.race_gun_set'`, [eventId]);
    expect(Number(starts[0].count)).toBe(1);
    await signOut(page);

    // The desk Volunteer, at the line.
    await signIn(page, "Dev Contributor");
    await page.goto(timingUrl);
    await hydrated(page);
    // «Ziua cursei»'s four tabs, «Cronometrare» current; the volunteer has no «Clasament» and no «Start».
    const tabs = page.getByTestId("race-day-tabs").getByRole("link");
    await expect(tabs).toHaveCount(3);
    await expect(page.getByTestId("race-day-tabs").locator('[aria-current="page"]')).toContainText(/Cronometrare|Sosiri/);
    await expect(page.getByTestId("race-gun-start")).toHaveCount(0);
    const fits = await page.getByTestId("race-day-tabs").locator("nav").evaluate((nav) => nav.scrollWidth <= nav.clientWidth + 1);
    expect(fits).toBe(true);
    await expect(page.getByTestId("finish-clock")).toContainText(/De la start: 0:0\d:\d\d/);

    // A number, typed: saved at once, the box empty and still the focus.
    const box = page.getByTestId("finish-bib");
    await box.fill("101");
    await box.press("Enter");
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    const entry101 = page.locator('[data-testid="finish-entry"][data-bib="101"]').first();
    await expect(entry101).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
    const recent101 = page.locator('[data-testid="finish-recent-row"][data-bib="101"]');
    await expect(recent101).toContainText(`#101 Ana Popescu ${tag}`);
    await expect(recent101).toContainText("introdus de Dev Contributor");

    // The elite, by the button: the label large, the name under it.
    const elite = page.locator('[data-testid="finish-elite"][data-bib="7"]').getByTestId("finish-elite-button");
    await expect(elite).toContainText(`Andrei ${tag}`);
    const height = await elite.evaluate((button) => button.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(56);
    await elite.click();
    const recent7 = page.locator('[data-testid="finish-recent-row"][data-bib="7"]');
    await expect(recent7).toContainText(`Andrei (#7) Andrei ${tag}`, { timeout: 15_000 });
    await expect(recent7).toContainText("introdus de Dev Contributor");
    await expect(elite).toBeDisabled();
    await expect(elite).toContainText("✓");

    // The same number again, a second later: the first time stays, and the line says who had it and when.
    await page.waitForTimeout(1_500);
    await box.fill("101");
    await page.getByTestId("finish-record").click();
    const duplicate = page.locator('[data-testid="finish-entry"][data-bib="101"][data-state="duplicate"]');
    await expect(duplicate).toContainText(/#101 era deja trecut de Dev Contributor la 0:\d\d:\d\d/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="finish-recent-row"][data-bib="101"]')).toHaveCount(1);
    // Pressed twice, 101 is no longer undone here: which press was right is «Clasament»'s to say.
    await expect(recent101.getByTestId("finish-undo")).toHaveCount(0);
    await expect(recent101.getByTestId("finish-undo-closed")).toContainText("l-ai mai trecut o dată");

    // Undo the elite's press: the line leaves «Ultimii sosiți», the button is pressable again.
    await recent7.getByTestId("finish-undo").click();
    await expect(page.locator('[data-testid="finish-recent-row"][data-bib="7"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(elite).toBeEnabled();

    // A press of this account left waiting under another race on this phone: named above the box, with a link to that race's page.
    const [volunteer] = await query<{ id: string }>(`SELECT id FROM staff_users WHERE email = 'dev-contributor@dev.test'`, []);
    const elsewhereId = randomUUID();
    const waiting = { entries: [{ id: randomUUID(), staffId: volunteer.id, bibNumber: 55, label: null, pressedAtMs: Date.now(), outcome: null }], kept: {}, title: `Crosul ${tag}` };
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`finish-line:${elsewhereId}`, JSON.stringify(waiting)] as const);
    await page.reload();
    await hydrated(page);
    const elsewhere = page.getByTestId("finish-elsewhere");
    await expect(elsewhere).toContainText(`1 apăsare așteaptă la Crosul ${tag}: se trimite doar de pe pagina lui.`);
    await expect(elsewhere.getByRole("link")).toHaveAttribute("href", `?eventId=${elsewhereId}`);

    await noHorizontalScroll(page);
  });
});
