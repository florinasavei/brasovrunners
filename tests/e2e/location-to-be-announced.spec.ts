import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-011-01 criterion 19 (`DECISIONS.md` §328) — the place to be announced, in a browser.
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
test.describe("BR-REQ-011-01 criterion 19 the place to be announced (§328)", () => {
  test("publishes without a place, says so on the page, and announces the place with one save", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `locatie-neanuntata-${suffix}`;
    const englishSlug = `place-to-be-announced-${suffix}`;
    const secret = `Sala secretă ${suffix}`;
    const secretEnglish = `Secret hall ${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    // The two names side by side from `sm`, stacked on a phone — and never wider than the phone (§362).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await fillDateField(page, "Începutul evenimentului", "2027-06-12");
    await fillTimeField(page, "Ora", "09:00");

    // The browser asks for a meeting point in each language until the switch says it is to be
    // announced (§315, §362).
    await expect(field("event.locationName")).toHaveAttribute("required", "");
    await expect(field("event.locationNameEn")).toHaveAttribute("required", "");
    // A venue written down the moment it is known — then the switch hides it, kept and not shown
    // (the owner: "if the location is announced later, we should hide these fields").
    await field("event.locationName").fill(secret);
    await field("event.locationNameEn").fill(secretEnglish);
    const toggle = page.getByRole("switch", { name: "Locația se anunță mai târziu" });
    await toggle.check();
    for (const name of ["event.locationName", "event.locationNameEn"]) {
      await expect(field(name)).not.toHaveAttribute("required", "");
      await expect(field(name)).toBeHidden();
    }
    await expect(field("event.mapUrl")).toBeHidden();
    await expect(page.getByTestId("place-copy-to-english")).toBeHidden();
    await expect(field("event.locationName")).toHaveValue(secret);
    await expect(field("event.locationNameEn")).toHaveValue(secretEnglish);

    await field("translations.ro.title").fill(`Locație neanunțată ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Locul se anunță curând.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Place to be announced ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "The place is announced soon.");
    await expect(page.getByText(/Nu se poate publica încă/)).toHaveCount(0);

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page, "Creezi și publici evenimentul?");
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
    expect(await page.content()).not.toContain(secretEnglish);

    /*
      The calendar file: the sentence, and no LOCATION for a calendar to route to. At the address
      the page links (`events/[slug]/page.tsx`, `/${locale}/events/${slug}/calendar.ics`): a path
      with an extension skips the proxy, so the localized `/ro/evenimente/…/calendar.ics` this used
      to ask for was the catch-all's 404 — which passed only while every page's payload carried the
      whole catalogue, this sentence included (§353). Hence the status and the type, too.
    */
    const icsResponse = await page.request.get(`/ro/events/${slug}/calendar.ics`);
    expect(icsResponse.status()).toBe(200);
    expect(icsResponse.headers()["content-type"]).toContain("text/calendar");
    const ics = await icsResponse.text();
    expect(ics).toContain("Locația se anunță în curând");
    expect(ics).not.toContain("LOCATION:");
    expect(ics.replace(/\r\n /g, "")).not.toContain(secret);

    // Announcing: the switch off, one save, and the venue is public — nobody is emailed.
    await page.goto(editorUrl);
    await hydrated(page);
    // The Locul box is folded on the editor, and its closed line says the place is to come.
    const place = await openEditorBox(page, "Locul");
    await expect(place.locator(":scope > summary")).toContainText("Se anunță mai târziu");
    await expect(page.getByRole("switch", { name: "Locația se anunță mai târziu" })).toBeChecked();
    await expect(field("event.locationName")).toBeHidden();
    await expect(field("event.locationName")).toHaveValue(secret);

    /*
      A map link typed wrong while the place was shown, then hidden by the switch (§328; §350, the
      editor's boxes, found by re-review): the hidden box used to keep its https rule, so the
      browser refused Salvează over a box it could not show, and said nothing. Hidden, it is
      read-only now — kept, posted, and not a rule the browser checks — and the save goes through.
    */
    const mapUrl = field("event.mapUrl");
    const save = page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true });
    await toggle.uncheck();
    await mapUrl.fill("www.harta-gresita.ro");
    await toggle.check();
    await expect(mapUrl).toBeHidden();
    await expect(mapUrl).toHaveValue("www.harta-gresita.ro");
    expect(await mapUrl.evaluate((input: HTMLInputElement) => input.willValidate)).toBe(false);
    // Switched off, the box is on screen with what was typed, and the browser refuses it again.
    await toggle.uncheck();
    await expect(mapUrl).toBeVisible();
    await expect(mapUrl).toHaveValue("www.harta-gresita.ro");
    expect(await mapUrl.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
    // The event is live, so the save carries the live-edit acknowledgement, as every such save does.
    await page.locator('[name="acknowledgeLiveEdit"]').check();
    const before = page.url();
    await save.click();
    await expect(mapUrl).toBeFocused();
    expect(page.url()).toBe(before);
    // On again, and Salvează goes through: the place is still to come, and the link that was not
    // one is stored as none (`ignoreHiddenFields`).
    await toggle.check();
    await save.click();
    await expect(page.locator("#admin-alert")).toContainText("Modificările au fost salvate.", { timeout: 15_000 });
    await expect(page.getByTestId("place-announced")).toHaveCount(0);
    await hydrated(page);
    await openEditorBox(page, "Locul");
    await expect(page.getByRole("switch", { name: "Locația se anunță mai târziu" })).toBeChecked();
    await expect(field("event.mapUrl")).toHaveValue("");

    await page.getByRole("switch", { name: "Locația se anunță mai târziu" }).uncheck();
    await expect(field("event.locationName")).toBeVisible();
    await expect(field("event.locationName")).toHaveAttribute("required", "");
    await expect(field("event.locationNameEn")).toBeVisible();
    await expect(field("event.locationNameEn")).toHaveAttribute("required", "");
    await expect(field("event.locationNameEn")).toHaveValue(secretEnglish);
    await page.locator('[name="acknowledgeLiveEdit"]').check();
    await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("place-announced")).toContainText("Locația e anunțată");

    await page.goto(`/ro/evenimente/${slug}`);
    await expect(page.locator("main").getByText(secret).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Locația se anunță în curând");
    // The English page names the place in English, never the Romanian words (§362).
    await page.goto(`/en/events/${englishSlug}`);
    await expect(page.locator("main").getByText(secretEnglish).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(secret);

    // Off the site again.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});
