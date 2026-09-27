import type { Page } from "@playwright/test";

/**
 * Answers the registration form's «Sex», which starts empty (§NNN): pre-chosen on «Prefer să nu
 * spun», it recorded an answer nobody gave, so the browser, the §422 list and the server now
 * refuse a form without one. A MUI select — a hidden input and a listbox — so it is pressed and
 * the option chosen by its value, the same in either language.
 */
export async function chooseSex(page: Page, value: "FEMALE" | "MALE" | "UNSPECIFIED" = "UNSPECIFIED") {
  await page.locator("#f-sex").click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}
