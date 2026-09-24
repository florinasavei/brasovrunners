import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languageTab, openEditorBox } from "./support/fold";

/**
 * §354, bilingual everywhere — "Textul în engleză e identic cu cel în română — e tradus?". The
 * case live on production: the English "Happy Monday" date carries the Romanian description in
 * its English box. Here with "Ce să aduci", a plain box a person types into like any other:
 *
 *   - typed the same in both languages on the create page, the box says so in amber, the English
 *     tab wears the mark, and the Publicare box lists it — while the create button still works:
 *     a warning, never a refusal;
 *   - on the editor, from what was saved, the Publicare box lists it again, linked to the English
 *     box, and the closed line of the box names it;
 *   - translated, the warning goes, as it is typed.
 *
 * Each Playwright project makes its own event, so the two never share a row.
 */
test("the same long text in both languages is a warning in the box, on the tab and before publication — never a refusal", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const field = (name: string) => page.locator(`[name="${name}"]`);
  const pasted = "Frontală, apă și o geacă de ploaie pentru coborârea de pe Tâmpa.";
  const day = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  await fillDateField(page, "Începutul evenimentului", day);
  await fillTimeField(page, "Ora", "18:30");
  await field("event.locationName").fill(`Telecabina Tâmpa ${suffix}`);
  // A place's name may be the same in both languages (§362): one press fills the empty English box.
  await page.getByTestId("place-copy-to-english").click();
  await expect(field("event.locationNameEn")).toHaveValue(`Telecabina Tâmpa ${suffix}`);
  await field("translations.ro.title").fill(`Happy Monday ${suffix}`);
  await field("translations.ro.slug").fill(`happy-monday-${suffix}`);
  await languageTab(page, "title", "en").click();
  await field("translations.en.title").fill(`Happy Monday ${suffix}`);
  await languageTab(page, "address", "en").click();
  await field("translations.en.slug").fill(`happy-monday-en-${suffix}`);

  // What to bring, the Romanian pasted into the English box.
  const programme = await openEditorBox(page, "Programul zilei și ce să aduci");
  await field("translations.ro.checklist").fill(pasted);
  await languageTab(page, "programme", "en").click();
  await field("translations.en.checklist").fill(pasted);
  await expect(page.getByTestId("programme-identical")).toBeVisible();
  await expect(languageTab(page, "programme", "en")).toContainText("identic cu româna");
  // Two identical titles are a name, and a name may be the same in both: no warning there.
  await expect(page.getByTestId("title-identical")).toHaveCount(0);

  // The Publicare box lists it, live, as something to check — not as something missing.
  await openEditorBox(page, "Publicare");
  const listed = page.getByTestId("identical-texts");
  await expect(listed).toContainText("Programul zilei și ce să aduci › English");
  await expect(programme).toBeVisible();

  // And the create goes through: it is a warning.
  await page.getByRole("button", { name: "Creează evenimentul" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await hydrated(page);

  // On the editor, from what was saved: listed before publication, linked to the English box…
  const saved = page.getByTestId("identical-texts");
  await expect(saved).toContainText("Programul zilei și ce să aduci › English");
  await expect(saved.getByRole("link")).toHaveAttribute("href", "#field-translations.en.checklist");
  // …named on the box's closed line, and marked on the English tab.
  const box = await openEditorBox(page, "Programul zilei și ce să aduci");
  await expect(box.locator(":scope > summary")).toContainText("EN identic cu RO");
  await expect(languageTab(page, "programme", "en")).toContainText("identic cu româna");

  // Translated: the warning goes as it is typed.
  await languageTab(page, "programme", "en").click();
  await field("translations.en.checklist").fill("A head torch, water and a rain jacket for the way down Tâmpa.");
  await expect(page.getByTestId("programme-identical")).toHaveCount(0);
  await expect(languageTab(page, "programme", "en")).not.toContainText("identic cu româna");
});
