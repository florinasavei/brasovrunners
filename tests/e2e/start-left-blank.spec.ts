import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { editorBox, languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * `DECISIONS.md` §NNN (amending §533) — the start's boxes left empty while it is to be announced,
 * in a browser. The owner, 2026-09-28, of «4 · Când și unde» with both switches ticked and «Ora *»
 * still red: «în V2.23 trebuie să pot să nu pun data și ora evenimentului! momentan am validare pe
 * asta».
 *
 * An Administrator creates a group run with «Data se anunță mai târziu» ticked and neither box
 * filled, publishes it in the same press, and the page says «Data se anunță în curând» with no
 * structured data, no calendar file and no place in the feed, while the sitemap lists it. Back in
 * the editor the boxes are empty and the closed line says the date is to be announced; unticked,
 * the boxes are required again and Salvează goes nowhere.
 *
 * Each project makes its own event (the suffix), and the spec takes it off the site at the end.
 */
test.describe("§NNN the start left blank while it is to be announced", () => {
  test("publishes with no date and no hour, says so everywhere, and asks for both again once unticked", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `data-neanuntata-${suffix}`;
    const englishSlug = `date-to-be-announced-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const hour = field("event.startsAtTime");
    const dateSwitch = page.getByRole("checkbox", { name: "Data se anunță mai târziu" });
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    // Required until a switch excuses it; «Ora se anunță mai târziu» alone excuses only the hour.
    await expect(hour).toHaveAttribute("required", "");
    await page.getByRole("checkbox", { name: "Ora se anunță mai târziu" }).check();
    await expect(hour).not.toHaveAttribute("required", "");
    await page.getByRole("checkbox", { name: "Ora se anunță mai târziu" }).uncheck();
    await expect(hour).toHaveAttribute("required", "");
    await dateSwitch.check();
    await expect(hour).not.toHaveAttribute("required", "");
    await expect(hour).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Tractorul Park");
    await field("translations.ro.title").fill(`Dată neanunțată ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Data se anunță curând.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Date to be announced ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "The date is announced soon.");

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page, "Creezi și publici evenimentul?");
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    const editorUrl = page.url();

    // The page: the sentence, and nothing that places the event in time.
    expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);
    await expect(page.locator("main").getByText("Data se anunță în curând").first()).toBeVisible();
    const html = await page.content();
    await expect(page.locator("main")).not.toContainText("9999");
    expect(html).not.toContain("9999-01-01");
    expect(html).not.toContain("SportsEvent");
    // No calendar link of its own (the club's feed in the page's frame is not the event's).
    expect(html).not.toContain(`${slug}/calendar.ics`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.goto(`/en/events/${englishSlug}`))?.status()).toBe(200);
    await expect(page.locator("main").getByText("Date to be announced soon").first()).toBeVisible();
    // No calendar file, no line in the feed, and the sitemap still has the page.
    expect((await page.request.get(`/ro/events/${slug}/calendar.ics`)).status()).toBe(404);
    expect(await (await page.request.get("/ro/events/calendar.ics")).text()).not.toContain(slug);
    expect(await (await page.request.get("/sitemap.xml")).text()).toContain(slug);

    // The backoffice list: the chip, and never the provisional day.
    await page.goto(`/ro/admin?q=${encodeURIComponent(suffix)}`);
    // The one on screen: a phone draws the list's rows as cards, the table hidden beside them.
    await expect(page.getByTestId("date-to-be-announced-chip").filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText("9999");

    // The editor: the boxes empty, the closed line saying so, never a date.
    await page.goto(editorUrl);
    await hydrated(page);
    const when = editorBox(page, "Când și unde");
    await expect(when.locator(":scope > summary")).toContainText("Data se anunță mai târziu");
    await expect(when.locator(":scope > summary")).not.toContainText("9999");
    await openEditorBox(page, "Când și unde");
    await expect(dateSwitch).toBeChecked();
    await expect(field("event.startsAtDate")).toHaveValue("");
    await expect(hour).toHaveValue("");

    // Unticked, both are required again: the browser keeps Salvează from posting an empty start.
    await dateSwitch.uncheck();
    await expect(hour).toHaveAttribute("required", "");
    expect(await hour.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    await page.locator('[name="acknowledgeLiveEdit"]').check();
    const before = page.url();
    await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).click();
    expect(page.url()).toBe(before);

    // Off the site again.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});
