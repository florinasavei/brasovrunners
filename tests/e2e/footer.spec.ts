import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The footer's one line, on every width, phone included (BR-REQ-041-01 criteria 1, 6 and 11;
 * `DECISIONS.md` §115, §262, §299, §323, §324, §365, §NNN; `shared/ui/SiteFooter.tsx`).
 *
 * Three reports on one day said the same thing about the marks landing on the summary's last
 * word and the build badge (§299) — every control here is still its own flex item, so overlap
 * is not a state the layout can reach, and `click({ trial: true })` runs Playwright's hit-target
 * check at each one without navigating anywhere.
 *
 * The owner, 2026-09-24, with a phone screenshot: "it should fit all in 1 row" — asked what
 * gives way, "All visible, smaller." §365's second line is gone: the switch, the fold's
 * summary, the three marks, the privacy notice and the language now share one line below `sm`
 * too, each a 32-pixel target instead of 44 (a footer-only exception to criterion 6) and ~12px
 * text, in that reading order. From `sm` up nothing here moved — 44px targets, one line, as
 * before §324 even existed.
 *
 * The widths are set here rather than taken from the project: 320 is the requirement's floor,
 * 360 the owner's screenshot, 393 the Pixel phone, 640 and 768 the band where the marks used to
 * land on the summary and the badge, and 1280 a desktop, where the build stamp is now pinned to
 * the bar's own corner (§NNN) rather than floating loose over the page as it did before §365.
 */
type Box = { x: number; y: number; width: number; height: number };

const WIDTHS = [320, 360, 393, 640, 768, 1280] as const;
/** MUI's `sm` breakpoint: the row shrinks below it, is full size at and above it. */
const SM = 600;
/** MUI's `md` breakpoint: where the build stamp's pinned copy takes over from the fold's. */
const MD = 900;

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator, name: string): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found, `${name} has a box`).not.toBeNull();
  return found!;
}

function controls(page: Page) {
  const footer = page.getByRole("contentinfo");
  return {
    footer,
    summary: footer.locator("summary"),
    toggle: footer.getByRole("button", { name: /temă/i }),
    // On the bar since §323, reading "Confidențialitate" at every width since §324, and named
    // for the notice, the visible word inside the name (WCAG 2.5.3).
    privacy: footer.getByRole("link", { name: "Nota de confidențialitate (GDPR)", exact: true }),
    marks: footer.getByRole("navigation", { name: /rețelele sociale|social media/i }).getByRole("link"),
    language: footer.getByRole("navigation", { name: "Limbă" }),
    // Two copies, mutually exclusive by width (§NNN): the fold's, below `md`, and the one
    // pinned to the bar's corner, from `md`.
    panelBadge: page.getByTestId("footer-build-badge-panel").getByLabel(/versiunea site-ului|website version/i),
    pinnedBadge: page.getByTestId("footer-build-badge-pinned").getByLabel(/versiunea site-ului|website version/i),
  };
}

/**
 * The page scrolled to its end, where the sticky bar rests in its own place.
 *
 * Since the page reserves room above the sticky footer for whatever the browser scrolls into view
 * (`scroll-padding-bottom`, theme.ts), a trial click on a control *in* the bar scrolls the page
 * to its end — the only place a sticky bar can move out of that room. Measured from the end,
 * every box is taken with the bar where it stays, and no click moves it.
 */
async function restAtTheEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

function expectDisjoint(boxes: Array<[string, Box]>, width: number) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [nameA, a] = boxes[i]!;
      const [nameB, b] = boxes[j]!;
      expect(intersects(a, b), `${nameA} and ${nameB} overlap at ${width}px`).toBe(false);
    }
  }
}

