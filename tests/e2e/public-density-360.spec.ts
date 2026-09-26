import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * §NNN — the 360-px density pass over the public pages (BR-REQ-041-01), measured on the built
 * pages rather than trusted from the markup (`tests/unit/shared/density-pass-360.test.ts` holds
 * the rules, `tests/unit/theme/density.test.ts` the values).
 *
 * - A public fold is the 44 pixels it claims, not 64 (its padding inside its height).
 * - A link inside a sentence is still a 44-pixel target, pressed at its edges, and its paragraph
 *   is a whole number of lines — no line stretched to the link's height.
 * - The contact form's first box is one gap under the legend, not two.
 *
 * The phone project runs at 360 px, the width the owner reads the site at; the desktop project
 * keeps its own viewport, where the two defects were the same and the spacing is `sm`'s.
 */

const PHONE = 360;

const isPhone = () => test.info().project.name === "mobile";
const tenth = (value: number) => Math.round(value * 10) / 10;

test.beforeEach(async ({ page }) => {
  if (isPhone()) await page.setViewportSize({ width: PHONE, height: 800 });
});

/** The paragraph's height over its line height: a whole number when no line was stretched. */
async function linesOf(paragraph: Locator): Promise<number> {
  return paragraph.evaluate((el) => el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight));
}

/** What a press 2 pixels inside the top and bottom edges of a link, at its middle, lands on. */
async function pressesLandOn(page: Page, link: Locator): Promise<boolean[]> {
  const box = await link.boundingBox();
  if (!box) throw new Error("the link has no box");
  const x = box.x + box.width / 2;
  return link.evaluate(
    (el, points) => points.map(([px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return hit !== null && (hit === el || el.contains(hit));
    }),
    [
      [x, box.y + 2],
      [x, box.y + box.height - 2],
    ] as Array<[number, number]>,
  );
}

async function expectInlineTarget(page: Page, paragraph: Locator, link: Locator, what: string) {
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  expect(tenth(box?.height ?? 0), `${what}: a 44-pixel target (BR-REQ-041-01 criterion 6)`).toBeGreaterThanOrEqual(44);
  expect(await pressesLandOn(page, link), `${what}: a press 2px inside its top and bottom edges is the link's`).toEqual([true, true]);
  const lines = await linesOf(paragraph);
  expect(Math.abs(lines - Math.round(lines)), `${what}: its paragraph is ${lines.toFixed(2)} lines — no line stretched`).toBeLessThan(0.1);
}

test.describe("§NNN the public pages at 360 px", () => {
  test("a public fold's summary is 44 pixels tall, its padding inside it", async ({ page }) => {
    await page.goto("/ro/calendar");
    const summary = page.locator("#main details > summary", { hasText: "Adresa pentru alte aplicații" });
    await expect(summary).toBeVisible();
    const height = tenth((await summary.boundingBox())?.height ?? 0);
    expect(height, "the calendar's feed-address fold").toBeGreaterThanOrEqual(44);
    expect(height, "the calendar's feed-address fold, not the 64 of a content-box summary").toBeLessThanOrEqual(44.5);

    // The listing's past events, when the sample has one: a 1.25rem line and its padding, under 64.
    await page.goto("/ro/evenimente");
    const past = page.locator("#main details[data-testid='past-events'] > summary");
    if ((await past.count()) > 0 && (await past.isVisible())) {
      const pastHeight = tenth((await past.boundingBox())?.height ?? 0);
      expect(pastHeight).toBeGreaterThanOrEqual(44);
      expect(pastHeight).toBeLessThan(60);
    }
  });

  test("«scrie-ne» in an event page's photographs notice is a 44-pixel target that does not stretch its line", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const first = page.locator("#main h2 a").first();
    await expect(first).toBeVisible();
    const href = await first.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!);
    const link = page.locator("#main p a[href$='/contact']").first();
    await expect(link).toBeVisible();
    const paragraph = link.locator("xpath=ancestor::p[1]");
    await expectInlineTarget(page, paragraph, link, "«scrie-ne»");
  });

  test("the contact page: the privacy line keeps its lines, and the first box is one gap under the legend", async ({ page }) => {
    await page.goto("/ro/contact");
    await expect(page.getByRole("heading", { level: 1, name: "Scrie-ne" })).toBeVisible();

    const privacy = page.locator("#main a[href$='/confidentialitate']").first();
    const privacyLine = privacy.locator("xpath=ancestor::p[1]");
    await expectInlineTarget(page, privacyLine, privacy, "the privacy notice under the form");

    // The club's address after "Sau scrie-ne direct la", where the deployment names one.
    const direct = page.locator("#main p", { hasText: "Sau scrie-ne direct la" });
    if ((await direct.count()) > 0) {
      await expectInlineTarget(page, direct, direct.locator("a[href^='mailto:']").first(), "the club's address");
    }

    const gap = await page.evaluate(() => {
      const legend = [...document.querySelectorAll("#main p")].find((p) => p.textContent?.startsWith("Câmpurile marcate"));
      const field = document.getElementById("c-name")?.closest(".MuiFormControl-root");
      if (!legend || !field) return Number.NaN;
      return field.getBoundingClientRect().top - legend.getBoundingClientRect().bottom;
    });
    // `DENSITY.gapSm` on a phone, 16 pixels from `sm` — the legend's margin alone.
    const expected = isPhone() ? 8 : 16;
    expect(Math.abs(gap - expected), `the first box is ${gap}px under the legend, ${expected} expected`).toBeLessThanOrEqual(1);
  });
});
