import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §809 — «Clasament» on the race's page (BR-REQ-039-01, BR-REQ-041-01 criterion 6), walked end to end at 320 pixels and on a desk: the
 * Administrator enters four results and, before publishing, the page shows no heading and no sentence about them; publishes (or is refused,
 * when the privacy notice or the terms the database holds do not name the results yet — then the public page must still show nothing); the page
 * then shows the ranking with «Participant #număr» for the runner who did not tick, the chip time under the time, the runner who dropped out last
 * with «Abandon»; the chips narrow the table by category, the box by race number, and «Niciun rând nu se potrivește.» is said when none does; the
 * listing's past fold wears a «Clasament» chip that leads to it; and the editor's «De făcut» says «Cursa s-a terminat și clasamentul nu e publicat»
 * until it is.
 *
 * Lane 51's `race-results.spec.ts` walks the entering, the import and the gate; this spec reuses only their steps to get four results saved. The race
 * and its four registered runners are written straight into the database — the setup, not the subject — one per project and run.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; tag: string; slug: string };

/**
 * A published race two days ago with four registered, confirmed runners holding 101 to 104: Ana (a woman of thirty, ticked), Bia (forty-six, did
 * not tick), Dan (a man of thirty-six, ticked) and Eli (a man of forty, ticked, who will drop out).
 */
