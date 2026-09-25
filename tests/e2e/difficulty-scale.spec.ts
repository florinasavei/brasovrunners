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
 *
 * `GlyphChip`'s `ariaLabel` moved off the chip's own `aria-label` attribute to a
 * visually-hidden `<span>` in the label's content (fix round, finding 1) — `toHaveAccessibleName`
 * is *not* the right check for it: a plain, roleless `<div>` (what MUI's `Chip` renders when it
 * is not `clickable`) has no accessible name computed for it at all under the accessible-name
 * algorithm, hidden span or not, which is exactly why an `aria-label` on it went unheard.
 * Browse-mode screen readers instead read every text node in visual order regardless of that
 * computed name, so the check here is that the hidden text is a real, present text node ahead of
 * the visible word — `expect(pill).toContainText(…)`, which reads DOM text content, not the
 * accessible-name API.
 *
 * The compact pill's fit at the phone widths the brief named — 320 and 360px, §375's own set —
 * gets its own dumbbell counts at each width (fix round, finding 4: the first pass measured only
 * "no sideways scroll", true of the old, narrower icon too and so never actually exercised the
 * wider one), and its measured pixel width is attached to the test report at both.
 */
test.describe("BR-REQ-041-01 the difficulty scale (§NNN)", () => {
  test("the event page's route row keeps the word beside the scale, two of three dumbbells lit", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    const traseu = page.getByTestId("event-facts").locator("dt", { hasText: /^Traseu$/ }).locator("xpath=following-sibling::dd[1]");
    const difficultyPill = traseu.locator(".MuiChip-root", { hasText: "Mediu" });
    await expect(difficultyPill).toBeVisible();
    // The word is what a screen reader hears from the text content; the scale is decoration.
    await expect(difficultyPill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(difficultyPill).toContainText("Dificultate: Mediu");
    await expect(difficultyPill.locator('[data-testid="difficulty-dumbbell-on"]')).toHaveCount(2);
    await expect(difficultyPill.locator('[data-testid="difficulty-dumbbell-off"]')).toHaveCount(1);
  });

  for (const width of [320, 360] as const) {
    test(`the listing card's compact pill keeps the word beside the scale, two of three dumbbells lit, and fits at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente");
      const card = page.locator("li", { hasText: "Tură pe Tâmpa" }).first();
      const pill = card.locator('[data-fact="pills"] .MuiChip-root', { hasText: "Mediu" });
      await expect(pill).toBeVisible();
      await expect(pill.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(pill).toContainText("Dificultate: Mediu");
      await expect(pill.locator('[data-testid="difficulty-dumbbell-on"]')).toHaveCount(2);
      await expect(pill.locator('[data-testid="difficulty-dumbbell-off"]')).toHaveCount(1);
      // Still nothing wider than the phone with the scale's extra width (§375's 320px lead).
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // Measured and reported, not merely bounded — the pill's own pixel width at this viewport.
      const box = await pill.boundingBox();
      await testInfo.attach(`difficulty-pill-width-${width}px`, { body: `${box?.width ?? "unmeasured"}px at viewport ${width}px` });
    });
  }

  test("the backoffice list's card keeps the word beside the scale, two of three dumbbells lit (§388)", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin");
    await hydrated(page);
    const pill = page.locator(".MuiChip-root:visible", { hasText: "Mediu" }).first();
    await expect(pill).toBeVisible();
    await expect(pill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(pill).toContainText("Dificultate: Mediu");
    await expect(pill.locator('[data-testid="difficulty-dumbbell-on"]')).toHaveCount(2);
    await expect(pill.locator('[data-testid="difficulty-dumbbell-off"]')).toHaveCount(1);
  });
});