test.describe("BR-REQ-041-01 the footer's one line, at every width", () => {
  for (const width of WIDTHS) {
    test(`at ${width}px every item is on one row, nothing overlaps, and every target is its size`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, toggle, privacy, marks, language, panelBadge, pinnedBadge } = controls(page);
      const count = await marks.count();
      test.skip(count === 0, "no social address is configured for this server");
      await restAtTheEnd(page);

      const phone = width < SM;
      // The footer-only exception to BR-REQ-041-01 criterion 6 (§NNN): 32px below `sm`, 44 at
      // and above it.
      const minTarget = phone ? 32 : 44;

      const boxes: Array<[string, Box]> = [
        ["the summary", await boxOf(summary, "the summary")],
        ["the scheme switch", await boxOf(toggle, "the scheme switch")],
        ["the privacy notice", await boxOf(privacy, "the privacy notice")],
      ];
      // Criterion 11: the switch is the first control on the line, in the bar's own corner.
      expect(boxes[1]![1].x).toBeLessThan(4);
      expect(boxes[1]![1].height).toBeGreaterThanOrEqual(minTarget);
      // Criterion 6, and §323: the notice is reachable from every page without opening anything.
      expect(boxes[2]![1].height).toBeGreaterThanOrEqual(minTarget);
      await privacy.click({ trial: true });
      // §324: it reads as the notice's name at every width, never "GDPR" alone, and never
      // clipped or ellipsised (§NNN: "all visible" was the owner's own word for it).
      await expect(privacy).toHaveText("Confidențialitate");

      for (let i = 0; i < count; i++) {
        const mark = marks.nth(i);
        const name = (await mark.getAttribute("aria-label")) ?? `mark ${i}`;
        const box = await boxOf(mark, name);
        expect(box.width, `${name} is ${minTarget} wide`).toBeGreaterThanOrEqual(minTarget);
        expect(box.height, `${name} is ${minTarget} tall`).toBeGreaterThanOrEqual(minTarget);
        await mark.click({ trial: true });
        boxes.push([name, box]);
      }
      if (phone) {
        await expect(language).toBeVisible();
        const box = await boxOf(language, "the language");
        expect(box.height, "the language is on the row's target").toBeGreaterThanOrEqual(minTarget);
        boxes.push(["the language", box]);
      } else {
        // From `sm` up the language stays in the header (§262); exactly one "Limbă" navigation
        // is announced at every width.
        await expect(language).toBeHidden();
      }

      // One row, always: every control's centre sits on the same line as the switch's.
      const bar = await boxOf(footer, "the footer");
      const switchMid = boxes[1]![1].y + boxes[1]![1].height / 2;
      for (const [name, box] of boxes) {
        expect(
          Math.abs(box.y + box.height / 2 - switchMid),
          `${name} is on the bar's single row at ${width}px`,
        ).toBeLessThan(8);
      }
      // Never a second line: the closed bar is one tap target tall, nothing more.
      expect(bar.height, `the bar's height at ${width}px`).toBeLessThanOrEqual(minTarget + 8);

      // The build stamp: whichever copy applies at this width is not on screen — the fold is
      // closed, and a desktop's pinned copy only shows from `md`.
      if (width >= MD) {
        await expect(pinnedBadge).toBeVisible();
      } else {
        await expect(pinnedBadge).toBeHidden();
      }
      await expect(panelBadge).toBeHidden();
      expectDisjoint(boxes, width);

      // Criterion 1: nothing on the bar widened the page, at 320px least of all.
      const overflow = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
    });
  }

  test("keeps the marks visible, tappable and clear of the panel when the fold is open, below md", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer, summary, marks, language, panelBadge } = controls(page);
    const count = await marks.count();
    test.skip(count === 0, "no social address is configured for this server");

    await summary.click();
    // The panel's links, and the privacy notice beside the fold, which wraps under it (§323).
    const panelLinks = footer.getByRole("link", { name: /confidențialitate|termeni|înscrierile|scrie-ne/i });
    await expect(panelLinks.first()).toBeVisible();
    // Open, the bar is taller: measured at the page's new end, where no trial click moves it.
    await restAtTheEnd(page);

    const boxes: Array<[string, Box]> = [];
    for (let i = 0; i < (await panelLinks.count()); i++) boxes.push([`panel link ${i}`, await boxOf(panelLinks.nth(i), `panel link ${i}`)]);
    for (let i = 0; i < count; i++) {
      const mark = marks.nth(i);
      await expect(mark).toBeVisible();
      await mark.click({ trial: true });
      boxes.push([`mark ${i}`, await boxOf(mark, `mark ${i}`)]);
    }
    if ((await language.count()) === 1 && (await language.isVisible())) {
      boxes.push(["the language", await boxOf(language, "the language")]);
    }
    // The build stamp is the panel's last line, clear of everything else on the bar.
    await expect(panelBadge).toBeVisible();
    boxes.push(["the build stamp", await boxOf(panelBadge, "the build stamp")]);
    expectDisjoint(boxes, page.viewportSize()?.width ?? 0);
  });
});

/**
 * §NNN — the owner, 2026-09-24, with a 360-pixel screenshot: "it should fit all in 1 row."
 * Asked what gives way, "All visible, smaller": every item stays, at 32px targets and ~12px
 * text on a phone. §365's second line — RO and EN beside the privacy notice, under the switch
 * and the fold — no longer exists: there is only the one row now, and this describes it and the
 * build stamp's two doors (the fold below `md`, pinned to the bar's corner from `md`).
 */
