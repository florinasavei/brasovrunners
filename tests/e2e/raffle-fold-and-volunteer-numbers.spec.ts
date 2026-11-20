import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-041-01 — the editor's «Tombolă» fold and why the volunteers are out of the raffle (the owner, 2026-11-20:
 * «vreau să le dau automat numere și voluntarilor, pentru că văd că deși voluntarii sunt bifați aici… cumva sunt excluși de pe lista de
 * la tombolă: plus că aici ar trebui să fie o secțiune colapsată cu „Tombola”»), walked at 320 pixels and on a desktop against the
 * production build, as the Administrator:
 *
 * - the editor's «Numere de concurs (BIB)» holds «Tombolă» closed, its bar saying who takes part and how; opened, «Voluntarii» says
 *   that two confirmed volunteers wear no number, the line following the tick as it is unticked and ticked again; «Elitele» unticked
 *   and saved, the page comes back with the fold open, its bar saying the new answer, and the database holding it;
 * - «Ziua cursei» → «Tombolă» says the same beside «Voluntari: 0», its link opens the «Voluntari» card at «Numerele voluntarilor
 *   încep de la»; «Salvează numerele» there numbers both from the start the club typed, and the line is gone from the tab, which now
 *   counts them.
 *
 * Every tap target a thumb hits is 44 pixels, and no page scrolls sideways. The race and its people are written straight into the
 * database — the setup, not the subject — one set per project and test, and removed after. Never a real person.
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

type Seeded = { eventId: string; participantIds: string[] };

