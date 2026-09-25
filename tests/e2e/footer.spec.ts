import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The footer's one row, on every width, phone included (BR-REQ-041-01 criteria 1, 6, 11, 21, 23
 * and 29; `DECISIONS.md` §115, §262, §299, §323, §324, §365, §372; `shared/ui/SiteFooter.tsx`).
 *
 * Three reports on one day said the same thing about the marks landing on the summary's last
 * word and the build badge (§299) — every control here is still its own flex item, so overlap
 * is not a state the layout can reach, and `click({ trial: true })` runs Playwright's hit-target
 * check at each one without navigating anywhere.
 *
 * §372, the owner, 2026-09-24: one row on a phone, keeping every item but not every word. Eight
 * items with their words need ~370 pixels and a phone has 288–328, so below `sm` the privacy
 * notice is a glyph and RO/EN are flags, and every item on the bar is a square of the bar's
 * target: 24px below 360 (WCAG 2.2 SC 2.5.8, AA), 28px from 360, 44px from `sm` — a
 * footer-bar-only exception to criterion 6.
 *
 * §378, the owner, 2026-09-25: the glyph is a question mark, not a lock; the notice comes right
 * after the fold, ahead of the marks, at every width; its word from `sm` is "GDPR"; and a phone's
 * items are 6px apart — the largest gap at which the English row still fitted at 320px with its
 * summary uncut, measured and recorded in `SiteFooter.tsx`.
 *
 * §385, the owner, later that day: "GDPR" instead of the question mark on a phone too, a 1px rule
 * before the languages, a condensed fold, and the build stamp in a chip. The word and the rule
 * take 14.6px more at 320 and 10.6px more at 360, so a phone's gap is `FOOTER_GAP` — 4px below
 * 360, 6px from 360 — and the summary's own padding is 2px a side; with that, "About the club" is
 * whole at 320 and at 360 with 3.6px to spare (the table in `SiteFooter.tsx`).
 *
 * The widths are set here rather than taken from the project: 320 is the requirement's floor,
 * 360 the owner's screenshot and the second size's first width, 393 the Pixel phone, 640 and
 * 768 the band where the marks used to land on the summary and the badge, and 1280 a desktop,
 * where the build stamp is pinned to the bar's own corner (§372).
 */
type Box = { x: number; y: number; width: number; height: number };

const WIDTHS = [320, 359, 360, 393, 640, 768, 1280] as const;
/** MUI's `sm` breakpoint: the bar's items are 44px at and above it. */
const SM = 600;
/** MUI's `md` breakpoint: where the build stamp's pinned copy takes over from the fold's. */
const MD = 900;

/** The bar's target at a width (`shared/ui/footer-target.ts`): 24, 28 from 360, 44 from `sm`. */
const targetAt = (width: number) => (width >= SM ? 44 : width >= 360 ? 28 : 24);

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator, name: string): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found, `${name} has a box`).not.toBeNull();
  return found!;
}

/** The two pages the row is measured on, with what each locale calls the bar's items. */
const PAGES = [
  { path: "/ro/evenimente", privacyName: "Nota de confidențialitate (GDPR)", language: "Limbă", summary: /despre club/i, other: "English" },
  { path: "/en/events", privacyName: "Privacy notice (GDPR)", language: "Language", summary: /about the club/i, other: "Română" },
] as const;

