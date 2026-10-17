import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN — «Clasament», a race's results (BR-REQ-050-02, BR-REQ-039-01, BR-REQ-053-01, BR-REQ-060-01), walked as the Administrator does at 320 pixels
 * and on a desk: open the page of a race that has started, import a small CSV (the boxes fill, nothing is saved), write the name of the number no
 * registration holds, press the ONE «Salvează tot clasamentul», read the places it gave, delete one result (it asks first), tick «Clasamentul e
 * public pe pagina evenimentului» — refused or accepted according to the privacy notice the database holds — and open the file. The Organizer
 * sees the same lines and no tick.
 *
 * The race and its three registered runners are written straight into the database — the setup, not the subject — one per project and run.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; tag: string };

/** A race two days ago with three registered runners holding the numbers 101 to 103: two women (30 and 41) and a man. */
async function seedRace(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name)
       VALUES ('RACE', now() - interval '2 days', 'INTERNAL', 'Parcul Tractorul') RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`,
      [eventId, `clasament-${tag}`, `Cursa de probă ${tag}`, `results-${tag}`, `The test race ${tag}`],
    );
    const runners = [
      { bib: 101, name: `Ana Popescu ${tag}`, sex: "FEMALE", birth: "1996-01-01", ticked: true, checkedIn: true },
      { bib: 102, name: `Bia Marin ${tag}`, sex: "FEMALE", birth: "1980-01-01", ticked: false, checkedIn: false },
      { bib: 103, name: `Dan Ionescu ${tag}`, sex: "MALE", birth: "1990-01-01", ticked: true, checkedIn: false },
    ];
    for (const runner of runners) {
      const email = `result-${runner.bib}-${tag}@test.invalid`;
      const { rows: person } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, runner.name],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
           email_confirmed_at, confirmed_at, bib_number, sex, birth_date, list_opt_out, checked_in_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
           now() - interval '5 days', now() - interval '5 days', $4, $5, $6, $7, $8)`,
        [eventId, person[0].id, runner.name, runner.bib, runner.sex, runner.birth, !runner.ticked, runner.checkedIn ? new Date() : null],
      );
    }
    return { eventId, tag };
  } finally {
    await client.end();
  }
}

/** Whether the privacy notice in force, in both languages, names `{{results}}` — what the Administrator's tick is gated on. */
async function noticeNamesResults(): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ locale: string; body: string }>(
      `SELECT t.locale, t.body_json::text AS body
         FROM legal_documents d JOIN legal_document_translations t ON t.legal_document_id = d.id
        WHERE d.key = 'PRIVACY_NOTICE' AND d.is_approved AND d.withdrawn_at IS NULL AND d.effective_at <= now()
          AND d.version = (SELECT max(version) FROM legal_documents WHERE key = 'PRIVACY_NOTICE' AND is_approved AND withdrawn_at IS NULL AND effective_at <= now())`,
    );
    return rows.length >= 2 && rows.every((row) => row.body.includes("{{results}}"));
  } finally {
    await client.end();
  }
}

const resultsUrl = (eventId: string) => `/ro/admin/events/${eventId}/results`;

