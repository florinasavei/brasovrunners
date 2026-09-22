import { expect, test } from "@playwright/test";
import { signIn, hydrated } from "./support/featured-event";

/**
 * BR-REQ-080-02 criterion 7 (`DECISIONS.md` §100) — the Mailgun plan is set from the
 * backoffice and the counters follow it. One round trip: Free → Basic → Free, reading the
 * sentence above the form each time, because the sentence is the whole point of the setting.
 */
test.describe("BR-REQ-080-02 the Mailgun plan on /admin/emails", () => {
  // One `platform_settings` row, two projects against one database: run these on desktop only,
  // as the contact-recipients block below already does, or the two runs overwrite each other's
  // plan mid-assertion.
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("an Administrator sets the plan and the counter changes period", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");

    await expect(main.getByRole("heading", { name: "Planul Mailgun și cât mai putem trimite" })).toBeVisible();
    // The default: Free, counted by the day.
    await expect(main.getByText(/Planul Free: \d+ din 100 mesaje trimise azi/)).toBeVisible();
    // Criterion 8: and the figure says whose allowance it is — one account, two deployments.
    await expect(main.getByText(/unui singur cont Mailgun/)).toBeVisible();

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

  test("an Organizer reads the figures and the queue, and is offered no form (§291)", async ({ page }) => {
    /*
      BR-REQ-060-01, `DECISIONS.md` §291. This test used to press "Salvează planul" as a
      Moderator and assert the refusal arrived as a sentence — which was the defect, not the
      behaviour: the owner met "Salvează planul" and "Salvează destinatarii" drawn for an
      Organizer who could only be told FORBIDDEN ("organizatorul nu ar trebui sa poata edita cine
      primeste mesajele"). Reading and changing are two questions (§208, §289): the Organizer
      reads the plan's figures, the queue and the club's copies, and no verb is drawn for them.
    */
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");

    // The figures, whichever plan the shared settings row is on when this test runs.
    await expect(main.getByText(/^Planul (Free|Basic|Foundation|Scale)/)).toBeVisible();
    await expect(main.getByText("Planul îl schimbă Administratorul", { exact: false })).toBeVisible();
    await expect(main.getByRole("button", { name: "Salvează planul" })).toHaveCount(0);
    await expect(main.getByLabel("Planul pe care e contul Mailgun")).toHaveCount(0);

    // The queue and the club's copies are participant data, read by whoever reads the
    // registrations (§289) — so the Organizer has them now, where a Moderator had neither.
    await expect(main.getByRole("heading", { name: "Coada de trimitere" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Trimite acum", exact: false })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Copiile clubului" })).toBeVisible();
    await expect(main.getByRole("button", { name: /Salvează/ })).toHaveCount(0);

    // And the contact recipients: the list in force, and nothing to change it with — the hidden
    // copies included (2026-09-22): the Organizer reads them, and only the Administrator sets them.
    await expect(main.getByRole("heading", { name: "Cine primește mesajele de contact" })).toBeVisible();
    await expect(main.getByText("Cine primește mesajele de contact stabilește Administratorul", { exact: false })).toBeVisible();
    await expect(main.getByText(/Copie ascunsă:/)).toBeVisible();
    await expect(main.getByLabel("Către (adrese despărțite prin virgulă)")).toHaveCount(0);
    await expect(main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)")).toHaveCount(0);
    await expect(main.getByLabel("Copie ascunsă la emailurile către participanți (Bcc)")).toHaveCount(0);
  });

  test("a Redactor reads the figures and neither the queue nor the club's copies", async ({ page }) => {
    // The other side of the §289 line: the queue names recipients and the copies name the
    // club's addresses for a participant's signed declaration — participant data both, so the
    // Redactor (who may not read the registrations) is shown the plan's figures and the words,
    // and nothing that names a person.
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");

    await expect(main.getByText(/^Planul (Free|Basic|Foundation|Scale)/)).toBeVisible();
    await expect(main.getByRole("button", { name: "Salvează planul" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Coada de trimitere" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Copiile clubului" })).toHaveCount(0);
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
  test("an Administrator sets who receives the contact messages, with a Cc and a Bcc", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");

    await expect(main.getByRole("heading", { name: "Cine primește mesajele de contact" })).toBeVisible();

    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("club@example.com");
    await main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)").fill("amalia@example.org");
    // The hidden copy (2026-09-22), with the club's own address typed again: an address in
    // "Către" is not also Bcc'd, so only the archive mailbox is kept from this box.
    await main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)").fill("Club@example.com, arhiva@example.org");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();

    await expect(main.getByText("Destinatarii formularului de contact au fost salvați.")).toBeVisible();
    await expect(main.getByText(/Acum ajung la: club@example\.com\. Copie: amalia@example\.org\. Copie ascunsă: arhiva@example\.org/)).toBeVisible();
    // What was saved is what the boxes show on the way back — the whole point of a setting.
    await expect(main.getByLabel("Către (adrese despărțite prin virgulă)")).toHaveValue("club@example.com");
    await expect(main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)")).toHaveValue("amalia@example.org");
    await expect(main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)")).toHaveValue("arhiva@example.org");

    // An address that is not one is refused, and nothing of it is kept.
    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("nope");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await expect(page.locator("#admin-alert").getByRole("alert")).toBeVisible();
    // A refusal is a fresh page: press again before it has hydrated and the press is lost
    // (`docs/VIBECODING.md`); the clear below is the press that was being dropped.
    await hydrated(page);
    await expect(main.getByText(/Acum ajung la: club@example\.com/)).toBeVisible();

    // And back to nobody in the app, which hands the question to `CONTACT_FORM_TO`: this
    // deployment sets none, so the page says so — a machine that sets one reads the other
    // half of the sentence, and both are the same answer to "the boxes are empty now".
    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("");
    await main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)").fill("");
    await main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)").fill("");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await expect(main.getByText(/Nu le primește nimeni|din variabila CONTACT_FORM_TO/)).toBeVisible();
    await expect(main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)")).toHaveValue("");
  });
});
