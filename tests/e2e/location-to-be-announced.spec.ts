import { expect, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-011-01 criterion 19 (`DECISIONS.md` §NNN) — the place to be announced, in a browser.
 *
 * The owner, 2026-09-23: "I want to be able to set the location as TBD, and to not announce it
 * yet". An Administrator creates a race with the switch on and a venue typed but not announced,
 * publishes it in the same press, and the public page — and its calendar file — say "Locația se
 * anunță în curând" and never the venue. Turning the switch off and saving puts the venue on the
 * page, with a banner saying nobody was emailed.
 *
 * Each project makes its own event (the suffix), and the spec takes it off the site at the end so
 * the listing other specs count does not grow by one card per run.
 */
test.describe("BR-REQ-011-01 criterion 19 the place to be announced (§NNN)", () => {
  test("publishes without a place, says so on the page, and announces the place with one save", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `locatie-neanuntata-${suffix}`;
    const englishSlug = `place-to-be-announced-${suffix}`;
    const secret = `Sala secretă ${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = page.locator(`#locale-panel-${locale}`);
      await panel.locator("summary").filter({ hasText: "Rezumat" }).click();
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    await field("event.startsAtDate").fill("2027-06-12");
    await field("event.startsAtTime").fill("09:00");

    // The browser asks for a meeting point until the switch says it is to be announced (§315).
    await expect(field("event.locationName")).toHaveAttribute("required", "");
    const toggle = page.getByRole("switch", { name: "Locația se anunță mai târziu" });
    await toggle.check();
    await expect(field("event.locationName")).not.toHaveAttribute("required", "");
    await expect(page.getByText("Nepublicat cât timp locația se anunță mai târziu.")).toBeVisible();
    // A venue written down the moment it is known, kept and not shown.
    await field("event.locationName").fill(secret);

    await field("translations.ro.title").fill(`Locație neanunțată ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Locul se anunță curând.");
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Place to be announced ${suffix}`);
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "The place is announced soon.");
    await expect(page.getByText(/Nu se poate publica încă/)).toHaveCount(0);

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    const editorUrl = page.url();

    // The public page, in both languages: the sentence where the place would be, never the venue.
    expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);
    await expect(page.locator("main").getByText("Locația se anunță în curând")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(secret);
    expect(await page.content()).not.toContain(secret);
    expect((await page.goto(`/en/events/${englishSlug}`))?.status()).toBe(200);
    await expect(page.locator("main").getByText("Location to be announced soon")).toBeVisible();
    expect(await page.content()).not.toContain(secret);

    // The calendar file: the sentence, and no LOCATION for a calendar to route to.
    const ics = await (await page.request.get(`/ro/evenimente/${slug}/calendar.ics`)).text();
    expect(ics).toContain("Locația se anunță în curând");
    expect(ics).not.toContain("LOCATION:");
    expect(ics.replace(/\r\n /g, "")).not.toContain(secret);

    // Announcing: the switch off, one save, and the venue is public — nobody is emailed.
    await page.goto(editorUrl);
    await hydrated(page);
    await expect(page.getByRole("switch", { name: "Locația se anunță mai târziu" })).toBeChecked();
    await expect(field("event.locationName")).toHaveValue(secret);
    await page.getByRole("switch", { name: "Locația se anunță mai târziu" }).uncheck();
    await expect(field("event.locationName")).toHaveAttribute("required", "");
    await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("place-announced")).toContainText("Locația e anunțată");

    await page.goto(`/ro/evenimente/${slug}`);
    await expect(page.locator("main").getByText(secret).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Locația se anunță în curând");

    // Off the site again.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});
