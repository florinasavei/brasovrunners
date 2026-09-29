import { expect, type Locator, type Page, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN (amending §482, §524) — «Pagini» → «Membri» → «Scrie zona membrilor»: the two languages are
 * tabs «RO» | «EN» in the fold, one editor on screen at a time, with «Copiază și tradu tot» above
 * them; the English tab says «nescris încă» while its editor is empty; a save with the Romanian alone
 * is refused naming the English, and the English tab comes forward with the box it names; both
 * languages written, the save goes through. The spec empties the zone at the end (both or neither,
 * §352), so the members' zone reads as it found it.
 *
 * The translation itself needs DeepL's key, which no test environment carries: the press and its
 * fill are `tests/unit/translate/members-zone-press.test.ts`.
 */

async function zoneEditor(page: Page): Promise<Locator> {
  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/pages/members");
  await hydrated(page);
  const card = page.locator("#members-zone");
  await openFold(card.locator("details").first());
  return card;
}

/** Replace what a language's editor holds: its fold opened, the editor clicked, everything selected. */
async function write(card: Locator, suffix: "Ro" | "En", text: string) {
  await openFold(card.locator(`[data-rich-text-fold="zone${suffix}Body"]`));
  await card.locator(`[data-rich-text="zone${suffix}Body"] [data-field]`).click();
  await card.page().keyboard.press("ControlOrMeta+A");
  if (text === "") await card.page().keyboard.press("Delete");
  else await card.page().keyboard.type(text);
}

test.describe.serial("§NNN the members' zone editor: tabs RO | EN", () => {
  test("the two languages are tabs under the translate press, and the Romanian alone is refused on the English tab", async ({ page }) => {
    test.setTimeout(90_000);
    const card = await zoneEditor(page);
    const form = card.getByTestId("members-zone-form");

    // «Copiază și tradu tot» above the tabs, always there (§482) — greyed without the key.
    await expect(form.getByTestId("translate-all")).toBeVisible();
    const roTab = form.getByRole("tab", { name: /^RO/ });
    const enTab = form.getByRole("tab", { name: /^EN/ });
    await expect(roTab).toHaveAttribute("aria-selected", "true");
    await expect(enTab).toBeVisible();
    // The header's flags beside the codes.
    await expect(roTab.locator('img[src="/flags/ro.svg"]')).toHaveCount(1);
    await expect(enTab.locator('img[src="/flags/gb.svg"]')).toHaveCount(1);
    // One editor on screen at a time.
    await expect(form.locator("#members-zone-panel-en")).toBeHidden();

    // The English emptied: its tab says so, as soon as the editor is empty.
    await enTab.click();
    await write(card, "En", "");
    await expect(enTab).toContainText("nescris încă");

    await roTab.click();
    await write(card, "Ro", "Salutare colegii!");
    await expect(form.locator("#members-zone-panel-ro")).toBeVisible();
    await form.getByRole("button", { name: "Salvează" }).click();

    // Refused on the English box (§352), named (§47), and the English tab on top with it.
    await expect(page.getByTestId("form-refusal")).toContainText("Zona membrilor (engleză)", { timeout: 20_000 });
    await expect(enTab).toHaveAttribute("aria-selected", "true");
    await expect(form.locator("#members-zone-panel-en")).toBeVisible();
    await expect(form.locator("#members-zone-panel-ro")).toBeHidden();
  });

  test("both languages written, the save goes through; emptied again, the zone is as it was", async ({ page }) => {
    test.setTimeout(90_000);
    let card = await zoneEditor(page);
    let form = card.getByTestId("members-zone-form");
    await write(card, "Ro", "Salutare colegii!");
    await form.getByRole("tab", { name: /^EN/ }).click();
    await write(card, "En", "Hello, colleagues!");
    await expect(form.getByRole("tab", { name: /^EN/ })).not.toContainText("nescris încă");
    await form.getByRole("button", { name: "Salvează" }).click();
    await expect(page).toHaveURL(/saved=/, { timeout: 20_000 });

    // Neither language: the zone's default words again (§352 allows neither).
    card = await zoneEditor(page);
    form = card.getByTestId("members-zone-form");
    await write(card, "Ro", "");
    await form.getByRole("tab", { name: /^EN/ }).click();
    await write(card, "En", "");
    await form.getByRole("button", { name: "Salvează" }).click();
    await expect(page).toHaveURL(/saved=/, { timeout: 20_000 });
  });
});
