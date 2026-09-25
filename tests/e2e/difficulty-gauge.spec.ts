import { expect, type Locator, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";
import { cardOnListing, openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §NNN — five difficulty levels and a gauge (the owner, 2026-09-25: "vreau să fie
 * foarte ușor, ușor, mediu, greu și foarte greu — sau un gauge icon custom mai degrabă"),
 * replacing §399's scale of weights. One glyph, drawn by `DifficultyGaugeIcon.tsx` and shared
 * through `RoutePills` (§388) by every surface: the event page's pill, the listing card's, the
 * backoffice's own list, and the editor's select.
 *
 * The gauge says its level with `data-level` and with how many of its five arc segments are lit
 * (`difficulty-gauge-on`) and faint (`difficulty-gauge-off`): "Mediu" (`MODERATE`) is the third
 * of five, so three lit and two faint; the seeded interval session is "Foarte greu" (`VERY_HARD`),
 * all five lit.
 *
 * The level's word says a level without saying of what; `GlyphChip`'s `srSuffix` follows it with
 * «— Dificultate» in a visually-hidden span. A plain, roleless `<div>` (MUI's `Chip` when it is
 * not `clickable`) has no computed accessible name, so the check is the real text — `toContainText`.
 */
async function expectGauge(pill: Locator, level: number) {
  const gauge = pill.locator('svg[data-testid="difficulty-gauge"]');
  await expect(gauge).toHaveCount(1);
  await expect(gauge).toHaveAttribute("aria-hidden", "true");
  await expect(gauge).toHaveAttribute("data-level", String(level));
  await expect(gauge.locator('[data-testid="difficulty-gauge-on"]')).toHaveCount(level);
  await expect(gauge.locator('[data-testid="difficulty-gauge-off"]')).toHaveCount(5 - level);
  await expect(gauge.locator('[data-testid="difficulty-gauge-needle"]')).toHaveCount(1);
}

test.describe("BR-REQ-041-01 the difficulty gauge (§NNN)", () => {
  test("the event page's route row keeps the word beside the gauge, the needle at the third of five", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    const traseu = page.getByTestId("event-facts").locator("dt", { hasText: /^Traseu$/ }).locator("xpath=following-sibling::dd[1]");
    const difficultyPill = traseu.locator(".MuiChip-root", { hasText: "Mediu" });
    await expect(difficultyPill).toBeVisible();
    await expect(difficultyPill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(difficultyPill).toContainText("Mediu — Dificultate");
    await expectGauge(difficultyPill, 3);
  });

  test("the English page says the level in English, with the field's name hidden after it", async ({ page }) => {
    await page.goto("/en/events/tampa-trail");
    const pill = page.getByTestId("event-facts").locator(".MuiChip-root", { hasText: "Moderate" });
    await expect(pill).toContainText("Moderate — Difficulty");
    await expectGauge(pill, 3);
  });

  for (const width of [320, 360] as const) {
    test(`the listing card's compact pill keeps the word beside the gauge and fits at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente");
      // The "other events" fold opens by itself only up to four cards (§89): `cardOnListing` opens it (the fix origin/qa gave the old spec).
      const card = (await cardOnListing(page, "Tură pe Tâmpa")).first();
      const pill = card.locator('[data-fact="pills"] .MuiChip-root', { hasText: "Mediu" });
      await expect(pill).toBeVisible();
      await expect(pill).toContainText("Mediu — Dificultate");
      await expectGauge(pill, 3);
      // The hardest end of the scale, on the seeded interval session (§NNN's seed).
      const hardest = page.locator("li", { hasText: "Antrenament de intervale" }).first().locator('[data-fact="pills"] .MuiChip-root', { hasText: "Foarte greu" });
      await expect(hardest).toContainText("Foarte greu — Dificultate");
      await expectGauge(hardest, 5);
      // Nothing wider than the phone (§375's 320px lead).
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // Measured and reported: the pill's own width, and the gauge's, at this viewport.
      const pillBox = await pill.boundingBox();
      const gaugeBox = await pill.locator("svg.MuiChip-icon").boundingBox();
      expect(gaugeBox?.width ?? 0).toBeLessThanOrEqual(24);
      const measured = `pill ${pillBox?.width ?? "unmeasured"}px, gauge ${gaugeBox?.width ?? "unmeasured"}px, "Foarte greu" pill ${(await hardest.boundingBox())?.width ?? "unmeasured"}px at viewport ${width}px (${testInfo.project.name})`;
      await testInfo.attach(`difficulty-pill-width-${width}px`, { body: measured });
      console.log(`difficulty-pill-width: ${measured}`);
      if (width === 320) {
        await testInfo.attach("difficulty-card-320px", { body: await card.screenshot(), contentType: "image/png" });
        await testInfo.attach("difficulty-card-very-hard-320px", {
          body: await page.locator("li", { hasText: "Antrenament de intervale" }).first().screenshot(),
          contentType: "image/png",
        });
      }
    });
  }

  test("the backoffice list's card keeps the word beside the gauge (§388)", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin");
    await hydrated(page);
    const pill = page.locator(".MuiChip-root:visible", { hasText: "Mediu" }).first();
    await expect(pill).toBeVisible();
    await expect(pill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(pill).toContainText("Mediu — Dificultate");
    await expectGauge(pill, 3);
  });

  test("the editor's select offers the five levels in order, each with its gauge", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await openEditorBox(page, "Traseul");
    await page.getByRole("combobox", { name: "Dificultate" }).click();
    const levels = ["Foarte ușor", "Ușor", "Mediu", "Greu", "Foarte greu"];
    for (const [index, word] of levels.entries()) {
      const option = page.getByRole("option", { name: word, exact: true });
      await expect(option).toBeVisible();
      await expect(option.locator('svg[data-testid="difficulty-gauge"]')).toHaveAttribute("data-level", String(index + 1));
    }
    // The order is the scale's: "Nespecificat" first, then very easy to very hard.
    await expect(page.getByRole("option")).toHaveText([/.+/, ...levels]);
    await page.getByRole("option", { name: "Foarte greu", exact: true }).click();
    await expect(page.locator('[name="event.difficulty"]')).toHaveValue("VERY_HARD");
  });
});
