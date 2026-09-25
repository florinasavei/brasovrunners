import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn, hydrated } from "./support/featured-event";
import { openFold } from "./support/fold";

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

    const plan = main.getByTestId("email-plan");
    await expect(main.getByRole("heading", { name: "Planul Mailgun și cât mai putem trimite" })).toBeVisible();
    // A fold since §336, closed on arrival, and its summary already says the plan and the day's
    // figure — the thing race morning opens this page for.
    await expect(plan).not.toHaveAttribute("open");
    await expect(plan.locator(":scope > summary")).toContainText(/Planul Free · \d+ din 100 azi/);
    await openFold(plan);
    // The default: Free, counted by the day.
    await expect(main.getByText(/Planul Free: \d+ din 100 mesaje trimise azi/)).toBeVisible();
    // Criterion 8: and the figure says whose allowance it is — one account, two deployments.
    await expect(main.getByText(/unui singur cont Mailgun/)).toBeVisible();

    await main.getByLabel("Planul pe care e contul Mailgun").selectOption("BASIC");
    await main.getByLabel("Notă (de ce, până când)").fill("Basic pentru cursa din octombrie");
    await main.getByRole("button", { name: "Salvează planul" }).click();
    await confirmDialog(page);

    await expect(main.getByText("Planul a fost salvat", { exact: false })).toBeVisible();
    // Its own save opens it by itself (§336), so what was saved is in view.
    await expect(plan).toHaveAttribute("open", "");
    await expect(main.getByText(/Planul Basic: \d+ din 10\.000 mesaje trimise luna aceasta/)).toBeVisible();
    await expect(main.getByText(/Notă: Basic pentru cursa din octombrie/)).toBeVisible();

    // And back, so the next test on this database starts from the default.
    await main.getByLabel("Planul pe care e contul Mailgun").selectOption("FREE");
    await main.getByRole("button", { name: "Salvează planul" }).click();
    await confirmDialog(page);
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

    // Every panel is a closed fold (§336). Opened here before anything is counted, because a
    // control inside a closed fold is not in the accessibility tree — "no Save button" would be
    // true of a hidden one.
    for (const id of ["email-plan", "outbox-queue", "club-notices", "contact-recipients"]) {
      await openFold(main.getByTestId(id));
    }

    // The figures, whichever plan the shared settings row is on when this test runs — the body's
    // sentence ("Planul Free: …"), not the summary's ("Planul Free · …").
    await expect(main.getByText(/^Planul (Free|Basic|Foundation|Scale): /)).toBeVisible();
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
    // The sentence in force depends on the shared row and on `CONTACT_FORM_TO`: with an address
    // in either it names the Bcc ("Copie ascunsă: …"); with neither — CI sets no variable, and the
    // Administrator's test below clears the row — it says nobody receives them, and names no copy.
    // Whichever state this database is in, the Organizer is shown the sentence.
    await expect(main.getByRole("heading", { name: "Cine primește mesajele de contact" })).toBeVisible();
    await expect(main.getByText("Cine primește mesajele de contact stabilește Administratorul", { exact: false })).toBeVisible();
    await expect(main.getByText(/Copie ascunsă:|Nu le primește nimeni/)).toBeVisible();
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

    await openFold(main.getByTestId("email-plan"));
    await expect(main.getByText(/^Planul (Free|Basic|Foundation|Scale): /)).toBeVisible();
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

    const contacts = main.getByTestId("contact-recipients");
    await expect(main.getByRole("heading", { name: "Cine primește mesajele de contact" })).toBeVisible();
    // Closed by default (§336; the owner: "should be closed by default"), saying in its summary
    // where the messages go right now.
    await expect(contacts).not.toHaveAttribute("open");
    await expect(contacts.locator(":scope > summary")).toContainText("Acum ajung la: ");
    await openFold(contacts);

    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("club@example.com");
    await main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)").fill("amalia@example.org");
    // The hidden copy (2026-09-22), with the club's own address typed again: an address in
    // "Către" is not also Bcc'd, so only the archive mailbox is kept from this box.
    await main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)").fill("Club@example.com, arhiva@example.org");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await confirmDialog(page);

    await expect(main.getByText("Destinatarii formularului de contact au fost salvați.")).toBeVisible();
    // Its own save opens it (§336), and the closed summary would now say the new address.
    await expect(contacts).toHaveAttribute("open", "");
    await expect(contacts.locator(":scope > summary")).toContainText("Acum ajung la: club@example.com");
    await expect(main.getByText(/Acum ajung la: club@example\.com\. Copie: amalia@example\.org\. Copie ascunsă: arhiva@example\.org/)).toBeVisible();
    // What was saved is what the boxes show on the way back — the whole point of a setting.
    await expect(main.getByLabel("Către (adrese despărțite prin virgulă)")).toHaveValue("club@example.com");
    await expect(main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)")).toHaveValue("amalia@example.org");
    await expect(main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)")).toHaveValue("arhiva@example.org");

    // An address that is not one is refused and nothing of it is saved — but what was typed stays
    // in its box to be corrected, and the refusal is said inside the form it is about (§315).
    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("nope");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await confirmDialog(page);
    await expect(main.getByTestId("contact-recipients-form").getByTestId("form-refusal")).toBeVisible();
    // The fold the Administrator opened to press is still open: a kept form's refusal re-renders
    // nothing around it (§336, §315).
    await expect(contacts).toHaveAttribute("open", "");
    await expect(main.getByLabel("Către (adrese despărțite prin virgulă)")).toHaveValue("nope");
    await expect(main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)")).toHaveValue("amalia@example.org");
    await hydrated(page);
    await expect(main.getByText(/Acum ajung la: club@example\.com\. Copie:/)).toBeVisible();

    // And back to nobody in the app, which hands the question to `CONTACT_FORM_TO`: this
    // deployment sets none, so the page says so — a machine that sets one reads the other
    // half of the sentence, and both are the same answer to "the boxes are empty now".
    await main.getByLabel("Către (adrese despărțite prin virgulă)").fill("");
    await main.getByLabel("Copie – Cc (adrese despărțite prin virgulă)").fill("");
    await main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)").fill("");
    await main.getByRole("button", { name: "Salvează destinatarii" }).click();
    await confirmDialog(page);
    await expect(main.getByText(/Nu le primește nimeni|din variabila CONTACT_FORM_TO/)).toBeVisible();
    await expect(main.getByLabel("Copie ascunsă – Bcc (adrese despărțite prin virgulă)")).toHaveValue("");
  });

  /*
    `DECISIONS.md` §336: folds start closed, and a refusal is never folded away. A kept form's
    refusal (§315) is the form's state, which the server drawing the fold cannot see — so this is
    the case the fold rule has to answer without a page parameter. Nothing is saved by a refused
    list, so the shared row is untouched.
  */
  test("a refused list stays in view, with JavaScript on and with it off", async ({ page, browser }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    await hydrated(page);
    const contacts = page.locator("#main").getByTestId("contact-recipients");
    const to = "Către (adrese despărțite prin virgulă)";

    // With JavaScript on: the fold opened to press stays open, the refusal inside it.
    await openFold(contacts);
    await contacts.getByLabel(to).fill("nope");
    await contacts.getByRole("button", { name: "Salvează destinatarii" }).click();
    await confirmDialog(page);
    await expect(contacts.getByTestId("form-refusal")).toBeVisible();
    await expect(contacts).toHaveAttribute("open", "");
    expect(page.url()).not.toContain("saved=");

    // With JavaScript off the refused POST renders the page afresh and every fold arrives closed —
    // and the refusal, with the address as typed, is shown anyway.
    const { baseURL, viewport } = test.info().project.use;
    const scriptless = await browser.newContext({
      baseURL,
      viewport,
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    const bare = await scriptless.newPage();
    await bare.goto("/ro/admin/emails");
    const fold = bare.locator("#main").getByTestId("contact-recipients");
    await openFold(fold);
    await fold.getByLabel(to).fill("nope");
    const posted = bare.waitForResponse((response) => response.request().method() === "POST");
    await fold.getByRole("button", { name: "Salvează destinatarii" }).click();
    await posted;
    await expect(fold).not.toHaveAttribute("open");
    await expect(fold.getByTestId("form-refusal")).toBeVisible();
    await expect(fold.getByLabel(to)).toHaveValue("nope");
    await scriptless.close();
  });
});

