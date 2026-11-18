import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN — a race's «Clasament» public from the start and live while it runs (BR-REQ-039-01, BR-REQ-053-01, BR-REQ-041-01 criterion 6; the
 * owner, 2026-11-18: «pe site live trebuie sa vad lista de finish, atat ca admin cat si public» — and, asked, «public from the start»,
 * «LIVE»), walked at 320 pixels and on a desk against a production build:
 *
 * 1. two days before the race the Administrator types a «Neprezentat» and ticks the results public: accepted, «Public de la start» with the
 *    start's day and hour, «Cursa nu a început încă», and under the unticked runner's «Pe site: Participant #102» the reason;
 * 2. the race's page, for a visitor, shows nothing of it;
 * 3. the race starts (its start moved into the past — the setup, not the subject) and a finisher is saved: the visitor's page shows the
 *    ranking with «Se actualizează singur la 30 de secunde»;
 * 4. another finisher is saved while the visitor's page stays open: nothing changes by itself until the page's own clock — Playwright's
 *    `page.clock`, fast-forwarded instead of waited — reaches thirty seconds; then the new row is there, with no reload;
 * 5. past the race's window the line goes and the page asks nothing more.
 *
 * The page is anonymous on purpose: its rows come through the public cache and the static page, so the row appearing proves the tag the
 * results' save expires is the one the section's read is filed under (§333). The backoffice is a second browser context.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

async function sql<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * A published race in two days with three registered, confirmed runners: Ana (101, ticked), Bia (102, did not tick) and Dan (103, ticked).
 * Their registrations were made under "notice version 99999", so the name rule's notice line holds whichever notice the database holds.
 */
