import { expect, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import {
  FEATURED,
  ensureRegistrationIsOpen,
  fillDateField,
  fillTimeField,
  hydrated,
  signIn,
  withFeaturedEventLock,
} from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * `DECISIONS.md` §394 — the owner, 2026-09-25: "another friend's race where we just go as a
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

test.describe("an EXTERNAL-registration PAID event's discount note (§394)", () => {
  // The second test below mutates the shared singleton `FEATURED` event for its own duration
  // (see its own docstring); serial keeps it from ever overlapping the first test in this file,
  // which reads nothing of `FEATURED`, so the two cannot race each other in the same worker.
  // `mode: "serial"` only orders the two tests within *one* project's own run of this file —
  // `mobile` and `desktop` each run it in a separate process, so the second test also takes
  // `withFeaturedEventLock`, the advisory lock the two projects share.
  test.describe.configure({ mode: "serial" });

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

    await openEditorBox(page, "Cost");
    await openEditorBox(page, "Participare și înscrieri");

    // Cost first: Cu taxă, with an amount — the discount note is not on screen yet, INTERNAL is
    // still the mode (§394: shown only for EXTERNAL + PAID).
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
    // (§394, `GlyphChip`'s `srSuffix`).
    // `toHaveAccessibleName` finds nothing here — MUI's `Chip` is a plain, roleless `<div>` when
    // it is not clickable, and ARIA 1.2 gives a generic element no computed name at all, which is
    // exactly why `GlyphChip`'s suffix is visually-hidden *text inside the chip* rather than an
    // `aria-label` (`route-pills.ts`, `GlyphChip.tsx`). Asserted on the chip's own text, not
    // merely somewhere in the card's `li` — a card with other chips nearby could otherwise pass
    // this on unrelated text.
    const roCard = await card(page, "/ro/evenimente", `Crosul partenerului ${suffix}`);
    const roChip = roCard.locator(".MuiChip-root").filter({ hasText: "Cu taxă" });
    await expect(roChip).toHaveCount(1);
    await expect(roChip).toHaveText("Cu taxă — plătit la organizator, nu la club");

    const enCard = await card(page, "/en/events", `The partner's race ${suffix}`);
    const enChip = enCard.locator(".MuiChip-root").filter({ hasText: "Paid" });
    await expect(enChip).toHaveCount(1);
    await expect(enChip).toHaveText("Paid — paid to the organizer, not to the club");

    // Off the site again.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });

  /**
   * The listing's featured hero (`FeaturedEventHero`) reads the same cost pill and discount note
   * as the event page (§394) — this is the one spot that has to borrow the *shared* singleton
   * event (`ensureRegistrationIsOpen`'s own `FEATURED`, `DECISIONS.md` §28: "the database refuses
   * a second [featured event]"), so the change is made and read back inside a `try`/`finally`:
   * whatever this test finds, the featured event is always left exactly as every other spec
   * expects it (`ensureRegistrationIsOpen`'s own end state, cost `FREE`), even on a failed
   * assertion.
   */
  test("shows the same cost pill and note on the listing's featured hero", async ({ page }) => {
    // Two full editor saves plus the `finally` block's own recovery (`ensureRegistrationIsOpen`
    // retries up to three times) — well past the 30-second default a lighter spec fits in.
    test.setTimeout(90_000);
    // The whole case, lock included: `mobile` and `desktop` are separate processes, and
    // `mode: "serial"` above only orders tests inside one of them (§394).
    await withFeaturedEventLock(() => runFeaturedHeroCase(page));
  });
});

/**
 * Split out so `withFeaturedEventLock` can wrap the whole case above, from the first mutation of
 * `FEATURED` to the `finally` block's own recovery — otherwise the two projects could still
 * interleave around the edges of the lock.
 */
async function runFeaturedHeroCase(page: Page): Promise<void> {
  await signIn(page, "Dev Administrator");
  try {
    await page.goto("/ro/admin");
    await page.getByRole("link", { name: FEATURED.title }).first().click();
    await expect(page).toHaveURL(/\/admin\/events\//);
    await hydrated(page);

    await openEditorBox(page, "Cost");
    await openEditorBox(page, "Participare și înscrieri");
    await page.getByRole("combobox", { name: "Cost" }).click();
    await page.getByRole("option", { name: "Cu taxă", exact: true }).click();
    await page.locator('[name="event.costAmount"]').fill("75 lei");
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri la organizator" }).click();
    await page.locator('[name="event.externalProvider"]').fill("Alt Club Brașov");
    await page.locator('[name="event.externalRegistrationUrl"]').fill(["https:/", "alt-club.example.test", "inscriere"].join("/"));
    await page.locator('[name="translations.ro.discountNote"]').fill("40 lei pentru membri BR");
    await languageTab(page, "discount-note", "en").click();
    await page.locator('[name="translations.en.discountNote"]').fill("40 lei for BR members");

    const acknowledge = page.locator('[name="acknowledgeLiveEdit"]');
    if (await acknowledge.count()) await acknowledge.check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/[?&]saved=/);

    // Unlike the event page's own cost row, the hero has no row of its own for the cost: it
    // folds into "Traseu" (route) as one of the line's pieces (`EventFacts`'s `!stacked`
    // branch, above the event's page code) — a "Cost" `dt` the way the stacked page has one
    // would never be found here.
    await page.goto("/ro/evenimente");
    const hero = page.locator('section[aria-labelledby="featured-event-title"]').first();
    await expect(hero).toBeVisible();
    const route = hero.locator("dt", { hasText: /^Traseu$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(route).toContainText("Cu taxă, la organizator: 75 lei");
    await expect(route).toContainText("40 lei pentru membri BR");

    await page.goto("/en/events");
    const heroEn = page.locator('section[aria-labelledby="featured-event-title"]').first();
    const routeEn = heroEn.locator("dt", { hasText: /^Route$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(routeEn).toContainText("Paid, to the organizer: 75 lei");
    await expect(routeEn).toContainText("40 lei for BR members");
  } finally {
    // Back to the baseline every other spec finds `FEATURED` in — free, on-site registration —
    // whether the assertions above passed or not. Cost alone, first, while the mode is still
    // `EXTERNAL` (so this save needs no declaration — `assertCoherentRegistrationBlock` only
    // asks for one under `INTERNAL`); `ensureRegistrationIsOpen` then moves the mode itself,
    // which is the one helper that knows how to choose the approved declaration.
    await page.goto("/ro/admin");
    await page.getByRole("link", { name: FEATURED.title }).first().click();
    await expect(page).toHaveURL(/\/admin\/events\//);
    await hydrated(page);
    await openEditorBox(page, "Cost");
    await page.getByRole("combobox", { name: "Cost" }).click();
    await page.getByRole("option", { name: "Gratuit", exact: true }).click();
    const ack = page.locator('[name="acknowledgeLiveEdit"]');
    if (await ack.count()) await ack.check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/[?&]saved=/);
    await ensureRegistrationIsOpen(page);
  }
}
