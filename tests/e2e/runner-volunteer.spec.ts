import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §948, BR-REQ-037-03, BR-REQ-038-01, BR-REQ-060-01 — «Transformă în voluntar» and «Transformă în alergător», and the
 * volunteers' own numbers (the owner, 2026-11-15: «aș vrea să pot să „transform" un alergător în voluntar și invers» and
 * «și voluntarii trebuie să aibă un „Nr de concurs"» — asked which numbers, «Serie proprie»).
 *
 * What only a browser can see, and the unit and PGlite tests cannot: each press is a form in a fold on a long page,
 * posted through the one confirmation dialog — so, as the Administrator: the fold on the registration's page opens, the
 * role is chosen from the event's own, the question names the person's two emails and ends in «… și trimite emailul» or
 * «… fără email» (§976), and the
 * press lands on the volunteer's own page, where the person is «Confirmat» and wears the first number of the volunteers'
 * series; from there the second fold holds the two names filled from the volunteer's one line and the relay tick, its
 * question names the address, and the press lands on the registration's page with the place and the declaration still to
 * sign. The Organizer, who works both pages, is offered neither fold. And «Lista pentru tombolă», a link on the event's
 * registrations list, downloads the one file that holds the runner and the volunteer by their numbers.
 *
 * The race, its role and its people are written straight into the database — the setup, not the subject — one set per
 * project and test, so the two projects never share a row. Never a real person: every name and address is made up.
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

/** A race of ten places a month away, its volunteers' numbers from 500, one role, one confirmed runner wearing number 1 and one volunteer. */
async function seed(tag: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, bib_start_number, volunteer_bib_start)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 10, 'Parcul Tractorul', 1, 500) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `transformare-${tag}`,
      `Crosul transformării ${tag}`,
      `transform-${tag}`,
      `The transform race ${tag}`,
    ]);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const runner = `Radu Munteanu ${tag}`;
    const email = `radu-${tag}@test.invalid`;
    const { rows: people } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, runner],
    );
    const { rows: registered } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
         results_name_consent, results_consent_version, confirmed_at, bib_number)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'Radu', $4, 1, now(), false, 1, now(), 1) RETURNING id`,
      [eventId, people[0].id, runner, `Munteanu ${tag}`],
    );
    // A volunteer of the Organizer's walk and of the raffle list: confirmed, with the role given and a number of the series.
    const other = `voluntar-${tag}@test.invalid`;
    const { rows: volunteers } = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, bib_number)
       VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', 'CONFIRMED', 'STAFF', 510) RETURNING id`,
      [eventId, roles[0].id, `Oana Voluntar ${tag}`, other],
    );
    await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [volunteers[0].id, roles[0].id]);
    return { eventId, registrationId: registered[0].id, runner, email, otherVolunteerId: volunteers[0].id };
  });
}

const volunteersOf = (eventId: string, email: string) =>
  withDatabase(async (client) => (await client.query<{ id: string; state: string; bib: number | null; name: string }>("SELECT id, state, bib_number AS bib, name FROM event_volunteers WHERE event_id = $1 AND email = $2", [eventId, email])).rows);
const registrationsOf = (eventId: string, name: string) =>
  withDatabase(async (client) => (await client.query<{ id: string; status: string; bib: number | null }>("SELECT id, status, bib_number AS bib FROM registrations WHERE event_id = $1 AND registered_name = $2 ORDER BY created_at", [eventId, name])).rows);

