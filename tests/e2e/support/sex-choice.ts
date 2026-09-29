import type { Page } from "@playwright/test";

/**
 * Answers the registration form's «Sex»: two radio cards the server draws, «Masculin» and «Feminin»
 * (§NNN, amending §510), nothing pre-chosen — the browser, the §422 list and the server refuse a
 * form without an answer. Real `<input type="radio" name="sex">`, so the answer is chosen by its
 * value, the same in either language, and it answers without JavaScript.
 */
export async function chooseSex(page: Page, value: "FEMALE" | "MALE" = "FEMALE") {
  await page.locator(`input[type="radio"][name="sex"][value="${value}"]`).check();
}
