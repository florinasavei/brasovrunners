import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §999 — «Clasament»'s «Timp» and «Timp cip», picked or typed (BR-REQ-050-02, BR-REQ-041-01 criterion 6), at 320 pixels and on a
 * desk: the 44-pixel clock beside every time box opens the page's one picker — loaded on that first press, a dialog on the phone and a
 * popover beside the button with a mouse — at 0:00:00 or at the box's own time in whole seconds; «OK» writes `h:mm:ss` through the
 * box's own events, «Anulează» writes nothing; digits alone become a time on leaving the box and on Enter; the one save ranks what
 * was picked and typed. The layout holds: no line past its card, no box under its button, the desktop's columns under their header.
 * And in an English-speaking browser the clock is on 24 hours, with no AM or PM.
 *
 * The race and its three registered runners are written straight into the database — the setup, not the subject — one per project and run.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** A race two days ago with three registered runners holding the numbers 101 to 103. */
async function seedRace(tag: string): Promise<string> {
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
      [eventId, `ceas-${tag}`, `Cursa cu ceas ${tag}`, `clock-${tag}`, `The clock race ${tag}`],
    );
    for (const runner of [
      { bib: 101, name: `Ana Popescu ${tag}`, sex: "FEMALE", birth: "1996-01-01" },
      { bib: 102, name: `Bia Marin ${tag}`, sex: "FEMALE", birth: "1980-01-01" },
      { bib: 103, name: `Dan Ionescu ${tag}`, sex: "MALE", birth: "1990-01-01" },
    ]) {
      const email = `clock-${runner.bib}-${tag}@test.invalid`;
      const { rows: person } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, runner.name],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
           email_confirmed_at, confirmed_at, bib_number, sex, birth_date, list_opt_out)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
           now() - interval '5 days', now() - interval '5 days', $4, $5, $6, false)`,
        [eventId, person[0].id, runner.name, runner.bib, runner.sex, runner.birth],
      );
    }
    return eventId;
  } finally {
    await client.end();
  }
}

const lineOf = (page: Page, bib: number) => page.locator(`[data-testid="result-line"][data-bib="${bib}"]`);
const timeBox = (page: Page, bib: number) => page.locator(`[name="r[${bib}].time"]`);
const chipBox = (page: Page, bib: number) => page.locator(`[name="r[${bib}].chip"]`);
const placeOf = (page: Page, bib: number) => lineOf(page, bib).getByTestId("result-place");

/** The picker's three columns: hours, minutes, seconds. */
const column = (picker: Locator, index: number) => picker.getByRole("listbox").nth(index);

/** Picks a time on the open clock, a column at a time, by the labels a person reads. */
async function pickOnTheClock(picker: Locator, hours: string, minutes: string, seconds: string) {
  for (const [index, label] of [hours, minutes, seconds].entries()) {
    await column(picker, index).getByRole("option").filter({ hasText: new RegExp(`^${label}$`) }).click();
    await expect(column(picker, index).locator('[aria-selected="true"]')).toHaveText(label);
  }
}

async function expectOpenAt(picker: Locator, hours: string, minutes: string, seconds: string) {
  await expect(picker.getByRole("listbox")).toHaveCount(3);
  for (const [index, label] of [hours, minutes, seconds].entries()) await expect(column(picker, index).locator('[aria-selected="true"]')).toHaveText(label);
}

/** No horizontal scroll, every line inside its card, every time box beside — never under — its 44-pixel button. */
async function layoutHolds(page: Page) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) found.push("the page scrolls sideways");
    for (const line of document.querySelectorAll<HTMLElement>('[data-testid="result-line"], [data-testid="typed-line"]')) {
      const box = line.getBoundingClientRect();
      if (box.width === 0) continue; // a closed fold's line
      const card = line.closest("ul")?.getBoundingClientRect();
      const name = line.getAttribute("data-bib") ?? line.getAttribute("aria-label") ?? "?";
      if (card && (box.right > card.right + 1 || box.left < card.left - 1)) found.push(`line ${name} runs past its card`);
      for (const cell of line.querySelectorAll<HTMLElement>(".result-time-cell")) {
        const input = cell.querySelector("input")?.getBoundingClientRect();
        const button = cell.querySelector("button")?.getBoundingClientRect();
        if (!input || !button) {
          found.push(`line ${name}: a time box without its button`);
          continue;
        }
        if (input.right > button.left + 0.5) found.push(`line ${name}: the box runs under its button`);
        if (button.right > box.right + 1) found.push(`line ${name}: the button runs past the line`);
        if (button.width < 43.5 || button.height < 43.5) found.push(`line ${name}: a button of ${button.width}×${button.height}`);
        if (input.width < 56) found.push(`line ${name}: a box of ${input.width} pixels`);
        if (input.height < 43.5) found.push(`line ${name}: a box ${input.height} pixels tall`);
      }
    }
    return found;
  });
  expect(problems).toEqual([]);
}

test.describe("§999 «Timp» and «Timp cip», picked or typed", () => {
  test.describe.configure({ timeout: 240_000 });

  test("picks a time with the page's one clock, cancels, takes tenths as whole seconds, reads digits on leaving the box and on Enter, and ranks the lot", async ({ page }, testInfo) => {
    const phone = testInfo.project.name === "mobile";
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}/results`);
    await hydrated(page);
    await expect(lineOf(page, 101)).toBeVisible();

    // ---- Beside each time box, a 44-pixel clock named with whose time it is — typed lines too ---------------------------------
    const pick101 = lineOf(page, 101).getByRole("button", { name: `Alege timpul: #101 Ana Popescu ${tag}`, exact: true });
    const chipPick101 = lineOf(page, 101).getByRole("button", { name: `Alege timpul cip: #101 Ana Popescu ${tag}`, exact: true });
    await expect(pick101).toBeVisible();
    await expect(chipPick101).toBeVisible();
    await expect(timeBox(page, 101)).toHaveAttribute("inputmode", "decimal");
    await expect(chipBox(page, 101)).toHaveAttribute("inputmode", "decimal");
    await page.getByTestId("results-typed").locator("summary").click();
    await expect(page.getByTestId("typed-line").first().getByRole("button", { name: "Alege timpul: Alergător neînscris 1", exact: true })).toBeVisible();
    await layoutHolds(page);
    if (!phone) {
      // On a desktop the columns keep their header: «Timp» over the time cells, «Timp cip» over the chip cells.
      const header = page.getByTestId("results-header");
      await expect(header).toBeVisible();
      const [timeHead, chipHead] = await Promise.all([header.locator(":scope > *").nth(2).boundingBox(), header.locator(":scope > *").nth(4).boundingBox()]);
      const [timeCell, chipCell] = await Promise.all([lineOf(page, 101).locator(".result-time-cell").nth(0).boundingBox(), lineOf(page, 101).locator(".result-time-cell").nth(1).boundingBox()]);
      expect(Math.abs((timeHead?.x ?? 0) - (timeCell?.x ?? -99))).toBeLessThanOrEqual(2);
      expect(Math.abs((chipHead?.x ?? 0) - (chipCell?.x ?? -99))).toBeLessThanOrEqual(2);
    }

    // ---- The first press loads the picker, and it opens at 0:00:00 — a dialog on the phone, a popover with a mouse ---------------
    const picker = page.getByTestId("time-picker");
    await expect(picker).toHaveCount(0);
    const scriptsBefore = scripts.length;
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>('[name="r[101].time"]');
      const heard: string[] = [];
      (window as unknown as { heard: string[] }).heard = heard;
      box?.addEventListener("input", () => heard.push("input"));
      box?.addEventListener("change", () => heard.push("change"));
    });
    await pick101.click();
    await expect(picker).toBeVisible();
    expect(scripts.length, "the picker's own code is fetched on the first press").toBeGreaterThan(scriptsBefore);
    await expect(picker).toHaveAttribute("data-shape", phone ? "dialog" : "popover");
    await expectOpenAt(picker, "00", "00", "00");
    await expect(column(picker, 0).getByRole("option")).toHaveCount(24);
    await expect(picker).toContainText(`Timp: #101 Ana Popescu ${tag}`);
    await expect(picker.getByTestId("time-picker-help")).toContainText("Zecimile (mm:ss.t)");
    // 0:00:00 is no race time: «OK» waits for a pick.
    await expect(picker.getByTestId("time-picker-ok")).toBeDisabled();
    // Measured once the popover has grown to its size (it opens with a scale), each a 44-pixel target.
    for (const target of [picker.getByTestId("time-picker-ok"), picker.getByTestId("time-picker-cancel"), column(picker, 1).getByRole("option").first()]) {
      await expect.poll(async () => (await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    }
    await pickOnTheClock(picker, "01", "23", "45");
    await picker.getByTestId("time-picker-ok").click();
    await expect(picker).toBeHidden();
    await expect(timeBox(page, 101)).toHaveValue("1:23:45");
    expect(await page.evaluate(() => (window as unknown as { heard: string[] }).heard)).toEqual(["input", "change"]);
    // The focus comes back to the box with a mouse; on a phone to the button, so no keyboard rises over the lines.
    await expect(phone ? pick101 : timeBox(page, 101)).toBeFocused();

    // ---- Opened again, it stands at the box's time; «Anulează» writes nothing ------------------------------------------------
    await pick101.click();
    await expect(picker).toBeVisible();
    await expectOpenAt(picker, "01", "23", "45");
    await pickOnTheClock(picker, "02", "00", "00");
    await picker.getByTestId("time-picker-cancel").click();
    await expect(picker).toBeHidden();
    await expect(timeBox(page, 101)).toHaveValue("1:23:45");
    await expect(pick101).toBeFocused();

    // ---- Tenths are typed: the clock opens at the whole seconds, and «OK» writes whole seconds ---------------------------------
    await timeBox(page, 102).fill("45:12.3");
    await lineOf(page, 102).getByRole("button", { name: `Alege timpul: #102 Bia Marin ${tag}`, exact: true }).click();
    await expect(picker).toBeVisible();
    await expectOpenAt(picker, "00", "45", "12");
    await picker.getByTestId("time-picker-ok").click();
    await expect(picker).toBeHidden();
    await expect(timeBox(page, 102)).toHaveValue("0:45:12");

    // ---- Digits alone are a time when the box is left; what cannot be read stays as typed -------------------------------------
    await chipBox(page, 101).fill("12345");
    await chipBox(page, 101).blur();
    await expect(chipBox(page, 101)).toHaveValue("1:23:45");
    await chipBox(page, 102).fill("45");
    await chipBox(page, 102).blur();
    await expect(chipBox(page, 102)).toHaveValue("45");
    await chipBox(page, 102).fill("");

    // ---- …and on Enter, before the form's own save: «4730» is saved as 47:30 ------------------------------------------------
    await layoutHolds(page);
    await timeBox(page, 103).fill("4730");
    await timeBox(page, 103).press("Enter");
    // Enter presses the form's own save, which asks first (§NNN), naming the rows it changes.
    await confirmDialog(page, "Salvezi clasamentul?");
    await expect(page.getByTestId("toast-live")).toContainText("Am salvat 3 rezultate", { timeout: 30_000 });
    await hydrated(page);

    // 102 (45:12) first, 103 (47:30) second, 101 (1:23:45) third — the first number of each place cell is the overall place —
    // and the boxes say what was stored.
    await expect(placeOf(page, 102)).toHaveText(/^\D*1(?!\d)/);
    await expect(placeOf(page, 103)).toHaveText(/^\D*2(?!\d)/);
    await expect(placeOf(page, 101)).toHaveText(/^\D*3(?!\d)/);
    await expect(timeBox(page, 101)).toHaveValue("1:23:45");
    await expect(chipBox(page, 101)).toHaveValue("1:23:45");
    await expect(timeBox(page, 102)).toHaveValue("0:45:12");
    await expect(timeBox(page, 103)).toHaveValue("0:47:30");
    await layoutHolds(page);
  });

  test.describe("in an English-speaking browser", () => {
    test.use({ locale: "en-US", timezoneId: "America/New_York" });

    test("draws the clock on 24 hours with no AM or PM, and «OK» writes the afternoon as it reads", async ({ page }, testInfo) => {
      const tag = `${testInfo.project.name}-en-${Date.now().toString(36)}`;
      const eventId = await seedRace(tag);
      await signIn(page, "Dev Administrator");
      await page.goto(`/en/admin/events/${eventId}/results`);
      await hydrated(page);
      await lineOf(page, 103).getByRole("button", { name: `Pick the time: #103 Dan Ionescu ${tag}`, exact: true }).click();
      const picker = page.getByTestId("time-picker");
      await expect(picker).toBeVisible();
      await expect(picker.getByRole("listbox")).toHaveCount(3);
      await expect(column(picker, 0).getByRole("option")).toHaveCount(24);
      await expect(column(picker, 0).getByRole("option").last()).toHaveText("23");
      await expect(column(picker, 1).getByRole("option")).toHaveCount(60);
      await expect(column(picker, 2).getByRole("option")).toHaveCount(60);
      await expect(picker).not.toContainText(/\b[AP]\.?M\.?\b/i);
      await expect(picker.getByTestId("time-picker-help")).toContainText("Tenths (mm:ss.t)");
      await expect(picker.getByTestId("time-picker-cancel")).toHaveText("Cancel");
      await pickOnTheClock(picker, "13", "05", "09");
      await picker.getByTestId("time-picker-ok").click();
      await expect(picker).toBeHidden();
      await expect(timeBox(page, 103)).toHaveValue("13:05:09");
    });
  });
});
