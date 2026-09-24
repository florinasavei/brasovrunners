import { expect, test } from "@playwright/test";

/**
 * The build badge, part of the shared chrome (AGENTS.md §8; `shared/ui/BuildBadge.tsx`).
 *
 * It was a fixed label in the bottom-right corner from `md` and a line under the footer below
 * that, read by every visitor on every page. Since §NNN (the owner, 2026-09-24: "version shows
 * by default") it is the last line of the footer's "Despre club" fold: on screen at no width
 * until somebody opens it. So every test that presses it opens the fold first, the way a
 * person would.
 *
 * It is also the staff entrance — a double-click, a long press, or `Enter` when focused — and
 * what keeps it from being a trap is that one tap does nothing at all.
 *
 * These run against the seeded database, so `docker compose up -d db && yarn db:seed` first.
 */

const badge = (page: import("@playwright/test").Page) =>
  page.getByLabel(/versiunea site-ului|website version/i);

/** "Despre club", the fold the stamp is in. */
async function openTheFold(page: import("@playwright/test").Page) {
  await page.getByRole("contentinfo").locator("summary").click();
  await expect(badge(page)).toBeVisible();
}

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

  test("stamps the build with a version and an ISO date, in both locales", async ({ page }) => {
    // "17 sept. 2026" beside a version was read as the date the *club* last posted something.
    // `app-ver` and an ISO date read as what they are — the build — and they read identically in
    // Romanian and English, which is the point of choosing ISO over either locale's format.
    for (const path of ["/ro/evenimente", "/en/events"]) {
      await page.goto(path);
      await expect(badge(page)).toHaveText(/app-ver/);
      // Date *and* time: two releases on one afternoon share a date, and the stamp exists to
      // tell them apart.
      await expect(badge(page)).toHaveText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    }
  });

  test("names the environment, so qa and production are never confused", async ({ page }) => {
    await page.goto("/ro/evenimente");
    // Production omits the prefix — there it is noise, and everywhere else it is the point.
    await expect(badge(page)).toHaveText(/^(local|test|qa) · /);
  });

  test("is not on screen until the footer's fold is opened, in any environment", async ({ page }) => {
    // §NNN: one rule at every width and on every deployment, so this local server shows what
    // production does — nothing, until "Despre club" is opened.
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await expect(badge(page)).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(badge(page)).toBeHidden();

    await openTheFold(page);
    // A line of the panel, inside the footer, never wider than the screen.
    const box = await badge(page).boundingBox();
    const footer = await page.getByRole("contentinfo").boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(footer!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  });

  test("does nothing on a single tap", async ({ page }) => {
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);

    // The badge receives pointer events, because a double-click on it opens staff sign-in.
    // What keeps it from being a trap for somebody who opened the fold for the links above it
    // is that one tap does nothing at all.
    await badge(page).click();
    await expect(page).toHaveURL(/\/ro\/evenimente$/);
  });

  test("is the staff entrance: a double-click opens sign-in, and so does Enter", async ({
    page,
  }) => {
    // The footer's "Staff" link is gone; this replaced it. Not a security measure — the
    // backoffice is guarded on the server on every request — but the club's public pages no
    // longer advertise a backoffice to everybody who reads them.
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);
    await badge(page).dblclick();
    await expect(page).toHaveURL(/\/ro\/autentificare$/);

    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);
    await badge(page).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("is the staff entrance on a phone too: press and hold opens sign-in", async ({ page }) => {
    // A double-tap is unreliable on a phone and often zooms instead; a long press is the gesture
    // a thumb can do on purpose and a scroll never does by accident.
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);
    // `hover` scrolls it into view first, so the press lands on it.
    await badge(page).hover();
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("no longer offers a staff link in the footer", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: /echipă|staff/i })).toHaveCount(0);
    // The two public legal routes are still there — AGENTS.md §9.2 requires them linked from the
    // footer. The privacy notice is on the bar itself since §323 ("Confidențialitate" at every
    // width since §324, named for the notice); the terms are behind the
    // summary, which names them, and a closed <details> hides its content from the
    // accessibility tree, so open it first.
    await expect(footer.getByRole("link", { name: "Nota de confidențialitate (GDPR)", exact: true })).toBeVisible();
    await footer.locator("summary").click();
    await expect(footer.getByRole("link", { name: /termeni de concurs/i })).toBeVisible();
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

    // The badge used to sit over the footer's corner, and the link had to stay clickable under
    // it; it is in the fold now (§NNN), and on a phone the link is on the bar's second line,
    // under the screen's edge until the page's end. The privacy notice is on the bar since
    // §323, so nothing has to be opened to reach it.
    await page.getByRole("contentinfo").getByRole("link", { name: "Nota de confidențialitate (GDPR)", exact: true }).click();
    await expect(page).toHaveURL(/\/ro\/confidentialitate/);
  });
});
