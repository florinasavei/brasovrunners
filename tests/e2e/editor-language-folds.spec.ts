import { expect, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";
import { expectBarGlyphsVisible, floatingBar } from "./support/floating-bar";
import { languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * §363 — a fold inside a language tab keeps its state when the tab changes (the owner,
 * 2026-09-24: "I would like to keep the expand/collapsed state while changing the language tab in
 * the event editor").
 *
 * The description's fold opened in Română is open in English; closed in English, it is closed in
 * Română. The English editor mounts when its tab comes forward. Closing a fold no longer throws
 * away what was typed inside it: the editor stays, hidden by the fold, and the form still posts
 * the typed document. And the bar over a selection in the description — where the owner saw three
 * empty buttons — shows its glyphs over the toolbar.
 *
 * On the create page, which saves nothing: the spec needs no event of its own.
 */
test("a fold opened in one language is open in the other, and closed in both", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);

  const fold = (locale: "ro" | "en") => page.locator(`[data-rich-text-fold="translations.${locale}.body"]`);
  const editor = (locale: "ro" | "en") => page.locator(`[data-rich-text="translations.${locale}.body"]`);

  await openEditorBox(page, "Descrierea evenimentului");
  await expect(fold("ro")).not.toHaveAttribute("open");
  await openFold(fold("ro"));

  const typed = "Alergăm împreună prin Brașov, în fiecare duminică.";
  await editor("ro").locator("[data-field]").click();
  await page.keyboard.type(typed);

  // The bar over a word of the first line: the one the owner saw empty.
  await editor("ro").locator(".tiptap p").first().dblclick({ position: { x: 8, y: 8 } });
  await expectBarGlyphsVisible(floatingBar(editor("ro"), "selection"));

  // English: the same fold, open, and its editor mounted now that it can be seen.
  await languageTab(page, "description", "en").click();
  await expect(fold("en")).toHaveAttribute("open", "");
  await expect(editor("en").locator("[data-field]")).toBeVisible();

  // Closed in English…
  await fold("en").locator(":scope > summary").press("Enter");
  await expect(fold("en")).not.toHaveAttribute("open");

  // …is closed in Română, and what was typed there is still what the form posts.
  await languageTab(page, "description", "ro").click();
  await expect(fold("ro")).not.toHaveAttribute("open");
  await expect(page.locator('input[type="hidden"][name="translations.ro.body"]')).toHaveValue(/Alergăm împreună prin Brașov/);

  // Opened again, the text is where it was.
  await openFold(fold("ro"));
  await expect(editor("ro").locator(".tiptap")).toContainText(typed);
  await languageTab(page, "description", "en").click();
  await expect(fold("en")).toHaveAttribute("open", "");
});
