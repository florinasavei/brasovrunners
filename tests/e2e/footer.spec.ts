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
 * the badge, and 1280 a desktop, where the badge used to float in the corner.
 *
 * Since §NNN (the owner, 2026-09-24: "it now takes way too much space, and version shows by
 * default") a phone's bar floats one line tall and rests two lines tall at the page's end, the
 * language sits side by side on the second line, and the build stamp is the fold's last line —
 * on screen at no width until the fold is opened.
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
    // On the bar since §323, reading "Confidențialitate" at every width since §324, and named
    // for the notice, the visible word inside the name (WCAG 2.5.3).
    privacy: footer.getByRole("link", { name: "Nota de confidențialitate (GDPR)", exact: true }),
    marks: footer.getByRole("navigation", { name: /rețelele sociale|social media/i }).getByRole("link"),
    language: footer.getByRole("navigation", { name: "Limbă" }),
    badge: page.getByLabel(/versiunea site-ului|website version/i),
  };
}

/**
 * The page scrolled to its end, where the sticky bar rests in its own place (§324).
 *
 * Since the page reserves room above the sticky footer for whatever the browser scrolls into view
 * (`scroll-padding-bottom`, theme.ts), a trial click on a control *in* the bar scrolls the page
 * to its end — the only place a sticky bar can move out of that room — and on a phone the bar's
 * second line is under the screen's edge until then (§NNN). Measured from the end, every box is
 * taken with the bar where it stays, and no click moves it.
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

test.describe("BR-REQ-041-01 the footer's one line", () => {
  for (const width of WIDTHS) {
    test(`at ${width}px nothing on the bar overlaps, and every mark takes its tap`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, toggle, privacy, marks, language, badge } = controls(page);
      const count = await marks.count();
      test.skip(count === 0, "no social address is configured for this server");
      await restAtTheEnd(page);

      const boxes: Array<[string, Box]> = [
        ["the summary", await boxOf(summary, "the summary")],
        ["the scheme switch", await boxOf(toggle, "the scheme switch")],
        ["the privacy notice", await boxOf(privacy, "the privacy notice")],
      ];
      // Criterion 11: the switch is the first control on the line, in the bar's own corner.
      expect(boxes[1]![1].x).toBeLessThan(4);
      expect(boxes[1]![1].height).toBeGreaterThanOrEqual(44);
      // Criterion 6, and §323: the notice is reachable from every page without opening anything.
      expect(boxes[2]![1].height).toBeGreaterThanOrEqual(44);
      await privacy.click({ trial: true });
      // §324: it reads as the notice's name on a phone too, never "GDPR" alone.
      await expect(privacy).toHaveText("Confidențialitate");

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

      // Every control on its intended line while the fold is closed: one line from `sm` (600px)
      // up; on a phone two, the privacy notice and the language on the second (§324). A
      // wrapping row puts what does not fit on a further line without overlapping anything,
      // which is exactly the failure a pairwise check would wave through.
      const bar = await boxOf(footer, "the footer");
      const phone = width < 600;
      const secondLine = new Set(phone ? ["the privacy notice", "the language"] : []);
      for (const [name, box] of boxes) {
        const line = secondLine.has(name) ? 66 : 22;
        expect(Math.abs(box.y + box.height / 2 - (bar.y + line)), `${name} is on the bar's line at ${width}px`).toBeLessThan(8);
      }
      // And no third line: the bar is one or two tap targets tall, nothing more.
      expect(bar.height, `the bar's height at ${width}px`).toBeLessThanOrEqual(phone ? 90 : 46);

      // §NNN: the build stamp is in the closed fold, on screen at no width.
      await expect(badge).toBeHidden();
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
    const { footer, summary, marks, language, badge } = controls(page);
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
    if ((await language.count()) === 1) {
      await expect(language).toBeVisible();
      boxes.push(["the language", await boxOf(language, "the language")]);
    }
    // The build stamp is the panel's last line (§NNN), clear of everything else on the bar.
    await expect(badge).toBeVisible();
    boxes.push(["the build stamp", await boxOf(badge, "the build stamp")]);
    expectDisjoint(boxes, page.viewportSize()?.width ?? 0);
  });

  for (const width of [320, 640, 1280] as const) {
    test(`at ${width}px the build stamp is on screen only once the fold is opened`, async ({ page }) => {
      // §NNN, the owner: "version shows by default". It was a label under the bar below `md`
      // and floated in the bottom-right corner from `md`; now no visitor sees it unless they
      // open "Despre club", at any width and in any environment — so this local server says
      // what production does.
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, badge } = controls(page);
      await expect(badge).toBeHidden();
      await restAtTheEnd(page);
      await expect(badge).toBeHidden();

      await summary.click();
      await expect(badge).toBeVisible();
      await restAtTheEnd(page);
      // Inside the footer, as one of its lines — not under it, not over the page's corner.
      const bar = await boxOf(footer, "the footer");
      const label = await boxOf(badge, "the build stamp");
      expect(label.y).toBeGreaterThanOrEqual(bar.y);
      expect(label.y + label.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
      expect(label.x + label.width).toBeLessThanOrEqual(width);
    });
  }
});

/**
 * §NNN — the owner, 2026-09-24, with a 360-pixel screenshot: "next prio is the footer on mobile…
 * it now takes way too much space, and version shows by default."
 *
 * Measured at 320, 360 and 390 pixels wide on production builds of the two versions, on a page
 * three screens long: before, the sticky bar was **89px on every screen** (two 44px lines and
 * the border, §324), and at the page's end **127px** from the bar's top to the document's end —
 * the bar plus the build badge's own line (21px and its margins). After: the bar floats **45px**
 * (one line and the border) and rests at **89px** with nothing under it; the badge is on screen
 * nowhere until the fold is opened. From 600px up the bar was and is 45px, and the badge no
 * longer floats in the corner.
 */