async function seedRace(tag: string): Promise<{ eventId: string; slug: string }> {
  const [{ id: eventId }] = await sql<{ id: string }>(
    `INSERT INTO events (type, starts_at, registration_mode, location_name, editorial_status, published_at)
     VALUES ('RACE', now() + interval '2 days', 'INTERNAL', 'Parcul Tractorul', 'PUBLISHED', now() - interval '20 days') RETURNING id`,
  );
  const slug = `clasament-live-${tag}`;
  await sql(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
    eventId,
    slug,
    `Cursa în direct ${tag}`,
    `results-live-${tag}`,
    `The live race ${tag}`,
  ]);
  const runners = [
    { bib: 101, name: `Ana Popescu ${tag}`, sex: "FEMALE", birth: "1996-01-01", ticked: true },
    { bib: 102, name: `Bia Marin ${tag}`, sex: "FEMALE", birth: "1980-01-01", ticked: false },
    { bib: 103, name: `Dan Ionescu ${tag}`, sex: "MALE", birth: "1990-01-01", ticked: true },
  ];
  for (const runner of runners) {
    const email = `live-${runner.bib}-${tag}@test.invalid`;
    const [person] = await sql<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, runner.name],
    );
    await sql(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
         email_confirmed_at, confirmed_at, bib_number, sex, birth_date, list_opt_out)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 99999, now() - interval '5 days', false, 1,
         now() - interval '5 days', now() - interval '5 days', $4, $5, $6, $7)`,
      [eventId, person.id, runner.name, runner.bib, runner.sex, runner.birth, !runner.ticked],
    );
  }
  return { eventId, slug };
}

/** Whether the privacy notice and the terms in force, in both languages, name `{{results}}` — what the Administrator's tick is gated on. */
async function textsNameResults(): Promise<boolean> {
  for (const key of ["PRIVACY_NOTICE", "TERMS"]) {
    const rows = await sql<{ body: string }>(
      `SELECT t.body_json::text AS body
         FROM legal_documents d JOIN legal_document_translations t ON t.legal_document_id = d.id
        WHERE d.key = $1 AND d.is_approved AND d.withdrawn_at IS NULL AND d.effective_at <= now()
          AND d.version = (SELECT max(version) FROM legal_documents WHERE key = $1 AND is_approved AND withdrawn_at IS NULL AND effective_at <= now())`,
      [key],
    );
    if (rows.length < 2 || !rows.every((row) => row.body.includes("{{results}}"))) return false;
  }
  return true;
}

const resultsUrl = (eventId: string) => `/ro/admin/events/${eventId}/results`;
const publicUrl = (slug: string) => `/ro/evenimente/${slug}`;
const row = (page: Page, bib: number) => page.locator(`[data-testid="result-row"][data-bib="${bib}"]`);

/** One saved line of «Clasament», by the page's own one button. */
async function saveLine(admin: Page, eventId: string, fill: (page: Page) => Promise<unknown>) {
  await admin.goto(resultsUrl(eventId));
  await hydrated(admin);
  await fill(admin);
  await admin.getByRole("button", { name: "Salvează tot clasamentul" }).click();
  await expect(admin.getByTestId("toast-live")).toContainText("Am salvat 1 rezultat", { timeout: 30_000 });
}

test.describe("§NNN «Clasament» public from the start, and live while the race runs", () => {
  test.describe.configure({ timeout: 240_000 });

  test("ticked before the race it shows nothing; from the start it shows the finishers and refreshes itself every 30 seconds", async ({ page, browser }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, slug } = await seedRace(tag);
    const backoffice = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const admin = await backoffice.newPage();
    try {
      await signIn(admin, "Dev Administrator");

      // ---- 1. Two days before the race: a «Neprezentat» typed early, and the tick -------------------------------------------------
      await saveLine(admin, eventId, (p) => p.locator('[name="r[102].status"]').selectOption("DNS"));
      await expect(admin.getByTestId("results-not-started")).toContainText("Cursa nu a început încă");
      await expect(admin.getByTestId("results-publish-not-started")).toContainText("Poți bifa de pe acum: pe site, clasamentul apare de la start");
      // «Loc» in plain words, above the lines.
      await expect(admin.getByTestId("results-place-hint")).toContainText("„Loc” e locul în clasament");

      const described = await textsNameResults();
      await admin.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" }).check();
      await admin.getByTestId("results-publish-form").getByRole("button", { name: "Salvează" }).click();
      await confirmDialog(admin, "Faci clasamentul public?");
      if (!described) {
        // Refused by the notice's gate, before the start as after it: the page of the race shows nothing.
        await expect(admin.getByTestId("results-publish-form").getByTestId("form-refusal")).toBeVisible();
        await page.goto(publicUrl(slug));
        await hydrated(page);
        await expect(page.getByTestId("results-section")).toHaveCount(0);
        return;
      }
      await expect(admin.getByTestId("toast-live")).toContainText("de la start", { timeout: 30_000 });
      await expect(admin.getByTestId("results-published-chip")).toHaveText("Public de la start");
      await expect(admin.getByTestId("results-publish-from-start")).toContainText(/Pe site apare de la start, .+, la \d{2}:\d{2}, pe măsură ce sosesc alergătorii\./);
      // The unticked runner says why she is «Participant #102»; the ticked one says nothing more.
      const bia = admin.locator('[data-testid="result-line"][data-bib="102"]');
      await expect(bia).toContainText("Pe site: Participant #102");
      await expect(bia.getByTestId("result-public-reason")).toHaveText("N-a bifat „Vreau să apar pe lista de participanți & rezultate”.");
      await expect(admin.locator('[data-testid="result-line"][data-bib="101"]').getByTestId("result-public-reason")).toHaveCount(0);
      await expect(admin.getByTestId("results-named-count")).toHaveText("Cu nume pe site: 0 din 1");

      // ---- 2. The visitor's page before the start: nothing, though a row is stored and the tick is on --------------------------------
      await page.goto(publicUrl(slug));
      await hydrated(page);
      await expect(page.getByRole("heading", { name: `Cursa în direct ${tag}` })).toBeVisible();
      await expect(page.getByTestId("results-section")).toHaveCount(0);
      await expect(page.getByText("Participant #102")).toHaveCount(0);

      // ---- 3. The race starts; a finisher is saved; the visitor's page shows the ranking, live --------------------------------------
      await sql(`UPDATE events SET starts_at = now() - interval '10 minutes' WHERE id = $1`, [eventId]);
      await saveLine(admin, eventId, (p) => p.locator('[name="r[101].time"]').fill("50:00"));
      await expect(admin.getByTestId("results-published-chip")).toHaveText("Public");

      // The page's own clock from here on: it flows as usual until paused, and is moved forward by hand.
      await page.clock.install();
      await page.goto(publicUrl(slug));
      await hydrated(page);
      const section = page.getByTestId("results-section");
      await expect(section).toBeVisible();
      await expect(section.getByTestId("results-live")).toHaveText("Se actualizează singur la 30 de secunde.");
      await expect(row(page, 101).getByTestId("result-name")).toHaveText(`Ana Popescu ${tag}`);
      await expect(row(page, 102).getByTestId("result-name")).toHaveText("Participant #102");
      await expect(row(page, 102).getByTestId("result-status")).toHaveText("Neprezentat");
      await expect(row(page, 103)).toHaveCount(0);
      await page.evaluate(() => {
        (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
      });
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

      // ---- 4. Another finisher while the page stays open: there only once the page's clock says thirty seconds ---------------------
      await saveLine(admin, eventId, (p) => p.locator('[name="r[103].time"]').fill("47:30"));
      // The page does not change by itself in the meantime: no timer has fired yet.
      await page.waitForTimeout(2_000);
      await expect(row(page, 103)).toHaveCount(0);
      await page.clock.fastForward(30_000);
      await page.clock.resume();
      await expect(row(page, 103)).toBeVisible({ timeout: 30_000 });
      await expect(row(page, 103).getByTestId("result-name")).toHaveText(`Dan Ionescu ${tag}`);
      await expect(section.getByTestId("result-row").evaluateAll((rows) => rows.map((tr) => tr.getAttribute("data-bib")))).resolves.toEqual(["103", "101", "102"]);
      // The same document: a refresh, never a reload.
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // ---- 5. Past the race's window (six hours for a race saved without an end): the line goes, nothing more is asked ---------------
      await page.clock.fastForward(6 * 3_600_000);
      await expect(section.getByTestId("results-live")).toHaveCount(0);
      await expect(row(page, 103)).toBeVisible();
    } finally {
      await backoffice.close();
    }
  });
});
