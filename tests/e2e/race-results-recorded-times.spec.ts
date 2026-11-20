import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §1012 — «Timpi la sosire» and «Folosește» on «Clasament» (BR-REQ-050-02, BR-REQ-041-01), walked at 320 pixels and on a desk against a
 * production build: on «Cronometrare» an Administrator types 101, then 102, then 101 again — the second 101 a duplicate, the first time
 * kept on the row —; on «Clasament» the line of 101 lists both times under its «Timp», who pressed each and when, «în clasament» on the
 * first and a 44-pixel «Folosește» beside the second; while that page is open, 103 arrives at «Cronometrare» in another tab — race day
 * goes on —, and the press still goes through, only its own line being guarded; pressed, the question names the time and the runner
 * and says that what is not saved on the page is lost; confirmed, the page comes back at the line, the toast says it, the line's «Timp»
 * is the second time, the places follow — 102 first now, 103 third —, a box typed on another line and not saved is empty again, as the
 * question said, and «Istoricul sosirilor» says the choice. Nothing scrolls sideways.
 *
 * The race and its three runners are written straight into the database — the setup, not the subject — one per project and run.
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

/** A race whose planned gun was a few minutes ago, with runners 101, 102 and 103. */
async function seedRace(tag: string): Promise<string> {
  const [{ id: eventId }] = await query<{ id: string }>(
    `INSERT INTO events (type, starts_at, registration_mode, location_name) VALUES ('RACE', now() - interval '3 minutes', 'INTERNAL', 'Parcul Tractorul') RETURNING id`,
    [],
  );
  await query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
    eventId,
    `timpi-${tag}`,
    `Cursa cu timpi ${tag}`,
    `times-${tag}`,
    `The race of times ${tag}`,
  ]);
  for (const runner of [
    { bib: 101, name: `Ana Popescu ${tag}` },
    { bib: 102, name: `Bia Marin ${tag}` },
    { bib: 103, name: `Cora Dinu ${tag}` },
  ]) {
    const email = `times-${runner.bib}-${tag}@test.invalid`;
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

/** A time as «Clasament» writes it: `h:mm:ss`. */
function clock(ms: number): string {
  const whole = Math.floor(ms / 1000);
  return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** Types a number at the line and waits for its answer: «salvat», or the duplicate's line. */
async function pressNumber(page: Page, bib: number, state: "saved" | "duplicate") {
  const box = page.getByTestId("finish-bib");
  await box.fill(String(bib));
  await box.press("Enter");
  await expect(page.locator(`[data-testid="finish-entry"][data-bib="${bib}"][data-state="${state}"]`).first()).toBeVisible({ timeout: 15_000 });
}

test.describe("§1012 «Timpi la sosire» and «Folosește»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a number pressed twice at «Cronometrare» lists both times on «Clasament»; «Folosește» on the second makes it the line's, the places follow, the history says it", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    await signIn(page, "Dev Administrator");

    // «Cronometrare»: 101, then 102, then 101 again — each a second and more apart, so every press has a second of its own.
    await page.goto(`/ro/admin/checkin/cronometrare?eventId=${eventId}`);
    await hydrated(page);
    await expect(page.getByTestId("finish-clock")).toContainText(/De la start: 0:0\d:\d\d/);
    await pressNumber(page, 101, "saved");
    await page.waitForTimeout(1_500);
    await pressNumber(page, 102, "saved");
    await page.waitForTimeout(1_500);
    await pressNumber(page, 101, "duplicate");
    await expect(page.locator('[data-testid="finish-entry"][data-bib="101"][data-state="duplicate"]')).toContainText(/#101 era deja trecut de Dev Administrator la 0:\d\d:\d\d/);

    // The two times the trail holds for 101: the first on the row, the second beside it.
    const [first] = await query<{ ms: number }>(`SELECT (metadata_json->>'gunTimeMs')::int AS ms FROM audit_logs WHERE entity_id = $1 AND action = 'event_result.created' AND (metadata_json->>'bibNumber')::int = 101`, [eventId]);
    const [second] = await query<{ ms: number }>(`SELECT (metadata_json->>'gunTimeMs')::int AS ms FROM audit_logs WHERE entity_id = $1 AND action = 'event_result.finish_duplicate' AND (metadata_json->>'bibNumber')::int = 101`, [eventId]);
    expect(second.ms).toBeGreaterThan(first.ms);
    const [press102] = await query<{ ms: number }>(`SELECT gun_time_ms AS ms FROM event_results WHERE event_id = $1 AND bib_number = 102`, [eventId]);
    expect(press102.ms).toBeGreaterThan(first.ms);
    expect(press102.ms).toBeLessThan(second.ms);

    // «Clasament»: under 101's «Timp», both times — the first «în clasament», a «Folosește» beside the second; nothing under 102's.
    await page.goto(`/ro/admin/events/${eventId}/results`);
    await hydrated(page);
    const line101 = page.locator('[data-testid="result-line"][data-bib="101"]');
    const line102 = page.locator('[data-testid="result-line"][data-bib="102"]');
    await expect(line101.getByTestId("result-time")).toHaveValue(clock(first.ms));
    const block = line101.getByTestId("result-recorded");
    await expect(block).toContainText("Timpi la sosire:");
    const times = block.getByTestId("result-recorded-time");
    await expect(times).toHaveCount(2);
    await expect(times.nth(0)).toContainText(clock(first.ms));
    await expect(times.nth(0)).toContainText("în clasament");
    await expect(times.nth(0)).toContainText(/Dev Administrator, la \d\d:\d\d:\d\d/);
    await expect(times.nth(0).getByTestId("result-recorded-use")).toHaveCount(0);
    await expect(times.nth(1)).toContainText(clock(second.ms));
    await expect(times.nth(1)).not.toContainText("în clasament");
    await expect(line102.getByTestId("result-recorded")).toHaveCount(0);
    await expect(line101.getByTestId("result-place").locator(".MuiTypography-body1")).toHaveText("1");
    await expect(line102.getByTestId("result-place").locator(".MuiTypography-body1")).toHaveText("2");
    await noHorizontalScroll(page);

    // A box typed on another line and not saved: «Folosește» posts its own small form, as «Șterge» does, and says what that does to it.
    await line102.getByTestId("result-note").fill("notă nesalvată");

    // Race day goes on: while this page is open, 103 arrives at «Cronometrare» in another tab. «Folosește» guards only its own line,
    // so the press below still goes through — no reload for another number's arrival.
    const timing = await page.context().newPage();
    await timing.goto(`/ro/admin/checkin/cronometrare?eventId=${eventId}`);
    await hydrated(timing);
    await expect(timing.getByTestId("finish-clock")).toContainText(/De la start: 0:\d\d:\d\d/);
    await pressNumber(timing, 103, "saved");
    await timing.close();
    const [press103] = await query<{ ms: number }>(`SELECT gun_time_ms AS ms FROM event_results WHERE event_id = $1 AND bib_number = 103`, [eventId]);
    expect(press103.ms).toBeGreaterThan(second.ms);
    await expect(page.locator('[data-testid="result-line"][data-bib="103"]').getByTestId("result-time")).toHaveValue("");

    // «Folosește» on the second time: 44 pixels, asked first, the time and the runner in the question.
    const use = times.nth(1).getByRole("button", { name: `Folosește ${clock(second.ms)} pentru #101 Ana Popescu ${tag}` });
    expect((await use.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await use.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Folosești acest timp?");
    await expect(dialog).toContainText(`Pui ${clock(second.ms)} ca timp pentru #101 Ana Popescu ${tag}? Rezultatul devine «Sosit», cu timpul cip și nota de acum, iar locurile se recalculează.`);
    await expect(dialog).toContainText("Ce n-ai salvat pe pagină se pierde: salvează întâi.");
    await dialog.getByTestId("confirm-dialog-confirm").click();

    // Back at the line, the toast saying it; the line's «Timp» is the second time, «în clasament» moved, 102 is first now, and 103 —
    // arrived after the page was drawn — third, its time on its line.
    await expect(page.getByTestId("toast-live")).toContainText("#101: timpul ales e acum în clasament, iar locurile s-au recalculat.", { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/results#result-line-101$`));
    await hydrated(page);
    await expect(line101.getByTestId("result-time")).toHaveValue(clock(second.ms));
    await expect(line101.getByTestId("result-recorded-time").nth(1)).toContainText("în clasament");
    await expect(line101.getByTestId("result-recorded-time").nth(0).getByTestId("result-recorded-use")).toHaveCount(1);
    await expect(line101.getByTestId("result-place").locator(".MuiTypography-body1")).toHaveText("2");
    await expect(line102.getByTestId("result-place").locator(".MuiTypography-body1")).toHaveText("1");
    const line103 = page.locator('[data-testid="result-line"][data-bib="103"]');
    await expect(line103.getByTestId("result-time")).toHaveValue(clock(press103.ms));
    await expect(line103.getByTestId("result-place").locator(".MuiTypography-body1")).toHaveText("3");
    // What the question said: the page is drawn again from what is stored, so the box typed and not saved is empty again — nothing of it was saved.
    await expect(line102.getByTestId("result-note")).toHaveValue("");
    expect(await query<{ note: string | null }>(`SELECT note FROM event_results WHERE event_id = $1 AND bib_number = 102`, [eventId])).toEqual([{ note: null }]);
    expect(await query<{ ms: number; status: string }>(`SELECT gun_time_ms AS ms, status FROM event_results WHERE event_id = $1 AND bib_number = 101`, [eventId])).toEqual([{ ms: second.ms, status: "FINISHED" }]);
    await noHorizontalScroll(page);

    // «Istoricul sosirilor» says the choice, newest first.
    const history = page.getByTestId("results-history");
    await history.locator("summary").first().click();
    await expect(history.getByTestId("results-history-line").first()).toContainText(
      `Dev Administrator a ales pentru #101 Ana Popescu ${tag} timpul ${clock(second.ms)} dintre cele înregistrate · Clasament`,
    );
    await noHorizontalScroll(page);
  });
});
