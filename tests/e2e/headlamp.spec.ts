import { expect, type Page, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-050-02 and BR-REQ-020-01 (`DECISIONS.md` §NNN) — "Necesită frontală", ticked in the
 * editor, is a pill on the listing card and the event page in both languages, a line in the
 * calendar entry; unticked, it is gone from all of them.
 *
 * The owner, 2026-09-25: "I need an extra checkmark on the event editor and a headlamp icon for
 * the events that require a headlamp (e.g. the Wednesday 'Running up that hill' event during
 * autumn, winter and spring, as it is already dark at 19:00 when it starts)."
 *
 * It creates and publishes its **own** event, as `partner-marker.spec.ts` does, on a Wednesday
 * evening in a month no other spec uses; the title is unique per project and run. The unticking
 * at the end also proves the public row cache is expired by the save (§333): the page is read
 * again straight after it and must not show the pill.
 */

const DATE = "2027-03-10";
const MONTH = "2027-03";

/**
 * The lit torch, by its drawing: a production build has no `data-testid="FlashlightOnIcon"` — MUI
 * writes that attribute only outside production — so the glyph is found by the start of its path,
 * `@mui/icons-material/FlashlightOn`'s own.
 */
const TORCH = 'svg:has(path[d^="M6 2h12v3H6z"])';

let title = "";
let englishTitle = "";
let slug = "";
let englishSlug = "";
let editorUrl = "";

/** The event page's "Traseu" / "Route" row, the `<dd>` after its label. */
const routeRow = (page: Page, label: string) => page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

/** The listing card with this title, every fold opened once the list has streamed in (§166). */
async function card(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.locator("#main ul > li h2").first()).toBeAttached();
  await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
  return page.locator("li").filter({ has: page.getByRole("heading", { name: heading }) });
}

/** The "Traseul" card's checkbox, set to `on`, then the save — acknowledged once the event is live. */
async function setHeadlamp(page: Page, on: boolean, live: boolean) {
  await openEditorBox(page, "Traseul");
  const box = page.getByRole("checkbox", { name: "Necesită frontală" });
  await expect(box).toBeVisible();
  // A thumb's target (BR-REQ-041-01 criterion 6): the checkbox's own box, not only its label.
  expect((await box.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("Se arată pe card, pe pagina evenimentului și în calendar.")).toBeVisible();
  if (on) await box.check();
  else await box.uncheck();
  if (live) await page.locator('[name="acknowledgeLiveEdit"]').check();
  await page.getByRole("button", { name: "Salvează", exact: true }).click();
  await page.waitForURL(/saved=event/);
}

test.describe.serial("BR-REQ-020-01 the headlamp pill", () => {
  test("an evening run is created, marked «Necesită frontală» in the editor, and published", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    title = `Running up that hill ${suffix}`;
    slug = `running-up-that-hill-${suffix}`;
    englishTitle = `Running up that hill EN ${suffix}`;
    englishSlug = `running-up-that-hill-en-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await fillDateField(page, "Începutul evenimentului", DATE);
    await fillTimeField(page, "Ora", "19:00");
    await field("event.locationName").fill("Stația de telecabină Tâmpa");
    await field("event.locationNameEn").fill("Tâmpa cable car station");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(englishTitle);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    editorUrl = page.url().split("?")[0];
    await hydrated(page);

    // Publication counts the short description in both languages (`AGENTS.md` §11.2).
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Urcăm pe Tâmpa, pe întuneric.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "Up the Tâmpa, in the dark.");
    await setHeadlamp(page, true, false);

    // The box says it while shut, and the tick comes back checked.
    await hydrated(page);
    await openEditorBox(page, "Traseul");
    await expect(page.getByRole("checkbox", { name: "Necesită frontală" })).toBeChecked();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the event page carries the pill in both languages, with its glyph", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    const pill = routeRow(page, "Traseu").locator(".MuiChip-root").filter({ hasText: "Frontală" });
    await expect(pill).toHaveCount(1);
    await expect(pill.locator(TORCH)).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto(`/en/events/${englishSlug}`);
    const englishPill = routeRow(page, "Route").locator(".MuiChip-root").filter({ hasText: "Headlamp" });
    await expect(englishPill).toHaveCount(1);
    await expect(englishPill.locator(TORCH)).toHaveCount(1);
    await expect(page.locator("#main")).not.toContainText("Frontală");
  });

  test("the listing card carries the pill in both languages", async ({ page }) => {
    const roCard = await card(page, "/ro/evenimente", title);
    await expect(roCard.locator(".MuiChip-root").filter({ hasText: "Frontală" })).toHaveCount(1);
    await expect(roCard.locator(TORCH)).toHaveCount(1);

    const enCard = await card(page, "/en/events", englishTitle);
    await expect(enCard.locator(".MuiChip-root").filter({ hasText: "Headlamp" })).toHaveCount(1);
    await expect(enCard).not.toContainText("Frontală");
  });

  test("the calendar entry names it after the place", async ({ page }) => {
    await page.goto(`/ro/calendar?month=${MONTH}`);
    const entry = page.locator(`#main [role=table] a[aria-label*="${title}"]`);
    await expect(entry).toHaveAttribute("aria-label", `19:00 ${title}. Frontală necesară`);
    await page.goto(`/en/calendar?month=${MONTH}`);
    await expect(page.locator(`#main [role=table] a[aria-label*="${englishTitle}"]`)).toHaveAttribute("aria-label", `19:00 ${englishTitle}. Headlamp required`);
  });

  test("unticked in the editor, it is gone from the page, the card and the calendar", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    await setHeadlamp(page, false, true);

    await page.goto(`/ro/evenimente/${slug}`);
    await expect(page.locator("#main h1")).toContainText(title);
    await expect(page.locator("#main")).not.toContainText("Frontală");
    await expect(page.locator(`#main ${TORCH}`)).toHaveCount(0);

    await page.goto(`/en/events/${englishSlug}`);
    await expect(page.locator("#main h1")).toContainText(englishTitle);
    await expect(page.locator("#main")).not.toContainText("Headlamp");

    const roCard = await card(page, "/ro/evenimente", title);
    await expect(roCard).toHaveCount(1);
    await expect(roCard).not.toContainText("Frontală");
    await expect(roCard.locator(TORCH)).toHaveCount(0);

    await page.goto(`/ro/calendar?month=${MONTH}`);
    await expect(page.locator(`#main [role=table] a[aria-label*="${title}"]`)).toHaveAttribute("aria-label", `19:00 ${title}`);
  });
});
