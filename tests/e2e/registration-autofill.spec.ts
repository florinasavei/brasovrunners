import { expect, test, type Page } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §282 — what a password manager does to this form, and what a person refused by
 * the anti-bot check is shown.
 *
 * The owner, 2026-09-22: "we need to test with auto-fill properly", "I want clear visual feedback
 * when people are not let through", and "I also want to give real people the option to fix it."
 * The three are one journey, and only a browser can prove it.
 *
 * Playwright cannot ask Chrome to run its own autofill, so these do what autofill does: put a
 * value into every input the page has, including the offscreen trap the person never sees. That
 * is the whole of the behaviour under test — a browser filling a field the form hid.
 */
const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

async function fillRequired(page: Page, email: string) {
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName: "Popescu",
    email,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`[name="${name}"]`).fill(value);
  }
  await page.locator('[name="emailConfirm"]').fill(email);
  await page.locator('[name="privacyAcknowledged"]').check();
  await page.locator('[name="rulesAcknowledged"]').check();
  await page.locator('[name="fitnessDeclared"]').check();
}

/** What a password manager does: write into the hidden field as if it were a real one. */
async function autofillTheTrap(page: Page, value: string) {
  await page.locator('[name="honeypot"]').evaluate((element, text) => {
    (element as HTMLInputElement).value = text as string;
  }, value);
}

const address = () => `e2e-autofill-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;

test.describe("§282 a browser that fills the hidden field does not cost the club an entrant", () => {
  test("accepts a registration whose trap the browser filled with the runner's own address", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const email = address();
    await fillRequired(page, email);
    // Exactly what Chrome does with a saved identity: the address goes into every field it
    // believes is an address field, and the trap is one of them.
    await autofillTheTrap(page, email);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    // Through, first time: the value in the trap is the person's own, which no bot would put
    // there. No refusal, and the confirmation page rather than the form again.
    await expect(page).toHaveURL(/submitted=/);
    await expect(page.getByText(/Mai încearcă o dată/)).toHaveCount(0);
  });

  test("refuses a trap filled with somebody else's spam, says so, and lets the second press through", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const email = address();
    await fillRequired(page, email);
    await autofillTheTrap(page, "https://cheap-seo.example");
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    /*
      The visual feedback (§282). Everything a person needs at this moment, where the browser
      lands them: that they were taken for a robot, that nothing was registered, that no email is
      coming — the promise §217 forbids making falsely — and a button right there.
    */
    const summary = page.locator("#registration-errors");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Mai încearcă o dată");
    await expect(summary).toContainText(/nu ți-am trimis niciun email/i);
    const again = summary.getByRole("button", { name: "Trimite din nou înscrierea" });
    await expect(again).toBeVisible();

    // And the way out: pressing it goes through, even though the trap is still filled — which is
    // what a password manager would do on every render.
    await autofillTheTrap(page, "https://cheap-seo.example");
    await again.click();
    await expect(page).toHaveURL(/submitted=/);
  });

  test("the way out is a real target on a phone", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page, address());
    await autofillTheTrap(page, "https://cheap-seo.example");
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    const again = page.locator("#registration-errors").getByRole("button", { name: "Trimite din nou înscrierea" });
    const box = await again.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
