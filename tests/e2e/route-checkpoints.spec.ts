import { expect, type Locator, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { fillTimeField, hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §757 (amending §718 and §750), BR-REQ-011-01, BR-REQ-050-02, BR-REQ-038-01 — the route's checkpoints and
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
  await openEditorBox(page, "Participare, înscrieri și regulament");
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

test.describe("§757 the route's checkpoints and the race's time limit", () => {
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
    const legend = when.getByTestId("duration-fieldset").locator(":scope > legend");
    await expect(legend).toContainText("Timp limită");
    await expect(legend.locator("svg")).toHaveCount(1);
    await expect(when.getByTestId("duration-fieldset")).toContainText("Cât au alergătorii de la start până se închide sosirea");
    await page.locator('[name="event.durationHours"]').fill("2");
    await page.locator('[name="event.durationMinutesPart"]').fill("30");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);

    // «Puncte de control»: a named card of «Traseul» (§NNN), opened the way a person does, with three spare rows.
    const card = page.getByTestId("event-checkpoints-card");
    await expect(page.locator("#box-course").getByTestId("event-checkpoints-card")).toHaveCount(1);
    await openEditorBox(page, "Puncte de control");
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
    // What is there, read from its own cell: the point's name «Apă la cabană» says «Apă» too, so the name's cell proves nothing.
    // «Apă» was ticked before the refusal and kept by it; «Mâncare» was ticked after.
    const kindsOf = (row: Locator) => row.locator('td[data-label="Ce găsești aici"]');
    await expect(kindsOf(rows.nth(0)).getByText("Apă", { exact: true })).toBeVisible();
    await expect(kindsOf(rows.nth(0)).getByText("Mâncare", { exact: true })).toBeVisible();
    await expect(rows.nth(0)).toContainText("Ora limită 11:00");
    await expect(kindsOf(rows.nth(1)).getByText("Cronometrare", { exact: true })).toBeVisible();
    await expect(kindsOf(rows.nth(1)).getByText("Apă", { exact: true })).toHaveCount(0);
    await expect(rows.nth(1)).toContainText("Ora limită 12:00");
    const finish = table.getByTestId("checkpoint-finish");
    await expect(finish).toContainText("Sosire");
    await expect(finish).toContainText("se închide la 12:30");

    // The English page says it in English.
    await page.goto(`/en/events/checkpoints-${tag}`);
    await expect(page.getByTestId("event-checkpoints")).toContainText("Water at the hut");
    await expect(page.getByTestId("checkpoint-finish")).toContainText("closes at 12:30");
  });

  /*
    §NNN — every verb of the card, from inside «Traseul» (the owner: «Partea cu „Puncte de control” ar
    trebui să fie băgată în cardul cu traseu (nested)»): the GPX's points previewed, a refusal that keeps
    what was typed, the ticked ones added, a point changed, one removed — each posting the card's own
    form from inside the event's save form, and none of it saving the event.
  */
  test("from inside «Traseul»: the GPX's points previewed and added, a refusal that keeps the boxes, a point changed and one removed", async ({ page }) => {
    const tag = `${test.info().project.name}-gpx-${Date.now().toString(36)}`;
    const race = await seedRace(tag);
    await attachGpx(race.id);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${race.id}`);
    await hydrated(page);

    const card = await openEditorBox(page, "Puncte de control");
    await card.getByTestId("checkpoints-gpx-offer").click();
    await page.waitForURL(/checkpointsGpx=1/);
    await hydrated(page);
    const preview = page.getByTestId("checkpoints-gpx-preview");
    await expect(preview).toBeVisible();
    await expect(page.locator("#event-save-form #box-course #box-checkpoints-gpx")).toHaveCount(1);
    const offered = preview.getByTestId("checkpoints-gpx-row");
    await expect(offered).toHaveCount(2);

    // A ticked point with no English name is refused, said in the card, and what was typed stays.
    await offered.nth(0).getByLabel("Numele (română)").fill("Izvorul Tâmpei");
    await offered.nth(1).getByLabel("Numele (engleză)").fill("The hut");
    await preview.getByRole("button", { name: "Adaugă punctele alese" }).click();
    await expect(preview.getByTestId("form-refusal")).toContainText("are nevoie de un nume în română și în engleză", { timeout: 20_000 });
    await expect(offered.nth(0).getByLabel("Numele (română)")).toHaveValue("Izvorul Tâmpei");
    await expect(offered.nth(1).getByLabel("Numele (engleză)")).toHaveValue("The hut");
    await expect(page.getByTestId("checkpoint-card")).toHaveCount(0);

    // Named in both languages, the two are added.
    await offered.nth(0).getByLabel("Numele (engleză)").fill("The spring");
    await preview.getByRole("button", { name: "Adaugă punctele alese" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Punctele din GPX au fost adăugate.", { timeout: 20_000 });
    await hydrated(page);
    await expect(page.getByTestId("checkpoint-card")).toHaveCount(2);

    // A point changed: its English name, saved by «Salvează punctele» from inside «Traseul».
    await page.goto(`/ro/admin/events/${race.id}`);
    await hydrated(page);
    const again = await openEditorBox(page, "Puncte de control");
    const first = again.getByTestId("checkpoint-card").nth(0);
    await openFold(first);
    await first.getByLabel("Numele (engleză)").fill("The spring above the town");
    await again.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Punctele de control au fost salvate.", { timeout: 20_000 });

    // A point removed: «Scoate acest punct» ticked, then saved.
    await page.goto(`/ro/admin/events/${race.id}`);
    await hydrated(page);
    const third = await openEditorBox(page, "Puncte de control");
    const second = third.getByTestId("checkpoint-card").nth(1);
    await openFold(second);
    await second.getByRole("checkbox", { name: /Scoate acest punct/ }).check();
    await third.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Punctele de control au fost salvate.", { timeout: 20_000 });

    const saved = await withDatabase((client) =>
      client.query<{ name_ro: string; name_en: string }>(`SELECT name_ro, name_en FROM event_checkpoints WHERE event_id = $1 ORDER BY km`, [race.id]),
    );
    expect(saved.rows).toEqual([{ name_ro: "Izvorul Tâmpei", name_en: "The spring above the town" }]);
    // None of it touched the event: the distance is still the one seeded.
    const event = await withDatabase((client) => client.query<{ distance_meters: number }>(`SELECT distance_meters FROM events WHERE id = $1`, [race.id]));
    expect(event.rows[0].distance_meters).toBe(21000);
  });

  /*
    §NNN — with scripts off, the card inside «Traseul» is a plain form of its own: a refused POST
    renders the page with the reason in the card and the typed boxes kept, and nothing is saved.
  */
  test("with scripts off, a refusal from inside «Traseul» comes back with the reason and the typed boxes", async ({ browser }) => {
    const tag = `${test.info().project.name}-nojs-${Date.now().toString(36)}`;
    const race = await seedRace(tag);
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    const page = await context.newPage();
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/events/${race.id}`);
      const card = await openEditorBox(page, "Puncte de control");
      await openEditorBox(page, "Adaugă puncte");
      const spare = card.getByTestId("checkpoint-new-row").first();
      await spare.getByLabel("Kilometrul").fill("30");
      await spare.getByLabel("Numele (română)").fill("Prea departe");
      await spare.getByLabel("Numele (engleză)").fill("Too far");
      await card.getByRole("button", { name: "Salvează punctele" }).click();
      await page.waitForLoadState("load");
      const after = page.getByTestId("event-checkpoints-card");
      await expect(after).toContainText("dar traseul are doar 21 km");
      await expect(after.getByTestId("checkpoint-new-row").first().getByLabel("Kilometrul")).toHaveValue("30");
      await expect(after.getByTestId("checkpoint-new-row").first().getByLabel("Numele (engleză)")).toHaveValue("Too far");
      const saved = await withDatabase((client) => client.query(`SELECT 1 FROM event_checkpoints WHERE event_id = $1`, [race.id]));
      expect(saved.rowCount).toBe(0);
    } finally {
      await context.close();
    }
  });
});

