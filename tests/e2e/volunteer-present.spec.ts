import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §983, BR-REQ-050-02, BR-REQ-071-01 — «Prezent» on the «Voluntari» list and «Lista pentru tombolă — doar prezenții» (the owner,
 * 2026-11-18, three days before the race: «La voluntari trebuie să trec prezent/absent ca să pot face tombola doar pentru cei
 * prezenți»), walked as the Organizer at 320 pixels and on a desktop, against the production build.
 *
 * What only a browser can see: the row's tick is a real form a thumb can press (44 pixels), its press comes back to the same
 * list address with the toast and the tick drawn ticked, the strip's «Prezenți» and «Absenți» move with it, the «Absenți» pill
 * filters the list to the person who did not come and marks itself as the filter in force, and the toolbar's present-only file
 * holds exactly the runner the desk checked in and the volunteer just ticked. No horizontal scroll at any width.
 *
 * The race, its role and its people are written straight into the database — the setup, not the subject — one set per project
 * and test, so the two projects never share a row, and removed after. Never a real person: every name and address is made up.
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

type Seeded = { eventId: string; participantId: string; runner: string; ana: string; dan: string };

/** A race a week away that holds a raffle, its volunteers' numbers from 500, one role, a runner the desk checked in wearing number 1, and two confirmed volunteers. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, bib_start_number, volunteer_bib_start, accepts_volunteers, has_raffle)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 10, 'Parcul Tractorul', 1, 500, true, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `prezenta-${tag}`,
      `Crosul prezenței ${tag}`,
      `presence-${tag}`,
      `The presence race ${tag}`,
    ]);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const runner = `Radu Munteanu ${tag}`;
    const email = `radu-prezent-${tag}@test.invalid`;
    const { rows: participants } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, runner],
    );
    // Confirmed, number 1, checked in at the desk this morning.
    await client.query(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
         results_name_consent, results_consent_version, confirmed_at, bib_number, checked_in_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'Radu', $4, 1, now(), false, 1, now(), 1, now())`,
      [eventId, participants[0].id, runner, `Munteanu ${tag}`],
    );
    const volunteer = async (name: string, number: number) => {
      const address = `${name.split(" ")[0].toLowerCase()}-prezent-${tag}@test.invalid`;
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, bib_number)
         VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', 'CONFIRMED', 'STAFF', $5) RETURNING id`,
        [eventId, roles[0].id, name, address, number],
      );
      await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [inserted[0].id, roles[0].id]);
      return inserted[0].id;
    };
    const ana = await volunteer(`Ana Prezentă ${tag}`, 500);
    const dan = await volunteer(`Dan Absent ${tag}`, 501);
    return { eventId, participantId: participants[0].id, runner, ana, dan };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
    // The volunteers, their roles and the translations go with the event (ON DELETE CASCADE); the trail rows are the test's own.
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
  });
}

const presentOf = (id: string) => withDatabase(async (client) => (await client.query<{ present: boolean }>("SELECT present FROM event_volunteers WHERE id = $1", [id])).rows[0].present);

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("§983 «Prezent» on the «Voluntari» list and the raffle among the present", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer ticks a volunteer present, sees «Prezenți: 1», filters «Absenți» and takes the present-only raffle file", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await signIn(page, "Dev Moderator");
      const list = `/ro/admin/volunteers?eventId=${seeded.eventId}`;
      await page.goto(list);
      await hydrated(page);

      // ---- The strip: nobody marked yet — «Prezenți: 0», «Absenți: 2», beside «Cu kit» ---------------------------------------
      const strip = page.getByTestId("volunteers-summary");
      await expect(strip.getByRole("link", { name: "Prezenți: 0" })).toBeVisible();
      await expect(strip.getByRole("link", { name: "Absenți: 2" })).toBeVisible();
      await fitsTheScreen(page);

      // ---- The row's tick: a real checkbox named with the person, a thumb's 44 pixels, empty ---------------------------------
      const anaName = `Ana Prezentă ${tag}`;
      const tick = page.locator(`#main [data-testid="volunteer-present-tick"]:visible`).and(page.getByRole("checkbox", { name: `Prezent: ${anaName}` }));
      await expect(tick).toHaveCount(1);
      await expect(tick).toHaveAttribute("aria-checked", "false");
      expect((await tick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await tick.click();

      // ---- Back at the same list address, the toast, the tick drawn ticked, the strip moved ---------------------------------
      await expect(page.getByText("Bifat: prezent.").first()).toBeVisible({ timeout: 30_000 });
      await hydrated(page);
      expect(new URL(page.url()).searchParams.get("eventId")).toBe(seeded.eventId);
      await expect(page.locator(`#main [data-testid="volunteer-present-tick"]:visible`).and(page.getByRole("checkbox", { name: `Prezent: ${anaName}` }))).toHaveAttribute("aria-checked", "true");
      await expect(strip.getByRole("link", { name: "Prezenți: 1" })).toBeVisible();
      await expect(strip.getByRole("link", { name: "Absenți: 1" })).toBeVisible();
      expect(await presentOf(seeded.ana)).toBe(true);
      expect(await presentOf(seeded.dan)).toBe(false);
      await fitsTheScreen(page);

      // ---- «Absenți»: the list is the one who did not come, the pill the filter in force -----------------------------------
      const absent = strip.getByRole("link", { name: "Absenți: 1" });
      expect((await absent.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await absent.click();
      await expect(page).toHaveURL(/[?&]present=no(&|$)/, { timeout: 30_000 });
      await hydrated(page);
      await expect(strip.getByRole("link", { name: "Absenți: 1" })).toHaveAttribute("aria-current", "page");
      await expect(page.locator(`#main [data-testid="volunteer-present-tick"]:visible`)).toHaveCount(1);
      await expect(page.locator(`#main [data-testid="volunteer-present-tick"]:visible`)).toHaveAccessibleName(`Prezent: Dan Absent ${tag}`);
      await fitsTheScreen(page);

      // ---- The present-only file, from the same screen: the runner the desk checked in and the volunteer ticked, by number ---
      const file = page.getByTestId("volunteers-raffle-present");
      await expect(file).toHaveText(/Lista pentru tombolă — doar prezenții \(CSV\)/);
      expect((await file.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      const href = await file.getAttribute("href");
      expect(href).toBe(`/api/admin/events/${seeded.eventId}/raffle?present=1&lang=ro`);
      const response = await page.request.get(href as string);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="tombola-prezenti-\d{4}-\d{2}-\d{2}\.csv"/);
      const lines = (await response.text()).replace(/^﻿/, "").split("\r\n");
      expect(lines).toEqual(["Număr,Nume,Categorie,Prezent", `1,${seeded.runner},Alergător,Da`, `500,${anaName},Voluntar,Da`, ""]);
      // The whole file beside it keeps everybody, Dan's «Prezent» said «Nu».
      const whole = await page.request.get((await page.getByTestId("volunteers-raffle-list").getAttribute("href")) as string);
      expect((await whole.text()).replace(/^﻿/, "").split("\r\n")).toEqual(["Număr,Nume,Categorie,Prezent", `1,${seeded.runner},Alergător,Da`, `500,${anaName},Voluntar,Da`, `501,Dan Absent ${tag},Voluntar,Nu`, ""]);

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
