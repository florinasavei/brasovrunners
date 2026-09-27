import { expect, type Locator, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §525 — «Întrebări frecvente»: an Administrator writes a question on the page's one form — the
 * question, its «Categorie» and its answer in both languages, «Pe site» ticked, one save that asks
 * first — and a visitor reads it at `/ro/intrebari`: under its category heading, a fold closed
 * until pressed, with its glyph, opened by a link's `#q-…`, and no sideways scroll at 320 px (the
 * mobile project's width). The spec deletes its own question at the end, so the menu and the
 * footer are as it found them; the page's own switch is left published.
 *
 * Serial: the three parts act on the one question the first writes.
 */

let question = "";
let category = "";

/** Type into a card's rich-text answer: open its fold, click into the editor, type. */
async function writeAnswer(card: Locator, suffix: "Ro" | "En", text: string) {
  await openFold(card.locator(`[data-rich-text-fold$=".answer${suffix}Body"]`));
  await card.locator(`[data-rich-text$=".answer${suffix}Body"] [data-field]`).click();
  await card.page().keyboard.type(text);
}

async function faqEditor(page: Page) {
  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/pages/faq");
  await hydrated(page);
}

test.describe.serial("§525 the FAQ page", () => {
  test("an Administrator writes a question in both languages and puts it on the site in the page's one save", async ({ page }) => {
    test.setTimeout(90_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    question = `Ce aduc la prima alergare ${suffix}?`;
    category = `Prima dată ${suffix}`;
    await faqEditor(page);

    // The page's own switch, once: publishing asks first (§384).
    const publish = page.locator("#faq-page").getByRole("button", { name: "Publică pagina" });
    if (await publish.isVisible()) {
      await publish.click();
      await confirmDialog(page, /Publici pagina/);
      await expect(page).toHaveURL(/saved=faqPagePublished/, { timeout: 20_000 });
      // A fresh load of the editor: the redirect's page must not be re-rendering under the typing.
      await page.goto("/ro/admin/pages/faq");
      await hydrated(page);
    }

    // One «Copiază și tradu tot» for the whole page, never one per card (§482).
    await expect(page.getByTestId("faq-page-form").getByTestId("translate-all")).toHaveCount(1);

    const card = page.locator("#faq-new");
    await openFold(card);
    await card.locator('[name$=".questionRo"]').fill(question);
    await card.locator('[name$=".categoryRo"]').fill(category);
    await writeAnswer(card, "Ro", "Apă, o frontală și chef de alergat.");

    await card.getByRole("tab", { name: /English/ }).click();
    await card.locator('[name$=".questionEn"]').fill(`What do I bring to my first run ${suffix}?`);
    await card.locator('[name$=".categoryEn"]').fill(`First time ${suffix}`);
    await writeAnswer(card, "En", "Water, a headlamp and the will to run.");

    await card.getByTestId("faq-visible").check();
    await page.getByRole("button", { name: "Salvează pagina" }).click();
    await confirmDialog(page, /Pui pe site/);
    await expect(page).toHaveURL(/saved=faqPageSaved/, { timeout: 20_000 });
    await expect(page.getByTestId("faq-card").filter({ hasText: question })).toHaveCount(1);
  });

  test("a visitor reads it under its category, opens its fold, and a link's #q-… opens it by itself", async ({ page }) => {
    expect(question, "the first part wrote the question").not.toBe("");
    await page.goto("/ro/intrebari");
    await expect(page.getByRole("heading", { level: 1, name: "Întrebări frecvente" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: category })).toBeVisible();

    const fold = page.locator("details").filter({ has: page.locator("summary", { hasText: question }) });
    await expect(fold).toHaveCount(1);
    await expect(fold).not.toHaveAttribute("open", "");
    // The fold header wears its glyph.
    await expect(fold.locator(":scope > summary").getByTestId("faq-glyph")).toBeAttached();
    await fold.locator(":scope > summary").click();
    await expect(fold).toHaveAttribute("open", "");
    await expect(fold.getByTestId("faq-answer")).toContainText("o frontală");

    // No sideways scroll, at the mobile project's 320 px as on the desktop.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const id = await fold.getAttribute("id");
    expect(id).toMatch(/^q-[0-9a-f]{8}$/);
    await page.goto(`/ro/intrebari#${id}`);
    await expect(page.locator(`details#${id}`)).toHaveAttribute("open", "", { timeout: 10_000 });
  });

  test("the Administrator deletes the question in the same one save, asked first", async ({ page }) => {
    expect(question, "the first part wrote the question").not.toBe("");
    await faqEditor(page);
    let card = page.getByTestId("faq-card").filter({ hasText: question });

    // Enter in a box is the plain save — the form's hidden default button — never a card's arrow.
    const titles = async () =>
      page.locator('[data-testid="faq-card"] input[name$=".questionRo"]').evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).value));
    const order = await titles();
    await openFold(card);
    await card.locator('[name$=".questionRo"]').press("Enter");
    await expect(page).toHaveURL(/saved=faqPageSaved/, { timeout: 20_000 });
    await hydrated(page);
    expect(await titles()).toEqual(order);

    card = page.getByTestId("faq-card").filter({ hasText: question });
    await openFold(card);
    await card.getByTestId("faq-remove").check();
    await page.getByRole("button", { name: "Salvează pagina" }).click();
    await confirmDialog(page, /Ștergi întrebarea/);
    await expect(page).toHaveURL(/saved=faqPageSaved/, { timeout: 20_000 });
    await expect(page.getByTestId("faq-card").filter({ hasText: question })).toHaveCount(0);
  });
});
