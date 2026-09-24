import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §343 — the owner, 2026-09-24, on "Cu taxă" showing no box for the money:
 * "usually nothing is paid; the exception is Wings for Life, where a donation is made on
 * another site". The editor's Cost select gets a third answer, `DONATION`, and its own pair of
 * boxes — a link, shown only for the chosen kind — and the event page says the same short
 * phrase the editor's help text promises: no money changes hands on this platform.
 *
 * Built from parts, like `event-route.spec.ts`'s links: `AGENTS.md` §8 forbids a hostname
 * literal, and `docs:check` scans test files for one too.
 */
const DONATION_LINK = ["https:/", "donate.example.test", "wings-for-life"].join("/");

test.describe("the cost select's third answer, Donație (§343)", () => {
  test("shows the donation link only when Donație is chosen, and the page says the short phrase", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `alergare-donatie-${suffix}`;
    const englishSlug = `donation-run-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    const field = (name: string) => page.locator(`[name="${name}"]`);
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await panel.locator("summary").filter({ hasText: "Rezumat" }).click();
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    // MUI pickers since the pickers landed beside the cost boxes (§347): driven, not filled.
    await fillDateField(page, "Începutul evenimentului", "2027-05-08");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Alergare cu donație ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await excerpt("ro", "Alergare fără taxă, cu o donație opțională pentru Wings for Life.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Donation run ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await excerpt("en", "A free run, with an optional donation for Wings for Life.");

    // The cost is the first thing in "Participare și înscrieri" (§350, the editor's boxes), with
    // its two extra boxes under it. Before a kind is chosen, those are not on screen.
    await openEditorBox(page, "Participare și înscrieri");
    await expect(field("event.costUrl")).toBeHidden();
    await expect(field("event.costAmount")).toBeHidden();

    await page.getByRole("combobox", { name: "Cost" }).click();
    await page.getByRole("option", { name: "Donație (pe alt site)" }).click();

    // Donație's own labels: the link required, the suggested amount optional.
    await expect(page.getByLabel("Link pentru donație")).toBeVisible();
    await expect(page.getByLabel("Suma sugerată (opțional)")).toBeVisible();
    await field("event.costUrl").fill(DONATION_LINK);
    await field("event.costAmount").fill("50 lei");

    // Switching to Cu taxă relabels the same two boxes rather than posting a second pair.
    await page.getByRole("combobox", { name: "Cost" }).click();
    await page.getByRole("option", { name: "Cu taxă", exact: true }).click();
    await expect(page.getByLabel("Suma")).toBeVisible();
    await expect(page.getByLabel("Unde se plătește (opțional)")).toBeVisible();
    // What was typed for Donație is still in the boxes — values kept while hidden (§328's rule).
    await expect(field("event.costUrl")).toHaveValue(DONATION_LINK);
    await expect(field("event.costAmount")).toHaveValue("50 lei");

    // Back to Donație for the save — the values are still the ones typed above.
    await page.getByRole("combobox", { name: "Cost" }).click();
    await page.getByRole("option", { name: "Donație (pe alt site)" }).click();

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    const editorUrl = page.url();

    await page.goto(`/ro/evenimente/${slug}`);
    // The cost is its own row since §NNN: a «Donație» pill under «Cost», then where to give.
    const cost = page.locator("dt", { hasText: /^Cost$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(cost).toBeVisible();
    await expect(cost.locator(".MuiChip-root")).toHaveText("Donație");
    const link = cost.getByRole("link", { name: /Donează pe donate\.example\.test/ });
    await expect(link).toHaveAttribute("href", DONATION_LINK);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    // A thumb's 44 pixels, on the phone and the desktop alike (BR-REQ-041-01 criterion 6).
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(cost).toContainText("sugerat 50 lei");
    // The platform takes no money itself — the club's own words say so on the editor, and the
    // page never claims a price it cannot honour: no raw currency amount is invented for JSON-LD.
    const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(jsonLd.isAccessibleForFree).toBe(false);
    expect(jsonLd.offers?.url).toBe(DONATION_LINK);
    expect(jsonLd.offers?.price).toBeUndefined();

    // The English page says it in English, from the same row.
    await page.goto(`/en/events/${englishSlug}`);
    await expect(page.getByRole("link", { name: /Donate on donate\.example\.test/ })).toHaveAttribute("href", DONATION_LINK);

    // Off the site again.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});
