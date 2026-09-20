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
    // Criterion 8: and the figure says whose allowance it is — one account, two deployments.
    await expect(main.getByText(/un singur cont Mailgun/)).toBeVisible();

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

/**
 * BR-REQ-070-04 criterion 9 (`DECISIONS.md` §164) — who reads what the contact form sends is
 * set on the same page, and the sentence above the boxes says where the list in force comes
 * from. Its own block rather than the plan's, because it is its own requirement.
 *
 * One project only. `platform_settings.contactRecipients` is a single row shared by the whole
 * deployment, and `fullyParallel` runs this file in both the mobile and the desktop project
 * against one server: two workers writing the one row would each read the other's address.
 * Nothing here is viewport-shaped — it is a backoffice form, and the phone-width rule
 * (BR-REQ-041-01 criterion 8) is about the participant's journey, which `contact.spec.ts`
 * walks on both.
 */
test.describe("BR-REQ-070-04 who receives the contact messages", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  // Set and cleared again, so the next test on this database starts from the environment's list.
  test("an Administrator sets who receives the contact messages, with a Cc", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");

    await expect(main.getByRole("heading", { name: "Cine primește mesajele de contact" })).toBeVisible();

    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("club@example.com");
    await main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)").fill("amalia@example.org");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();

    await expect(main.getByText("Destinatarii formularului de contact au fost salvați.")).toBeVisible();
    await expect(main.getByText(/Acum ajung la: club@example\.com\. Copie: amalia@example\.org/)).toBeVisible();
    // What was saved is what the boxes show on the way back — the whole point of a setting.
    await expect(main.getByLabel("Către (adrese despărțite prin virgulă)")).toHaveValue("club@example.com");
    await expect(main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)")).toHaveValue("amalia@example.org");

    // An address that is not one is refused, and nothing of it is kept.
    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("nope");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await expect(page.locator("#admin-alert").getByRole("alert")).toBeVisible();
    await expect(main.getByText(/Acum ajung la: club@example\.com/)).toBeVisible();

    // And back to nobody in the app, which hands the question to `CONTACT_FORM_TO`: this
    // deployment sets none, so the page says so — a machine that sets one reads the other
    // half of the sentence, and both are the same answer to "the boxes are empty now".
    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("");
    await main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)").fill("");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await expect(main.getByText(/Nu le primește nimeni|din variabila CONTACT_FORM_TO/)).toBeVisible();
  });
});
