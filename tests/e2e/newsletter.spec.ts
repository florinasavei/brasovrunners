import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import { mintNewsletterLink, newsletterMessagesTo, newsletterSubscription, seedConfirmedSubscriber } from "./support/newsletter";

/**
 * §445 — the backoffice's «Newsletter» entry (the owner, 2026-09-26: "un meniu suplimentar în
 * backoffice cu «Newsletter»"): numbers only, the topic chosen, both languages, the question that
 * names how many, and the send's banner and history line; `/admin/emails` keeps one line pointing
 * here; a role that may not send is offered no tab and gets a 404. Desktop only: one outbox, and
 * the history is the page's newest sends.
 */
test.describe("§445 the newsletter's own backoffice page", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one outbox and one history, shared by both projects");
  });

  test("an Administrator opens «Newsletter» from the menu, writes to one topic, is asked how many, and the send is queued", async ({ page }) => {
    const email = `e2e-news-admin-${Date.now().toString(36)}@test.invalid`;
    await seedConfirmedSubscriber(email, ["GEAR_TESTING"]);
    await signIn(page, "Dev Administrator");
    // /admin/emails holds no newsletter card any more — one line pointing at the page.
    await page.goto("/ro/admin/settings/emails");
    await expect(page.locator("#main").getByTestId("newsletter-panel")).toHaveCount(0);
    await expect(page.getByTestId("newsletter-link").getByRole("link", { name: "Newsletter →" })).toHaveAttribute("href", "/ro/admin/newsletter");
    // The menu's own entry, after «Emailuri».
    const tab = page.getByRole("tab", { name: "Newsletter" });
    await tab.click();
    await expect(page).toHaveURL(/\/ro\/admin\/newsletter$/);
    await hydrated(page);
    const panel = page.locator("#main").getByTestId("newsletter-panel");
    await expect(panel.getByTestId("newsletter-counts")).toContainText("Abonați confirmați:");

    const compose = page.locator("#main").getByTestId("newsletter-composer").getByTestId("newsletter-compose");
    // The retired discount codes are no choice (§517).
    await expect(compose.locator('input[name="topic"][value="DISCOUNTS"]')).toHaveCount(0);
    await compose.locator('input[name="topic"][value="GEAR_TESTING"]').check();
    const subject = `Testare de încălțăminte ${Date.now().toString(36)}`;
    // One language per tab, the letter in the rich-text editor (§NNN): bold on the first line.
    await compose.getByLabel("Subiect (română)").fill(subject);
    await compose.getByTestId("newsletter-body-ro").locator(".tiptap").click();
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Sâmbătă, la start.");
    await compose.getByRole("tab", { name: /English/ }).click();
    await compose.getByLabel("Subiect (engleză)").fill("A shoe test");
    await compose.getByTestId("newsletter-body-en").locator(".tiptap").click();
    await page.keyboard.type("Saturday, at the start.");
    // The editor posts its document as JSON through its hidden box.
    await expect(compose.locator('input[type="hidden"][name="newsletterBodyRo"]')).toHaveValue(/"bold"/);
    // The preview: the message as an English subscriber receives it, from the boxes as they stand.
    await compose.getByRole("button", { name: "Previzualizează în engleză" }).click();
    await expect(compose.getByTestId("newsletter-preview-subject")).toContainText(`A shoe test / ${subject}`);
    await compose.getByRole("button", { name: "Trimite newsletterul" }).click();
    await confirmDialog(page, /Trimiți newsletterul/);

    await expect(page).toHaveURL(/\/ro\/admin\/newsletter\?saved=newsletterSent/, { timeout: 30_000 });
    await expect(page.getByTestId("newsletter-sent-banner")).toBeVisible();
    expect(await newsletterMessagesTo(email)).toBe(1);
    await expect(page.getByTestId("newsletter-history")).toContainText(subject);
    // The history says the letter's first line of words (§NNN).
    await expect(page.getByTestId("newsletter-history")).toContainText("Sâmbătă, la start.");
  });

  test("an Administrator opens «Abonați», searches an address, downloads the CSV and sees «Dezabonează» on the row", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const email = `e2e-news-list-${stamp}@test.invalid`;
    await seedConfirmedSubscriber(email, ["GEAR_TESTING"]);
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/newsletter");
    await hydrated(page);

    const card = page.locator("#main").getByTestId("newsletter-subscribers");
    // A fold, closed by default (§336), its line saying the counts.
    await expect(card.locator("summary")).toContainText("Abonați");
    await expect(card.locator("summary")).toContainText(/abona(t|ți) confirma(t|ți)/);
    await expect(card.getByTestId("newsletter-subscribers-filters")).toBeHidden();
    await card.locator("summary").first().click();
    await expect(card.getByTestId("newsletter-subscribers-filters")).toBeVisible();

    // The search is a GET form: the state is the address, and the fold opens by itself.
    await card.getByLabel("Caută adresa").fill(email.toUpperCase());
    await card.getByRole("button", { name: "Filtrează" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/newsletter\?q=[^#]+#newsletter-subscribers$/);
    const table = card.getByTestId("newsletter-subscribers-table");
    await expect(table.getByTestId("newsletter-subscriber-row")).toHaveCount(1);
    await expect(table.getByTestId("newsletter-subscriber-email")).toHaveText(email);
    await expect(table.getByTestId("newsletter-subscriber-state")).toContainText("Confirmat");
    await expect(card.getByTestId("newsletter-subscribers-counts")).toContainText("1 abonat confirmat, 0 în așteptare");

    // The CSV of the same filter, named with the date, with its BOM and the table's columns.
    const [download] = await Promise.all([page.waitForEvent("download"), card.getByTestId("newsletter-subscribers-csv").click()]);
    expect(download.suggestedFilename()).toMatch(/^newsletter-abonati-\d{4}-\d{2}-\d{2}\.csv$/);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const csv = readFileSync(path, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Adresa,Limba,Teme,Starea,Abonat din,Confirmat la");
    expect(csv).toContain(email);

    // The Administrator's verb, 44 pixels tall, asking first (§384) with the address in its question.
    const unsubscribe = table.getByRole("button", { name: "Dezabonează" });
    await expect(unsubscribe).toBeVisible();
    expect((await unsubscribe.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await unsubscribe.click();
    await confirmDialog(page, new RegExp(`Dezabonezi ${email.replace(/[.]/g, "\\.")}`));
    await expect(page).toHaveURL(/saved=newsletterUnsubscribed/, { timeout: 30_000 });
    expect(await newsletterSubscription(email)).toBeNull();
    await expect(card.getByTestId("newsletter-subscribers-empty")).toBeVisible();
  });

  for (const who of ["Dev Copywriter", "Dev Technical"] as const) {
    test(`offers ${who} no «Newsletter» and answers the address with a 404`, async ({ page }) => {
      await signIn(page, who);
      await expect(page.getByRole("tab", { name: "Newsletter" })).toHaveCount(0);
      // 404, the answer a route that does not exist gives (BR-REQ-060-01, §376).
      expect((await page.goto("/ro/admin/newsletter"))?.status()).toBe(404);
    });
  }

  test("the Organizer opens «Newsletter» and finds the composer, without the Administrator's withdrawal", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await expect(page.getByRole("tab", { name: "Newsletter" })).toBeVisible();
    expect((await page.goto("/ro/admin/newsletter"))?.status()).toBe(200);
    await expect(page.locator("#main").getByTestId("newsletter-composer")).toBeVisible();
    // The Administrator's withdrawal is not the Organizer's.
    await expect(page.getByTestId("newsletter-withdraw")).toHaveCount(0);
    // The Organizer reads «Abonați» and its CSV, and is offered no «Dezabonează» (§NNN).
    await expect(page.locator("#main").getByTestId("newsletter-subscribers")).toBeVisible();
    await expect(page.getByTestId("newsletter-subscribers-csv")).toHaveCount(1);
    await expect(page.getByTestId("newsletter-subscriber-unsubscribe")).toHaveCount(0);
  });
});

/**
 * §445 — the newsletter, through the browser, at 320px and on a desktop: the button on the contact
 * page, the pop-up and its refusal, the "check your inbox" answer, the double opt-in's page and the
 * subscriber's own page with its two buttons. The seeded privacy notice is the platform's template,
 * which names `{{newsletterTopics}}`, so the page offers the pop-up. Its absence under a notice that
 * does not name it is proved on the real page in `tests/integration/newsletter/contact-page-gate.test.ts`:
 * here the notice is the shared database's, and the public cache (§333) would keep the old one.
 */
test.describe("§445 the newsletter pop-up on the contact page", () => {
  const address = () => `e2e-news-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;

  test("opens a pop-up from a 44-pixel button, every topic a thumb's row, nothing wider than the phone", async ({ page }) => {
    await page.goto("/ro/contact", { waitUntil: "networkidle" });
    const open = page.getByTestId("newsletter-open");
    await expect(open).toBeVisible();
    expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const dialog = page.getByTestId("newsletter-dialog");
    await expect(dialog).toBeHidden();

    await open.click();
    await expect(dialog).toBeVisible();
    // A real modal: the browser's own, over the page.
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(dialog.getByRole("heading", { name: "Abonează-te la noutățile clubului" })).toBeVisible();
    for (const topic of ["ALL", "BIG_EVENTS", "GEAR_TESTING", "SPECIAL_EVENTS", "WEEKLY_RUNS", "VOLUNTEERING", "RESULTS_PHOTOS"]) {
      const row = dialog.getByTestId(`newsletter-topic-${topic}`);
      await expect(row).toBeVisible();
      expect((await row.boundingBox())?.height ?? 0, topic).toBeGreaterThanOrEqual(44);
    }
    // The discount codes are for the club's members, not the newsletter (§517).
    await expect(dialog.getByTestId("newsletter-topic-DISCOUNTS")).toHaveCount(0);
    await expect(dialog).not.toContainText("Coduri de reducere");
    // «Toate noutățile» ticks all; unticking one unticks it.
    const boxes = dialog.locator('input[name="topics"]');
    await dialog.getByTestId("newsletter-topic-ALL").click();
    expect(await boxes.evaluateAll((inputs) => inputs.every((input) => (input as HTMLInputElement).checked))).toBe(true);
    await dialog.getByTestId("newsletter-topic-SPECIAL_EVENTS").click();
    await expect(dialog.getByTestId("newsletter-topic-ALL").locator("input")).not.toBeChecked();
    await expect(dialog.getByTestId("newsletter-topic-BIG_EVENTS").locator("input")).toBeChecked();
    await expect(dialog.getByRole("link", { name: "nota de confidențialitate" })).toBeVisible();
    for (const button of [dialog.getByTestId("newsletter-close"), dialog.getByRole("button", { name: "Abonează-mă" })]) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await dialog.getByTestId("newsletter-close").click();
    await expect(dialog).toBeHidden();
  });

  test("refuses no topic inside the pop-up, keeping the address; then says 'check your inbox'", async ({ page }) => {
    const email = address();
    await page.goto("/ro/contact", { waitUntil: "networkidle" });
    await page.getByTestId("newsletter-open").click();
    const dialog = page.getByTestId("newsletter-dialog");
    await dialog.locator('[name="newsletterEmail"]').fill(email);
    // The consent is the person's own tick, required; the topics are the server's to refuse.
    await dialog.getByTestId("newsletter-consent").click();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await dialog.getByRole("button", { name: "Abonează-mă" }).click();

    await expect(page).toHaveURL(/newsletter=invalid/, { timeout: 30_000 });
    await expect(dialog).toBeVisible();
    await expect(page.locator("#newsletter-errors")).toContainText("Alege cel puțin o temă.");
    await expect(dialog.locator('[name="newsletterEmail"]')).toHaveValue(email);
    await expect(dialog.locator('[name="consent"]')).toBeChecked();

    await dialog.getByTestId("newsletter-topic-BIG_EVENTS").click();
    await dialog.getByTestId("newsletter-topic-GEAR_TESTING").click();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await dialog.getByRole("button", { name: "Abonează-mă" }).click();
    await expect(page).toHaveURL(/newsletter=sent/, { timeout: 30_000 });
    await expect(page.getByTestId("newsletter-sent")).toContainText("Verifică-ți căsuța de email");
    expect(await newsletterSubscription(email)).toEqual({ topics: ["BIG_EVENTS", "GEAR_TESTING"], confirmed: false });
  });

  test("subscribes with two topics, confirms from the link, then changes the topics and unsubscribes from the subscriber's own page", async ({ page }) => {
    const email = address();
    await page.goto("/en/contact", { waitUntil: "networkidle" });
    await page.getByTestId("newsletter-open").click();
    const dialog = page.getByTestId("newsletter-dialog");
    await dialog.locator('[name="newsletterEmail"]').fill(email);
    await dialog.getByTestId("newsletter-topic-WEEKLY_RUNS").click();
    await dialog.getByTestId("newsletter-topic-GEAR_TESTING").click();
    await dialog.getByTestId("newsletter-consent").click();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await dialog.getByRole("button", { name: "Subscribe me" }).click();
    await expect(page).toHaveURL(/newsletter=sent/, { timeout: 30_000 });
    expect(await newsletterSubscription(email)).toEqual({ topics: ["GEAR_TESTING", "WEEKLY_RUNS"], confirmed: false });

    // The confirmation page: the GET changes nothing, the button does.
    const confirm = await mintNewsletterLink(email, "CONFIRM");
    await page.goto(`/en/newsletter/confirm/${confirm}`);
    await expect(page.getByText(`at ${email}`)).toBeVisible();
    expect((await newsletterSubscription(email))?.confirmed).toBe(false);
    await page.getByRole("button", { name: "Confirm my subscription" }).click();
    await expect(page.getByTestId("newsletter-confirmed")).toBeVisible();
    expect((await newsletterSubscription(email))?.confirmed).toBe(true);
    // Spent: the same link again is the notice, not a second confirmation.
    await page.goto(`/en/newsletter/confirm/${confirm}`);
    await expect(page.getByTestId("newsletter-link-invalid")).toBeVisible();

    const manage = await mintNewsletterLink(email, "MANAGE");
    await page.goto(`/ro/noutati/abonament/${manage}`);
    await expect(page.getByText(`la ${email}`)).toBeVisible();
    await page.getByTestId("newsletter-topics-form").locator('input[value="GEAR_TESTING"]').uncheck();
    await page.getByTestId("newsletter-topics-form").locator('input[value="VOLUNTEERING"]').check();
    await page.getByRole("button", { name: "Salvează temele" }).click();
    await expect(page.getByTestId("newsletter-saved")).toBeVisible();
    expect((await newsletterSubscription(email))?.topics).toEqual(["WEEKLY_RUNS", "VOLUNTEERING"]);
    // Single use (AGENTS.md §12.8): the page moved to the link's successor; the pressed one opens nothing.
    const successor = page.url();
    expect(successor).not.toContain(manage);
    await page.goto(`/ro/noutati/abonament/${manage}`);
    await expect(page.getByTestId("newsletter-link-invalid")).toBeVisible();
    await page.goto(successor);
    await expect(page.getByText(`la ${email}`)).toBeVisible();

    const unsubscribe = page.getByRole("button", { name: "Dezabonează-mă de la tot" });
    expect((await unsubscribe.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await unsubscribe.click();
    await expect(page.getByTestId("newsletter-gone")).toBeVisible();
    expect(await newsletterSubscription(email)).toBeNull();
  });
});