test.describe("§NNN one row on a phone, the build stamp's two doors", () => {
  for (const width of [320, 360] as const) {
    test(`at ${width}px the bar is one row at every scroll position, nothing clipped`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, toggle, privacy, marks, language, panelBadge } = controls(page);

      for (const where of ["the top", "halfway down"] as const) {
        if (where === "halfway down") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
        const bar = await boxOf(footer, "the footer");
        expect(bar.y + bar.height, `the bar's bottom edge at ${where}, ${width}px`).toBeLessThanOrEqual(721);
        // One row, not two: the bar is a single 32px target tall, plus its border.
        expect(bar.height, `the bar's height at ${where}, ${width}px`).toBeLessThanOrEqual(40);
        for (const [name, locator] of [
          ["the switch", toggle],
          ["the summary", summary],
          ["the privacy notice", privacy],
          ["the language", language],
        ] as const) {
          const box = await boxOf(locator, name);
          expect(box.y + box.height, `${name} is on screen at ${where}, ${width}px`).toBeLessThanOrEqual(720);
        }
        await expect(panelBadge).toBeHidden();
      }

      // At the end of the page: the same one row, nothing under it.
      await restAtTheEnd(page);
      const resting = await boxOf(footer, "the footer");
      expect(resting.height, `the resting bar's height at ${width}px`).toBeLessThanOrEqual(40);
      const chrome = await page.evaluate(() => {
        const bar = document.querySelector("footer")!.getBoundingClientRect();
        return document.documentElement.scrollHeight - (bar.top + window.scrollY);
      });
      expect(chrome, `from the bar's top to the document's end at ${width}px`).toBeLessThanOrEqual(40);
      await expect(panelBadge).toBeHidden();

      // Every item the row promises, actually on screen: nothing dropped, nothing hidden by an
      // ancestor's overflow. The summary's own text ("Despre club") is part of this — it is
      // never reduced to the marker alone.
      await expect(toggle).toBeVisible();
      await expect(summary).toBeVisible();
      await expect(summary).toContainText(/despre club/i);
      const count = await marks.count();
      for (let i = 0; i < count; i++) await expect(marks.nth(i)).toBeVisible();
      await expect(privacy).toBeVisible();
      await expect(language).toBeVisible();

      // RO and EN side by side, each a 32px target — not stacked, nothing missing.
      const english = language.getByRole("link", { name: "English" });
      const current = await boxOf(language.locator("[aria-current]"), "the current language");
      const other = await boxOf(english, "the English link");
      expect(Math.abs(current.y + current.height / 2 - (other.y + other.height / 2))).toBeLessThan(2);
      expect(other.x).toBeGreaterThanOrEqual(current.x + current.width - 1);
      expect(current.height).toBeGreaterThanOrEqual(32);
      expect(other.height).toBeGreaterThanOrEqual(32);
      await english.click({ trial: true });

      // BR-REQ-041-01 criterion 1: nothing on the bar ever widens the page, at either width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("from sm up the row is the ordinary 44px height, at every scroll position", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer } = controls(page);
    const floating = await boxOf(footer, "the footer");
    expect(720 - floating.y).toBeLessThanOrEqual(46);
    expect(floating.height).toBeLessThanOrEqual(46);
  });
});

test.describe("§NNN the desktop build stamp, pinned to the bar's own corner", () => {
  test("from md, is visible at the bar's right end without opening anything", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer, pinnedBadge, panelBadge } = controls(page);

    await expect(pinnedBadge).toBeVisible();
    await expect(panelBadge).toBeHidden();

    const bar = await boxOf(footer, "the footer");
    const stamp = await boxOf(pinnedBadge, "the pinned build stamp");
    // Inside the bar, at its right end, never past the viewport.
    expect(stamp.y).toBeGreaterThanOrEqual(bar.y);
    expect(stamp.y + stamp.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    expect(stamp.x + stamp.width).toBeLessThanOrEqual(1280);
    expect(stamp.x).toBeGreaterThan(bar.x + bar.width / 2);

    // It does not widen the page, and it does not sit on top of the row's own items.
    const { summary, toggle, privacy, marks } = controls(page);
    const rowBoxes: Array<[string, Box]> = [
      ["the switch", await boxOf(toggle, "the switch")],
      ["the summary", await boxOf(summary, "the summary")],
      ["the privacy notice", await boxOf(privacy, "the privacy notice")],
    ];
    for (let i = 0; i < (await marks.count()); i++) rowBoxes.push([`mark ${i}`, await boxOf(marks.nth(i), `mark ${i}`)]);
    for (const [name, box] of rowBoxes) expect(intersects(box, stamp), `${name} and the pinned build stamp overlap`).toBe(false);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
