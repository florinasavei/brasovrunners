import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-060-01 criteria 8 and 34 — the guide, task by task (§NNN).
 *
 * The owner, leaving the backoffice to two colleagues for two weeks: the guide is "every task as
 * numbered steps with the exact button words". So a section is a list of jobs, each folded to its
 * title; one press opens that job's numbered steps, and the words a reader must find on the
 * screen are drawn bold. The reader's own role's sections come first and open (§103).
 */

/** The guide's sections: the folds that hold jobs, in the order the page draws them. */
function sections(page: Page) {
  return page.locator("#main details").filter({ has: page.getByTestId("guide-task") });
}

async function sectionTitles(page: Page): Promise<string[]> {
  return sections(page)
    .locator(":scope > summary")
    .evaluateAll((summaries) => summaries.map((summary) => (summary.firstChild?.textContent ?? "").trim()));
}

test.describe("BR-REQ-060-01 criteria 8 and 34 the guide, task by task", () => {
  test("an Organizer reads their own sections first, and a job opens to numbered steps with the screen's words in bold", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/guide");

    const titles = await sectionTitles(page);
    // Everyone's first steps, the desk, then the Organizer's own jobs — before any colleague's.
    expect(titles.slice(0, 3)).toEqual(["Primii pași", "Ziua cursei — masa de ridicare a numerelor", "Organizator — înscrieri, numere, mesaje"]);
    expect(titles.indexOf("Administrator — evenimente, înscrieri, emailuri")).toBeGreaterThan(2);

    const own = sections(page).filter({ hasText: "Organizator — înscrieri, numere, mesaje" });
    await expect(own).toHaveAttribute("open", "");
    await expect(sections(page).filter({ hasText: "Administrator — evenimente, înscrieri, emailuri" })).not.toHaveAttribute("open", "");

    // A job, folded to its title until pressed.
    const job = own.getByTestId("guide-task").filter({ hasText: "Descarcă și tipărește numerele de concurs" });
    const summary = job.locator(":scope > summary");
    const steps = job.locator("ol > li");
    await expect(steps.first()).toBeHidden();
    // A thumb's target (BR-REQ-041-01 criterion 6), rounded to a tenth of a pixel.
    expect(Math.round(((await summary.boundingBox())?.height ?? 0) * 10) / 10).toBeGreaterThanOrEqual(44);
    await summary.click();
    await expect(steps.first()).toBeVisible();
    expect(await steps.count()).toBeGreaterThanOrEqual(5);
    // The button's own words, bold, as the screen says them.
    await expect(job.locator("strong", { hasText: "«Descarcă toate numerele (PDF)»" })).toBeVisible();
    await expect(job.locator("strong", { hasText: "«Câte unul pe pagină»" })).toBeVisible();
  });

  test("a volunteer reads the first steps and the desk, and the colleagues' sections stay folded", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    await page.goto("/ro/admin/guide");

    const titles = await sectionTitles(page);
    expect(titles.slice(0, 2)).toEqual(["Primii pași", "Ziua cursei — masa de ridicare a numerelor"]);
    const desk = sections(page).filter({ hasText: "Ziua cursei — masa de ridicare a numerelor" });
    await expect(desk).toHaveAttribute("open", "");
    await expect(sections(page).filter({ hasText: "Organizator — înscrieri, numere, mesaje" })).not.toHaveAttribute("open", "");

    const job = desk.getByTestId("guide-task").filter({ hasText: "Nu și-a semnat declarația" });
    await job.locator(":scope > summary").click();
    await expect(job.locator("strong", { hasText: "«Confirmă pe hârtie»" }).first()).toBeVisible();
  });
});
