import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * BR-REQ-041-01 (§NNN) — the listing's cards, measured in a browser at 320 pixels (the mobile
 * project) and on a desktop, where they stand two to a row.
 *
 * The owner, 2026-09-24, with a screenshot of `/ro/evenimente`: "There is too much whitespace on
 * these cards, it needs to be better spaced". In it: a card's door pinned to its foot with a hole
 * above it; the place's pin alone on a line and the place on the next; the route as a line of
 * middle dots with a tiny glyph; one title underlined in the visited purple beside a black one; a
 * registration address wrapped over two lines of a summary. `listing-card.test.ts` asserts the
 * markup; this measures what a reader sees.
 *
 * The seed publishes single-date events; a series card exists only when another spec has made one
 * (CI's seed has none), so the series checks run on whatever series the listing has, if any.
 */

/** Every event card on the listing, the folds opened so a phone's folded list is measured too. */
async function cards(page: Page): Promise<Locator> {
  await page.goto("/ro/evenimente");
  const main = page.locator("#main");
  // The list streams in after the shell (§166): wait for a card before measuring any.
  await expect(main.locator("ul > li h2").first()).toBeVisible();
  await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
  return main.locator("ul > li").filter({ has: page.locator("h2") });
}

test.describe("BR-REQ-041-01 the listing's cards (§NNN)", () => {
  test("put the place's pin on the place's first line, never alone", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const where = list.nth(i).locator('[data-fact="where"]');
      if ((await where.count()) === 0) continue;
      const offset = await where.evaluate((line) => {
        const icon = line.querySelector("svg")!.getBoundingClientRect();
        const words = line.querySelector("svg + div")!;
        const range = document.createRange();
        range.selectNodeContents(words);
        const first = range.getClientRects()[0]!;
        // The glyph's centre against the first line of words' centre.
        return Math.abs(icon.top + icon.height / 2 - (first.top + first.height / 2));
      });
      expect.soft(offset, `card ${i}: the pin sits on the place's first line`).toBeLessThanOrEqual(6);
    }
  });

  test("draw the route and the cost as pills, with no middle dots between them", async ({ page }) => {
    const list = await cards(page);
    // The seeded Tâmpa run: 14 km, 600 m of climb, moderate, on trail, free.
    const tampa = list.filter({ hasText: "Tură pe Tâmpa" }).first();
    const pills = tampa.locator('[data-fact="pills"] .MuiChip-root');
    await expect(pills).toHaveText(["14 km", "600 m D+", "Mediu", "Trail", "Gratuit"]);
    await expect(tampa.locator('[data-fact="pills"]')).not.toContainText("·");
    // The surface is said once on the card: as a pill, not also as a chip at the top.
    await expect(tampa.locator(".MuiChip-root", { hasText: /^Trail$/ })).toHaveCount(1);
    // The long "diferență de nivel" of the old line is the pill's "D+" now, on every card.
    await expect(page.locator("#main ul > li", { hasText: "diferență de nivel" })).toHaveCount(0);
  });

  test("give every title one style: the text's colour, no underline, one size and weight", async ({ page }) => {
    const list = await cards(page);
    const styles = await list.locator("h2 a").evaluateAll((links) =>
      links.map((link) => {
        const style = getComputedStyle(link);
        return `${style.color}|${style.textDecorationLine}|${style.fontSize}|${style.fontWeight}`;
      }),
    );
    expect(styles.length).toBeGreaterThan(0);
    expect(new Set(styles).size).toBe(1);
    const bodyColour = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(styles[0]).toBe(`${bodyColour}|none|18px|600`);
  });

  test("keep the door to the page right under the facts — no hole above it", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    for (let i = 0; i < count; i += 1) {
      const card = list.nth(i);
      const gap = await card.evaluate((li) => {
        const door = [...li.querySelectorAll("a")].find((a) => /Descrierea completă/.test(a.textContent ?? ""))!;
        // The last thing above the door: the fold of a series card, or the facts.
        const above = li.querySelector("details") ?? li.querySelector('[data-testid="card-facts"]')!;
        return door.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
      });
      // The door's own margin, four pixels, and no more: what a row leaves over is below it.
      expect.soft(gap, `card ${i}: the door follows the facts`).toBeLessThanOrEqual(8);
      expect.soft(gap, `card ${i}: the door does not overlap the facts`).toBeGreaterThanOrEqual(0);
    }
  });

  test("clamp the summary to three lines and print no web address", async ({ page }) => {
    const list = await cards(page);
    const summaries = list.locator('[data-testid="card-excerpt"]');
    const count = await summaries.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const lines = await summaries.nth(i).evaluate((box) => {
        const paragraph = box.querySelector("p");
        const lineHeight = parseFloat(getComputedStyle(paragraph ?? box).lineHeight);
        // A picture is not a line; the seed's summaries have none.
        return box.querySelector("figure") ? 0 : Math.round(box.getBoundingClientRect().height / lineHeight);
      });
      expect.soft(lines, `summary ${i}`).toBeLessThanOrEqual(3);
    }
    await expect(page.locator("#main ul > li", { hasText: /https?:\/\// })).toHaveCount(0);
  });

  test("take a press anywhere on a single-date card to its page, and the door's own press too", async ({ page }) => {
    const list = await cards(page);
    const card = list.filter({ hasText: "Tură pe Tâmpa" }).first();
    const href = await card.locator("h2 a").getAttribute("href");
    expect(href).toMatch(/^\/ro\/evenimente\/tura-pe-tampa$/);
    // A point on the card that is no link of its own — the place's line — lands on the title's link.
    const landed = await card.locator('[data-fact="where"]').evaluate((line) => {
      const box = line.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width - 4, box.top + box.height / 2)?.closest("a")?.getAttribute("href") ?? null;
    });
    expect(landed).toBe(href);
    // The door stands above the stretched link and takes its own press.
    const door = card.getByRole("link", { name: "Descrierea completă a evenimentului" });
    const onDoor = await door.evaluate((link) => {
      const box = link.getBoundingClientRect();
      return document.elementFromPoint(box.left + 8, box.top + box.height / 2)?.closest("a") === link;
    });
    expect(onDoor).toBe(true);
  });

  test("write a series card's next date on its own line with «Următoarea:», when the listing has a series", async ({ page }) => {
    const list = await cards(page);
    const series = list.filter({ has: page.locator("summary", { hasText: /^Următoarele date/ }) });
    const count = await series.count();
    test.skip(count === 0, "no series on the listing: CI's seed publishes none");
    for (let i = 0; i < count; i += 1) {
      const when = series.nth(i).locator('[data-fact="when"]');
      await expect(when).toContainText(/^Următoarea:\s*(Luni|Marți|Miercuri|Joi|Vineri|Sâmbătă|Duminică), \d{1,2} /);
      // The word is not a line of its own above the facts any more: nowhere outside the date's line.
      const elsewhere = await series.nth(i).evaluate(
        (li) =>
          [...li.querySelectorAll("*")].filter(
            (element) => element.children.length === 0 && /^Următoarea:?$/.test(element.textContent?.trim() ?? "") && !element.closest('[data-fact="when"]'),
          ).length,
      );
      expect(elsewhere).toBe(0);
    }
  });

  test("fit a 320-pixel phone: nothing wider than the page", async ({ page }) => {
    await cards(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
