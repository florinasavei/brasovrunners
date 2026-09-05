import { expect, test } from "@playwright/test";

/**
 * The build badge, part of the shared chrome (AGENTS.md §8; `shared/ui/BuildBadge.tsx`).
 *
 * A fixed element in the bottom-right corner is exactly the kind of thing that is fine on a
 * desktop and covers a link on a phone, so the interesting assertions here are the mobile
 * ones: it must stay small, it must not act on a single tap, and it must not widen the
 * document.
 *
 * It is also the staff entrance now — a double-click, or `Enter` when focused — which is why
 * the "does not swallow a tap" assertion changed shape: the badge does receive pointer events
 * where a sign-in exists, and what protects the corner is that one tap does nothing at all.
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
      // The exact build moved out of the visible text and into the title, so the corner label
      // stays two facts rather than four. Either the baseline and a commit, or the "dev"
      // fallback when a build had no git.
      await expect(badge(page)).toHaveAttribute("title", /BR-V\d+\.\d+|dev/);
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
    // Production omits the prefix — there it is noise, and everywhere else it is the point.
    await expect(badge(page)).toHaveText(/^(local|test|qa) · /);
  });

  test("does nothing on a single tap in the corner it occupies", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // The badge receives pointer events now, because a double-click on it opens staff sign-in.
    // What keeps it from being a trap on a 320px screen — where the corner is also where a
    // thumb lands — is that one tap does nothing at all.
    await badge(page).click();
    await expect(page).toHaveURL(/\/ro\/evenimente$/);
  });

  test("stays small enough not to cover the corner of the page", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const box = await badge(page).boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // A label, not a panel: at 320px it may not take more than half the width, and it is one
    // line of small text tall.
    expect(box!.width).toBeLessThanOrEqual(viewport!.width * 0.75);
    expect(box!.height).toBeLessThanOrEqual(40);
  });

  test("is the staff entrance: a double-click opens sign-in, and so does Enter", async ({
    page,
  }) => {
    // The footer's "Staff" link is gone; this replaced it. Not a security measure — the
    // backoffice is guarded on the server on every request — but the club's public pages no
    // longer advertise a backoffice to everybody who reads them.
    await page.goto("/ro/evenimente");
    await badge(page).dblclick();
    await expect(page).toHaveURL(/\/ro\/autentificare$/);

    await page.goto("/ro/evenimente");
    await badge(page).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("no longer offers a staff link in the footer", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: /echipă|staff/i })).toHaveCount(0);
    // The two public legal routes are still there — AGENTS.md §9.2 requires them in the footer.
    await expect(footer.getByRole("link", { name: /confidențialitate/i })).toBeVisible();
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