test.describe("§NNN the phone's footer is one floating line", () => {
  test("at 320px it floats one line tall, rests two lines tall, and nothing is under it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer, privacy, language, badge } = controls(page);

    // At the top of a long page: only the first line is on screen. Before: 89.
    const floating = await boxOf(footer, "the footer");
    const onScreen = 720 - floating.y;
    expect(onScreen, "the floating bar's height at 320px").toBeLessThanOrEqual(46);
    expect(onScreen).toBeGreaterThanOrEqual(44);
    await expect(badge).toBeHidden();

    // The keyboard in the footer raises the whole bar: a focused link is never under the edge
    // (WCAG 2.4.11). A scripted focus counts as keyboard focus (`:focus-visible`) here.
    await privacy.focus();
    await expect
      .poll(async () => {
        const link = await privacy.boundingBox();
        return link ? link.y + link.height : Infinity;
      })
      .toBeLessThanOrEqual(720);
    await privacy.blur();

    // At the end of the page the bar rests in its place: two lines, and nothing below it — the
    // badge's line is gone. Before: 126 from the bar's top to the document's end.
    await restAtTheEnd(page);
    const resting = await boxOf(footer, "the footer");
    expect(resting.height, "the resting bar's height at 320px").toBeLessThanOrEqual(90);
    const chrome = await page.evaluate(() => {
      const bar = document.querySelector("footer")!.getBoundingClientRect();
      return document.documentElement.scrollHeight - (bar.top + window.scrollY);
    });
    expect(chrome, "from the bar's top to the document's end at 320px").toBeLessThanOrEqual(90);
    await expect(badge).toBeHidden();

    // RO and EN side by side on the second line, each a 44px target — not stacked.
    const english = language.getByRole("link", { name: "English" });
    const current = await boxOf(language.locator("[aria-current]"), "the current language");
    const other = await boxOf(english, "the English link");
    expect(Math.abs(current.y + current.height / 2 - (other.y + other.height / 2))).toBeLessThan(2);
    expect(other.x).toBeGreaterThanOrEqual(current.x + current.width - 1);
    expect(current.height).toBeGreaterThanOrEqual(44);
    expect(other.height).toBeGreaterThanOrEqual(44);
    await english.click({ trial: true });

    // BR-REQ-041-01 criterion 1.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("from 600px up the bar is one line at every scroll position", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { footer } = controls(page);
    const floating = await boxOf(footer, "the footer");
    expect(720 - floating.y).toBeLessThanOrEqual(46);
    expect(floating.height).toBeLessThanOrEqual(46);
  });
});
