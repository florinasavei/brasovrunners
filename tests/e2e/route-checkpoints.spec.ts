import { expect, type Locator, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { elevationGpx } from "../helpers/elevation-gpx";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §757 (amending §718 and §750), §770, BR-REQ-011-01, BR-REQ-050-02, BR-REQ-038-01 — the route's checkpoints
 * and the race's time limit (the owner, 2026-10-13: «I need to put checkpoints and limit times»; «trebuie
 * să pot pune timp limită»; «nu pot să văd unde e punctul de alimentare pe acel număr»; 2026-10-14: «aici
 * aș vrea să am și un tip de punct de tipul „direcționare”», «în loc de ora limită, trebuie să punem „timp
 * limită” ca să fie dinamic»).
 *
 * An Administrator sets a race's «Timp limită», is refused a checkpoint beyond the route with the reason
 * and one with a time limit longer than the race's, adds two checkpoints — one ticked «Direcționare» —
 * with their time limits typed as hours and minutes through the card's own form, and the bib designer's
 * preview address changes with them; the published page then shows «Timp limită: 2 h 30 min», the table
 * «Puncte de control» with both points, each with its limit and the clock it closes at («Timp limită: 1 h ·
 * se închide la 11:00»), and the finish closing at 12:30.
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
async function fillRow(row: Locator, values: { km: string; ro: string; en: string; kinds: string[]; hours: string; minutes: string }) {
  await row.getByLabel("Kilometrul").fill(values.km);
  await row.getByLabel("Numele (română)").fill(values.ro);
  await row.getByLabel("Numele (engleză)").fill(values.en);
  for (const kind of values.kinds) await row.getByRole("checkbox", { name: kind, exact: true }).check();
  // «Timp limită»: the race's own two boxes, «Ore» and «Minute» (§770).
  await row.getByLabel("Ore", { exact: true }).fill(values.hours);
  await row.getByLabel("Minute", { exact: true }).fill(values.minutes);
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

    // «Puncte de control»: a named card of «Traseul» (§763), opened the way a person does, with three spare rows.
    const card = page.getByTestId("event-checkpoints-card");
    await expect(page.locator("#box-course").getByTestId("event-checkpoints-card")).toHaveCount(1);
    await openEditorBox(page, "Puncte de control");
    await expect(card.locator("xpath=self::details")).toHaveAttribute("open", "");
    await expect(card).toContainText("Lungimea traseului: 21 km.");
    const spare = card.getByTestId("checkpoint-new-row");
    await expect(spare).toHaveCount(3);

    // A kilometre beyond the route is refused with the reason, and what was typed stays.
    await fillRow(spare.nth(0), { km: "30", ro: "Prea departe", en: "Too far", kinds: ["Apă"], hours: "1", minutes: "0" });
    await card.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(card).toContainText("dar traseul are doar 21 km", { timeout: 20_000 });
    await expect(spare.nth(0).getByLabel("Kilometrul")).toHaveValue("30");

    // A time limit longer than the race's own «Timp limită» (2 h 30 min) is refused with both durations, and what was typed stays.
    await fillRow(spare.nth(0), { km: "7,5", ro: "Prea lung", en: "Too long", kinds: ["Apă"], hours: "3", minutes: "15" });
    await card.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(card).toContainText("3 h 15 min", { timeout: 20_000 });
    await expect(card).toContainText("e mai lung decât 2 h 30 min");
    await expect(spare.nth(0).getByLabel("Ore", { exact: true })).toHaveValue("3");
    await expect(spare.nth(0).getByLabel("Minute", { exact: true })).toHaveValue("15");
    await expect(page.getByTestId("checkpoint-card")).toHaveCount(0);

    // Two points: water and food at 7,5 with one hour, timing and direction at 15 with two.
    await fillRow(spare.nth(0), { km: "7,5", ro: "Apă la cabană", en: "Water at the hut", kinds: [], hours: "1", minutes: "0" });
    await spare.nth(0).getByRole("checkbox", { name: "Mâncare", exact: true }).check();
    await fillRow(spare.nth(1), { km: "15", ro: "Cronometrare", en: "Timing", kinds: ["Cronometrare", "Direcționare"], hours: "2", minutes: "0" });
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
    // The limit and the clock it closes at: the gun is at 10:00, so one hour is 11:00 and two hours 12:00.
    await expect(rows.nth(0).getByTestId("checkpoint-cutoff")).toHaveText("Timp limită: 1 h · se închide la 11:00");
    await expect(kindsOf(rows.nth(1)).getByText("Cronometrare", { exact: true })).toBeVisible();
    await expect(kindsOf(rows.nth(1)).getByText("Direcționare", { exact: true })).toBeVisible();
    await expect(kindsOf(rows.nth(1)).getByText("Apă", { exact: true })).toHaveCount(0);
    await expect(rows.nth(1).getByTestId("checkpoint-cutoff")).toHaveText("Timp limită: 2 h · se închide la 12:00");
    await expect(kindsOf(rows.nth(0)).getByText("Direcționare", { exact: true })).toHaveCount(0);
    const finish = table.getByTestId("checkpoint-finish");
    await expect(finish).toContainText("Sosire");
    await expect(finish).toContainText("Timp limită: 2 h 30 min · se închide la 12:30");

    // The English page says it in English.
    await page.goto(`/en/events/checkpoints-${tag}`);
    await expect(page.getByTestId("event-checkpoints")).toContainText("Water at the hut");
    await expect(page.getByTestId("event-checkpoints")).toContainText("Direction");
    await expect(page.getByTestId("checkpoint-finish")).toContainText("Time limit: 2 h 30 min · closes at 12:30");

    // The saved points on the editor's closed lines say the limit and the clock it closes at.
    await page.goto(`/ro/admin/events/${race.id}`);
    await hydrated(page);
    const cardAgain = await openEditorBox(page, "Puncte de control");
    await expect(cardAgain).toContainText("timp limită 1 h · se închide la 11:00");
    await expect(cardAgain).toContainText("timp limită 2 h · se închide la 12:00");
    // The two boxes come back as they were saved: one hour and no minutes (the editor's own «0» for none).
    const firstCard = cardAgain.getByTestId("checkpoint-card").nth(0);
    await openFold(firstCard);
    await expect(firstCard.getByLabel("Ore", { exact: true })).toHaveValue("1");
    await expect(firstCard.getByLabel("Minute", { exact: true })).toHaveValue("0");
  });

  /*
    §763 — every verb of the card, from inside «Traseul» (the owner: «Partea cu „Puncte de control” ar
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
    §763 — with scripts off, the card inside «Traseul» is a plain form of its own: a refused POST
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
      // The same for the time limits, with the refusal only the server makes (the browser holds the boxes' own bounds,
      // so «60 minute» never leaves the page): a nearer point with a longer limit than a farther one. Both boxes of both
      // rows come back as typed (§770).
      await openEditorBox(page, "Puncte de control");
      await openEditorBox(page, "Adaugă puncte");
      const rows = after.getByTestId("checkpoint-new-row");
      await fillRow(rows.nth(0), { km: "5", ro: "Prima", en: "First", kinds: [], hours: "2", minutes: "0" });
      await fillRow(rows.nth(1), { km: "9", ro: "A doua", en: "Second", kinds: [], hours: "1", minutes: "15" });
      await after.getByRole("button", { name: "Salvează punctele" }).click();
      await page.waitForURL(/./);
      const again = page.getByTestId("event-checkpoints-card");
      await expect(again).toContainText("e mai lung decât cel al punctului", { timeout: 20_000 });
      const typed = again.getByTestId("checkpoint-new-row");
      await expect(typed.nth(0).getByLabel("Ore", { exact: true })).toHaveValue("2");
      await expect(typed.nth(1).getByLabel("Ore", { exact: true })).toHaveValue("1");
      await expect(typed.nth(1).getByLabel("Minute", { exact: true })).toHaveValue("15");
      const saved = await withDatabase((client) => client.query(`SELECT 1 FROM event_checkpoints WHERE event_id = $1`, [race.id]));
      expect(saved.rowCount).toBe(0);
    } finally {
      await context.close();
    }
  });
});

/*
  §NNN (amending §718, §741, §757; the owner, 2026-10-16: «I would like to have a widget actually! And read it from the
  GPX» — «select which ones to show on the elevation profile»): the route's elevation profile on the event page, above
  the table «Puncte de control», with the pins of the checkpoints the club left ticked and the pointer's readout, and
  the same chart as a preview in the editor's card with the tick on each point. A race of 9 km with the sample GPX's
  altitudes and four checkpoints: water at 3.8 km, food at 4.5, water at 6.2, and a first-aid point at 7.5 that is
  unticked — in the table, not on the chart.
*/
const POINTS = [
  { km: 3.8, ro: "Punct izvor", en: "Spring point", kinds: "WATER", onProfile: true },
  { km: 4.5, ro: "Punct cabană", en: "Hut point", kinds: "FOOD", onProfile: true },
  { km: 6.2, ro: "Punct vârf", en: "Summit point", kinds: "WATER", onProfile: true },
  { km: 7.5, ro: "Punct ascuns", en: "Hidden point", kinds: "FIRST_AID", onProfile: false },
] as const;

