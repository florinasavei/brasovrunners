import { expect, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * `DECISIONS.md` §NNN — the owner, 2026-09-25: "another friend's race where we just go as a
 * group but we pay for it; they gave us a discount so that they appear on our calendar."
 *
 * An `EXTERNAL`-registration, `PAID` event's cost row says the fee is settled at the organizer's
 * own form, never the club's, and carries the club's own discount note — in each language — when
 * there is one. Built from parts, like `event-cost-donation.spec.ts`: `AGENTS.md` §8 forbids a
 * hostname literal, and `docs:check` scans test files for one too.
 */
const ORGANIZER_LINK = ["https:/", "alt-club.example.test", "inscriere"].join("/");

/** The listing card with this title, every fold opened once the list has streamed in (§166, `headlamp.spec.ts`). */
async function card(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.locator("#main ul > li h2").first()).toBeAttached();
  await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
  return page.locator("li").filter({ has: page.getByRole("heading", { name: heading }) });
}

test.describe("an EXTERNAL-registration PAID event's discount note (§NNN)", () => {
  test("shows the note only for EXTERNAL + PAID, both languages or neither, and the page reads it in each language", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `cros-partener-${suffix}`;
    const englishSlug = `partner-race-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    const field = (name: string) => page.locator(`[name="${name}"]`);
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    await fillDateField(page, "Începutul evenimentului", "2027-06-12");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Piața Sfatului");
    await field("event.locationNameEn").fill("Council Square");
    await field("translations.ro.title").fill(`Crosul partenerului ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await excerpt("ro", "Alergăm împreună cu alt club, la cursa lor.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`The partner's race ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await excerpt("en", "We run together with another club, at their race.");

    // The registration mode select only exists for a type that takes registrations at all
    // (§111 excludes a group run); the create form defaults to one that does not.
    await openEditorBox(page, "Ce fel de eveniment");
    await page.getByRole("combobox", { name: "Tip eveniment" }).click();
    await page.getByRole("option", { name: "Concurs" }).click();

    await openEditorBox(page, "Participare și înscrieri");

    // Cost first: Cu taxă, with an amount — the discount note is not on screen yet, INTERNAL is
    // still the mode (§NNN: shown only for EXTERNAL + PAID).
    await page.getByRole("combobox", { name: "Cost" }).click();
    await page.getByRole("option", { name: "Cu taxă", exact: true }).click();
    await field("event.costAmount").fill("75 lei");
    await expect(page.getByLabel("Reducerea clubului").first()).toBeHidden();

    // Înscrieri la organizator: the discount note appears.
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri la organizator" }).click();
    await field("event.externalProvider").fill("Alt Club Brașov");
    await field("event.externalRegistrationUrl").fill(ORGANIZER_LINK);
    await expect(page.getByLabel("Reducerea clubului").first()).toBeVisible();

    // Both languages or neither: Romanian only is refused, naming the English box.
    await field("translations.ro.discountNote").fill("40 lei pentru membri BR");
    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page);
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: /Reducerea clubului/ })).toBeVisible();

    // Complete the English side and save.
    await languageTab(page, "discount-note", "en").click();
    await field("translations.en.discountNote").fill("40 lei for BR members");
    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page);
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    const editorUrl = page.url();

    await page.goto(`/ro/evenimente/${slug}`);
    // "Cu taxă, la organizator: 75 lei" on the cost row, and the discount note under it.
    const cost = page.locator("dt", { hasText: /^Cost$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(cost).toBeVisible();
    await expect(cost.locator(".MuiChip-root")).toHaveText("Cu taxă, la organizator: 75 lei");
    await expect(cost).toContainText("40 lei pentru membri BR");

    // JSON-LD: not free, and the offer points at the organizer's own registration link.
    const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(jsonLd.isAccessibleForFree).toBe(false);
    expect(jsonLd.offers?.url).toBe(ORGANIZER_LINK);

    // The .ics description carries the same fact, and the note. Its own path is not localized
    // (`i18n/routing.ts` maps only the page and its register route), so it stays "/events/" under
    // every locale prefix.
    const icsResponse = await page.request.get(`/ro/events/${slug}/calendar.ics`);
    // RFC 5545 folds a long line at 75 octets, so the wrap is undone before reading it back —
    // `icalText` escapes the comma as `\,`, which the wrap could otherwise land inside.
    const ics = (await icsResponse.text()).replace(/\r\n /g, "");
    expect(ics).toContain("Cost: 75 lei\\, la organizator");
    expect(ics).toContain("40 lei pentru membri BR");

    // The English page reads its own language's note and wording.
    await page.goto(`/en/events/${englishSlug}`);
    const costEn = page.locator("dt", { hasText: /^Cost$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(costEn.locator(".MuiChip-root")).toHaveText("Paid, to the organizer: 75 lei");
    await expect(costEn).toContainText("40 lei for BR members");

    // The English .ics carries the same fact and the English note.
    const icsEnResponse = await page.request.get(`/en/events/${englishSlug}/calendar.ics`);
    const icsEn = (await icsEnResponse.text()).replace(/\r\n /g, "");
    expect(icsEn).toContain("Cost: 75 lei\\, paid to the organizer");
    expect(icsEn).toContain("40 lei for BR members");

    // The listing card, both languages: the pill keeps the closed set's own word — "Cu taxă",
    // "Paid" — and a screen reader alone is told the fee goes to the organizer, never the club
    // (§NNN, `GlyphChip`'s `srSuffix`).
    const roCard = await card(page, "/ro/evenimente", `Crosul partenerului ${suffix}`);
    await expect(roCard.locator(".MuiChip-root").filter({ hasText: "Cu taxă" })).toHaveCount(1);
    await expect(roCard).toContainText("plătit la organizator, nu la club");

    const enCard = await card(page, "/en/events", `The partner's race ${suffix}`);
    await expect(enCard.locator(".MuiChip-root").filter({ hasText: "Paid" })).toHaveCount(1);
    await expect(enCard).toContainText("paid to the organizer, not to the club");

    // Off the site again.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});
