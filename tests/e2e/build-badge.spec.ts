import { expect, test } from "@playwright/test";

/**
 * The build badge, part of the shared chrome (AGENTS.md §8; `shared/ui/BuildBadge.tsx`).
 *
 * A fixed element in the bottom-right corner is exactly the kind of thing that is fine on a
 * desktop and covers a link on a phone, so the interesting assertions here are the mobile
 * ones: it must not swallow a tap, and it must not widen the document.
 *
 * These run against the seeded database, so `docker compose up -d db && yarn db:seed` first.
 */

const badge = (page: import("@playwright/test").Page) =>
  page.getByLabel(/versiunea site-ului|website version/i);

/**
 * The other half of "which site am I looking at": the badge answers it for whoever knows to
 * look in the corner, and this answers it for a visitor who does not.
 */
test.describe("the environment notice", () => {
  test("tells a visitor this is not the club's real site, in both languages", async ({ page }) => {
    await page.goto("/ro/evenimente");
    await expect(page.getByText(/nu este site-ul real al clubului/i)).toBeVisible();

    await page.goto("/en/events");
    await expect(page.getByText(/not the club's real website/i)).toBeVisible();
  });

  test("sits above the header, so it is read before anything below it", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const notice = await page.getByRole("complementary").first().boundingBox();
    const header = await page.getByRole("banner").first().boundingBox();
    expect(notice).not.toBeNull();
    expect(header).not.toBeNull();
    expect(notice!.y).toBeLessThan(header!.y);
  });

  test("does not push the page past a 320px viewport", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});

test.describe("the build badge", () => {
  test("names a version on every page, in both locales", async ({ page }) => {
    for (const path of ["/ro/evenimente", "/en/events", "/ro/confidentialitate"]) {
      await page.goto(path);
      // Either the baseline and a commit, or the "dev" fallback when a build had no git.
      await expect(badge(page)).toHaveText(/BR-V\d+\.\d+|dev/);
    }
  });

  test("shows when the code behind it was last changed, to the minute", async ({ page }) => {
    await page.goto("/ro/evenimente");
    // A year is the part that is stable across locales; the month name is not. The time is
    // what separates two deploys on the same afternoon.
    await expect(badge(page)).toHaveText(/\d{4}/);
    await expect(badge(page)).toHaveText(/\d{2}:\d{2}/);
  });

  test("names the environment, so qa and production are never confused", async ({ page }) => {
    await page.goto("/ro/evenimente");
    await expect(badge(page)).toHaveText(/^(local|test|qa|production) · /);
  });

  test("does not swallow a tap in the corner it occupies", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // `pointer-events: none` is what makes this true — assert the behaviour, not the
    // declaration, so a refactor that keeps the effect keeps passing.
    const box = await badge(page).boundingBox();
    expect(box).not.toBeNull();
    const atBadge = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest("[aria-label]")?.getAttribute("aria-label") ?? null;
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    );
    // `?? ""` because the usual pass is `null` — the point hits page content with no labelled
    // ancestor at all, which is the same success as hitting something that is not the badge.
    expect(atBadge ?? "").not.toMatch(/versiunea site-ului|website version/i);
  });

  test("does not widen the document past the viewport", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // BR-REQ-041-01 criterion 1, restated for the one element positioned outside the flow.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("leaves the footer's legal links reachable", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // The badge sits above the footer's own corner: the link must still be clickable, which
    // is the failure a fixed overlay actually causes on a 320px screen.
    await page.getByRole("link", { name: /confidențialitate/i }).click();
    await expect(page).toHaveURL(/\/ro\/confidentialitate/);
  });
});
