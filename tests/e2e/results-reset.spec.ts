import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN — «Resetează clasamentul» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01), walked at 320 pixels and on a desk against a production
 * build: an Administrator tries «Cronometrare» on a race whose planned start is an hour ahead — a test «Start», a finish typed —, opens
 * «Clasament», opens the danger card at its foot, reads the question that counts what goes, resets, and reads no result back; on
 * «Cronometrare» the clock says again that the race has not started, and a press the phone kept from before the reset is refused with
 * its reason, nothing written. The Organizer's «Clasament» has no such card. Nothing scrolls sideways.
 *
 * The race and its two runners are written straight into the database — the setup, not the subject — one per project and run.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** One query on the server's database: the setup and the reads, not the subject. */
async function query<T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** A race whose planned start is an hour ahead — «Start» may be pressed from three hours before it — with runners 101 and 102. */
async function seedRace(tag: string): Promise<string> {
  const [{ id: eventId }] = await query<{ id: string }>(
    `INSERT INTO events (type, starts_at, registration_mode, location_name) VALUES ('RACE', now() + interval '1 hour', 'INTERNAL', 'Parcul Tractorul') RETURNING id`,
    [],
  );
  await query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
    eventId,
    `resetare-${tag}`,
    `Cursa de probă ${tag}`,
    `reset-${tag}`,
    `The trial race ${tag}`,
  ]);
  for (const runner of [
    { bib: 101, name: `Ana Popescu ${tag}` },
    { bib: 102, name: `Bia Marin ${tag}` },
  ]) {
    const email = `reset-${runner.bib}-${tag}@test.invalid`;
    const [person] = await query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, runner.name],
    );
    await query(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
         email_confirmed_at, confirmed_at, bib_number, sex, birth_date)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
         now() - interval '5 days', now() - interval '5 days', $4, 'FEMALE', '1990-01-01')`,
      [eventId, person.id, runner.name, runner.bib],
    );
  }
  return eventId;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("§NNN «Resetează clasamentul»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an Administrator's trial — a «Start» and a finish — is wiped from «Clasament» after the question; «Cronometrare» says the race has not started, and a press kept from before is refused", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const timingUrl = `/ro/admin/checkin/cronometrare?eventId=${eventId}`;
    await signIn(page, "Dev Administrator");

    // The trial at the finish line, an hour before the planned start: a test «Start», then a number typed a few seconds after it.
    await page.goto(timingUrl);
    await hydrated(page);
    await expect(page.getByTestId("finish-clock")).toContainText("Cursa nu a pornit încă.");
    await page.getByTestId("race-gun-start").click();
    await expect(page.getByTestId("timing-banner")).toContainText("Startul a fost dat", { timeout: 15_000 });
    await hydrated(page);
    await expect(page.getByTestId("finish-clock")).toContainText(/De la start: 0:00:0[2-9]/, { timeout: 15_000 });
    const box = page.getByTestId("finish-bib");
    await box.fill("101");
    await box.press("Enter");
    await expect(page.locator('[data-testid="finish-entry"][data-bib="101"]').first()).toHaveAttribute("data-state", "saved", { timeout: 15_000 });

    // «Clasament»: the danger card at the foot of the page, closed; opened, its one button asks first and says what goes.
    await page.goto(`/ro/admin/events/${eventId}/results`);
    await hydrated(page);
    const card = page.getByTestId("results-reset");
    await expect(card).toContainText("Resetează clasamentul");
    await card.locator("summary").click();
    const button = card.getByRole("button", { name: "Resetează clasamentul", exact: true });
    await expect(button).toBeEnabled();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Resetezi clasamentul?");
    await expect(dialog).toContainText("Se șterge 1 rezultat al cursei — sosirea, timpul, starea, nota sau rândul unui alergător neînscris.");
    await expect(dialog).toContainText(/Se șterge și startul dat la \d\d:\d\d\./);
    await expect(dialog).toContainText("Ce e pe telefoanele de la «Cronometrare» și n-a plecat încă se pierde. Nu se poate anula.");
    // The moment of the question, on this machine's clock — the server's: a press made now is a press of the trial.
    const beforeTheReset = Date.now();
    await dialog.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("toast-live")).toContainText("Clasamentul a fost resetat.", { timeout: 30_000 });
    await hydrated(page);
    await expect(page.getByTestId("results-summary")).toContainText("Sosiți: 0");
    await expect(page.getByTestId("result-delete")).toHaveCount(0);
    expect(await query<{ count: string }>(`SELECT count(*) FROM event_results WHERE event_id = $1`, [eventId])).toEqual([{ count: "0" }]);
    expect(await query<{ gun: Date | null }>(`SELECT race_gun_at AS gun FROM events WHERE id = $1`, [eventId])).toEqual([{ gun: null }]);
    await noHorizontalScroll(page);

    // A press this phone kept from before the reset — waiting for a signal, as the finish line keeps one — sent once the page wakes.
    const [admin] = await query<{ id: string }>(`SELECT id FROM staff_users WHERE email = 'dev-admin@dev.test'`, []);
    await page.evaluate(
      ([key, entry]) => {
        let line: { entries: unknown[]; kept: Record<string, unknown>; title: string | null } = { entries: [], kept: {}, title: null };
        try {
          line = { ...line, ...JSON.parse(window.localStorage.getItem(key) ?? "{}") };
        } catch {
          // A line that cannot be read is no line: the press below is the only one.
        }
        window.localStorage.setItem(key, JSON.stringify({ ...line, entries: [...(line.entries ?? []), JSON.parse(entry)] }));
      },
      [`finish-line:${eventId}`, JSON.stringify({ id: randomUUID(), staffId: admin.id, bibNumber: 102, label: null, pressedAtMs: beforeTheReset - 1_000, outcome: null })] as const,
    );

    // «Cronometrare» again: the race has not started, the gun the plan's — and the kept press says why it no longer counts.
    await page.goto(timingUrl);
    await hydrated(page);
    await expect(page.getByTestId("finish-clock")).toContainText("Cursa nu a pornit încă.");
    await expect(page.getByTestId("race-gun-line")).toContainText("Startul planificat:");
    await expect(page.getByTestId("finish-recent-empty")).toBeVisible();
    const kept = page.locator('[data-testid="finish-entry"][data-bib="102"]');
    await expect(kept).toHaveAttribute("data-state", "refused", { timeout: 15_000 });
    await expect(kept).toContainText("#102: apăsat înainte de resetarea clasamentului — nu mai contează");
    expect(await query<{ count: string }>(`SELECT count(*) FROM event_results WHERE event_id = $1`, [eventId])).toEqual([{ count: "0" }]);
    await noHorizontalScroll(page);
  });

  test("the Organizer's «Clasament» has no reset", async ({ page }) => {
    const tag = `${test.info().project.name}-organizer-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/events/${eventId}/results`);
    await hydrated(page);
    await expect(page.getByTestId("results-form")).toBeVisible();
    await expect(page.getByTestId("results-reset")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Resetează clasamentul" })).toHaveCount(0);
    await noHorizontalScroll(page);
  });
});
