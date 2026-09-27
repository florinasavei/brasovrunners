import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * §480 — the 360-px density pass over the public pages (BR-REQ-041-01), measured on the built
 * pages rather than trusted from the markup (`tests/unit/shared/density-pass-360.test.ts` holds
 * the rules, `tests/unit/theme/density.test.ts` the values).
 *
 * - A public fold is the 44 pixels it claims, not 64 (its padding inside its height).
 * - A link inside a sentence is still a 44-pixel target, pressed at its edges, and its paragraph
 *   is a whole number of lines — no line stretched to the link's height.
 * - The contact form's first box is one gap under the legend, not two.
 * - The listing and an event page on the scale's tighter steps (the second round): the cards six
 *   apart, a card's facts six apart and eight under the summary, the route pills six apart, the
 *   filter row six from the intro and the grid.
 *
 * Measured at 360 in headless Chromium on the sample data, before → after the second round: the
 * listing 1974.8 → 1910.8 px (cards 375.4 / 305.8 / 307.3 / 329.4 / 329.4 / 307.3 → 363.4 / 295.8
 * / 297.3 / 319.4 / 319.4 / 297.3, the first card 416 → 412 from the top), the sample race's page
 * 1002.9 → 965.4 (its facts 368 → 334.5: the route pills now fit one line), the open footer fold
 * 130 → 96. At 320: the listing 2024.8 → 1960.8, the race's page 1098.9 → 1090.9.
 *
 * The third round, the event page one step tighter (the description's foot and the divider
 * `sectionGap` → `gapSm`, the partners, the door and the film likewise, the sections under the
 * facts `sectionGapLg` → `sectionGap`), measured the same way after the merge of BR-V2.06: at 360
 * the race's page 965.4 → 949.4 (its facts 518.9 → 502.9 from the top), a partnered event's
 * 921.5 → 897.5; at 320 the race's 1090.9 → 1074.9. The facts' own rows were already on the
 * scale's lowest step (six under an answer, four between a question and its answer) and stay.
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

test.describe("§480 the public pages at 360 px", () => {
  test("the listing's cards, facts, pills and filter row stand on the scale's tighter steps", async ({ page }) => {
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });
    const cards = page.getByTestId("listing-cards").locator(":scope > li");
    await expect(cards.first()).toBeVisible();
    const measured = await page.evaluate(() => {
      const list = document.querySelector("[data-testid='listing-cards']");
      const facts = document.querySelector("[data-testid='card-facts']");
      const pills = document.querySelector("[data-testid='card-facts'] [data-fact='pills'] > div");
      const factsBox = facts?.parentElement;
      return {
        cardGap: list ? getComputedStyle(list).rowGap : null,
        factsRowGap: facts ? getComputedStyle(facts).rowGap : null,
        factsTop: factsBox ? getComputedStyle(factsBox).marginTop : null,
        pillsGap: pills ? getComputedStyle(pills).rowGap : null,
        listTop: list?.getBoundingClientRect().top ?? null,
        filterBottom: document.querySelector("[data-testid='listing-cards']")?.previousElementSibling?.getBoundingClientRect().bottom ?? null,
      };
    });
    // A phone: the tighter steps. From `sm` (the desktop project): the values the pages had.
    const [grid, row, group, pill, around] = isPhone() ? ["6px", "6px", "8px", "6px", 6] : ["12px", "8px", "12px", "8px", 12];
    expect(measured.cardGap, "the grid's gap between two cards").toBe(grid);
    expect(measured.factsRowGap, "a card's facts").toBe(row);
    expect(measured.factsTop, "the gap above a card's facts").toBe(group);
    if (measured.pillsGap !== null) expect(measured.pillsGap, "the route pills").toBe(pill);
    if (measured.listTop !== null && measured.filterBottom !== null) {
      expect(Math.abs(measured.listTop - measured.filterBottom - around), "the grid under the filter row").toBeLessThanOrEqual(0.5);
    }
  });

  test("an event page: the description, the divider and the facts one step closer on a phone", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const first = page.locator("#main h2 a").first();
    await expect(first).toBeVisible();
    await page.goto((await first.getAttribute("href"))!);
    await expect(page.getByTestId("event-facts")).toBeVisible();
    const measured = await page.evaluate(() => {
      const hr = document.querySelector("#main hr");
      const facts = document.querySelector("[data-testid='event-facts']");
      return {
        divider: hr ? getComputedStyle(hr).marginTop : null,
        // The divider's bottom margin is the whole gap to the facts: nothing else sits between.
        underDivider: hr && facts ? facts.getBoundingClientRect().top - hr.getBoundingClientRect().bottom : null,
        // The description's last paragraph collapses into the divider's margin: this is the gap a reader sees.
        overDivider: hr?.previousElementSibling ? hr.getBoundingClientRect().top - hr.previousElementSibling.getBoundingClientRect().bottom : null,
      };
    });
    // `DENSITY.gapSm` on a phone (was `sectionGap`, 16), 24 from `sm` as before.
    const [divider, under] = isPhone() ? ["8px", 8] : ["24px", 24];
    expect(measured.divider, "the divider over the facts").toBe(divider);
    expect(Math.abs((measured.underDivider ?? Number.NaN) - under), "the facts under the divider").toBeLessThanOrEqual(0.5);
    expect(Math.abs((measured.overDivider ?? Number.NaN) - under), "the divider under the description").toBeLessThanOrEqual(0.5);
  });

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