const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test.describe("§948 «Transformă în voluntar» and «Transformă în alergător»", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the Administrator turns a runner into a volunteer — asked first, both emails named — and, from the volunteer's page, back into a runner", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, registrationId, runner, email } = await seed(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${registrationId}`);
    await hydrated(page);

    // ---- The fold on the registration's page: closed on arrival, the event's role in its select --------------------
    const fold = page.getByTestId("to-volunteer");
    await expect(fold).not.toHaveAttribute("open", "");
    await openFold(fold);
    await expect(fold).toContainText("Înscrierea se anulează și locul se eliberează");
    await expect(fold.getByTestId("to-volunteer-role")).toHaveValue(/[0-9a-f-]{36}/);
    await expect(fold.getByTestId("to-volunteer-role").locator("option")).toHaveText(["Punct de apă"]);
    await fits(page);
    const press = fold.getByTestId("to-volunteer-submit");
    await expect(press).toHaveText(/Transformă în voluntar/);
    await expect(press.locator("svg")).toHaveCount(1);
    await press.click();

    // ---- It asks first: who, both emails, the freed place, and two answers, one of which keeps the person's two back ---
    const dialog = page.getByRole("dialog", { name: "Transformi alergătorul în voluntar?" });
    await expect(dialog).toContainText(`Pleacă 1 email către ${runner}: „Înscriere anulată”.`);
    await expect(dialog).toContainText("Apoi încă 1 email către aceeași persoană: „Rolul tău de voluntar”.");
    await expect(dialog).toContainText("Locul eliberat se oferă primului de pe lista de așteptare");
    // No box ticked in advance (§976): the email is the answer pressed.
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByTestId("confirm-dialog-confirm")).toHaveText("Transformă în voluntar și trimite emailul");
    await expect(dialog.getByTestId("confirm-dialog-skip-email")).toHaveText("Transformă în voluntar fără email");
    await confirmDialog(page, "Transformi alergătorul în voluntar?");

    // ---- On the volunteer's own page: confirmed, the role given, the first number of the volunteers' series ---------
    await expect(page).toHaveURL(/\/ro\/admin\/volunteers\/[0-9a-f-]{36}\?saved=runnerBecameVolunteer/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Înscrierea a fost anulată, iar persoana e acum voluntar confirmat.", { timeout: 30_000 });
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 2, name: runner })).toBeVisible();
    await expect(page.getByTestId("volunteer-state")).toHaveText(/Confirmat/);
    await expect(page.locator('[data-testid="volunteer-number"]:visible').first()).toHaveText(/Nr\. 500/);
    const [volunteer, ...moreVolunteers] = await volunteersOf(eventId, email);
    expect(moreVolunteers).toEqual([]);
    expect(volunteer).toMatchObject({ state: "CONFIRMED", bib: 500, name: runner });
    // The registration: cancelled, its number kept — retired — never the volunteer's.
    expect(await registrationsOf(eventId, runner)).toEqual([{ id: registrationId, status: "CANCELLED", bib: 1 }]);

    // ---- And back: the fold on the volunteer's page, the two names filled from the one line, the relay tick ---------
    const back = page.getByTestId("to-runner");
    await expect(back).not.toHaveAttribute("open", "");
    await openFold(back);
    await expect(back.locator('[name="firstName"]')).toHaveValue("Radu Munteanu");
    await expect(back.locator('[name="lastName"]')).toHaveValue(tag);
    // The Administrator corrects the split, as the line under the boxes asks.
    await back.locator('[name="firstName"]').fill("Radu");
    await back.locator('[name="lastName"]').fill(`Munteanu ${tag}`);
    await back.getByRole("checkbox", { name: /Confirm că această persoană mi-a cerut să o înscriu/ }).check();
    await fits(page);
    await back.getByTestId("to-runner-submit").click();
    const second = page.getByRole("dialog", { name: "Transformi voluntarul în alergător?" });
    await expect(second).toContainText(email);
    await expect(second).toContainText(`Radu Munteanu ${tag}`);
    await expect(second).toContainText("„Ești pe lista de așteptare”");
    await expect(second).toContainText("„Semnează declarația”");
    await confirmDialog(page, "Transformi voluntarul în alergător?");

    // ---- On the registration's page: a place held, the declaration the person's own to sign --------------------------
    await expect(page).toHaveURL(/\/ro\/admin\/registrations\/[0-9a-f-]{36}\?saved=volunteerBecameRunnerPlaced/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Era un loc liber: persoana l-a primit și are de semnat declarația.", { timeout: 30_000 });
    const standing = (await registrationsOf(eventId, runner)).filter((row) => row.status !== "CANCELLED");
    expect(standing.map((row) => row.status)).toEqual(["PENDING_DECLARATION"]);
    expect(await volunteersOf(eventId, email)).toEqual([{ id: volunteer.id, state: "CANCELLED", bib: 500, name: runner }]);
    await fits(page);
  });

  test("«Lista pentru tombolă» on the event's registrations list downloads the runners and the volunteers by their numbers", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, runner } = await seed(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    const link = page.getByTestId("registrations-raffle-list");
    await expect(link).toHaveText(/Lista pentru tombolă \(CSV\)/);
    await expect(link.locator("svg")).toHaveCount(1);
    const href = await link.getAttribute("href");
    expect(href).toBe(`/api/admin/events/${eventId}/raffle?lang=ro`);
    const response = await page.request.get(href as string);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="tombola-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = (await response.text()).replace(/^\uFEFF/, "").split("\r\n");
    // «Prezent» (§949, §NNN): the runner was not checked in at the desk, and nobody ticked the volunteer «Prezent» on the «Voluntari» list.
    expect(lines).toEqual(["Număr,Nume,Categorie,Prezent", `1,${runner},Alergător,Nu`, `510,Oana Voluntar ${tag},Voluntar,Nu`, ""]);
    await fits(page);
  });

  test("the Organizer reads both pages and is offered neither fold", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { registrationId, otherVolunteerId, runner } = await seed(tag);
    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/registrations/${registrationId}`);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 2, name: runner })).toBeVisible();
    await expect(page.getByTestId("to-volunteer")).toHaveCount(0);
    await page.goto(`/ro/admin/volunteers/${otherVolunteerId}`);
    await hydrated(page);
    await expect(page.getByTestId("volunteer-state")).toHaveText(/Confirmat/);
    await expect(page.getByTestId("to-runner")).toHaveCount(0);
  });
});