/** A 9 km race with the sample GPX attached and the four checkpoints above, published. */
async function seedProfileRace(tag: string): Promise<{ id: string; slug: string }> {
  const race = await seedRace(tag);
  const key = `${appEnv()}/route-gpx/${randomUUID()}/profil.gpx`;
  const gpx = elevationGpx();
  const file = path.join(process.cwd(), ".media", key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, gpx);
  await withDatabase(async (client) => {
    await client.query(`UPDATE events SET distance_meters = 9000, route_gpx = $2::jsonb WHERE id = $1`, [
      race.id,
      JSON.stringify({ key, name: "profil.gpx", size: Buffer.byteLength(gpx), uploadedAt: new Date().toISOString() }),
    ]);
    for (const [position, point] of POINTS.entries()) {
      await client.query(
        `INSERT INTO event_checkpoints (event_id, position, name_ro, name_en, km, kinds, on_profile) VALUES ($1, $2, $3, $4, $5, ARRAY[$6]::event_checkpoint_kind[], $7)`,
        [race.id, position, point.ro, point.en, point.km, point.kinds, point.onProfile],
      );
    }
  });
  await publish(race.id);
  return race;
}

test.describe("§NNN the route's elevation profile", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the page draws the chart above the table, with a pin for each ticked point and the unticked one only in the table; the pointer reads the route", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const race = await seedProfileRace(`${project}-${Date.now().toString(36)}-profile`);
    await page.goto(`/ro/evenimente/${race.slug}`);
    await hydrated(page);

    // One chart is on screen: the narrow one on a phone, the wide one on a desktop.
    const section = page.getByTestId("route-elevation");
    await expect(section).toBeVisible();
    const chart = section.locator('[data-testid="elevation-chart"]:visible');
    await expect(chart).toHaveCount(1);
    await expect(chart).toHaveAttribute("data-size", project === "mobile" ? "narrow" : "wide");
    await expect(chart).toHaveAttribute("aria-label", /^Profilul traseului: 9,0 km, de la \d+ la \d+ m$/);

    // The pins: the three ticked points, a glyph each; the first-aid point the club unticked is not on the chart.
    const pins = chart.getByTestId("elevation-pin");
    await expect(pins).toHaveCount(3);
    await expect(pins.nth(0)).toHaveAttribute("data-glyph", "water");
    await expect(pins.nth(1)).toHaveAttribute("data-glyph", "food");
    await expect(pins.nth(2)).toHaveAttribute("data-glyph", "water");
    await expect(section).not.toContainText("Punct ascuns");
    await expect(chart.locator("text", { hasText: "Alt" })).toHaveCount(1);
    await expect(chart.locator("text", { hasText: /^km$/ })).toHaveCount(1);

    // The table lists every point, the unticked one too, and comes after the chart.
    const rows = page.getByTestId("checkpoint-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(3)).toContainText("Punct ascuns");
    const chartBox = (await section.boundingBox())!;
    const tableBox = (await page.getByTestId("event-checkpoints").boundingBox())!;
    expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(tableBox.y + 1);

    // Nothing sticks out of the screen, and the labels are 11 px or more as drawn.
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
    expect(widths.page).toBeLessThanOrEqual(widths.window);
    const smallest = await chart.evaluate((svg) => {
      const scale = svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width;
      return Math.min(...[...svg.querySelectorAll("text")].map((text) => parseFloat(getComputedStyle(text).fontSize) * scale));
    });
    expect(smallest).toBeGreaterThanOrEqual(10.9);

    // The pointer: nothing before the first event, then the kilometre and the altitude, and the point's name where there is one.
    const readout = page.getByTestId("elevation-pointer-readout");
    await expect(readout).toHaveCount(0);
    // On screen first: a box is measured where the page is scrolled to, and a pointer lands where the screen is.
    await section.scrollIntoViewIfNeeded();
    const shown = (await section.boundingBox())!;
    const hut = (await pins.nth(1).locator("circle").first().boundingBox())!;
    const at = { x: hut.x + hut.width / 2, y: hut.y + hut.height / 2 };
    if (project === "mobile") await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.move(at.x, at.y);
    await expect(readout).toBeVisible();
    await expect(readout).toHaveText(/^4,[45] km · \d+ m · Punct cabană$/);
    await expect(page.getByTestId("elevation-pointer-line")).toBeVisible();
    // The readout that names a point stays on the screen — whole, never widening the page — at every named pin, on a 320 px phone too.
    const readoutInside = async () => {
      const box = (await readout.boundingBox())!;
      const screen = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(screen.width + 0.5);
      expect(screen.scroll).toBeLessThanOrEqual(screen.width);
    };
    await readoutInside();
    for (const index of [0, 2]) {
      const pin = (await pins.nth(index).locator("circle").first().boundingBox())!;
      const pinAt = { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 };
      if (project === "mobile") await page.touchscreen.tap(pinAt.x, pinAt.y);
      else await page.mouse.move(pinAt.x, pinAt.y);
      await expect(readout).toHaveText(index === 0 ? /^3,[78] km · \d+ m · Punct izvor$/ : /^6,[12] km · \d+ m · Punct vârf$/);
      await readoutInside();
    }
    // Back on the hut for the shot below.
    if (project === "mobile") await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.move(at.x, at.y);
    await expect(readout).toHaveText(/^4,[45] km · \d+ m · Punct cabană$/);
    await readoutInside();
    // Between two points, no name: the readout says the kilometre and the altitude only.
    const far = shown.x + shown.width * 0.25;
    if (project === "mobile") await page.touchscreen.tap(far, at.y);
    else await page.mouse.move(far, at.y);
    await expect(readout).toHaveText(/^\d,\d km · \d+ m$/);
    await page.screenshot({ path: `test-results/l46-pointer-${project}.png`, clip: { x: 0, y: Math.max(0, shown.y - 8), width: page.viewportSize()!.width, height: shown.height + 16 } });
    // A mouse leaving takes the line away; a finger lifting leaves it.
    if (project !== "mobile") {
      await page.mouse.move(2, 2);
      await expect(readout).toHaveCount(0);
    }

    // The keys: the chart is a tab stop; home, end and the arrows read the kilometre and the altitude, said politely for a screen reader.
    const pointer = page.getByTestId("elevation-pointer");
    await pointer.focus();
    await page.keyboard.press("Home");
    await expect(readout).toHaveText(/^0,0 km · \d+ m$/);
    await expect(pointer.getByRole("status")).toHaveText(/^0,0 km · \d+ m$/);
    await page.keyboard.press("End");
    await expect(readout).toHaveText(/^9,0 km · \d+ m$/);
    await expect(pointer.getByRole("status")).toHaveText(/^9,0 km · \d+ m$/);
    await page.keyboard.press("ArrowLeft");
    await expect(readout).toHaveText(/^8,9 km · \d+ m$/);
    await readoutInside();

    // The route section, chart and table, as a visitor sees them.
    // The picture is of the section, not of the bars that float over the page: hidden for the shot only.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        const position = getComputedStyle(element).position;
        if (position === "fixed" || position === "sticky") element.style.visibility = "hidden";
      }
    });
    const scrolled = await page.evaluate(() => window.scrollY);
    const chartNow = (await section.boundingBox())!;
    const tableNow = (await page.getByTestId("event-checkpoints").boundingBox())!;
    await page.screenshot({
      path: `test-results/l46-page-${project}.png`,
      fullPage: true,
      clip: { x: 0, y: scrolled + chartNow.y - 56, width: page.viewportSize()!.width, height: tableNow.y + tableNow.height - chartNow.y + 64 },
    });

    // The English page: the English words and the English names.
    await page.goto(`/en/events/checkpoints-${race.slug.replace(/^puncte-/, "")}`);
    const english = page.getByTestId("route-elevation").locator('[data-testid="elevation-chart"]:visible');
    await expect(english).toHaveAttribute("aria-label", /^Route profile: 9\.0 km, from \d+ to \d+ m$/);
    await expect(english.getByTestId("elevation-pin")).toHaveCount(3);
    await expect(english.getByTestId("elevation-pin").nth(1).locator("title")).toHaveText("Hut point");
  });

  test("with scripts off the static chart stands", async ({ browser }) => {
    const race = await seedProfileRace(`${test.info().project.name}-${Date.now().toString(36)}-nojs`);
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    const page = await context.newPage();
    try {
      await page.goto(`/ro/evenimente/${race.slug}`);
      const chart = page.getByTestId("route-elevation").locator('[data-testid="elevation-chart"]:visible');
      await expect(chart).toHaveCount(1);
      await expect(chart.getByTestId("elevation-pin")).toHaveCount(3);
    } finally {
      await context.close();
    }
  });

  test("the editor's card previews it, ticks each point, and a saved tick takes the pin off the page", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const race = await seedProfileRace(`${project}-${Date.now().toString(36)}-editor`);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${race.id}`);
    await hydrated(page);
    const card = await openEditorBox(page, "Puncte de control");

    // «Așa apare pe pagină»: the compact chart, three pins, above the rows, with the sentence that it follows a save.
    const preview = card.getByTestId("checkpoints-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Așa apare pe pagină");
    await expect(preview).toContainText("Se schimbă după „Salvează punctele”, nu în timp ce scrii.");
    const chart = preview.getByTestId("elevation-chart");
    await expect(chart).toHaveCount(1);
    await expect(preview.getByTestId("elevation-pin")).toHaveCount(3);
    // The preview's labels are 11 px or more as drawn in the editor's card — on a 320 px phone the card leaves the chart about 204 px.
    const previewSmallest = await chart.evaluate((svg) => {
      const scale = svg.getBoundingClientRect().width / (svg as SVGSVGElement).viewBox.baseVal.width;
      return Math.min(...[...svg.querySelectorAll("text")].map((text) => parseFloat(getComputedStyle(text).fontSize) * scale));
    });
    expect(previewSmallest).toBeGreaterThanOrEqual(10.9);

    // The tick on each point: on for a new row, off for the point the club left off.
    // (Counted by the boxes' own names: the saved points and the spare rows sit in folds that are closed.)
    await expect(card.locator('input[name$=".onProfile"]')).toHaveCount(4 + 3);
    await expect(card.locator('input[name="cp[4].onProfile"]')).toBeChecked();
    await expect(card.locator('input[name="cp[3].onProfile"]')).not.toBeChecked();
    await openFold(card.getByTestId("checkpoint-card").nth(3));
    await expect(card.getByTestId("checkpoint-card").nth(3).getByRole("checkbox", { name: "Arată pe profilul traseului" })).not.toBeChecked();
    await card.screenshot({ path: `test-results/l46-editor-${project}.png` });

    // Untick the hut and save: the preview refreshes with the save, and the page loses the pin but keeps the row.
    const hut = card.getByTestId("checkpoint-card").nth(1);
    await openFold(hut);
    await hut.getByRole("checkbox", { name: "Arată pe profilul traseului" }).uncheck();
    await card.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Punctele de control au fost salvate.", { timeout: 20_000 });
    await hydrated(page);
    await expect(page.getByTestId("checkpoints-preview").getByTestId("elevation-pin")).toHaveCount(2);
    const stored = await withDatabase((client) => client.query<{ name_ro: string; on_profile: boolean }>(`SELECT name_ro, on_profile FROM event_checkpoints WHERE event_id = $1 ORDER BY km`, [race.id]));
    expect(stored.rows.map((row) => [row.name_ro, row.on_profile])).toEqual([
      ["Punct izvor", true],
      ["Punct cabană", false],
      ["Punct vârf", true],
      ["Punct ascuns", false],
    ]);

    await expect(async () => {
      await page.goto(`/ro/evenimente/${race.slug}`);
      await expect(page.getByTestId("route-elevation").locator('[data-testid="elevation-chart"]:visible').getByTestId("elevation-pin")).toHaveCount(2);
    }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId("checkpoint-row")).toHaveCount(4);
    await expect(page.getByTestId("event-checkpoints")).toContainText("Punct cabană");
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