/** The environment's folder in the media store, as the server names it (`<env>/route-gpx/…`). */
function appEnv(): string {
  databaseUrl();
  return process.env.APP_ENV ?? "local";
}

/**
 * A GPX for the seeded race, written where the server's store reads it (`.media/`; on CI's `test`
 * the in-memory store falls back to the disk, `E2E_FAKE_MEDIA_FROM_DISK`): a straight 21 km track
 * east along one parallel, two waypoints on it — a spring near km 7.8 and a hut near km 15.6.
 */
async function attachGpx(eventId: string) {
  const key = `${appEnv()}/route-gpx/${randomUUID()}/traseu.gpx`;
  const track = Array.from({ length: 55 }, (_, step) => `<trkpt lat="45.6" lon="${(25.5 + step * 0.005).toFixed(3)}"><ele>600</ele></trkpt>`).join("");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="45.6" lon="25.6"><name>Izvor</name><sym>Drinking Water</sym></wpt><wpt lat="45.6" lon="25.7"><name>Cabana</name><sym>Lodge</sym></wpt><trk><name>Traseu</name><trkseg>${track}</trkseg></trk></gpx>`;
  const file = path.join(process.cwd(), ".media", key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, gpx);
  await withDatabase((client) =>
    client.query(`UPDATE events SET route_gpx = $2::jsonb WHERE id = $1`, [
      eventId,
      JSON.stringify({ key, name: "traseu.gpx", size: Buffer.byteLength(gpx), uploadedAt: new Date().toISOString() }),
    ]),
  );
}
