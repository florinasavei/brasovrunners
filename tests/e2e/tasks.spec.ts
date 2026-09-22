import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-05 criteria 8–9 — the to-do half of the task board: a counter, and two filters
 * that combine (`DECISIONS.md` §150; the owner: "show a counter of how many items are pending,
 * and a filter by issue type and owner").
 *
 * The arithmetic and the narrowing are unit-tested; this is what a unit test cannot see —
 * that the chips are links an Administrator can press, that one keeps the other's choice in
 * the address, and that two rows of chips still fit a 320 px phone with no sideways scroll.
 * Scoped to `#main` for the streamed-duplicate reason `tasks-cost.spec.ts` explains (§93).
 */
test.describe("BR-REQ-090-05 the to-do half of the task board", () => {
  test("counts the rows and narrows them by owner and by kind, together", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks");
    // §265: the checklist is the first panel, so a bare URL still opens on it.
    const main = page.locator("#main");
    const list = main.getByRole("list", { name: "Lista de sarcini" });

    // The counter, over the whole board when nothing is filtered.
    await expect(main.getByText(/^De făcut: \d+ · Gata: \d+$/)).toBeVisible();

    // Start from a kind, then pick an owner: the kind must survive in the address.
    // Each chip is a link 44 px tall (criterion 9; the chip inside it is small).
    const box = await main.getByRole("navigation", { name: "Tip" }).getByRole("link", { name: "Cont" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await main.getByRole("navigation", { name: "Tip" }).getByRole("link", { name: "Cont" }).click();
    await expect(page).toHaveURL(/kind=account/);
    await main.getByRole("navigation", { name: "Cine" }).getByRole("link", { name: "Clubul" }).click();
    await expect(page).toHaveURL(/owner=club/);
    await expect(page).toHaveURL(/kind=account/);
    // Every row shown is the club's, of the account kind.
    await expect(list.getByRole("listitem").first()).toBeVisible();
    expect(await list.getByText("Dezvoltatorul", { exact: true }).count()).toBe(0);
    expect(await list.getByText("Decizie", { exact: true }).count()).toBe(0);
    await expect(main.getByRole("navigation", { name: "Cine" }).getByRole("link", { name: "Clubul" })).toHaveAttribute("aria-current", "page");

    // A kind chip keeps the owner.
    await main.getByRole("navigation", { name: "Tip" }).getByRole("link", { name: "Text" }).click();
    await expect(page).toHaveURL(/owner=club/);
    await expect(page).toHaveURL(/kind=text/);
    await expect(list.getByRole("listitem").first()).toBeVisible();
    expect(await list.getByText("Cont", { exact: true }).count()).toBe(0);
    expect(await list.getByText("Text", { exact: true }).count()).toBeGreaterThan(0);
    // The counter describes the rows shown, so it is still there and still a pair of numbers.
    await expect(main.getByText(/^De făcut: \d+ · Gata: \d+$/)).toBeVisible();

    // "Toate" on the owner row drops the owner and keeps the kind.
    await main.getByRole("navigation", { name: "Cine" }).getByRole("link", { name: "Toate" }).click();
    await expect(page).toHaveURL(/kind=text/);
    await expect(page).not.toHaveURL(/owner=/);

    // Two rows of chips, a 320 px phone, no sideways scroll (§18.5).
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("reads a value outside the closed sets as no filter at all", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks?owner=nobody&kind=cont");
    const main = page.locator("#main");
    await expect(main.getByText(/^De făcut: \d+ · Gata: \d+$/)).toBeVisible();
    // "Toate" is current on both rows: the typed values named nothing the page offers.
    await expect(main.getByRole("navigation", { name: "Cine" }).locator("[aria-current=page]")).toHaveText("Toate");
    await expect(main.getByRole("navigation", { name: "Tip" }).locator("[aria-current=page]")).toHaveText("Toate");
  });

  test("says so when a combination has no row, and counts nothing", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    // The only developer row is the scheduler check, so developer × text is empty whatever
    // the jobs' health — no dependence on a pinger having run.
    await page.goto("/ro/admin/tasks?owner=developer&kind=text");
    const main = page.locator("#main");
    await expect(main.getByText("Niciun rând pentru acest filtru.")).toBeVisible();
    await expect(main.getByText("De făcut: 0 · Gata: 0")).toBeVisible();
    expect(await main.getByRole("list", { name: "Lista de sarcini" }).getByRole("listitem").count()).toBe(0);
    expect(await main.getByText("Tot ce se vede aici este rezolvat.").count()).toBe(0);
  });
});
