import type { Page } from "@playwright/test";

/**
 * Answers the registration form's «Sex»: a dropdown again (§NNN, amending §554), «Feminin» first and
 * «Masculin» second behind an empty «Alege…», nothing pre-chosen — the browser, the §422 list and the
 * server refuse a form without an answer. What posts is a native `<select name="sex">` the server
 * draws, so the answer is chosen by its value, the same in either language, with JavaScript or
 * without; the island's glyph list writes into the same select.
 */
export async function chooseSex(page: Page, value: "FEMALE" | "MALE" = "FEMALE") {
  await page.locator('select[name="sex"]').selectOption(value);
}