/** The place cell of one runner's line: the overall position and what follows it. */
const placeOf = (page: Page, bib: number) => page.locator(`[data-testid="result-line"][data-bib="${bib}"]`).getByTestId("result-place");
const timeBox = (page: Page, bib: number) => page.locator(`[name="r[${bib}].time"]`);

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("§NNN a race's results", () => {
  // Toasts queue, one read after the other: a later sentence waits for the earlier one to hide.
  test.describe.configure({ timeout: 240_000 });

  test("imports a CSV into the boxes, takes the missing name, saves once, ranks, deletes one result and gates the tick on the notice", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId } = await seedRace(tag);
    await signIn(page, "Dev Administrator");

    // The registrations list and the event editor both open the page for a race that has started (BR-REQ-050-02).
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    await expect(page.getByTestId("results-link").first()).toBeVisible();
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    // The link sits in the closed «Înscrieri» card: it is in the page, and points at the race's own results.
    await expect(page.getByTestId("results-link").first()).toHaveAttribute("href", resultsUrl(eventId));

    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await expect(page.getByTestId("results-title")).toContainText(`Cursa de probă ${tag}`);
    await expect(page.locator('[data-testid="result-line"]')).toHaveCount(3);
    // The checked-in runner first, then by number.
    await expect(page.locator('[data-testid="result-line"]').first()).toHaveAttribute("data-bib", "101");
    // A runner who did not tick is said to appear as «Participant #102» on the site.
    await expect(page.getByText("Pe site: Participant #102")).toBeVisible();
    await noHorizontalScroll(page);

    // Every box is at least 44 pixels high — the thumb's reach (BR-REQ-041-01 criterion 6).
    for (const testId of ["result-time", "result-status", "result-chip", "result-note"]) {
      const box = await page.getByTestId(testId).first().boundingBox();
      expect(box?.height ?? 0, testId).toBeGreaterThanOrEqual(43.5);
    }

    // ---- «Importă din CSV»: the boxes fill, nothing is saved ----------------------------------------------------
    await page.getByTestId("results-import").locator("summary").click();
    await page.getByTestId("results-import-text").fill("Nr;Timp;Status\n101;50:00;\n102;45:12;\n103;;DNF\n555;47:00;");
    await page.getByRole("button", { name: "Importă din CSV" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Nimic nu s-a salvat încă", { timeout: 20_000 });
    await expect(timeBox(page, 101)).toHaveValue("0:50:00");
    await expect(timeBox(page, 102)).toHaveValue("0:45:12");
    await expect(page.locator('[name="r[103].status"]')).toHaveValue("DNF");
    // The number no registration holds is a new line of its own, with the name left to write; its fold opened by itself.
    await expect(page.locator('[name="n[0].bib"]')).toHaveValue("555");
    await expect(page.locator('[name="n[0].time"]')).toHaveValue("0:47:00");
    await expect(page.locator('[name="n[0].name"]')).toBeVisible();
    await expect(page.locator('[name="n[0].name"]')).toHaveValue("");
    // The pasted text left its box, and the database still holds nothing.
    await expect(page.getByTestId("results-import-text")).toHaveValue("");
    await noHorizontalScroll(page);

    // ---- One save, refused on the line that has no name, with every box kept ------------------------------------------
    await page.getByRole("button", { name: "Salvează tot clasamentul" }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("#555");
    await expect(refusal).toContainText("scrie numele");
    await expect(timeBox(page, 101)).toHaveValue("0:50:00");
    await expect(page.locator('[name="n[0].time"]')).toHaveValue("0:47:00");

    // ---- …then the name is written, and the one save writes the lot ----------------------------------------------------
    await page.locator('[name="n[0].name"]').fill("Ion Vasile");
    await page.getByRole("button", { name: "Salvează tot clasamentul" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Am salvat 4 rezultate", { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/results$`));
    await hydrated(page);

    // 102 (45:12) is first, the typed 555 (47:00) second, 101 (50:00) third; 103 did not finish and has no place.
    await expect(placeOf(page, 102)).toContainText("1");
    await expect(placeOf(page, 102)).toContainText("la sex: 1");
    await expect(placeOf(page, 102)).toContainText("Feminin, 40-49 ani");
    await expect(placeOf(page, 101)).toContainText("3");
    await expect(placeOf(page, 103)).toContainText("fără loc încă");
    await expect(page.getByTestId("typed-line").first().getByTestId("result-place")).toContainText("2");
    await expect(page.locator('[name="n[0].name"]')).toHaveValue("Ion Vasile");
    await expect(page.getByTestId("results-summary")).toContainText("Sosiți: 3");
    await expect(page.getByTestId("results-summary")).toContainText("Abandon: 1");

    // ---- A save of what was drawn changes nothing --------------------------------------------------------------------
    await page.getByRole("button", { name: "Salvează tot clasamentul" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Nimic de schimbat în clasament", { timeout: 30_000 });

    // ---- The row's own delete asks first, and the others' places follow --------------------------------------------------
    await page.locator('[data-testid="result-line"][data-bib="102"]').getByTestId("result-delete").click();
    await confirmDialog(page, "Ștergi rezultatul?");
    await expect(page.getByTestId("toast-live")).toContainText("Rezultat șters", { timeout: 30_000 });
    await hydrated(page);
    await expect(placeOf(page, 102)).toContainText("fără loc încă");
    await expect(placeOf(page, 101)).toContainText("2");
    await expect(page.getByTestId("typed-line").first().getByTestId("result-place")).toContainText("1");

    // ---- The file: the ranking, names as the backoffice sees them --------------------------------------------------------
    const href = await page.getByTestId("results-export").getAttribute("href");
    expect(href).toContain(`/api/admin/events/${eventId}/results`);
    const file = await page.request.get(href as string);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("text/csv");
    const csv = await file.text();
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Loc,Loc la sex,Loc la categorie,Număr,Nume");
    expect(csv).toContain("Ion Vasile");
    expect(csv).toContain(`Ana Popescu ${tag}`);
    expect(csv).toContain("0:47:00");

    // ---- The Administrator's tick: gated on the notice the database holds ------------------------------------------------------
    const described = await noticeNamesResults();
    const tick = page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" });
    await expect(tick).not.toBeChecked();
    if (!described) await expect(page.getByTestId("results-notice-missing")).toContainText("nu descrie încă clasamentul");
    await tick.check();
    await page.getByTestId("results-publish-form").getByRole("button", { name: "Salvează" }).click();
    await confirmDialog(page, "Faci clasamentul public?");
    if (described) {
      await expect(page.getByTestId("toast-live")).toContainText("Clasamentul e acum public", { timeout: 30_000 });
      await hydrated(page);
      await expect(page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" })).toBeChecked();
      await expect(page.getByTestId("results-published-chip")).toContainText("Public");
      // Taking it off asks first too.
      await page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" }).uncheck();
      await page.getByTestId("results-publish-form").getByRole("button", { name: "Salvează" }).click();
      await confirmDialog(page, "Scoți clasamentul de pe site?");
      await expect(page.getByTestId("toast-live")).toContainText("nu mai e public", { timeout: 30_000 });
    } else {
      const publishRefusal = page.getByTestId("results-publish-form").getByTestId("form-refusal");
      await expect(publishRefusal).toBeVisible();
      await expect(publishRefusal).toContainText("Nota de confidențialitate în vigoare nu descrie încă clasamentul");
      await expect(page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" })).not.toBeChecked();
      await expect(page.getByTestId("results-published-chip")).toContainText("Nepublic");
    }
    await noHorizontalScroll(page);
  });

  test("shows the Organizer the same lines and no tick: only an administrator publishes", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId } = await seedRace(tag);
    await signIn(page, "Dev Moderator");
    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await expect(page.locator('[data-testid="result-line"]')).toHaveCount(3);
    await expect(page.getByRole("checkbox", { name: "Clasamentul e public pe pagina evenimentului" })).toHaveCount(0);
    await expect(page.getByTestId("results-publish-admin-only")).toContainText("Doar un administrator poate publica clasamentul");
    // The Organizer enters a result: one save, and the toast counts it.
    await timeBox(page, 101).fill("48:30");
    await page.getByRole("button", { name: "Salvează tot clasamentul" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Am salvat 1 rezultat", { timeout: 30_000 });
    await expect(placeOf(page, 101)).toContainText("1");
  });

  test("is the 404 of an unknown page for the Tehnic role, whatever the address", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId } = await seedRace(tag);
    await signIn(page, "Dev Technical");
    const response = await page.goto(resultsUrl(eventId));
    expect(response?.status()).toBe(404);
    // The file is refused too, by the route itself.
    const file = await page.request.get(`/api/admin/events/${eventId}/results?lang=ro`);
    expect(file.status()).toBe(403);
  });

  test("answers a group run with the sentence that says it has none", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    let groupId: string;
    try {
      const { rows } = await client.query<{ id: string }>(`INSERT INTO events (type, starts_at, registration_mode) VALUES ('GROUP_RUN', now() - interval '2 days', 'NONE') RETURNING id`);
      groupId = rows[0].id;
      await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'Alergare.'), ($1, 'en', $4, $5, 'Run.')`, [groupId, `grup-${tag}`, `Alergare ${tag}`, `group-${tag}`, `Run ${tag}`]);
    } finally {
      await client.end();
    }
    await signIn(page, "Dev Administrator");
    await page.goto(resultsUrl(groupId));
    await hydrated(page);
    await expect(page.getByTestId("results-not-race")).toContainText("Doar o cursă are clasament");
    await expect(page.getByTestId("results-form")).toHaveCount(0);
    // The editor offers no link to it either.
    await page.goto(`/ro/admin/events/${groupId}`);
    await hydrated(page);
    await expect(page.getByTestId("results-link")).toHaveCount(0);
  });
});