/**
 * `DECISIONS.md` §336 — "Emailurile trimise participanților" is one card holding one card per
 * message (the owner: "should be a master card with smaller cards within"), the language switch
 * inside it, and a `#fragment` opens the fold it names. Read-only, so both projects run it.
 */
test.describe("§336 the emails participants receive, as a card of cards", () => {
  test("closed on arrival; the language switch is inside it; each message is a closed card of its own", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");
    const card = main.getByTestId("participant-emails");
    const messages = card.getByTestId("participant-email");

    await expect(card).not.toHaveAttribute("open");
    await expect(card.getByRole("heading", { name: "Emailurile trimise participanților", level: 2 })).toBeVisible();
    await expect(card.locator(":scope > summary")).toContainText(/\d+ mesaje · Română/);
    // Nothing of it outside the card: the switch is not on the page until the card is open.
    await expect(main.getByRole("link", { name: "English", exact: true })).toHaveCount(0);

    await openFold(card);
    await expect(card.getByText("Limba în care vezi și scrii mesajele:")).toBeVisible();
    await expect(card.getByRole("link", { name: "Română", exact: true })).toHaveAttribute("aria-current", "page");
    const count = await messages.count();
    // Every message type, the two the event notices added (§331) among them.
    expect(count).toBeGreaterThanOrEqual(20);
    for (let index = 0; index < count; index += 1) await expect(messages.nth(index)).not.toHaveAttribute("open");
    await expect(card.locator("#email-EVENT_UPDATE_NOTICE > summary")).toContainText("doar când un organizator anunță o schimbare");
    await expect(card.locator("#email-EVENT_CANCELLED > summary")).toContainText("la anularea evenimentului, dacă e bifat");
    // A type nothing queues any more says so before it is opened, and is listed after the rest.
    await expect(card.locator("#email-WAITLIST_OFFER_EXPIRED > summary")).toContainText("nu se mai trimite");
    await expect(card.locator("#email-EVENT_REMINDER > summary")).not.toContainText("nu se mai trimite");
    await expect(messages.last()).toHaveAttribute("id", /^email-(WAITLIST_OFFER_EXPIRED|REGISTRATION_MANAGE_LINK|DECLARATION_SIGNED)$/);

    // Each card's summary: the message's name, as a heading under the card's, and when it goes out.
    const reminder = card.locator("#email-EVENT_REMINDER");
    await expect(reminder.getByRole("heading", { name: "Reminderul dinaintea startului", level: 3 })).toBeVisible();
    // The club's lead in words (§377): two days, unset.
    await expect(reminder.locator(":scope > summary")).toContainText("cu 2 zile înainte de start");
    await openFold(reminder);
    await expect(reminder.locator("iframe")).toBeVisible();
    await expect(reminder.getByText(/^Subiect: /)).toBeVisible();

    // The switch applies to the card: choosing English lands back on it, open, in English.
    await card.getByRole("link", { name: "English", exact: true }).click();
    await expect(page).toHaveURL(/\?lang=en#participant-emails$/);
    await expect(card).toHaveAttribute("open", "");
    await expect(card.getByRole("link", { name: "English", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(card.locator(":scope > summary")).toContainText(/\d+ mesaje · English/);
  });

  test("a #fragment naming a closed panel opens it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails#contact-recipients");
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("contact-recipients")).toHaveAttribute("open", "");
    // And a message inside the closed card: both folds open.
    await page.goto("/ro/admin/emails#email-EVENT_REMINDER");
    await hydrated(page);
    await expect(page.locator("#participant-emails")).toHaveAttribute("open", "");
    await expect(page.locator("#email-EVENT_REMINDER")).toHaveAttribute("open", "");
  });
});

