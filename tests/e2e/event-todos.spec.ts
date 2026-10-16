import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §749, amended by §752 — «De făcut pentru pagina evenimentului» (two folds, shut on arrival, each with a summary line: every action opens its fold first) (BR-REQ-050-01, BR-REQ-060-01): an
 * Administrator and a Superadministrator open an event whose page lacks its cover, see the computed row
 * under «Lipsește pe pagină» and follow its link to the cover's card, add a task with Enter, change every
 * one of its fields through the pencil, tick it from its box and find it under «Gata», untick it, and
 * delete it. «Nu pot să modific chestii» (the owner) could not be reproduced on a production build as an
 * Administrator, a Superadministrator or an Organizer (every press worked); the second test pins every
 * change path anyway, and that the card is the same element after a press, so nothing the reader opened
 * or typed is replaced under their hand.
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

/** The one marker the page puts on the card's element, so a later check can tell whether the browser kept it or replaced it. */
async function markCard(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __card: Element | null }).__card = document.querySelector('[data-testid="event-todos"]');
  });
}
async function cardIsTheSame(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const marked = (window as unknown as { __card: Element | null }).__card;
    return Boolean(marked && marked.isConnected && marked === document.querySelector('[data-testid="event-todos"]'));
  });
}

test.describe("§749 the event's «De făcut»", () => {
  // Toasts queue, one read after the other (`toastQueueReducer`): a later sentence waits for the earlier one to hide.
  test.describe.configure({ timeout: 180_000 });

  test("shows what the page lacks, links to the field, takes a task with a priority first, assigns it and ticks it", async ({ page }) => {
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
    await expect(card.getByRole("heading", { name: "Lipsește pe pagină" })).toBeVisible();
    await expect(card.getByRole("heading", { name: "Sarcini" })).toBeVisible();
    // …and its two folds are shut: the rows are one press away, behind a summary that says what is in them.
    const pageFold = page.getByTestId("event-todos-page");
    const ownFold = page.getByTestId("event-todos-own");
    await expect(pageFold).not.toHaveAttribute("open", "");
    await expect(ownFold).not.toHaveAttribute("open", "");

    // The events list says the same count beside the event: the computed rows (no typed line yet).
    const openLine = (await card.locator("summary").first().innerText()).match(/(\d+) de făcut/);
    expect(openLine).not.toBeNull();
    const lacking = Number(openLine![1]);
    await page.goto(`/ro/admin?q=${tag}`);
    await hydrated(page);
    await expect(page.locator('[data-testid="event-todos-chip"]:visible')).toHaveText(new RegExp(`${lacking} de făcut`));
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    // A computed row: no cover photo — a link with a priority word, no tick, no edit, no delete. Open its fold first.
    await openFold(pageFold);
    const cover = card.locator('[data-testid="event-todo-page-row"][data-rule="cover"]');
    await expect(cover).toContainText("Evenimentul nu are fotografie de copertă.");
    await expect(cover.getByTestId("event-todo-priority")).toHaveText("Normală");
    await expect(cover.getByRole("button")).toHaveCount(0);
    await expect(cover.getByRole("checkbox")).toHaveCount(0);
    const fill = cover.getByTestId("event-todo-fill");
    expect((await fill.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The whole row is the link: it lands on «Copertă» and opens it.
    await fill.click();
    await expect(page).toHaveURL(/#box-cover$/);
    await expect(page.locator("#box-cover")).toHaveAttribute("open", "");
    await expect(page.getByTestId("cover-box")).toBeVisible();

    // A task of the club's own, «Urgentă»: it is first among «Sarcini», and Enter sends it. Open «Sarcini» first.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await openFold(page.getByTestId("event-todos-own"));
    const add = page.getByTestId("event-todo-add");
    await add.getByLabel("Adaugă o sarcină").fill("Cere aprobarea pentru traseu");
    await add.getByLabel("Prioritate").selectOption("URGENT");
    await add.getByLabel("Adaugă o sarcină").press("Enter");
    const list = page.getByTestId("event-todos-list");
    const first = list.locator("li").first();
    await expect(first).toContainText("Cere aprobarea pentru traseu");
    await expect(first.getByTestId("event-todo-priority")).toHaveText("Urgentă");
    // …the toast says so, and the add line is empty again.
    await expect(page.getByTestId("toast-live")).toContainText("Rând adăugat", { timeout: 20_000 });
    await expect(add.getByLabel("Adaugă o sarcină")).toHaveValue("");

    // …and the events list's chip counts the computed rows plus the open typed line.
    await page.goto(`/ro/admin?q=${tag}`);
    await hydrated(page);
    await expect(page.locator('[data-testid="event-todos-chip"]:visible')).toHaveText(new RegExp(`${lacking + 1} de făcut`));
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    // Give it to herself through the pencil — «Sarcini» is shut again on a fresh load.
    await expect(page.getByTestId("event-todos-own")).not.toHaveAttribute("open", "");
    await openFold(page.getByTestId("event-todos-own"));
    const row = page.getByTestId("event-todos-list").locator("li").first();
    await openFold(row.getByTestId("event-todo-edit"));
    await row.getByLabel("Cine").selectOption({ label: "Dev Administrator" });
    await row.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("event-todos-list").locator("li").first().getByTestId("event-todo-assignee")).toContainText("Pentru Dev Administrator");

    // «Ale mele» (inside «Sarcini») keeps this row among the tasks; the page's own rows have nobody and stay in their fold.
    await page.getByRole("link", { name: "Ale mele" }).click();
    await expect(page).toHaveURL(/mine=1/);
    // Pressing it opens «Sarcini» by itself, and leaves «Lipsește pe pagină» shut.
    await expect(page.getByTestId("event-todos-own")).toHaveAttribute("open", "");
    await expect(page.getByTestId("event-todos-page")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("event-todos-list").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("event-todo-page-row")).toHaveCount(lacking);

    // Tick it from its box: it leaves the open list and waits under «Gata», and «Ale mele» is still on.
    await page.getByRole("checkbox", { name: /^Bifează: Cere aprobarea/ }).click();
    await expect(page.getByTestId("event-todos-empty")).toBeVisible();
    await expect(page).toHaveURL(/mine=1/);
    const done = page.getByTestId("event-todos-done");
    await expect(done).toContainText("Gata (1)");
    await openEditorBox(page, "Gata (1)");
    await expect(done).toContainText("Cere aprobarea pentru traseu");
    await expect(done).toContainText("Bifat de Dev Administrator");

    // Inside the screen, whichever width the project has.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("arrives with both folds shut, and each shut line reads right at this width", async ({ page }, testInfo) => {
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const eventId = await seedEvent(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    const card = page.getByTestId("event-todos");
    const pageFold = page.getByTestId("event-todos-page");
    const ownFold = page.getByTestId("event-todos-own");

    // Both shut, and each fold's row is on the screen: its words, how many, how pressing.
    await expect(card).toHaveAttribute("open", "");
    await expect(pageFold).not.toHaveAttribute("open", "");
    await expect(ownFold).not.toHaveAttribute("open", "");
    await expect(pageFold.locator("summary").first()).toBeVisible();
    await expect(pageFold.locator("summary").first()).toContainText(/Lipsește pe pagină\s*\d+ (?:de )?rânduri/);
    await expect(pageFold.locator("summary").first().getByTestId("event-todo-fold-priority").first()).toBeVisible();
    await expect(ownFold.locator("summary").first()).toContainText(/Sarcini\s*nicio sarcină deschisă/);
    // Nothing of «Sarcini» is drawn while it is shut: not the add line, not the chips.
    await expect(card.getByTestId("event-todo-add")).toBeHidden();
    await expect(card.getByRole("navigation", { name: "Ce rânduri arăt" })).toBeHidden();
    // The two summaries are targets a thumb can hit.
    for (const fold of [pageFold, ownFold]) expect((await fold.locator("summary").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // An urgent task of mine says so on the shut line after a fresh load.
    await openFold(ownFold);
    const add = card.getByTestId("event-todo-add");
    await add.getByLabel("Adaugă o sarcină").fill("Banda cu sponsori");
    await add.getByLabel("Prioritate").selectOption("URGENT");
    await openFold(add.getByTestId("event-todo-add-more"));
    await add.getByLabel("Cine").selectOption({ label: "Dev Administrator" });
    await add.getByLabel("Adaugă o sarcină").press("Enter");
    await expect(page.getByTestId("toast-live")).toContainText("Rând adăugat", { timeout: 20_000 });
    // The press that worked leaves «Sarcini» open on its result, «Lipsește pe pagină» shut.
    await expect(page.getByTestId("event-todos-own")).toHaveAttribute("open", "");
    await expect(page.getByTestId("event-todos-page")).not.toHaveAttribute("open", "");

    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await expect(ownFold).not.toHaveAttribute("open", "");
    const line = ownFold.locator("summary").first();
    await expect(line).toContainText(/Sarcini\s*1 de făcut · 1 ale mele/);
    await expect(line.getByTestId("event-todo-fold-priority")).toHaveText("Urgentă");
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `test-results/todos-folds-shut-${testInfo.project.name}.png` });
    // Inside the screen, whichever width the project has — 320 pixels on the phone project.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("opens the fold an address names, and only that one", async ({ page }, testInfo) => {
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const eventId = await seedEvent(tag);
    await signIn(page, "Dev Administrator");

    // A row of «Lipsește pe pagină» in the address: that fold opens, the card around it too, «Sarcini» stays shut.
    await page.goto(`/ro/admin/events/${eventId}#event-todo-page-cover`);
    await hydrated(page);
    await expect(page.getByTestId("event-todos")).toHaveAttribute("open", "");
    await expect(page.getByTestId("event-todos-page")).toHaveAttribute("open", "");
    await expect(page.getByTestId("event-todos-own")).not.toHaveAttribute("open", "");

    // «Sarcini» by its own address, on a fresh load (a change of the fragment alone keeps the folds the reader opened):
    // that one opens, the other stays shut.
    await page.goto("about:blank");
    await page.goto(`/ro/admin/events/${eventId}#box-todos-own`);
    await hydrated(page);
    await expect(page.getByTestId("event-todos-own")).toHaveAttribute("open", "");
    await expect(page.getByTestId("event-todos-page")).not.toHaveAttribute("open", "");
  });

  for (const identity of ["Dev Administrator", "Dev Superadministrator"]) {
    test(`${identity} changes every part of a task, and the card stays the reader's own after each press`, async ({ page }, testInfo) => {
      const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
      const eventId = await seedEvent(tag);
      await signIn(page, identity);
      await page.goto(`/ro/admin/events/${eventId}`);
      await hydrated(page);
      const card = page.getByTestId("event-todos");
      const add = card.getByTestId("event-todo-add");
      const open = card.getByTestId("event-todos-list");

      // Every action is inside «Sarcini», shut on arrival: open it through its summary first.
      await openFold(card.getByTestId("event-todos-own"));

      // Add with Enter, the words only: «Normală», nobody, no day.
      await add.getByLabel("Adaugă o sarcină").fill("Banda cu sponsori");
      await add.getByLabel("Adaugă o sarcină").press("Enter");
      const row = open.locator("li").first();
      await expect(row).toContainText("Banda cu sponsori");
      await expect(row.getByTestId("event-todo-priority")).toHaveText("Normală");
      await expect(page.getByTestId("toast-live")).toContainText("Rând adăugat", { timeout: 20_000 });

      // Right after a press the reader opens the pencil and starts typing; the card must still be the element
      // they started in, with the fold open and the words as typed. Mark the card, open, type, wait.
      await markCard(page);
      await openFold(row.getByTestId("event-todo-edit"));
      await row.getByLabel("Ce e de făcut").fill("Banda cu sponsori și logo-urile lor");
      await page.waitForTimeout(3_000);
      expect(await cardIsTheSame(page), "the card is still the element the reader started in").toBe(true);
      await expect(row.getByTestId("event-todo-edit")).toHaveAttribute("open", "");
      await expect(row.getByLabel("Ce e de făcut")).toHaveValue("Banda cu sponsori și logo-urile lor");

      // Change every field through the pencil: the words (above), the priority, who, the day — one save.
      await row.getByLabel("Prioritate").selectOption("HIGH");
      await row.getByLabel("Cine").selectOption({ label: identity });
      const due = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      const [year, month, day] = due.split("-");
      const dueGroup = row.getByRole("group", { name: "Termen" });
      await dueGroup.getByRole("spinbutton").first().click();
      await page.keyboard.type(`${day}${month}${year}`);
      await row.getByRole("button", { name: "Salvează", exact: true }).click();
      await expect(page.getByTestId("toast-live")).toContainText("Rând salvat", { timeout: 20_000 });
      const saved = open.locator("li").first();
      await expect(saved).toContainText("Banda cu sponsori și logo-urile lor");
      await expect(saved.getByTestId("event-todo-priority")).toHaveText("Mare");
      await expect(saved.getByTestId("event-todo-assignee")).toContainText(`Pentru ${identity}`);
      await expect(saved.getByTestId("event-todo-due")).toContainText("Termen:");
      // Saved, and the fold is closed again.
      await expect(saved.getByTestId("event-todo-edit")).not.toHaveAttribute("open", "");

      // Tick it from its box: it goes under «Gata», struck through, with a box to untick.
      await page.getByRole("checkbox", { name: /^Bifează: Banda cu sponsori/ }).click();
      await expect(card.getByTestId("event-todos-done")).toContainText("Gata (1)");
      await expect(page.getByTestId("toast-live")).toContainText("Bifat", { timeout: 20_000 });
      await expect(open.locator("li")).toHaveCount(0);
      const done = card.getByTestId("event-todos-done");
      await openFold(done);
      await expect(done.getByTestId("event-todo-text")).toHaveCSS("text-decoration-line", "line-through");

      // Untick it from the same place: it is back among «Sarcini».
      await done.getByRole("checkbox", { name: /^Debifează: Banda cu sponsori/ }).click();
      await expect(open.locator("li")).toHaveCount(1);
      await expect(card.getByTestId("event-todos-done")).toHaveCount(0);

      // Delete it: the pencil, «Șterge», and the question.
      const back = open.locator("li").first();
      await openFold(back.getByTestId("event-todo-edit"));
      await back.getByRole("button", { name: "Șterge", exact: true }).click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("toast-live")).toContainText("șters", { timeout: 20_000 });
      await expect(card.getByTestId("event-todo-item")).toHaveCount(0);
      await expect(card.getByTestId("event-todos-empty")).toBeVisible();

      // The card, at this project's width, for whoever looks at the test results.
      await add.getByLabel("Adaugă o sarcină").fill("Banda cu sponsori și logo-urile lor");
      await add.getByLabel("Prioritate").selectOption("HIGH");
      await add.getByLabel("Adaugă o sarcină").press("Enter");
      await expect(open.locator("li")).toHaveCount(1);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `test-results/todos-card-${testInfo.project.name}-${identity.replace(/\s+/g, "")}.png` });

      // Inside the screen, whichever width the project has.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
