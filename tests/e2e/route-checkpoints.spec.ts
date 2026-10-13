import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { fillTimeField, hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §NNN (amending §718 and §750), BR-REQ-011-01, BR-REQ-050-02, BR-REQ-038-01 — the route's checkpoints and
 * the race's time limit (the owner, 2026-10-13: «I need to put checkpoints and limit times»; «trebuie să
 * pot pune timp limită»; «nu pot să văd unde e punctul de alimentare pe acel număr»).
 *
 * An Administrator sets a race's «Timp limită», is refused a checkpoint beyond the route with the reason,
 * adds two checkpoints with their cut-offs through the card's own form, and the bib designer's preview
 * address changes with them; the published page then shows «Timp limită: 2 h 30 min», the table «Puncte
 * de control» with both points and the finish closing at 12:30.
 *
 * The race is written straight into the database — the setup, not the subject — one per project and
 * run, so the two projects never share a row: a 21 km race on 15 May 2027, the meeting at 09:00 and the
 * gun at 10:00 on the club's clock.
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

/** A draft race taking registrations on the site, with its distance typed and its gun an hour after the meeting. */
async function seedRace(tag: string): Promise<{ id: string; slug: string }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, race_starts_at, registration_mode, capacity, location_name, distance_meters, timezone)
       VALUES ('RACE', '2027-05-15T06:00:00Z', '2027-05-15T07:00:00Z', 'INTERNAL', 50, 'Parcul Tractorul', 21000, 'Europe/Bucharest')
       RETURNING id`,
    );
    const slug = `puncte-${tag}`;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă de probă.'), ($1, 'en', $4, $5, 'A trial race.')`,
      [rows[0].id, slug, `Cursa cu puncte ${tag}`, `checkpoints-${tag}`, `The checkpoints race ${tag}`],
    );
    return { id: rows[0].id, slug };
  });
}

async function publish(eventId: string) {
  await withDatabase((client) => client.query(`UPDATE events SET editorial_status = 'PUBLISHED', published_at = now() WHERE id = $1`, [eventId]));
}

/** The bib designer's preview picture, its fold opened the way a person does. */
async function bibPreview(page: Page): Promise<Locator> {
  await openEditorBox(page, "Participare și înscrieri");
  await openEditorBox(page, "Numere de concurs (BIB)");
  await openFold(page.getByTestId("bib-design"));
  return page.getByTestId("bib-design-preview").locator("img");
}

/** One spare row of the card: its boxes, by their own labels inside the row. */
async function fillRow(row: Locator, values: { km: string; ro: string; en: string; kinds: string[]; cutoff: string }) {
  await row.getByLabel("Kilometrul").fill(values.km);
  await row.getByLabel("Numele (română)").fill(values.ro);
  await row.getByLabel("Numele (engleză)").fill(values.en);
  for (const kind of values.kinds) await row.getByRole("checkbox", { name: kind, exact: true }).check();
  await fillTimeField(row, "Ora limită", values.cutoff);
}

test.describe("§NNN the route's checkpoints and the race's time limit", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an Administrator sets the time limit and two checkpoints; the page and the bib's address follow", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const race = await seedRace(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${race.id}`);
    await hydrated(page);

    // The bib's preview before any checkpoint: its address is what changes below.
    const before = (await (await bibPreview(page)).getAttribute("src")) as string;
    expect(before).not.toMatch(/[?&]v=/);

    // «Timp limită» — the duration box's words on a race, with its glyph, and 2 h 30 min typed and saved.
    const when = await openEditorBox(page, "Când și unde");
    const legend = when.getByTestId("duration-fieldset").locator("legend");
    await expect(legend).toContainText("Timp limită");
    await expect(legend.locator("svg")).toHaveCount(1);
    await expect(when.getByTestId("duration-fieldset")).toContainText("Cât au alergătorii de la start până se închide sosirea");
    await page.locator('[name="event.durationHours"]').fill("2");
    await page.locator('[name="event.durationMinutesPart"]').fill("30");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);

    // «Puncte de control»: open by itself while it has none, with three spare rows.
    const card = page.getByTestId("event-checkpoints-card");
    await expect(card.locator("xpath=self::details")).toHaveAttribute("open", "");
    await expect(card).toContainText("Lungimea traseului: 21 km.");
    const spare = card.getByTestId("checkpoint-new-row");
    await expect(spare).toHaveCount(3);

    // A kilometre beyond the route is refused with the reason, and what was typed stays.
    await fillRow(spare.nth(0), { km: "30", ro: "Prea departe", en: "Too far", kinds: ["Apă"], cutoff: "11:00" });
    await card.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(card).toContainText("dar traseul are doar 21 km", { timeout: 20_000 });
    await expect(spare.nth(0).getByLabel("Kilometrul")).toHaveValue("30");

    // Two points: water and food at 7,5 with 11:00, timing at 15 with 12:00.
    await fillRow(spare.nth(0), { km: "7,5", ro: "Apă la cabană", en: "Water at the hut", kinds: [], cutoff: "11:00" });
    await spare.nth(0).getByRole("checkbox", { name: "Mâncare", exact: true }).check();
    await fillRow(spare.nth(1), { km: "15", ro: "Cronometrare", en: "Timing", kinds: ["Cronometrare"], cutoff: "12:00" });
    const save = card.getByRole("button", { name: "Salvează punctele" });
    expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await save.click();
    await expect(page.getByTestId("toast-live")).toContainText("Punctele de control au fost salvate.", { timeout: 20_000 });
    await hydrated(page);
    await expect(page.getByTestId("checkpoint-card")).toHaveCount(2);

    // The bib's preview is drawn from the saved points: a new address.
    const after = (await (await bibPreview(page)).getAttribute("src")) as string;
    expect(after).toMatch(/[?&]v=/);
    expect(after).not.toBe(before);
    const picture = await page.request.get(after);
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/png");

    // The page: «Timp limită», the table with both points and the finish closing at 12:30.
    await publish(race.id);
    await page.goto(`/ro/evenimente/${race.slug}`);
    await expect(page.getByTestId("race-time-limit")).toHaveText("2 h 30 min");
    const table = page.getByTestId("event-checkpoints");
    await expect(table.getByRole("heading", { name: "Puncte de control" })).toBeVisible();
    const rows = table.getByTestId("checkpoint-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("7,5 km");
    await expect(rows.nth(0)).toContainText("Apă la cabană");
    await expect(rows.nth(0)).toContainText("Apă");
    await expect(rows.nth(0)).toContainText("Mâncare");
    await expect(rows.nth(0)).toContainText("Ora limită 11:00");
    await expect(rows.nth(1)).toContainText("Cronometrare");
    await expect(rows.nth(1)).toContainText("Ora limită 12:00");
    const finish = table.getByTestId("checkpoint-finish");
    await expect(finish).toContainText("Sosire");
    await expect(finish).toContainText("se închide la 12:30");

    // The English page says it in English.
    await page.goto(`/en/events/checkpoints-${tag}`);
    await expect(page.getByTestId("event-checkpoints")).toContainText("Water at the hut");
    await expect(page.getByTestId("checkpoint-finish")).toContainText("closes at 12:30");
  });
});