/**
 * BR-REQ-033-02 criterion 12's rule applied to every message a participant receives
 * (2026-09-22; the owner: "să putem seta și unde mai merg în BCC mailurile de înregistrare"):
 * the club's hidden copy of the emails to participants is set on the same page, named back in
 * force above the boxes, and priced in the plan's forecast — one address is one more message on
 * each of the runner's five, so the cost of a registration moves by five and the forecast says
 * which part of it the copies are. Desktop only, for the same one-row reason as the blocks above.
 */
test.describe("BR-REQ-033-02 criterion 12 the club's hidden copy of the emails to participants", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  // Set and cleared again, so the next test on this database starts with no hidden copy.
  test("an Administrator sets it, the sentence in force names it, and the forecast counts it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");
    const panel = main.getByTestId("club-notices");
    const forecast = main.getByTestId("email-forecast");
    const box = panel.getByLabel("Copie ascunsă la emailurile către participanți (Bcc)");
    // Both folds closed on arrival (§336): the plan holds the forecast, the copies the box. The
    // copies' summary counts the mailboxes it names.
    await expect(panel.locator(":scope > summary")).toContainText(/Adrese care primesc copii: \d+/);
    await openFold(main.getByTestId("email-plan"));
    await openFold(panel);

    // Nothing hidden yet: the forecast prints the plain cost and no second sentence.
    await expect(forecast).toContainText(/costă circa [0-9]+ mesaje/);
    await expect(forecast).not.toContainText("copiile ascunse");
    const before = Number((await forecast.innerText()).match(/costă circa ([0-9]+) mesaje/)?.[1]);
    expect(before).toBeGreaterThan(0);

    // Only this box is touched; the other lists keep whatever they held, so the row is left as
    // it was found. The same mailbox twice, in two spellings, is one mailbox.
    await box.fill("arhiva@example.org, Arhiva@example.org");
    await panel.getByRole("button", { name: "Salvează", exact: true }).click();
    await confirmDialog(page, "Schimbi cine primește copiile clubului?");

    await expect(main.getByText("Am salvat cine primește copiile clubului.")).toBeVisible();
    await expect(panel.getByText("Copie ascunsă la emailurile către participanți: arhiva@example.org.")).toBeVisible();
    await expect(box).toHaveValue("arhiva@example.org");
    // One address on each of the runner's five messages: the cost moved by five, and the
    // forecast says so next to the plan's figures, where the club decides what it can afford.
    await expect(forecast).toContainText(`costă circa ${before + 5} mesaje`);
    await expect(forecast).toContainText("Din ele, 5 sunt copiile ascunse");

    // And back to none: the sentence in force says so, and the forecast is what it was.
    await box.fill("");
    await panel.getByRole("button", { name: "Salvează", exact: true }).click();
    await confirmDialog(page, "Schimbi cine primește copiile clubului?");
    await expect(panel.getByText("Copie ascunsă la emailurile către participanți: —.")).toBeVisible();
    await expect(forecast).toContainText(`costă circa ${before} mesaje`);
    await expect(forecast).not.toContainText("copiile ascunse");
  });
});
