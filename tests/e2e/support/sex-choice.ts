import type { Page } from "@playwright/test";

/**
 * Answers the registration form's «Sex», which starts on an empty «Alege…» (§NNN): pre-chosen on
 * «Prefer să nu spun», it recorded an answer nobody gave, so the browser, the §422 list and the
 * server now refuse a form without one. A native `<select name="sex">` the server draws — it
 * answers without JavaScript — so the option is chosen by its value, the same in either language.
 */
export async function chooseSex(page: Page, value: "FEMALE" | "MALE" | "UNSPECIFIED" = "UNSPECIFIED") {
  await page.locator('select[name="sex"]').selectOption(value);
}
