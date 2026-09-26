import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * BR-REQ-090-05 and BR-REQ-060-01 — `/admin/tasks` lands on «Club», and «De făcut» is the club's
 * own checklist (`DECISIONS.md` §438; the owner, 2026-09-26: "by default I need to be on the
 * «Club» tab, and I need another folder — a list for Amalia (the club's to-do)").
 *
 * The list operations, the role gate and the starting list are unit- and PGlite-tested; this is
 * what they cannot see — that the tabs are where the owner asked, that a tick is one 44-pixel
 * press that moves the line into the folded «terminate», that the owner filter survives a press,
 * that deleting asks first, and that the Organizer writes while the Redactor only reads.
 *
 * Every line this spec adds carries the project's name and the time, and is deleted by the same
 * test, so the two projects and a rerun on the same database never meet each other's lines.
 */

/**
 * A write is a Server Action, a row lock and a redirect that renders the whole panel again; on a
 * shared machine under a two-project run that has taken longer than the default five seconds.
 */
const SAVED = 20_000;
test.describe("BR-REQ-090-05 «Club» first, and «De făcut» beside it", () => {
  test("lands an Administrator on «Club», with «De făcut» and its open count one tab away", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks");
    const main = page.locator("#main");
    const nav = main.getByRole("navigation", { name: "Ce mai este de făcut" });

    await expect(nav.getByRole("link", { name: "Club", exact: true })).toHaveAttribute("aria-current", "page");
    // The system's own list is what «Club» shows: its counter is still there.
    await expect(main.getByText(/^De făcut: \d+ · Gata: \d+$/)).toBeVisible();

    const todo = nav.getByRole("link", { name: /^De făcut \(\d+\)$/ });
    await expect(todo).toBeVisible();
    await todo.click();
    await expect(page).toHaveURL(/panel=todo/);
    await expect(nav.getByRole("link", { name: /^De făcut/ })).toHaveAttribute("aria-current", "page");
    await expect(main.getByTestId("club-todo-counts")).toHaveText(/^Deschise: \d+ · Terminate: \d+$/);
    // The main bar's tab is «Sarcini» now, the sub-tab «De făcut» (the owner's message to the club).
    await expect(page.getByRole("tab", { name: "Sarcini" })).toBeVisible();
  });

  test("adds a line, filters by its owner, ticks it into «terminate», unticks it and deletes it after asking", async ({ page }, testInfo) => {
    const stamp = Date.now();
    const text = `E2E ${testInfo.project.name} ${stamp}`;
    // Unique per run too: a run that stopped halfway leaves its line behind, and the filter below
    // counts exactly one.
    const owner = `E2E${testInfo.project.name}${stamp}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks?panel=todo");
    const main = page.locator("#main");

    const add = main.getByTestId("club-todo-add");
    await openFold(add);
    await add.getByLabel("Ce e de făcut").fill(text);
    await add.getByLabel("Pentru cine").fill(owner);
    await add.getByRole("button", { name: "Adaugă", exact: true }).click();
    await expect(page).toHaveURL(/saved=clubTodoAdded/, { timeout: SAVED });

    // The owner is a chip on the filter now; pressing it narrows the list to that one line.
    await main.getByRole("navigation", { name: "Pentru cine" }).getByRole("link", { name: owner }).click();
    await expect(page).toHaveURL(new RegExp(`for=${owner}`));
    const list = main.getByRole("list", { name: "Lista clubului" });
    await expect(list.getByTestId("club-todo-item")).toHaveCount(1);
    const item = list.getByTestId("club-todo-item").filter({ hasText: text });
    await expect(item.getByText(`Pentru ${owner}`)).toBeVisible();

    // The tick: one press, 44 pixels, and the filter survives it.
    const tick = item.getByRole("button", { name: `Bifează: ${text}` });
    const box = await tick.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    await tick.click();
    await expect(page).toHaveURL(/saved=clubTodoDone/, { timeout: SAVED });
    await expect(page).toHaveURL(new RegExp(`for=${owner}`));
    await expect(main.getByText(`Nimic deschis pentru ${owner}.`)).toBeVisible();

    // Done lines are folded away, struck through, with who ticked them.
    const done = main.getByTestId("club-todo-done");
    await expect(done.locator(":scope > summary")).toHaveText(/^Arată terminate \(\d+\)$/);
    await openFold(done);
    const doneItem = done.getByTestId("club-todo-item").filter({ hasText: text });
    await expect(doneItem.getByText(/^Bifat de Dev Administrator, /)).toBeVisible();
    // The line's own words — the paragraph, not the same words in its «Modifică» box.
    const decoration = await doneItem.locator("p", { hasText: text }).evaluate((element) => getComputedStyle(element).textDecorationLine);
    expect(decoration).toContain("line-through");

    await doneItem.getByRole("button", { name: `Debifează: ${text}` }).click();
    await expect(page).toHaveURL(/saved=clubTodoReopened/, { timeout: SAVED });
    const again = list.getByTestId("club-todo-item").filter({ hasText: text });
    await expect(again).toBeVisible();

    // Deleting asks first, and the line is gone for everybody.
    const edit = again.locator("details");
    await openFold(edit);
    await edit.getByRole("button", { name: "Șterge", exact: true }).click();
    await confirmDialog(page, "Ștergi rândul?");
    await expect(page).toHaveURL(/saved=clubTodoDeleted/, { timeout: SAVED });
    await expect(main.getByTestId("club-todo-item").filter({ hasText: text })).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});

test.describe("BR-REQ-060-01 who writes the club's checklist", () => {
  test("an Organizer lands on «De făcut», with nothing else on the page, and writes it", async ({ page }, testInfo) => {
    const text = `E2E organizer ${testInfo.project.name} ${Date.now()}`;
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/tasks");
    const main = page.locator("#main");
    const nav = main.getByRole("navigation", { name: "Ce mai este de făcut" });
    await expect(nav.getByRole("link", { name: /^De făcut/ })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link")).toHaveCount(1);

    const add = main.getByTestId("club-todo-add");
    await openFold(add);
    await add.getByLabel("Ce e de făcut").fill(text);
    await add.getByRole("button", { name: "Adaugă", exact: true }).click();
    await expect(page).toHaveURL(/saved=clubTodoAdded/, { timeout: SAVED });

    const item = main.getByRole("list", { name: "Lista clubului" }).getByTestId("club-todo-item").filter({ hasText: text });
    await item.getByRole("button", { name: `Bifează: ${text}` }).click();
    await expect(page).toHaveURL(/saved=clubTodoDone/, { timeout: SAVED });
    const done = main.getByTestId("club-todo-done");
    await openFold(done);
    const doneItem = done.getByTestId("club-todo-item").filter({ hasText: text });
    await expect(doneItem.getByText(/^Bifat de Dev Moderator, /)).toBeVisible();

    await openFold(doneItem.locator("details"));
    await doneItem.getByRole("button", { name: "Șterge", exact: true }).click();
    await confirmDialog(page, "Ștergi rândul?");
    await expect(page).toHaveURL(/saved=clubTodoDeleted/, { timeout: SAVED });
  });

  test("a Redactor reads the list and is offered no verb on it", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/tasks");
    const main = page.locator("#main");
    await expect(main.getByTestId("club-todo-counts")).toBeVisible();
    await expect(main.getByText(/^Poți citi lista; o scriu Organizatorul/)).toBeVisible();
    await expect(main.getByTestId("club-todo-item").first()).toBeVisible();
    await expect(main.getByRole("button", { name: /^Bifează: / })).toHaveCount(0);
    await expect(main.getByTestId("club-todo-add")).toHaveCount(0);
    await expect(main.getByText("Modifică", { exact: true })).toHaveCount(0);
  });
});