async function seedRace(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name, editorial_status, published_at)
       VALUES ('RACE', now() - interval '2 days', 'INTERNAL', 'Parcul Tractorul', 'PUBLISHED', now() - interval '20 days') RETURNING id`,
    );
    const eventId = rows[0].id;
    const slug = `clasament-public-${tag}`;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`,
      [eventId, slug, `Cursa clasamentului ${tag}`, `results-public-${tag}`, `The results race ${tag}`],
    );
    const runners = [
      { bib: 101, name: `Ana Popescu ${tag}`, sex: "FEMALE", birth: "1996-01-01", ticked: true },
      { bib: 102, name: `Bia Marin ${tag}`, sex: "FEMALE", birth: "1980-01-01", ticked: false },
      { bib: 103, name: `Dan Ionescu ${tag}`, sex: "MALE", birth: "1990-01-01", ticked: true },
      { bib: 104, name: `Eli Vasile ${tag}`, sex: "MALE", birth: "1985-01-01", ticked: true },
    ];
    for (const runner of runners) {
      const email = `public-${runner.bib}-${tag}@test.invalid`;
      const { rows: person } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, runner.name],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
           email_confirmed_at, confirmed_at, bib_number, sex, birth_date, list_opt_out, checked_in_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 99999, now() - interval '5 days', false, 1,
           now() - interval '5 days', now() - interval '5 days', $4, $5, $6, $7, now())`,
        [eventId, person[0].id, runner.name, runner.bib, runner.sex, runner.birth, !runner.ticked],
      );
    }
    return { eventId, tag, slug };
  } finally {
    await client.end();
  }
}

/** Whether the privacy notice **and** the terms in force, in both languages, name `{{results}}` — what the Administrator's tick and the public page are gated on. */
async function textsNameResults(): Promise<boolean> {
  return (await textNamesResults("PRIVACY_NOTICE")) && (await textNamesResults("TERMS"));
}

async function textNamesResults(key: "PRIVACY_NOTICE" | "TERMS"): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ locale: string; body: string }>(
      `SELECT t.locale, t.body_json::text AS body
         FROM legal_documents d JOIN legal_document_translations t ON t.legal_document_id = d.id
        WHERE d.key = $1 AND d.is_approved AND d.withdrawn_at IS NULL AND d.effective_at <= now()
          AND d.version = (SELECT max(version) FROM legal_documents WHERE key = $1 AND is_approved AND withdrawn_at IS NULL AND effective_at <= now())`,
      [key],
    );
    return rows.length >= 2 && rows.every((row) => row.body.includes("{{results}}"));
  } finally {
    await client.end();
  }
}

/**
 * The registrations of this spec were made under "notice version 99999", so the name rule's last condition (a registration made under a notice that
 * described the results, §421) holds for them whichever notice the database holds: the rule under test is the page's, and the notice's own gate is
 * the other assertion (`textsNameResults`).
 */

const resultsUrl = (eventId: string) => `/ro/admin/events/${eventId}/results`;
const publicUrl = (slug: string) => `/ro/evenimente/${slug}`;
const row = (page: Page, bib: number) => page.locator(`[data-testid="result-row"][data-bib="${bib}"]`);

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("§809 «Clasament» on the race's page", () => {
  test.describe.configure({ timeout: 240_000 });

  test("is absent until it is published, then ranks the field, narrows by category and by number, and leads from the listing; the editor's reminder goes with it", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, slug } = await seedRace(tag);
    await signIn(page, "Dev Administrator");

    // ---- Four results entered and saved through the backoffice's one button ---------------------------------------------------
    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await page.locator('[name="r[101].time"]').fill("50:00");
    await page.locator('[name="r[101].chip"]').fill("49:58");
    await page.locator('[name="r[102].time"]').fill("45:12");
    await page.locator('[name="r[103].time"]').fill("47:30");
    await page.locator('[name="r[104].status"]').selectOption("DNF");
    await page.getByRole("button", { name: "Salvează tot clasamentul" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Am salvat 4 rezultate", { timeout: 30_000 });

    // ---- Not published: no heading, no sentence, no number, on the page of the race ---------------------------------------------
    const notThere = async () => {
      await page.goto(publicUrl(slug));
      await hydrated(page);
      await expect(page.getByRole("heading", { name: `Cursa clasamentului ${tag}` })).toBeVisible();
      await expect(page.getByTestId("results-section")).toHaveCount(0);
      await expect(page.locator("#clasament")).toHaveCount(0);
      await expect(page.getByText("Participant #102")).toHaveCount(0);
      await expect(page.getByText("Clasament", { exact: true })).toHaveCount(0);
    };
    await notThere();

    // ---- The editor says what is left to do: the race is over and the ranking is not public ---------------------------------------
    const todoRow = () => page.locator('[data-testid="event-todo-page-row"][data-rule="results"]');
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await expect(todoRow()).toHaveCount(1);
    await expect(todoRow()).toContainText("Cursa s-a terminat și clasamentul nu e publicat");
    await expect(todoRow().getByTestId("event-todo-fill")).toHaveAttribute("href", resultsUrl(eventId));

    // ---- The Administrator's tick: accepted when the texts name the results, refused otherwise ------------------------------------
    const described = await textsNameResults();
    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" }).check();
    await page.getByTestId("results-publish-form").getByRole("button", { name: "Salvează" }).click();
    await confirmDialog(page, "Faci clasamentul public?");

    if (!described) {
      // Refused: the page of the race must still show nothing — no section and no bib.
      await expect(page.getByTestId("results-publish-form").getByTestId("form-refusal")).toBeVisible();
      await notThere();
      return;
    }
    await expect(page.getByTestId("toast-live")).toContainText("Clasamentul e acum public", { timeout: 30_000 });

    // ---- The page of the race, published ----------------------------------------------------------------------------------------
    await page.goto(publicUrl(slug));
    await hydrated(page);
    const section = page.getByTestId("results-section");
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: "Clasament" })).toBeVisible();
    await expect(section.getByTestId("results-published")).toContainText(/^Publicat .+ · rămâne pe pagină până .+/);
    // The finishers by place, the runner who dropped out last.
    await expect(section.getByTestId("result-row")).toHaveCount(4);
    await expect(section.getByTestId("result-row").evaluateAll((rows) => rows.map((tr) => tr.getAttribute("data-bib")))).resolves.toEqual(["102", "103", "101", "104"]);
    // Bia did not tick: «Participant #102», and her name is nowhere on the page. Ana ticked and is named.
    await expect(row(page, 102).getByTestId("result-name")).toHaveText("Participant #102");
    await expect(row(page, 101).getByTestId("result-name")).toHaveText(`Ana Popescu ${tag}`);
    await expect(page.getByText(`Bia Marin ${tag}`)).toHaveCount(0);
    await expect(row(page, 101).getByTestId("result-chip-time")).toHaveText("Timp cip: 0:49:58");
    await expect(row(page, 104).getByTestId("result-status")).toHaveText("Abandon");
    // The phone prints a cell's column word before it (`data-label`): a finisher's time reads «Timp 0:50:00», and the runner who dropped
    // out reads «Abandon» alone, never «Timp Abandon».
    const before = (bib: number) => row(page, bib).getByTestId("result-time").evaluate((cell) => getComputedStyle(cell, "::before").content);
    expect(await before(104)).toMatch(/^(none|normal)$/);
    if ((page.viewportSize()?.width ?? 1280) < 600) expect(await before(101)).toBe('"Timp "');
    await expect(row(page, 102).getByTestId("result-place")).toContainText("1");
    await expect(row(page, 102).getByTestId("result-category")).toContainText("Feminin, 40-49 ani · loc 1");
    await expect(row(page, 104).getByTestId("result-place")).toContainText("Fără loc");
    await noHorizontalScroll(page);

    // ---- The category chips: a thumb's reach, native radios, «Toate» first ------------------------------------------------------
    const chips = section.getByTestId("results-category-chip");
    await expect(chips.first()).toContainText("Toate");
    await expect(chips).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) expect((await chips.nth(index).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await section.getByRole("radio", { name: "Feminin, 40-49 ani" }).check();
    await expect(row(page, 102)).toBeVisible();
    for (const bib of [101, 103, 104]) await expect(row(page, bib)).toBeHidden();
    await section.getByRole("radio", { name: "Masculin, 30-39 ani" }).check();
    await expect(row(page, 103)).toBeVisible();
    for (const bib of [101, 102, 104]) await expect(row(page, bib)).toBeHidden();
    await section.getByRole("radio", { name: "Toate" }).check();
    for (const bib of [101, 102, 103, 104]) await expect(row(page, bib)).toBeVisible();

    // ---- The number box: contains, a thumb's height, and a sentence when nothing matches ---------------------------------------------
    const search = section.getByTestId("results-bib-search");
    expect((await search.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await expect(search).toHaveAttribute("inputmode", "numeric");
    await search.fill("104");
    await expect(row(page, 104)).toBeVisible();
    for (const bib of [101, 102, 103]) await expect(row(page, bib)).toBeHidden();
    await search.fill("10");
    for (const bib of [101, 102, 103, 104]) await expect(row(page, bib)).toBeVisible();
    await search.fill("999");
    await expect(section.getByTestId("results-none")).toHaveText("Niciun rând nu se potrivește.");
    for (const bib of [101, 102, 103, 104]) await expect(row(page, bib)).toBeHidden();
    await search.fill("");
    await expect(section.getByTestId("results-none")).toHaveText("");
    for (const bib of [101, 102, 103, 104]) await expect(row(page, bib)).toBeVisible();
    await noHorizontalScroll(page);

    // ---- The English page says the same in English -----------------------------------------------------------------------------------
    await page.goto(`/en/events/results-public-${tag}`);
    await hydrated(page);
    await expect(page.getByTestId("results-section").getByRole("heading", { name: "Results" })).toBeVisible();
    await expect(row(page, 104).getByTestId("result-status")).toHaveText("Dropped out");
    await expect(row(page, 102).getByTestId("result-name")).toHaveText("Participant #102");

    // ---- The listing: the past fold wears a «Clasament» chip, a 44-pixel link to the section ---------------------------------------------
    await page.goto("/ro/evenimente");
    await hydrated(page);
    const past = page.getByTestId("past-events");
    await past.locator("summary").first().click();
    const card = past.locator("li", { has: page.getByRole("link", { name: `Cursa clasamentului ${tag}` }) });
    const chip = card.getByTestId("results-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Clasament");
    await expect(chip).toHaveAttribute("href", new RegExp(`${slug}#clasament$`));
    const box = await chip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`${slug}#clasament$`));
    await expect(page.getByTestId("results-section")).toBeVisible();

    // ---- The editor's reminder is gone once it is public ----------------------------------------------------------------------------------
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await expect(todoRow()).toHaveCount(0);

    // ---- Taking it off takes it off the page at once ------------------------------------------------------------------------------------------
    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" }).uncheck();
    await page.getByTestId("results-publish-form").getByRole("button", { name: "Salvează" }).click();
    await confirmDialog(page, "Scoți clasamentul de pe site?");
    await expect(page.getByTestId("toast-live")).toContainText("nu mai e public", { timeout: 30_000 });
    await notThere();
  });

  test("never draws a section on a group run's page, and the editor has no reminder for it", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    let groupId: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO events (type, starts_at, registration_mode, editorial_status, published_at, results_published, results_published_at)
         VALUES ('GROUP_RUN', now() - interval '2 days', 'NONE', 'PUBLISHED', now() - interval '20 days', true, now()) RETURNING id`,
      );
      groupId = rows[0].id;
      await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'Alergare.'), ($1, 'en', $4, $5, 'Run.')`, [
        groupId,
        `grup-public-${tag}`,
        `Alergare ${tag}`,
        `group-public-${tag}`,
        `Run ${tag}`,
      ]);
    } finally {
      await client.end();
    }
    // Even with the flag set by hand, a group run has no results: the page has no section.
    await page.goto(publicUrl(`grup-public-${tag}`));
    await hydrated(page);
    await expect(page.getByRole("heading", { name: `Alergare ${tag}` })).toBeVisible();
    await expect(page.getByTestId("results-section")).toHaveCount(0);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${groupId}`);
    await hydrated(page);
    await expect(page.locator('[data-testid="event-todo-page-row"][data-rule="results"]')).toHaveCount(0);
  });
});
