import { expect, test } from "@playwright/test";

/**
 * The build badge, part of the shared chrome (AGENTS.md §8; `shared/ui/BuildBadge.tsx`).
 *
 * It was a fixed label in the bottom-right corner from `md` and a line under the footer below
 * that, read by every visitor on every page. §365 (the owner, 2026-09-24: "version shows by
 * default") put it inside the footer's "Despre club" fold: on screen at no width until
 * somebody opened it, at every width. §372 split it by width again, the owner's later word on
 * the desktop site: "I liked when I saw the app on the bottom right." Two copies exist in the
 * markup now, mutually exclusive by `display` and each with its own test id: the phone's, still
 * inside the fold (`footer-build-badge-panel`, shown below `md`), and the desktop's, pinned to
 * the bar's own corner without opening anything (`footer-build-badge-pinned`, shown from `md`).
 * Every test that presses the phone's copy still opens the fold first, the way a person would.
 *
 * It is also the staff entrance — a double-click, a long press, or `Enter` when focused — and
 * what keeps it from being a trap is that one tap does nothing at all.
 *
 * These run against the seeded database, so `docker compose up -d db && yarn db:seed` first.
 */

/** The phone's copy, inside the "Despre club" fold — hidden by CSS from `md` up. */
const panelBadge = (page: import("@playwright/test").Page) =>
  page.getByTestId("footer-build-badge-panel").getByLabel(/versiunea site-ului|website version/i);

/** The desktop's copy, pinned to the bar's own corner — hidden by CSS below `md`. */
const pinnedBadge = (page: import("@playwright/test").Page) =>
  page.getByTestId("footer-build-badge-pinned").getByLabel(/versiunea site-ului|website version/i);

/** "Despre club", the fold the phone's copy is in. */
async function openTheFold(page: import("@playwright/test").Page) {
  await page.getByRole("contentinfo").locator("summary").click();
  await expect(panelBadge(page)).toBeVisible();
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
      await expect(panelBadge(page)).toHaveAttribute("title", /BR-V\d+\.\d+|dev/);
    }
  });

  test("stamps the build with a version and an ISO date, in both locales", async ({ page }) => {
    // "17 sept. 2026" beside a version was read as the date the *club* last posted something.
    // `app-ver` and an ISO date read as what they are — the build — and they read identically in
    // Romanian and English, which is the point of choosing ISO over either locale's format.
    for (const path of ["/ro/evenimente", "/en/events"]) {
      await page.goto(path);
      await expect(panelBadge(page)).toHaveText(/app-ver/);
      // Date *and* time: two releases on one afternoon share a date, and the stamp exists to
      // tell them apart.
      await expect(panelBadge(page)).toHaveText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    }
  });

  test("names the environment, so qa and production are never confused", async ({ page }) => {
    await page.goto("/ro/evenimente");
    // Production omits the prefix — there it is noise, and everywhere else it is the point.
    await expect(panelBadge(page)).toHaveText(/^(local|test|qa) · /);
  });

  test("on a phone, is not on screen until the footer's fold is opened", async ({ page }, testInfo) => {
    // §365, still true below `md` (§372): the phone's own copy is on screen at no width until
    // "Despre club" is opened. From `md` the entrance is the pinned copy instead (below), which
    // shows without opening anything — that is the point of §372, not a regression of this.
    test.skip(testInfo.project.name !== "mobile", "the panel copy only shows below md");
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await expect(panelBadge(page)).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(panelBadge(page)).toBeHidden();

    await openTheFold(page);
    // A line of the panel, inside the footer, never wider than the screen.
    const box = await panelBadge(page).boundingBox();
    const footer = await page.getByRole("contentinfo").boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(footer!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  });

  test("from md, the pinned copy is visible at the bar's corner without opening anything", async ({ page }, testInfo) => {
    // §372, the owner: "on the desktop version I liked when I saw the app on the bottom right."
    test.skip(testInfo.project.name !== "desktop", "the pinned copy only shows from md");
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await expect(pinnedBadge(page)).toBeVisible();
    // The panel copy stays out of the way here — one build stamp doing the showing at a time.
    await expect(panelBadge(page)).toBeHidden();

    const box = await pinnedBadge(page).boundingBox();
    const footer = await page.getByRole("contentinfo").boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(footer).not.toBeNull();
    // At the bar's own corner: inside the footer, at its right end.
    expect(box!.y).toBeGreaterThanOrEqual(footer!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.x + box!.width).toBeGreaterThan((footer!.x + footer!.width) / 2);
  });

  test("is the staff entrance from md too: a double-click opens sign-in, and so does Enter", async ({ page }, testInfo) => {
    // Review finding 5: the only staff-entrance tests skipped unless the project was "mobile",
    // driving the panel copy. From `md` the entrance is the pinned copy instead, and the PR CI
    // run (desktop project only, §209) checked no staff entrance at all.
    test.skip(testInfo.project.name !== "desktop", "the pinned copy only shows from md");
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    // One click does nothing here either: it is never a trap for a pointer passing over it.
    await pinnedBadge(page).click();
    await expect(page).toHaveURL(/\/ro\/evenimente$/);
    await pinnedBadge(page).dblclick();
    await expect(page).toHaveURL(/\/ro\/autentificare$/);

    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await pinnedBadge(page).focus();
    await expect(pinnedBadge(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("does nothing on a single tap", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the panel copy only shows below md");
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);

    // The badge receives pointer events, because a double-click on it opens staff sign-in.
    // What keeps it from being a trap for somebody who opened the fold for the links above it
    // is that one tap does nothing at all.
    await panelBadge(page).click();
    await expect(page).toHaveURL(/\/ro\/evenimente$/);
  });

  test("is the staff entrance: a double-click opens sign-in, and so does Enter", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the panel copy only shows below md");
    // The footer's "Staff" link is gone; this replaced it. Not a security measure — the
    // backoffice is guarded on the server on every request — but the club's public pages no
    // longer advertise a backoffice to everybody who reads them.
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);
    await panelBadge(page).dblclick();
    await expect(page).toHaveURL(/\/ro\/autentificare$/);

    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);
    await panelBadge(page).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("is the staff entrance on a phone too: press and hold opens sign-in", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the panel copy only shows below md");
    // A double-tap is unreliable on a phone and often zooms instead; a long press is the gesture
    // a thumb can do on purpose and a scroll never does by accident.
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    await openTheFold(page);
    // `hover` scrolls it into view first, so the press lands on it.
    await panelBadge(page).hover();
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
    // footer. The privacy notice is on the bar itself since §323 (a question mark on a phone and
    // "GDPR" from `sm` since §NNN, named for the notice at every width); the terms are behind the
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
    // it; it is in the fold below `md` (§365) and pinned beside the row from `md` (§372), and
    // the link is on the bar's one row, on screen at every scroll position — a question mark on a
    // phone, named for the notice (§NNN). The privacy notice is on the bar since §323, so nothing has
    // to be opened to reach it.
    await page.getByRole("contentinfo").getByRole("link", { name: "Nota de confidențialitate (GDPR)", exact: true }).click();
    await expect(page).toHaveURL(/\/ro\/confidentialitate/);
  });
});
