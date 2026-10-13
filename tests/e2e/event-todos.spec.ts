import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * §NNN — «De făcut pentru pagina evenimentului» (BR-REQ-050-01, BR-REQ-060-01): an Administrator
 * opens an event whose page lacks its cover, sees the computed row marked «din pagină» and follows
 * its link to the cover's card, adds a row with the priority «Urgentă» and sees it first, gives it
 * to herself and sees it under «Ale mele», ticks it and finds it under «Gata».
 *
 * The event is written straight into the database — the setup, not the subject — one per project
 * and run, so the two projects never share a row.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** A group run with both languages' texts and no cover, no description and no route: a page with things to do. */
async function seedEvent(tag: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name)
       VALUES ('GROUP_RUN', now() + interval '30 days', 'NONE', 'Parcul Tractorul') RETURNING id`,
    );
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O oră ușoară.'), ($1, 'en', $4, $5, 'An easy hour.')`,
      [rows[0].id, `de-facut-${tag}`, `Alergarea de probă ${tag}`, `to-do-${tag}`, `The test run ${tag}`],
    );
    return rows[0].id;
  } finally {
    await client.end();
  }
}

test.describe("§NNN the event's «De făcut»", () => {
  test.describe.configure({ timeout: 90_000 });

  test("shows what the page lacks, links to the field, takes a row with a priority first, assigns it and ticks it", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedEvent(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    // The card opens by itself while anything is left, and its closed line counts.
    const card = page.getByTestId("event-todos");
    await expect(card).toBeVisible();
    await expect(card.locator("xpath=self::details")).toHaveAttribute("open", "");
    await expect(card.getByRole("heading", { name: "De făcut pentru pagina evenimentului" })).toBeVisible();
    await expect(card.locator("summary").first()).toContainText(/\d+ de făcut/);

    // The events list says the same count beside the event: the computed rows (no typed line yet).
    const openLine = (await card.locator("summary").first().innerText()).match(/(\d+) de făcut/);
    expect(openLine).not.toBeNull();
    const lacking = Number(openLine![1]);
    await page.goto(`/ro/admin?q=${tag}`);
    await hydrated(page);
    await expect(page.locator('[data-testid="event-todos-chip"]:visible')).toHaveText(new RegExp(`${lacking} de făcut`));
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    // A computed row: no cover photo — marked «din pagină», with a priority word and no edit or delete.
    const cover = card.locator('[data-testid="event-todo-page-row"][data-rule="cover"]');
    await expect(cover).toContainText("Evenimentul nu are fotografie de copertă.");
    await expect(cover).toContainText("din pagină");
    await expect(cover.getByTestId("event-todo-priority")).toHaveText("Normală");
    await expect(cover.getByRole("button", { name: /Șterge|Modifică/ })).toHaveCount(0);
    const fill = cover.getByTestId("event-todo-fill");
    expect((await fill.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The link lands on «Copertă» and opens it.
    await fill.click();
    await expect(page).toHaveURL(/#box-cover$/);
    await expect(page.locator("#box-cover")).toHaveAttribute("open", "");
    await expect(page.getByTestId("cover-box")).toBeVisible();

    // A row of the club's own, «Urgentă»: it is first, ahead of every normal and low computed row.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await openEditorBox(page, "Adaugă un rând");
    const add = page.getByTestId("event-todo-add");
    await add.getByLabel("Ce e de făcut").fill("Cere aprobarea pentru traseu");
    await add.getByLabel("Prioritate").selectOption("URGENT");
    await add.getByRole("button", { name: "Adaugă", exact: true }).click();
    await page.waitForURL(/#box-todos$/);
    await hydrated(page);
    const list = page.getByTestId("event-todos-list");
    const first = list.locator("li").first();
    await expect(first).toContainText("Cere aprobarea pentru traseu");
    await expect(first.getByTestId("event-todo-priority")).toHaveText("Urgentă");
    expect(await list.locator("li").count()).toBeGreaterThan(1);

    // …and the list's chip counts the computed rows plus the open typed line.
    await page.goto(`/ro/admin?q=${tag}`);
    await hydrated(page);
    await expect(page.locator('[data-testid="event-todos-chip"]:visible')).toHaveText(new RegExp(`${lacking + 1} de făcut`));
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    // Assign it: «Modifică» → «Cine».
    await first.getByText("Modifică", { exact: true }).click();
    await first.getByLabel("Cine").selectOption({ label: "Dev Administrator" });
    await first.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/#box-todos$/);
    await hydrated(page);
    await expect(page.getByTestId("event-todos-list").locator("li").first().getByTestId("event-todo-assignee")).toContainText("Pentru Dev Administrator");

    // «Ale mele» keeps this row and drops the computed ones, which have nobody.
    await page.getByRole("link", { name: "Ale mele" }).click();
    await expect(page).toHaveURL(/mine=1/);
    await hydrated(page);
    await expect(page.getByTestId("event-todos-list").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("event-todo-page-row")).toHaveCount(0);

    // Tick it: it leaves the open list and waits under «Gata».
    await page.getByRole("button", { name: /^Bifează: Cere aprobarea/ }).click();
    await page.waitForURL(/#box-todos$/);
    await hydrated(page);
    await expect(page.getByTestId("event-todos-empty")).toBeVisible();
    const done = page.getByTestId("event-todos-done");
    await expect(done).toContainText("Gata (1)");
    await openEditorBox(page, "Gata (1)");
    await expect(done).toContainText("Cere aprobarea pentru traseu");
    await expect(done).toContainText("Bifat de Dev Administrator");

    // Inside the screen, whichever width the project has.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
