import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * `DECISIONS.md` §NNN — the owner, 2026-09-25: "by default toate evenimentele sunt gratuite".
 * The create page's cost select preselects "Gratuit"; a save that never opens "Participare și
 * înscrieri" still writes it, and the public page reads "Gratuit" without anyone having touched
 * the cost box at all.
 */
test.describe("a new event starts free (§NNN)", () => {
  test("the create page shows Gratuit selected, and the explainer fold is closed at 320px", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    // The cost select reads "Gratuit" before anyone opens the box or touches it.
    await openEditorBox(page, "Participare și înscrieri");
    await expect(page.getByRole("combobox", { name: "Cost" })).toHaveText(/Gratuit/);
    // The amount and link boxes stay hidden under Gratuit.
    await expect(page.locator('[name="event.costAmount"]')).toBeHidden();
    await expect(page.locator('[name="event.costUrl"]')).toBeHidden();

    // "Ce înseamnă fiecare tip?" is a small closed line, not a card, and it opens on demand.
    const help = page.getByText("Ce înseamnă fiecare tip?", { exact: true }).locator("xpath=ancestor::details[1]");
    await expect(help).toBeVisible();
    expect(await help.getAttribute("open")).toBeNull();
    await help.locator(":scope > summary").click();
    await expect(help).toHaveAttribute("open", "");
    await expect(page.getByText(/La o alergare de grup se vine pur și simplu/)).toBeVisible();
    // It closes again on a second click — a real toggle, not a one-way reveal.
    await help.locator(":scope > summary").click();
    await expect(help).not.toHaveAttribute("open");
  });

  test("a save that never opens the cost box still stores FREE, read as Gratuit on /ro and /en", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `alergare-gratuita-${suffix}`;
    const englishSlug = `free-run-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    const field = (name: string) => page.locator(`[name="${name}"]`);
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await fillDateField(page, "Începutul evenimentului", "2027-05-09");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Alergare gratuită ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await excerpt("ro", "O alergare fără nicio taxă.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Free run ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await excerpt("en", "A run with no cost at all.");

    // "Participare și înscrieri" is never opened — the cost box included.
    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page, "Creezi și publici evenimentul?");
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);

    await page.goto(`/ro/evenimente/${slug}`);
    const cost = page.locator("dt", { hasText: /^Cost$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(cost.locator(".MuiChip-root")).toHaveText("Gratuit");

    await page.goto(`/en/events/${englishSlug}`);
    const costEn = page.locator("dt", { hasText: /^Cost$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(costEn.locator(".MuiChip-root")).toHaveText("Free");
  });
});
