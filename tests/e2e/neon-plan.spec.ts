import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-07 criterion 2 (`DECISIONS.md` §280's follow-up) — the Neon plan is set from the
 * backoffice and both screens follow it.
 *
 * The owner, with the billing console beside `/devs`: "faza asta cu DB-ul Neon nu e actualizata!
 * pt ca am zis ca am cumparat urmatorul plan!" One round trip: Free → Launch → Free, reading the
 * sentence on `/devs` as the role that reads that page and cannot set the plan (Tehnic), because
 * the sentence is the whole point of the setting. The arithmetic is unit-tested; this is the part
 * a unit test cannot see — that the select posts, that the other screen reads the row, and that a
 * reader who may not open the costs panel is told where the plan is set rather than linked to a 404.
 */
test.describe("BR-REQ-090-07 the Neon plan on /admin/tasks and /devs", () => {
  // One `platform_settings` row, two projects against one database: desktop only, as the
  // Mailgun plan's spec does, or the two runs overwrite each other's plan mid-assertion.
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("an Administrator sets Launch, Tehnic reads it on /devs, and the Administrator sets Free back", async ({ page }) => {
    // Three sign-ins and two saves in one round trip, deliberately — a split would leave the
    // shared row on Launch when a middle step fails. Alone it takes 17 s; beside twelve other
    // workers on one server it passed the default 30 s budget, so it declares itself slow.
    test.slow();
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks?panel=costs");
    const main = page.locator("#main");
    const panel = main.getByTestId("neon-plan");

    // The default: Free, with its ceilings — no key in CI, so the sentence without the hours.
    await expect(panel.getByRole("heading", { name: "Planul Neon (baza de date)" })).toBeVisible();
    await expect(panel.getByTestId("neon-plan-in-force")).toContainText(/^Planul: Free/);
    // No key in CI, so the setting stands in for Neon's answer, and the panel says so (§326).
    await expect(panel.getByTestId("neon-plan-source")).toContainText("se folosește planul ales mai jos");

    await panel.getByLabel("Planul de rezervă, când Neon nu răspunde").selectOption("LAUNCH");
    await panel.getByLabel("Notă (de ce, până când)").fill("Launch din 22 septembrie; revizuire în decembrie");
    await panel.getByRole("button", { name: "Salvează planul Neon" }).click();

    await expect(page).toHaveURL(/panel=costs/);
    await expect(main.getByText("Planul Neon a fost salvat", { exact: false })).toBeVisible();
    await expect(panel.getByTestId("neon-plan-in-force")).toContainText(/^Planul: Launch/);
    await expect(panel.getByText(/Notă: Launch din 22 septembrie/)).toBeVisible();
    // The cost table's row follows: Launch, by usage, no next plan — and the verdict stops saying "free".
    const neonRow = main.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Neon (baza de date)" }) });
    await expect(neonRow).toContainText("Launch");
    await expect(neonRow).toContainText(/la consum/);
    await expect(neonRow).toContainText("nu are pas următor");
    await expect(main.getByText(/Aproape: se plătesc domeniul și baza de date/)).toBeVisible();

    // Tehnic reads `/devs` and cannot open the costs panel: the Launch sentence, no ceiling, no
    // red, and a sentence saying who sets the plan rather than a link into a 404.
    await page.context().clearCookies();
    await signIn(page, "Dev Technical");
    await page.goto("/ro/devs");
    const block = page.locator("#main").getByTestId("neon-block");
    await expect(block.getByTestId("neon-plan-sentence")).toHaveText(/Planul setat: Launch\. Îl setează Administratorul, pe Sarcini → Costuri\./);
    await expect(block.getByRole("link", { name: /Schimbă planul/ })).toHaveCount(0);
    await expect(block.getByText(/Planul Launch e plătit pe consum: fără plafon de ore și fără oprire/)).toBeVisible();
    await expect(block.getByText(/Spațiu ocupat: [\d,.]+ MB — [\d,.]+ \$\/GB-lună/)).toBeVisible();
    await expect(block.getByText(/din 512 MB/)).toHaveCount(0);
    await expect(block.getByText(/din 100 ore-CU/)).toHaveCount(0);
    const tehnicTasks = await page.goto("/ro/admin/tasks?panel=costs");
    expect(tehnicTasks?.status()).toBe(404);

    // And back to Free, as the Administrator, so the next test on this database starts from the
    // default; the Administrator's `/devs` carries the link into the panel that sets it.
    await page.context().clearCookies();
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/devs");
    const adminBlock = page.locator("#main").getByTestId("neon-block");
    await expect(adminBlock.getByTestId("neon-plan-sentence")).toContainText("Planul setat: Launch.");
    await adminBlock.getByRole("link", { name: /Schimbă planul/ }).click();
    await expect(page).toHaveURL(/\/admin\/tasks\?panel=costs/);
    const again = page.locator("#main").getByTestId("neon-plan");
    await again.getByLabel("Planul de rezervă, când Neon nu răspunde").selectOption("FREE");
    await again.getByLabel("Notă (de ce, până când)").fill("");
    await again.getByRole("button", { name: "Salvează planul Neon" }).click();
    await expect(again.getByTestId("neon-plan-in-force")).toContainText(/^Planul: Free/);

    await page.goto("/ro/devs");
    const freeBlock = page.locator("#main").getByTestId("neon-block");
    await expect(freeBlock.getByTestId("neon-plan-sentence")).toContainText("Planul setat: Free.");
    await expect(freeBlock.getByText(/Spațiu ocupat: [\d,.]+ MB din 512 MB/)).toBeVisible();
  });
});
