import { expect, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §NNN — the difficulty as a scale of dumbbells (the owner, 2026-09-25: "I want
 * also for the difficulty to have a better icon system, like weights or something"), replacing
 * the phone-signal bars §112 first chose. One glyph, drawn by `DifficultyIcon.tsx` and shared
 * through `RoutePills` (§388) by every surface: the event page's pill, the listing card's, and
 * the backoffice's own list.
 *
 * "Mediu" (`MODERATE`) is the middle of three levels, so every assertion below expects exactly
 * two dumbbells lit (`data-testid="difficulty-dumbbell-on"`) and one faint
 * (`data-testid="difficulty-dumbbell-off"`) — the fix round's finding 4: the first pass checked
 * only that the word was visible, which was already true of the old signal-bar icon and so never
 * actually tested the change.
 */
test.describe("BR-REQ-041-01 the difficulty scale (§NNN)", () => {
  test("the event page's route row keeps the word beside the scale, two of three dumbbells lit", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    const traseu = page.getByTestId("event-facts").locator("dt", { hasText: /^Traseu$/ }).locator("xpath=following-sibling::dd[1]");
    const difficultyPill = traseu.locator(".MuiChip-root", { hasText: "Mediu" });
    await expect(difficultyPill).toBeVisible();
    // The word is what a screen reader hears from the text content; the scale is decoration.
    await expect(difficultyPill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(difficultyPill).toHaveAttribute("aria-label", "Dificultate: Mediu");
    await expect(difficultyPill.locator('[data-testid="difficulty-dumbbell-on"]')).toHaveCount(2);
    await expect(difficultyPill.locator('[data-testid="difficulty-dumbbell-off"]')).toHaveCount(1);
  });

  test("the listing card's compact pill keeps the word beside the scale, two of three dumbbells lit, and fits at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/ro/evenimente");
    const card = page.locator("li", { hasText: "Tură pe Tâmpa" }).first();
    const pill = card.locator('[data-fact="pills"] .MuiChip-root', { hasText: "Mediu" });
    await expect(pill).toBeVisible();
    await expect(pill.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(pill).toHaveAttribute("aria-label", "Dificultate: Mediu");
    await expect(pill.locator('[data-testid="difficulty-dumbbell-on"]')).toHaveCount(2);
    await expect(pill.locator('[data-testid="difficulty-dumbbell-off"]')).toHaveCount(1);
    // Still nothing wider than the phone with the scale's extra width (§375's 320px lead).
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("the backoffice list's card keeps the word beside the scale, two of three dumbbells lit (§388)", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin");
    await hydrated(page);
    const pill = page.locator(".MuiChip-root:visible", { hasText: "Mediu" }).first();
    await expect(pill).toBeVisible();
    await expect(pill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(pill).toHaveAttribute("aria-label", "Dificultate: Mediu");
    await expect(pill.locator('[data-testid="difficulty-dumbbell-on"]')).toHaveCount(2);
    await expect(pill.locator('[data-testid="difficulty-dumbbell-off"]')).toHaveCount(1);
  });
});
