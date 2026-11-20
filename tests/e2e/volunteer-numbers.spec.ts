import { expect, type Page, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §1023, amending §948, BR-REQ-050-02 and BR-REQ-071-01 — every volunteer's number is V001, V002, … by itself, and «Descarcă pentru
 * random.org» (the owner, 2026-11-20: «vreau sa le dai numar de voluntar V001 V002 la toti voluntarii automat!»), walked as the
 * Organizer at 320 pixels and on a desktop, against the production build.
 *
 * What only a browser can see: «Confirmă» pressed on the «Voluntari» list comes back with the person's «Nr. V002» beside the name —
 * nothing set first — the confirmed volunteer before them showing «Nr. V001»; «Ziua cursei» → «Tombolă» counts the volunteers and
 * writes their numbers after the race numbers; and its «Descarcă pentru random.org», a thumb's 44 pixels, hands out a plain-text file
 * whose every line is a race number or a V number — no header, no name. No horizontal scroll at any width.
 *
 * The race, its role and its people are written straight into the database — the setup, not the subject — one set per project and
 * test, so the two projects never share a row, and removed after. Never a real person: every name and address is made up.
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

type Seeded = { eventId: string; participantId: string; runner: string; ana: string; eva: string; anaName: string; evaName: string };

/** A race a week away that holds a raffle, one role, a confirmed runner wearing number 1, a volunteer confirmed with V001 and one only offered. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, bib_start_number, accepts_volunteers, has_raffle)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 10, 'Parcul Tractorul', 1, true, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `numere-voluntari-${tag}`,
      `Crosul numerelor ${tag}`,
      `volunteer-numbers-${tag}`,
      `The numbers race ${tag}`,
    ]);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const runner = `Radu Numărul ${tag}`;
    const email = `radu-numere-${tag}@test.invalid`;
    const { rows: participants } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, runner],
    );
    await client.query(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
         results_name_consent, results_consent_version, confirmed_at, bib_number)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'Radu', $4, 1, now(), false, 1, now(), 1)`,
      [eventId, participants[0].id, runner, `Numărul ${tag}`],
    );
    const volunteer = async (name: string, state: "CONFIRMED" | "REGISTERED", number: number | null) => {
      const address = `${name.split(" ")[0].toLowerCase()}-numere-${tag}@test.invalid`;
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, volunteer_number)
         VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', $5, 'STAFF', $6) RETURNING id`,
        [eventId, roles[0].id, name, address, state, number],
      );
      await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [inserted[0].id, roles[0].id]);
      return inserted[0].id;
    };
    const anaName = `Ana Voluntară ${tag}`;
    const evaName = `Eva Nouă ${tag}`;
    const ana = await volunteer(anaName, "CONFIRMED", 1);
    const eva = await volunteer(evaName, "REGISTERED", null);
    return { eventId, participantId: participants[0].id, runner, ana, eva, anaName, evaName };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
    // The volunteers, their roles and the translations go with the event (ON DELETE CASCADE); the trail rows are the test's own.
    // «Confirmă» queues no email (only a reopening tells the person their roles), so nothing is left in the outbox.
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
  });
}

const numberOf = (id: string) => withDatabase(async (client) => (await client.query<{ volunteer_number: number | null }>("SELECT volunteer_number FROM event_volunteers WHERE id = $1", [id])).rows[0].volunteer_number);

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("§1023 the volunteers' V numbers and the raffle's file for random.org", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a volunteer confirmed on «Voluntari» shows «Nr. V002»; «Tombolă» counts the volunteers; «Descarcă pentru random.org» hands out numbers alone", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await signIn(page, "Dev Moderator");
      await page.goto(`/ro/admin/volunteers?eventId=${seeded.eventId}`);
      await hydrated(page);

      // ---- The confirmed volunteer wears V001 beside the name; the one only offered wears nothing yet -----------------------
      const numbers = page.locator('#main [data-testid="volunteer-list-number"]:visible');
      await expect(numbers).toHaveText(["Nr. V001"]);
      await fitsTheScreen(page);

      // ---- «Confirmă» on Eva: nothing to set first — she comes back as V002 ------------------------------------------------
      const confirm = page.locator("#main").getByRole("button", { name: `Confirmă: ${seeded.evaName}` }).locator("visible=true");
      await expect(confirm).toHaveCount(1);
      expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await confirm.click();
      await expect(page.getByText("Voluntar confirmat.").first()).toBeVisible({ timeout: 30_000 });
      await hydrated(page);
      await expect(numbers).toHaveCount(2);
      expect((await numbers.allTextContents()).sort()).toEqual(["Nr. V001", "Nr. V002"]);
      expect(await numberOf(seeded.eva)).toBe(2);
      expect(await numberOf(seeded.ana)).toBe(1);
      await fitsTheScreen(page);

      // ---- «Ziua cursei» → «Tombolă»: the volunteers counted and numbered after the race numbers -----------------------------
      await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
      await hydrated(page);
      await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 3 · Alergători: 1 · Elite: 0 · Voluntari: 2 · Prezenți dintre ei: 0");
      await expect(page.locator('[data-testid="raffle-row-number"]:visible')).toHaveText(["1", "V001", "V002"]);
      await expect(page.locator('[data-testid="raffle-row-name"]:visible')).toHaveText([seeded.runner, seeded.anaName, seeded.evaName]);
      await fitsTheScreen(page);

      // ---- «Descarcă pentru random.org»: a text file, one person per line, the number and the name, no header ------------------
      const button = page.getByTestId("raffle-download-random-org");
      await expect(button).toHaveText(/Descarcă pentru random\.org/);
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.getByTestId("raffle-random-org-help")).toHaveAccessibleName(
        "Un rând pe persoană, cu număr și nume: îl lipești în random.org → List Randomizer și apeși Randomize. Primul rând e câștigătorul.",
      );
      const href = await button.getAttribute("href");
      expect(href).toBe(`/api/admin/events/${seeded.eventId}/raffle?format=random-org&lang=ro`);
      const response = await page.request.get(href as string);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
      expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="tombola-\d{4}-\d{2}-\d{2}-random-org\.txt"/);
      const body = await response.text();
      expect(body).toBe(`1 ${seeded.runner}\r\nV001 ${seeded.anaName}\r\nV002 ${seeded.evaName}\r\n`);
      const lines = body.split("\r\n");
      expect(lines.at(-1)).toBe("");
      expect(lines.slice(0, -1).every((line) => /^V?\d+ \S/.test(line))).toBe(true);
      // And pressed as a person presses it: the browser saves a file of that name holding the same lines, nothing else.
      const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
      expect(download.suggestedFilename()).toMatch(/^tombola-\d{4}-\d{2}-\d{2}-random-org\.txt$/);
      expect(readFileSync(await download.path(), "utf8")).toBe(body);
      // The present-only one beside it: nobody checked in or ticked yet — an empty file, not a blank line.
      const present = await page.request.get((await page.getByTestId("raffle-download-random-org-present").getAttribute("href")) as string);
      expect(present.headers()["content-disposition"]).toMatch(/^attachment; filename="tombola-prezenti-\d{4}-\d{2}-\d{2}-random-org\.txt"/);
      expect(await present.text()).toBe("");

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