function controls(page: Page, where: (typeof PAGES)[number] = PAGES[0]) {
  const footer = page.getByRole("contentinfo");
  const language = footer.getByRole("navigation", { name: where.language });
  return {
    footer,
    fold: page.getByTestId("footer-about-fold"),
    summary: footer.locator("summary"),
    toggle: footer.getByRole("button", { name: /temă|theme/i }),
    // On the bar since §323, named for the notice at every width; the word "GDPR" at every
    // width (§378 from `sm`, §385 on a phone).
    privacy: footer.getByRole("link", { name: where.privacyName, exact: true }),
    word: footer.getByTestId("footer-privacy-word"),
    // The phone's rule before the languages (§385).
    rule: footer.getByTestId("footer-language-rule"),
    marks: footer.getByRole("navigation", { name: /rețelele sociale|social media/i }).getByRole("link"),
    language,
    current: language.locator('[aria-current="true"]'),
    other: language.getByRole("link", { name: where.other, exact: true }),
    // Two copies, mutually exclusive by width (§372): the fold's, below `md`, and the one
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

/**
 * The fold's panel content, inside the `<details>`. The panel's own box is zero wide on purpose
 * (`SiteFooter.tsx`: it adds nothing to the fold's width on the row), so Playwright calls the box
 * itself hidden; its one child is what a person sees.
 */
const panelContent = (fold: Locator) => fold.getByTestId("footer-about-panel").locator(":scope > *").first();

/** The rule's name in `rowItems`: the one item that is not a target (§385). */
const RULE = "the rule";

/**
 * Every item on the row, by name, measured, in the order the owner asked for (§378): the switch,
 * the summary, the privacy notice, the three marks, then — on a phone — the rule and RO and EN.
 */
async function rowItems(page: Page, where: (typeof PAGES)[number], phone: boolean): Promise<Array<[string, Box]>> {
  const { toggle, summary, privacy, marks, language, rule } = controls(page, where);
  const items: Array<[string, Box]> = [
    ["the scheme switch", await boxOf(toggle, "the scheme switch")],
    ["the summary", await boxOf(summary, "the summary")],
    ["the privacy notice", await boxOf(privacy, "the privacy notice")],
  ];
  for (let i = 0; i < (await marks.count()); i++) {
    const mark = marks.nth(i);
    const name = (await mark.getAttribute("aria-label")) ?? `mark ${i}`;
    items.push([name, await boxOf(mark, name)]);
  }
  if (phone) {
    items.push([RULE, await boxOf(rule, RULE)]);
    // RO then EN, whichever is the current one.
    for (const [i, name] of [[0, "RO"], [1, "EN"]] as const) {
      items.push([name, await boxOf(language.locator(":scope > *").nth(i), name)]);
    }
  }
  return items;
}

/** A phone's gap between neighbouring items on the bar (`FOOTER_GAP`, §378, §385): 4px below 360, 6px from 360. */
const phoneGapAt = (width: number) => (width >= 360 ? 6 : 4);

/**
 * The row's items stand left to right in their order, and on a phone each is the phone's gap from
 * the next — the rule included, on both sides — except after the summary, whose fold takes
 * whatever room the row has left, so the space from the summary's words to the privacy word is
 * at least the gap. The last item ends inside the viewport.
 */
function expectOrderedAndSpaced(items: Array<[string, Box]>, width: number, phone: boolean) {
  const gapWanted = phoneGapAt(width);
  for (let i = 1; i < items.length; i++) {
    const [before, a] = items[i - 1]!;
    const [after, b] = items[i]!;
    const gap = b.x - (a.x + a.width);
    expect(gap, `${after} is to the right of ${before} at ${width}px`).toBeGreaterThanOrEqual(-0.5);
    if (!phone) continue;
    if (before === "the summary") {
      expect(gap, `at least ${gapWanted}px from the summary to ${after} at ${width}px`).toBeGreaterThanOrEqual(gapWanted - 0.5);
    } else {
      expect(Math.abs(gap - gapWanted), `${before} to ${after} is ${gapWanted}px at ${width}px (was ${gap})`).toBeLessThan(0.6);
    }
  }
  const [lastName, last] = items.at(-1)!;
  expect(last.x + last.width, `${lastName} ends inside ${width}px`).toBeLessThanOrEqual(width + 0.5);
}

/**
 * One row: every target's top is the switch's, each is at least the bar's target tall and wide
 * (the summary is a label: its height is the target, its width its words), and the rule — the one
 * item that is not a target — is 16 to 20 pixels tall, one wide, and centred on the switch.
 */
function expectOneRow(items: Array<[string, Box]>, width: number, target: number, state: string) {
  const [, first] = items[0]!;
  for (const [name, box] of items) {
    if (name === RULE) {
      expect(box.width, `the rule is one pixel wide at ${width}px`).toBeLessThanOrEqual(1.5);
      expect(box.height, `the rule is 16 to 20px tall at ${width}px`).toBeGreaterThanOrEqual(15.5);
      expect(box.height).toBeLessThanOrEqual(20.5);
      const centre = box.y + box.height / 2;
      expect(Math.abs(centre - (first.y + first.height / 2)), `the rule is centred on the row at ${width}px, fold ${state}`).toBeLessThan(1);
      continue;
    }
    expect(Math.abs(box.y - first.y), `${name}'s top is the switch's at ${width}px, fold ${state}`).toBeLessThan(1.5);
    expect(box.height, `${name} is ${target}px tall at ${width}px`).toBeGreaterThanOrEqual(target - 0.5);
    if (name !== "the summary") {
      expect(box.width, `${name} is ${target}px wide at ${width}px`).toBeGreaterThanOrEqual(target - 0.5);
    }
  }
}

test.describe("BR-REQ-041-01 the footer's one row, at every width", () => {
  for (const width of WIDTHS) {
    test(`at ${width}px every item is on one row, nothing overlaps, and every target is its size`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, privacy, word, rule, marks, language, current, other, panelBadge, pinnedBadge } = controls(page);
      const count = await marks.count();
      test.skip(count === 0, "no social address is configured for this server");
      await restAtTheEnd(page);

      const phone = width < SM;
      const target = targetAt(width);
      if (!phone) {
        // From `sm` up the language stays in the header (§262); exactly one "Limbă" navigation
        // is announced at every width.
        await expect(language).toBeHidden();
      }
      const items = await rowItems(page, PAGES[0], phone);
      // Criterion 11: the switch is the first control on the row, in the bar's own corner.
      expect(items[0]![1].x).toBeLessThan(4);

      // Criterion 6 and its footer-bar exception (§372): every item at least the bar's target,
      // in width and in height, on one row — the rule centred on it (§385).
      expectOneRow(items, width, target, "closed");
      for (let i = 0; i < count; i++) await marks.nth(i).click({ trial: true });
      await privacy.click({ trial: true });
      if (phone) await other.click({ trial: true });

      // §323: the notice is reachable from every page without opening anything. Its name and
      // tooltip are the notice's; the word "GDPR" is on screen at every width (§378, §385).
      await expect(privacy).toHaveAttribute("title", "Nota de confidențialitate (GDPR)");
      await expect(privacy).toHaveAttribute("href", /\/ro\/confidentialitate$/);
      await expect(word).toBeVisible();
      await expect(word).toHaveText("GDPR");
      // Right after the fold, ahead of the marks, and on a phone every item the gap from the next.
      expectOrderedAndSpaced(items, width, phone);
      if (phone) {
        await expect(rule).toBeVisible();
        // Flags only: no letters on screen — each code is clipped to a pixel, still read by a
        // screen reader — and the current one ringed.
        for (const [code, item] of [["RO", current], ["EN", other]] as const) {
          const letters = await boxOf(item.getByText(code, { exact: true }), `the ${code} code`);
          expect(letters.width, `${code} is not on screen at ${width}px`).toBeLessThanOrEqual(1);
        }
        const ring = await current.locator("span").first().evaluate((el) => getComputedStyle(el).outlineStyle);
        expect(ring, "the current language is ringed").toBe("solid");
      } else {
        // From `sm` the languages are in the header, and there is nothing to separate.
        await expect(rule).toBeHidden();
      }

      // Never a second line: the closed bar is one target tall, plus its border.
      const bar = await boxOf(footer, "the footer");
      expect(bar.height, `the bar's height at ${width}px`).toBeLessThanOrEqual(target + 2);
      await expect(summary).toBeVisible();

      // The build stamp: whichever copy applies at this width is not on screen — the fold is
      // closed, and a desktop's pinned copy only shows from `md`.
      if (width >= MD) {
        await expect(pinnedBadge).toBeVisible();
      } else {
        await expect(pinnedBadge).toBeHidden();
      }
      await expect(panelBadge).toBeHidden();
      expectDisjoint(items, width);

      // Criterion 1: nothing on the bar widened the page, at 320px least of all.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

/**
 * §372 — the phone's one row in both languages, fold closed and open. The English row has other
 * widths ("About the club" is longer than "Despre club"), and opening the fold is what broke the
 * row twice before: the fold's panel is inside the `<details>` again (review finding 4), and
 * every row item keeps the switch's top however tall the open fold grows.
 *
 * §378 and §385: at the four widths the gap was measured at — 320, 360, 390 and 412 — in the
 * owner's order (the word "GDPR" right after the fold, the rule before the flags), every item the
 * phone's gap from the next (4px below 360, 6px from 360), the English summary uncut at 320 and
 * 360, and the last flag inside the viewport. Open, the panel is condensed (§385).
 */
test.describe("§372 §378 §385 one row on a phone, in both languages, fold closed and open", () => {
  for (const where of PAGES) {
    for (const width of [320, 360, 390, 412] as const) {
      for (const state of ["closed", "open"] as const) {
        test(`${where.path} at ${width}px, fold ${state}: every item on the switch's row, in order, spaced, nothing cut`, async ({ page }) => {
          await page.setViewportSize({ width, height: 720 });
          await page.goto(where.path, { waitUntil: "networkidle" });
          const { fold, summary, marks, current, other, word, rule, privacy } = controls(page, where);
          test.skip((await marks.count()) === 0, "no social address is configured for this server");
          const target = targetAt(width);

          if (state === "open") {
            await summary.click();
            await expect(fold).toHaveAttribute("open", "");
            await expect(panelContent(fold)).toBeVisible();
          }
          await restAtTheEnd(page);

          const items = await rowItems(page, where, true);
          expectOneRow(items, width, target, state);
          expectDisjoint(items, width);
          expectOrderedAndSpaced(items, width, true);

          // The word "GDPR", named for the notice in this language (§385), and the rule before
          // the languages, drawn in the theme's divider colour.
          await expect(word).toBeVisible();
          await expect(word).toHaveText("GDPR");
          await expect(privacy).toHaveAttribute("title", where.privacyName);
          await expect(rule).toBeVisible();
          await expect(rule).toHaveAttribute("aria-hidden", "true");

          // Both languages, each the bar's target in width and height (review finding 2).
          for (const [name, locator] of [["the current language", current], ["the other language", other]] as const) {
            const box = await boxOf(locator, name);
            expect(box.width, `${name} is ${target}px wide at ${width}px`).toBeGreaterThanOrEqual(target - 0.5);
            expect(box.height, `${name} is ${target}px tall at ${width}px`).toBeGreaterThanOrEqual(target - 0.5);
          }

          // The summary's words on screen and never ellipsised: `toContainText` passes on clipped
          // text too, so the span's own scroll width is compared with what it is given.
          await expect(summary).toContainText(where.summary);
          const words = await summary.locator("span").first().evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
          expect(words.scroll, `the summary's label is not ellipsised at ${width}px, fold ${state}`).toBeLessThanOrEqual(words.client);

          if (state === "open") {
            // The panel is the fold's own content, below the whole row, never past the viewport.
            const rowBottom = Math.max(...items.map(([, box]) => box.y + box.height));
            const panel = await boxOf(panelContent(fold), "the panel");
            expect(panel.y, `the panel is below the row at ${width}px`).toBeGreaterThanOrEqual(rowBottom - 1);
            expect(panel.x + panel.width, `the panel stays inside ${width}px`).toBeLessThanOrEqual(width);
            // Its links are reachable where they are drawn, over the space below the marks too.
            const terms = fold.getByRole("link", { name: /termeni|racing tos/i });
            await terms.click({ trial: true });

            // Condensed (§385): every link and the stamp a 44px target, the lines 44px apart with
            // no margin between them, "Scrie-ne" once, and the whole panel shorter than the 188px
            // it was at 360 in Romanian (with the club's address configured) before the change.
            const panelControls = panelContent(fold).locator("a, [role=button]");
            const tops: number[] = [];
            for (let i = 0; i < (await panelControls.count()); i++) {
              const box = await boxOf(panelControls.nth(i), `the panel's control ${i}`);
              expect(box.height, `the panel's control ${i} is 44px tall at ${width}px`).toBeGreaterThanOrEqual(43.5);
              tops.push(box.y);
            }
            const lines = [...new Set(tops.map((top) => Math.round(top - panel.y)))];
            for (const line of lines) {
              expect(line % 44 <= 1 || line % 44 >= 43, `a panel line starts at ${line}px, a multiple of 44 at ${width}px`).toBe(true);
            }
            expect(panel.height, `the panel's height at ${width}px`).toBeLessThanOrEqual(lines.length * 44 + 8);
            expect(panel.height, `the panel is shorter than §378's 188px at ${width}px`).toBeLessThan(188);
            const panelText = await panelContent(fold).evaluate((el) => el.textContent ?? "");
            expect(panelText.match(/Scrie-ne|Write to us/g), `"Scrie-ne" once at ${width}px`).toHaveLength(1);
            // The stamp, a chip, is the panel's last item.
            await expect(panelContent(fold).locator(":scope > *").last()).toHaveAttribute("data-testid", "footer-build-badge-panel");
          }

          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, `nothing widens the page at ${width}px, fold ${state}`).toBeLessThanOrEqual(0);
        });
      }
    }
  }

  test("at 768px, opening the fold keeps the row and puts the panel under it", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 720 });
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const { fold, summary, marks } = controls(page);
    test.skip((await marks.count()) === 0, "no social address is configured for this server");
    await summary.click();
    await expect(panelContent(fold)).toBeVisible();
    await restAtTheEnd(page);
    const items = await rowItems(page, PAGES[0], false);
    for (const [name, box] of items) {
      expect(Math.abs(box.y - items[0]![1].y), `${name} stays on the switch's row once the fold is open`).toBeLessThan(1.5);
    }
    const rowBottom = Math.max(...items.map(([, box]) => box.y + box.height));
    const panel = await boxOf(panelContent(fold), "the panel");
    expect(panel.y).toBeGreaterThanOrEqual(rowBottom - 1);
    await expect(page.getByTestId("footer-build-badge-panel").getByLabel(/versiunea site-ului/i)).toBeVisible();
  });

  for (const width of [320, 360] as const) {
    test(`at ${width}px the bar is one row at every scroll position`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
      const { footer, summary, toggle, privacy, language, panelBadge } = controls(page);
      const target = targetAt(width);

      for (const where of ["the top", "halfway down"] as const) {
        if (where === "halfway down") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
        const bar = await boxOf(footer, "the footer");
        expect(bar.y + bar.height, `the bar's bottom edge at ${where}, ${width}px`).toBeLessThanOrEqual(721);
        expect(bar.height, `the bar's height at ${where}, ${width}px`).toBeLessThanOrEqual(target + 2);
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
      const chrome = await page.evaluate(() => {
        const bar = document.querySelector("footer")!.getBoundingClientRect();
        return document.documentElement.scrollHeight - (bar.top + window.scrollY);
      });
      expect(chrome, `from the bar's top to the document's end at ${width}px`).toBeLessThanOrEqual(target + 2);
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

test.describe("§372 the desktop build stamp, pinned to the bar's own corner", () => {
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
    for (const [name, box] of await rowItems(page, PAGES[0], false)) {
      expect(intersects(box, stamp), `${name} and the pinned build stamp overlap`).toBe(false);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
