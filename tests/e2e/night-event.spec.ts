import { expect, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { cardOnListing, languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-050-02 and BR-REQ-020-01 (`DECISIONS.md` §394, replacing §382's checkbox) — "Eveniment de
 * noapte", computed from the sunset: a 19:00 group run in November is a night event on the listing
 * card, the event page (in both languages) and the calendar entry without anybody ticking anything,
 * and the editor says so before the save; the same run moved to June is not; "Da" in June is.
 *
 * The owner, 2026-09-25: "«Necesită frontală» ar trebui să fie cumva «eveniment de noapte» setat
 * automat în funcție de ora de start și când apune soarele."
 *
 * It creates and publishes its **own** event, as `partner-marker.spec.ts` does, on a Wednesday
 * evening in a month no other spec uses; the title is unique per project and run. Each change is
 * read on the public page straight after the save, which also proves the public row cache is
 * expired by it (§333).
 */

const NOVEMBER = "2027-11-17";
const MONTH = "2027-11";
const JUNE = "2027-06-16";

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

/** The "Traseul" card's automatic line. */
const autoLine = (page: Page) => page.getByTestId("night-auto-line");

/** Pick one of the three choices in "Traseul", then save — acknowledged once the event is live. */
async function saveWithChoice(page: Page, choice: "Automat (după apus)" | "Da" | "Nu", live: boolean) {
  await openEditorBox(page, "Traseul");
  const radio = page.getByRole("radio", { name: choice, exact: true });
  await expect(radio).toBeVisible();
  // A thumb's target (BR-REQ-041-01 criterion 6): the radio's own box, not only its label.
  expect((await radio.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await radio.check();
  if (live) await page.locator('[name="acknowledgeLiveEdit"]').check();
  await page.getByRole("button", { name: "Salvează", exact: true }).click();
  await page.waitForURL(/saved=event/);
  await hydrated(page);
}

test.describe.serial("BR-REQ-020-01 the night event, from the sunset", () => {
  test("a 19:00 run in November: the create page says «eveniment de noapte» before anything is ticked", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    title = `Noaptea pe Tâmpa ${suffix}`;
    slug = `noaptea-pe-tampa-${suffix}`;
    englishTitle = `Night on the Tâmpa ${suffix}`;
    englishSlug = `night-on-the-tampa-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await openEditorBox(page, "Traseul");
    // No date yet: the line asks for one; "Automat" is the default choice.
    await expect(autoLine(page)).toHaveText(/^Automat: alege data și ora startului/);
    await expect(page.getByRole("radio", { name: "Automat (după apus)", exact: true })).toBeChecked();

    await fillDateField(page, "Începutul evenimentului", NOVEMBER);
    await expect(autoLine(page)).toHaveText(/^Automat: pe mie\., 17 nov\. 2027, apusul la 16:\d\d — alege ora startului$/);
    await fillTimeField(page, "Ora", "19:00");
    await expect(autoLine(page)).toHaveText(/^Automat: pe mie\., 17 nov\. 2027, începe la 19:00, apusul la 16:\d\d — eveniment de noapte$/);

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
    await saveWithChoice(page, "Automat (după apus)", false);

    // The editor's own line, from the stored date, and the closed card's word.
    await openEditorBox(page, "Traseul");
    await expect(autoLine(page)).toHaveText(/— eveniment de noapte$/);
    await expect(page.locator("#box-course > summary")).toContainText("de noapte (automat)");

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the event page carries the pill in both languages, with the torch and the sunset", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    // «Alergare de noapte», not «Eveniment de noapte»: a group run is a run (§394).
    const pill = routeRow(page, "Traseu").locator(".MuiChip-root").filter({ hasText: "Alergare de noapte" });
    await expect(pill).toHaveCount(1);
    await expect(pill.locator(TORCH)).toHaveCount(1);
    await pill.hover();
    // The tooltip says only the sunset (§415): the owner, 2026-09-25, "pe tooltip trebuie doar să
    // zic când apune soarele" — §404's start/end shapes stay on the calendar entry and the .ics.
    await expect(page.getByRole("tooltip")).toHaveText(/^Soarele apune la 16:\d\d$/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto(`/en/events/${englishSlug}`);
    const englishPill = routeRow(page, "Route").locator(".MuiChip-root").filter({ hasText: "Night run" });
    await expect(englishPill).toHaveCount(1);
    await expect(englishPill.locator(TORCH)).toHaveCount(1);
    await englishPill.hover();
    await expect(page.getByRole("tooltip")).toHaveText(/^The sun sets at 16:\d\d$/);
    await expect(page.locator("#main")).not.toContainText("Alergare de noapte");
  });

  test("the listing card and the calendar entry carry it", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const roCard = await cardOnListing(page, title);
    await expect(roCard.locator(".MuiChip-root").filter({ hasText: "Alergare de noapte" })).toHaveCount(1);
    await expect(roCard.locator(TORCH)).toHaveCount(1);
    await page.goto("/en/events");
    const enCard = await cardOnListing(page, englishTitle);
    await expect(enCard.locator(".MuiChip-root").filter({ hasText: "Night run" })).toHaveCount(1);

    await page.goto(`/ro/calendar?month=${MONTH}`);
    await expect(page.locator(`#main [role=table] a[aria-label*="${title}"]`)).toHaveAttribute(
      "aria-label",
      new RegExp(`^19:00 ${title}\\. Alergare de noapte: începe la 19:00, după apusul de la 16:\\d\\d$`),
    );
  });

  test("moved to June, «Automat» says it is not — in the editor as the date is typed, and on the page", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    await openEditorBox(page, "Data și ora");
    await fillDateField(page, "Începutul evenimentului", JUNE);
    await openEditorBox(page, "Traseul");
    await expect(autoLine(page)).toHaveText(/^Automat: pe mie\., 16 iun\. 2027, începe la 19:00, apusul la 21:\d\d — nu e eveniment de noapte$/);
    await saveWithChoice(page, "Automat (după apus)", true);

    await page.goto(`/ro/evenimente/${slug}`);
    await expect(page.locator("#main h1")).toContainText(title);
    await expect(page.locator("#main")).not.toContainText("Alergare de noapte");
    await expect(page.locator(`#main ${TORCH}`)).toHaveCount(0);
    await page.goto(`/en/events/${englishSlug}`);
    await expect(page.locator("#main h1")).toContainText(englishTitle);
    await expect(page.locator("#main")).not.toContainText("Night run");
  });

  test("«Da» in June shows it anyway, and the closed card says «de noapte»", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    await saveWithChoice(page, "Da", true);
    await expect(page.locator("#box-course > summary")).toContainText("de noapte");
    await expect(page.locator("#box-course > summary")).not.toContainText("de noapte (automat)");

    await page.goto(`/ro/evenimente/${slug}`);
    const pill = routeRow(page, "Traseu").locator(".MuiChip-root").filter({ hasText: "Alergare de noapte" });
    await expect(pill).toHaveCount(1);
    await page.goto(`/en/events/${englishSlug}`);
    await expect(routeRow(page, "Route").locator(".MuiChip-root").filter({ hasText: "Night run" })).toHaveCount(1);
  });

  test("a start in daylight that finishes after dusk is a night run too (§394)", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    await openEditorBox(page, "Data și ora");
    // Back to November, light at 16:00 (civil dusk that day is 17:17), but 90 minutes of duration
    // crosses it — a start in daylight that finishes after dusk (§394).
    await fillDateField(page, "Începutul evenimentului", NOVEMBER);
    await fillTimeField(page, "Ora", "16:00");
    await page.locator('[name="event.durationMinutes"]').fill("90");
    await openEditorBox(page, "Traseul");
    await expect(autoLine(page)).toHaveText(/— eveniment de noapte$/);
    // The end is named with its time and its source, «Durata» (§394, review round 3).
    await expect(page.getByTestId("night-end-line")).toHaveText(/alergarea ține până la 17:30 și prinde întunericul/);
    await saveWithChoice(page, "Automat (după apus)", true);

    await page.goto(`/ro/evenimente/${slug}`);
    const pill = routeRow(page, "Traseu").locator(".MuiChip-root").filter({ hasText: "Alergare de noapte" });
    await expect(pill).toHaveCount(1);
    await pill.hover();
    await expect(page.getByRole("tooltip")).toHaveText(/^Soarele apune la 16:\d\d$/);
    await page.goto(`/en/events/${englishSlug}`);
    const englishPill = routeRow(page, "Route").locator(".MuiChip-root").filter({ hasText: "Night run" });
    await englishPill.hover();
    await expect(page.getByRole("tooltip")).toHaveText(/^The sun sets at 16:\d\d$/);
  });
});
