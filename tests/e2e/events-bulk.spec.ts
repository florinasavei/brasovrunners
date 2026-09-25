import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languageTab } from "./support/fold";

/**
 * BR-REQ-050-02 criteria 11 and 12 (`DECISIONS.md` §113, §114) — a repeated event is one row,
 * and the bulk bar deletes what is ticked.
 *
 * Two draft events with the same title are a hand-made series: the list shows them as one row
 * with "2 date"; ticking that row ticks both; "Delete the ticked ones" asks, then removes both
 * and says so. Only this test's own row is ticked — the two Playwright projects share the
 * database, and "all" here would be the other project's rows too.
 */
test.describe("BR-REQ-050-02 a series is one row, and the bulk bar deletes it", () => {
  test("ticks the series, deletes both dates, and counts them", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const title = `Serie de probă ${suffix}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await signIn(page, "Dev Superadministrator");

    for (const [index, date] of ["2027-06-07", "2027-06-14"].entries()) {
      await page.goto("/ro/admin/events/new");
      // The tabs switch with React state: a click before hydration is discarded when React
      // takes over, the English panel stays hidden, and a hidden box cannot be filled.
      await hydrated(page);
      await fillDateField(page, "Începutul evenimentului", date);
      await fillTimeField(page, "Ora", "18:30");
      await field("event.locationName").fill("Parcul Tractorul");
      await field("event.locationNameEn").fill("Parcul Tractorul");
      // One language per tab on the create form too, as on the editor.
      await field("translations.ro.title").fill(title);
      await field("translations.ro.slug").fill(`serie-de-proba-${suffix}-${index}`);
      await languageTab(page, "title", "en").click();
      await field("translations.en.title").fill(`Trial series ${suffix}`);
      await languageTab(page, "address", "en").click();
      await field("translations.en.slug").fill(`trial-series-${suffix}-${index}`);
      await page.getByRole("button", { name: "Creează evenimentul" }).click();
      await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    }

    await page.goto("/ro/admin");
    // The row's checkbox is MUI's: a tick before hydration is reverted when React takes over.
    await hydrated(page);
    const main = page.locator("#main");
    // One row for the two dates, with the count chip; the title links to the next date. The
    // list is a table from `md` up and a block per row below it, both in the document and one
    // hidden, so the row is whichever visible `tr` or `li` holds the title.
    await expect(main.getByRole("link", { name: title, exact: true })).toHaveCount(1);
    const row = main.locator("tr, li").filter({ visible: true }).filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await expect(row.getByText("2 date", { exact: true })).toBeVisible();

    await row.getByRole("checkbox", { name: `Selectează „${title}”` }).check();
    await expect(main.getByText("Bifate: 1")).toBeVisible();

    await main.getByRole("button", { name: "Șterge cele bifate" }).click();
    await confirmDialog(page, "Ștergi evenimentele bifate?");

    await expect(page.locator("#admin-alert")).toContainText("2 evenimente șterse");
    await expect(main.getByRole("link", { name: title })).toHaveCount(0);
  });
});
