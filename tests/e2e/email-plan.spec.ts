import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-080-02 criterion 7 (`DECISIONS.md` §100) — the Mailgun plan is set from the
 * backoffice and the counters follow it. One round trip: Free → Basic → Free, reading the
 * sentence above the form each time, because the sentence is the whole point of the setting.
 */
test.describe("BR-REQ-080-02 the Mailgun plan on /admin/emails", () => {
  test("an Administrator sets the plan and the counter changes period", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");

    await expect(main.getByRole("heading", { name: "Planul Mailgun și cât mai putem trimite" })).toBeVisible();
    // The default: Free, counted by the day.
    await expect(main.getByText(/Planul Free: \d+ din 100 mesaje trimise azi/)).toBeVisible();

    await main.getByLabel("Planul pe care e contul Mailgun").selectOption("BASIC");
    await main.getByLabel("Notă (de ce, până când)").fill("Basic pentru cursa din octombrie");
    await main.getByRole("button", { name: "Salvează planul" }).click();

    await expect(main.getByText("Planul a fost salvat", { exact: false })).toBeVisible();
    await expect(main.getByText(/Planul Basic: \d+ din 10\.000 mesaje trimise luna aceasta/)).toBeVisible();
    await expect(main.getByText(/Notă: Basic pentru cursa din octombrie/)).toBeVisible();

    // And back, so the next test on this database starts from the default.
    await main.getByLabel("Planul pe care e contul Mailgun").selectOption("FREE");
    await main.getByRole("button", { name: "Salvează planul" }).click();
    await expect(main.getByText(/Planul Free: \d+ din 100 mesaje trimise azi/)).toBeVisible();
  });

  test("a Moderator does not get the page's form to act on", async ({ page }) => {
    // BR-REQ-060-01: the page is readable by every staff role (the messages are), the action
    // is not — the service refuses a Moderator and the page shows the refusal as a sentence.
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");
    await main.getByLabel("Planul pe care e contul Mailgun").selectOption("BASIC");
    await main.getByRole("button", { name: "Salvează planul" }).click();
    await expect(page.locator("#admin-alert").getByRole("alert")).toBeVisible();
    await expect(main.getByText(/Planul Free: \d+ din 100 mesaje trimise azi/)).toBeVisible();
  });
});
