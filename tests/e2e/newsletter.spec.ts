import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";
import { mintNewsletterLink, newsletterMessagesTo, newsletterSubscription, seedConfirmedSubscriber } from "./support/newsletter";

/**
 * §NNN — the newsletter's composer on `/admin/emails`: numbers only, the topic chosen, both
 * languages, the question that names how many, and the send's banner and history line. Desktop
 * only: one outbox, and the history is the page's newest sends.
 */
test.describe("§NNN the newsletter's composer on /admin/emails", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one outbox and one history, shared by both projects");
  });

  test("an Administrator writes to one topic, is asked how many, and the send is queued", async ({ page }) => {
    const email = `e2e-news-admin-${Date.now().toString(36)}@test.invalid`;
    await seedConfirmedSubscriber(email, ["DISCOUNTS"]);
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    await hydrated(page);
    const panel = page.locator("#main").getByTestId("newsletter-panel");
    await openFold(panel);
    await expect(panel.getByTestId("newsletter-counts")).toContainText("Abonați confirmați:");

    const compose = panel.getByTestId("newsletter-compose");
    await compose.locator('input[name="topic"][value="DISCOUNTS"]').check();
    const subject = `Cod de reducere ${Date.now().toString(36)}`;
    await compose.getByLabel("Subiect (română)").fill(subject);
    await compose.getByLabel("Subiect (engleză)").fill("A discount code");
    await compose.getByLabel("Textul (română)").fill("Codul: E2E10");
    await compose.getByLabel("Textul (engleză)").fill("The code: E2E10");
    await compose.getByRole("button", { name: "Trimite newsletterul" }).click();
    await confirmDialog(page, /Trimiți newsletterul/);

    await expect(page).toHaveURL(/saved=newsletterSent/, { timeout: 30_000 });
    await expect(page.getByTestId("newsletter-sent-banner")).toBeVisible();
    expect(await newsletterMessagesTo(email)).toBe(1);
    await openFold(page.locator("#main").getByTestId("newsletter-panel"));
    await expect(page.getByTestId("newsletter-history")).toContainText(subject);
  });
});

/**
 * §NNN — the newsletter, through the browser, at 320px and on a desktop: the button on the contact
 * page, the pop-up and its refusal, the "check your inbox" answer, the double opt-in's page and the
 * subscriber's own page with its two buttons. The seeded privacy notice is the platform's template,
 * which names `{{newsletterTopics}}`, so the page offers the pop-up.
 */
test.describe("§NNN the newsletter pop-up on the contact page", () => {
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
    for (const topic of ["ALL", "NEW_EVENTS", "BIG_EVENTS", "DISCOUNTS", "GEAR_TESTING"]) {
      const row = dialog.getByTestId(`newsletter-topic-${topic}`);
      await expect(row).toBeVisible();
      expect((await row.boundingBox())?.height ?? 0, topic).toBeGreaterThanOrEqual(44);
    }
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
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await dialog.getByRole("button", { name: "Abonează-mă" }).click();

    await expect(page).toHaveURL(/newsletter=invalid/);
    await expect(dialog).toBeVisible();
    await expect(page.locator("#newsletter-errors")).toContainText("Alege cel puțin o temă.");
    await expect(dialog.locator('[name="newsletterEmail"]')).toHaveValue(email);

    await dialog.getByTestId("newsletter-topic-DISCOUNTS").click();
    await dialog.getByTestId("newsletter-topic-GEAR_TESTING").click();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await dialog.getByRole("button", { name: "Abonează-mă" }).click();
    await expect(page).toHaveURL(/newsletter=sent/);
    await expect(page.getByTestId("newsletter-sent")).toContainText("Verifică-ți căsuța de email");
    expect(await newsletterSubscription(email)).toEqual({ topics: ["GEAR_TESTING", "DISCOUNTS"], confirmed: false });
  });

  test("confirms from the link, then changes the topics and unsubscribes from the subscriber's own page", async ({ page }) => {
    const email = address();
    await page.goto("/en/contact", { waitUntil: "networkidle" });
    await page.getByTestId("newsletter-open").click();
    const dialog = page.getByTestId("newsletter-dialog");
    await dialog.locator('[name="newsletterEmail"]').fill(email);
    await dialog.getByTestId("newsletter-topic-NEW_EVENTS").click();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await dialog.getByRole("button", { name: "Subscribe me" }).click();
    await expect(page).toHaveURL(/newsletter=sent/);

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
    await page.getByTestId("newsletter-topics-form").locator('input[value="VOLUNTEERING"]').check();
    await page.getByRole("button", { name: "Salvează temele" }).click();
    await expect(page.getByTestId("newsletter-saved")).toBeVisible();
    expect((await newsletterSubscription(email))?.topics).toEqual(["NEW_EVENTS", "VOLUNTEERING"]);

    const unsubscribe = page.getByRole("button", { name: "Dezabonează-mă de la tot" });
    expect((await unsubscribe.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await unsubscribe.click();
    await expect(page.getByTestId("newsletter-gone")).toBeVisible();
    expect(await newsletterSubscription(email)).toBeNull();
  });
});