/** A published race a week away holding a raffle «Din oficiu», every group ticked, no volunteers' series: two numbered runners, two confirmed volunteers. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number, accepts_volunteers, has_raffle)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1, true, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `tombola-pliata-${tag}`,
      `Crosul tombolei pliate ${tag}`,
      `folded-raffle-${tag}`,
      `The folded raffle race ${tag}`,
    ]);
    const participantIds: string[] = [];
    for (const [first, bib] of [["Ana", 1], ["Bogdan", 2]] as const) {
      const name = `${first} Alergătoare ${tag}`;
      const email = `${first.toLowerCase()}-pliata-${tag}@test.invalid`;
      const { rows: participants } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      participantIds.push(participants[0].id);
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, privacy_notice_version, privacy_acknowledged_at,
           results_name_consent, results_consent_version, confirmed_at, bib_number)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, now(), $4)`,
        [eventId, participants[0].id, name, bib],
      );
    }
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    for (const first of ["Vlad", "Ioana"]) {
      const address = `${first.toLowerCase()}-pliata-${tag}@test.invalid`;
      const { rows: helpers } = await client.query<{ id: string }>(
        `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source)
         VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', 'CONFIRMED', 'STAFF') RETURNING id`,
        [eventId, roles[0].id, `${first} Voluntar ${tag}`, address],
      );
      await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [helpers[0].id, roles[0].id]);
    }
    return { eventId, participantIds };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    // The volunteers, roles and translations go with the event (ON DELETE CASCADE); the registrations first, then their people.
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [seeded.participantIds]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
  });
}

const raffleRow = (eventId: string) =>
  withDatabase(async (client) => (await client.query<{ elites: boolean; volunteers: boolean; start: number | null }>(`SELECT raffle_elites AS elites, raffle_volunteers AS volunteers, volunteer_bib_start AS start FROM events WHERE id = $1`, [eventId])).rows[0]);
const volunteerNumbers = (eventId: string) =>
  withDatabase(async (client) => (await client.query<{ number: number | null }>(`SELECT bib_number AS number FROM event_volunteers WHERE event_id = $1 ORDER BY bib_number NULLS LAST`, [eventId])).rows.map((row) => row.number));

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

async function tall(locator: Locator, what: string): Promise<void> {
  expect((await locator.boundingBox())?.height ?? 0, `${what} is a thumb's 44 pixels`).toBeGreaterThanOrEqual(44);
}

test.describe("§NNN «Tombolă» in the editor, and why the volunteers are out of the raffle", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the fold opens, a group unticked is saved and comes back open; the volunteers' line leads to their numbers and goes once they have them", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const editor = `/ro/admin/events/${seeded.eventId}`;
    try {
      await signIn(page, "Dev Administrator");

      await test.step("the editor's «Numere de concurs (BIB)» holds «Tombolă» closed, its bar saying who and how", async () => {
        await page.goto(editor);
        await hydrated(page);
        const fold = page.locator("#box-raffle");
        await expect(fold).toBeAttached();
        await expect(fold).not.toHaveAttribute("open", "");
        await expect(fold.locator(":scope > summary")).toContainText("Tombolă");
        await expect(fold.locator(":scope > summary")).toContainText("Alergători, elite, voluntari · din oficiu");
        // Inside the race numbers' card, as a person finds it.
        await expect(page.locator("#box-bibs #box-raffle")).toHaveCount(1);
        await openEditorBox(page, "Tombolă");
        await expect(fold).toHaveAttribute("open", "");
        await tall(fold.locator(":scope > summary"), "«Tombolă»'s bar");
        await expect(fold.getByRole("checkbox", { name: "Avem tombolă", exact: true })).toBeChecked();
        await fitsTheScreen(page);
      });

      const fold = page.locator("#box-raffle");
      const line = fold.getByTestId("raffle-volunteers-without-number");

      await test.step("under «Voluntarii», why the volunteers are out — following the tick as it is unticked and ticked again", async () => {
        await expect(line).toBeVisible();
        await expect(line).toContainText("2 voluntari confirmați nu au număr, deci nu intră la tombolă.");
        await expect(line.getByRole("link", { name: "Mergi la numerele voluntarilor" })).toHaveAttribute("href", "#box-volunteer-numbers");
        await tall(line.getByRole("link", { name: "Mergi la numerele voluntarilor" }), "the line's link");
        const volunteers = fold.getByRole("checkbox", { name: "Voluntarii", exact: true });
        await volunteers.uncheck();
        await expect(line).toBeHidden();
        await volunteers.check();
        await expect(line).toBeVisible();
        await fitsTheScreen(page);
      });

      await test.step("«Elitele» unticked and saved: the page comes back with «Tombolă» open, saying the new answer", async () => {
        await fold.getByRole("checkbox", { name: "Elitele", exact: true }).uncheck();
        // Live (published): saving a change asks for the acknowledgement first.
        await page.getByRole("checkbox", { name: "Am înțeles că modific conținut publicat." }).check();
        await page.getByRole("button", { name: "Salvează", exact: true }).click();
        await page.waitForURL(/[?&]saved=event&.*raffle=1|[?&]raffle=1&.*saved=event/, { timeout: 30_000 });
        await hydrated(page);
        expect(await raffleRow(seeded.eventId)).toEqual({ elites: false, volunteers: true, start: null });
        for (const id of ["#box-registration", "#box-bibs", "#box-raffle"]) await expect(page.locator(id), id).toHaveAttribute("open", "");
        await expect(page.locator("#box-raffle > summary")).toContainText("Alergători, voluntari · din oficiu");
        await expect(page.locator("#box-raffle").getByRole("checkbox", { name: "Elitele", exact: true })).not.toBeChecked();
        // The volunteers are still out: the line is still there, in sight.
        await expect(page.locator("#box-raffle").getByTestId("raffle-volunteers-without-number")).toBeVisible();
        await fitsTheScreen(page);
      });

      await test.step("«Ziua cursei» → «Tombolă» says it beside «Voluntari: 0», and its link opens the volunteers' numbers", async () => {
        await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
        await hydrated(page);
        await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 2 · Alergători: 2 · Voluntari: 0 · Prezenți dintre ei: 0");
        const hint = page.getByTestId("raffle-volunteers-without-number");
        await expect(hint).toBeVisible();
        await expect(hint).toContainText("2 voluntari confirmați nu au număr, deci nu intră la tombolă. Setează „Numerele voluntarilor încep de la” în cardul «Voluntari»: fiecare confirmat primește pe loc un număr.");
        const go = hint.getByRole("link", { name: "Mergi la numerele voluntarilor" });
        await tall(go, "the tab's link");
        await fitsTheScreen(page);
        await go.click();
        await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${seeded.eventId}#box-volunteer-numbers$`), { timeout: 30_000 });
        await hydrated(page);
        // The card opens around its numbers form on arrival.
        await expect(page.locator("#box-volunteers")).toHaveAttribute("open", "");
        await expect(page.getByTestId("volunteer-numbers-start")).toBeVisible();
      });

      await test.step("«Salvează numerele» numbers both from the club's start; the tab's line is gone and it counts them", async () => {
        await page.getByTestId("volunteer-numbers-start").fill("500");
        const save = page.getByTestId("volunteer-numbers-form").getByRole("button", { name: "Salvează numerele" });
        await save.click();
        await expect(page).toHaveURL(/#box-volunteers$/, { timeout: 30_000 });
        await hydrated(page);
        expect(await volunteerNumbers(seeded.eventId)).toEqual([500, 501]);
        expect((await raffleRow(seeded.eventId)).start).toBe(500);
        await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
        await hydrated(page);
        await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 4 · Alergători: 2 · Voluntari: 2 · Prezenți dintre ei: 0");
        await expect(page.getByTestId("raffle-volunteers-without-number")).toHaveCount(0);
        await fitsTheScreen(page);
        // And the editor's line under «Voluntarii» is gone too.
        await page.goto(editor);
        await hydrated(page);
        await expect(page.locator("#box-raffle").getByTestId("raffle-volunteers-without-number")).toHaveCount(0);
      });

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
