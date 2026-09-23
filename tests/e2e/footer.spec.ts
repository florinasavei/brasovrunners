import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The footer's one line (BR-REQ-041-01 criteria 1, 6 and 11; `DECISIONS.md` §115, §262  and §299; `shared/ui/SiteFooter.tsx`).
 *
 * Three reports on one day said the same thing: the social marks sat on the summary's last word
 * and on the build badge between 600 and 750 pixels (the owner's screenshot), and on an iPhone
 * the Strava mark could not be tapped (Amalia). The marks were positioned over the bar, so they
 * had no width in the layout and nothing had ever measured whether they landed on something
 * else. This does: every control on the bar is a 44-pixel box, no two of them intersect, and
 * each mark receives a tap at its centre — `click({ trial: true })` runs Playwright's hit-target
 * check, which fails when another element covers the point, without navigating to Strava.
 *
 * The widths are set here rather than taken from the project: 320 is the requirement's floor,
 * 393 the owner's phone, 640 and 768 the band where the marks used to land on the summary and
 * the badge, and 1280 a desktop with the badge floating in the corner.
 */
type Box = { x: number; y: number; width: number; height: number };

const WIDTHS = [320, 393, 640, 768, 1280] as const;

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
    // On the bar since §NNN: "GDPR" on a phone, "Confidențialitate" from `sm`.
    privacy: footer.getByRole("link", { name: /^(GDPR|Confidențialitate)$/ }),
    marks: footer.getByRole("navigation", { name: /rețelele sociale|social media/i }).getByRole("link"),
    language: footer.getByRole("navigation", { name: "Limbă" }),
    badge: page.getByLabel(/versiunea site-ului|website version/i),
  };
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

test.describe("BR-REQ-041-01 the footer's one line", () => {
  for (const width of WIDTHS) {
    test(`at ${width}px nothing on the bar overlaps, and every mark takes its tap`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, toggle, privacy, marks, language, badge } = controls(page);
      const count = await marks.count();
      test.skip(count === 0, "no social address is configured for this server");

      const boxes: Array<[string, Box]> = [
        ["the summary", await boxOf(summary, "the summary")],
        ["the scheme switch", await boxOf(toggle, "the scheme switch")],
        ["the privacy notice", await boxOf(privacy, "the privacy notice")],
      ];
      // Criterion 11: the switch is the first control on the line, in the bar's own corner.
      expect(boxes[1]![1].x).toBeLessThan(4);
      expect(boxes[1]![1].height).toBeGreaterThanOrEqual(44);
      // Criterion 6, and §NNN: the notice is reachable from every page without opening anything.
      expect(boxes[2]![1].height).toBeGreaterThanOrEqual(44);
      await privacy.click({ trial: true });

      for (let i = 0; i < count; i++) {
        const mark = marks.nth(i);
        const name = (await mark.getAttribute("aria-label")) ?? `mark ${i}`;
        const box = await boxOf(mark, name);
        // Criterion 6: a 44-pixel target, and a tap at its centre reaches it.
        expect(box.width, `${name} is 44 wide`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${name} is 44 tall`).toBeGreaterThanOrEqual(44);
        await mark.click({ trial: true });
        boxes.push([name, box]);
      }
      if ((await language.count()) === 1) boxes.push(["the language", await boxOf(language, "the language")]);

      // One line while the fold is closed: every control's centre is on the bar's first 44px.
      // A wrapping row puts what does not fit on a second line without overlapping anything,
      // which is exactly the failure a pairwise check would wave through.
      const bar = await boxOf(footer, "the footer");
      for (const [name, box] of boxes) {
        expect(Math.abs(box.y + box.height / 2 - (bar.y + 22)), `${name} is on the bar's line at ${width}px`).toBeLessThan(8);
      }

      if ((await badge.count()) === 1) boxes.push(["the build badge", await boxOf(badge, "the build badge")]);
      expectDisjoint(boxes, width);

      // Criterion 1: nothing on the bar widened the page.
      const overflow = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
    });
  }

  test("keeps the marks visible, tappable and clear of the panel when the fold is open", async ({ page }) => {
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer, summary, marks, language } = controls(page);
    const count = await marks.count();
    test.skip(count === 0, "no social address is configured for this server");

    await summary.click();
    // The panel's links, and the privacy notice beside the fold, which wraps under it (§NNN).
    const panelLinks = footer.getByRole("link", { name: /GDPR|confidențialitate|termeni|înscrierile|scrie-ne/i });
    await expect(panelLinks.first()).toBeVisible();

    const boxes: Array<[string, Box]> = [];
    for (let i = 0; i < (await panelLinks.count()); i++) boxes.push([`panel link ${i}`, await boxOf(panelLinks.nth(i), `panel link ${i}`)]);
    for (let i = 0; i < count; i++) {
      const mark = marks.nth(i);
      await expect(mark).toBeVisible();
      await mark.click({ trial: true });
      boxes.push([`mark ${i}`, await boxOf(mark, `mark ${i}`)]);
    }
    if ((await language.count()) === 1) {
      await expect(language).toBeVisible();
      boxes.push(["the language", await boxOf(language, "the language")]);
    }
    expectDisjoint(boxes, page.viewportSize()?.width ?? 0);
  });

  test("gives the build badge its own line under the bar below `md`", async ({ page }) => {
    // The band the owner's screenshot came from: the badge floated here and the marks sat on it.
    await page.setViewportSize({ width: 640, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer, badge } = controls(page);
    const bar = await boxOf(footer, "the footer");
    const label = await boxOf(badge, "the build badge");
    expect(label.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  });
});
