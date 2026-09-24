import { expect, test, type Locator, type Page } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox } from "./support/fold";

/**
 * BR-REQ-041-01 (§366) — the listing's cards, measured in a browser at 320 pixels (the mobile
 * project) and on a desktop, where they stand two to a row.
 *
 * The owner, 2026-09-24, with a screenshot of `/ro/evenimente`: "There is too much whitespace on
 * these cards, it needs to be better spaced"; then, of the one-off "Trail to Road cu Brașov Running
 * Festival" beside two series cards: "I do not see the google maps link for this event", "for the
 * time I would like a clock icon as well", "I am missing the blue link for this event, why?", and
 * of its facts line beside the event page's pills: "this is currently pretty ugly!". In it: the
 * one-off card one `<a>` around everything with a black title, a door pinned to the card's foot
 * with a hole above it; the place's pin alone on a line; the route as a line of middle dots with
 * the partner's sentence among the numbers; a registration address wrapped over two lines of a
 * summary. `listing-card.test.ts` asserts the markup; this measures what a reader sees.
 *
 * The seed publishes single-date events with no map link and no series (`pilot.ts`, CI's too). The
 * tap-target check makes its own series, with a map link, so the series card's title over its
 * rhythm, the map link and the dates in the fold are pressed on every run, and deletes it after;
 * the other checks run on whatever the listing has — that series while it stands, another spec's —
 * and the unit test carries the map link on both kinds of card.
 */

/** Every event card on the listing, the folds opened so a phone's folded list is measured too. */
async function cards(page: Page): Promise<Locator> {
  await page.goto("/ro/evenimente");
  const main = page.locator("#main");
  // The list streams in after the shell (§166): wait for a card before measuring any — in the
  // document first, since with more than four cards a phone folds them all (§78) and the first is
  // not visible until the fold is opened here.
  const first = main.locator("ul > li h2").first();
  await expect(first).toBeAttached();
  await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
  await expect(first).toBeVisible();
  return main.locator("ul > li").filter({ has: page.locator("h2") });
}

/**
 * A weekly series of three published dates, the first eight days out, with a map link and a
 * summary in both languages — made in the backoffice, the way the club makes one, then signed out
 * of, so the listing is read as a visitor reads it. Returns the series' Romanian title.
 *
 * Through the backoffice and not straight into the database (as `waitlist-length.spec.ts` seeds its
 * events), because the listing reads its rows through the public cache (§333), which only a write
 * through the application expires: rows inserted behind the server's back would never reach a
 * listing this server had already read, and the other specs read it first. Removed the same way
 * (`removeSeries`), for the same reason and one more: a phone folds the listing once it has more
 * than four cards (§78), and a series left behind would fold it for every spec after this one.
 */
async function publishSeries(page: Page): Promise<string> {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const title = `Tură de probă ${suffix}`;
  const field = (name: string) => page.locator(`[name="${name}"]`);
  const summary = async (locale: "ro" | "en", words: string) => {
    const panel = languagePanel(page, "title", locale);
    await panel.locator("summary").filter({ hasText: "Rezumat" }).click();
    await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
    await page.keyboard.type(words);
  };
  // Inside the eight weeks a series creates into at once (§122), as `series-drafts.spec.ts` does.
  const DAY = 86_400_000;
  const today = new Date();
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 8, 9));
  const ymd = (date: Date) => date.toISOString().slice(0, 10);

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  await fillDateField(page, "Începutul evenimentului", ymd(first));
  await fillTimeField(page, "Ora", "09:00");
  await field("event.locationName").fill("Parcul Tractorul");
  await field("event.mapUrl").fill("https://maps.example.test/parcul-tractorul");
  await field("translations.ro.title").fill(title);
  await field("translations.ro.slug").fill(`tura-de-proba-${suffix}`);
  await summary("ro", "O tură de probă, pentru cardul seriei.");
  await languageTab(page, "title", "en").click();
  await field("translations.en.title").fill(`Trial run ${suffix}`);
  await languageTab(page, "address", "en").click();
  await field("translations.en.slug").fill(`trial-run-${suffix}`);
  await summary("en", "A trial run, for the series card.");
  await page.getByRole("button", { name: "Creează și publică" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/, { timeout: 30_000 });
  await hydrated(page);

  // Weekly, until two weeks on: two more dates, published with the source (the tick's default, §350).
  const recurrence = await openEditorBox(page, "Recurență");
  await recurrence.getByRole("checkbox", { name: "Repetă evenimentul" }).check();
  await fillDateField(page, "Până la (opțional)", ymd(new Date(first.getTime() + 14 * DAY)));
  await expect(recurrence.getByRole("checkbox", { name: "Publică datele noi automat" })).toBeChecked();
  await recurrence.getByRole("button", { name: "Creează datele" }).click();
  await page.getByRole("dialog", { name: "Creezi datele?" }).getByRole("button", { name: "Creează datele" }).click();
  await expect(page.locator("#admin-alert")).toContainText("2 date create acum", { timeout: 15_000 });

  await page.context().clearCookies();
  return title;
}

/** The series `publishSeries` made, deleted from the backoffice's list — one row, its three dates (§113, §114). */
async function removeSeries(page: Page, title: string): Promise<void> {
  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin");
  // The row's checkbox is MUI's: a tick before hydration is reverted when React takes over.
  await hydrated(page);
  const main = page.locator("#main");
  const row = main.locator("tr, li").filter({ visible: true }).filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await row.getByRole("checkbox", { name: `Selectează „${title}”` }).check();
  await main.getByRole("button", { name: "Șterge cele bifate" }).click();
  await page.getByRole("dialog", { name: "Ștergi evenimentele bifate?" }).getByRole("button", { name: "Șterge cele bifate" }).click();
  await expect(page.locator("#admin-alert")).toContainText("3 evenimente șterse", { timeout: 15_000 });
  await page.context().clearCookies();
}

test.describe("BR-REQ-041-01 the listing's cards (§366)", () => {
  test("are no whole-card link: the title is the card's link, the heading holds it, nothing is a link inside a link", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const card = list.nth(i);
      // No anchor wraps the heading or any other anchor.
      await expect(card.locator("a h2")).toHaveCount(0);
      await expect(card.locator("a a")).toHaveCount(0);
      // The title is the first link, to the event's page, and the door goes to the same page.
      const title = card.locator("h2 a");
      await expect(title).toHaveCount(1);
      const href = await title.getAttribute("href");
      expect(href).toMatch(/^\/ro\/evenimente\/[^/]+$/);
      expect(await card.getByRole("link").first().getAttribute("href")).toBe(href);
      expect(await card.getByRole("link", { name: "Descrierea completă a evenimentului" }).getAttribute("href")).toBe(href);
    }
  });

  test("give every title one style: the club's blue, no underline, one size and weight", async ({ page }) => {
    const list = await cards(page);
    const styles = await list.locator("h2 a").evaluateAll((links) =>
      links.map((link) => {
        const style = getComputedStyle(link);
        return `${style.color}|${style.textDecorationLine}|${style.fontSize}|${style.fontWeight}`;
      }),
    );
    expect(styles.length).toBeGreaterThan(0);
    expect(new Set(styles).size).toBe(1);
    // The primary colour — the door wears it too (§319) — never the page's ink or a visited purple.
    const door = list.first().getByRole("link", { name: "Descrierea completă a evenimentului" });
    const primary = await door.evaluate((link) => getComputedStyle(link).color);
    const ink = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(primary).not.toBe(ink);
    expect(styles[0]).toBe(`${primary}|none|20px|500`);
  });

  test("put the place's pin on the place's first line, never alone, and the place's map as its link wherever the club gave one", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const where = list.nth(i).locator('[data-fact="where"]');
      if ((await where.count()) === 0) continue;
      const offset = await where.evaluate((line) => {
        const icon = line.querySelector("svg")!.getBoundingClientRect();
        const words = line.querySelector("svg + div")!;
        // The first line box of the words themselves — not a link's padded box around them, and
        // not the text of a style tag the renderer may have put beside them.
        const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => (node.textContent?.trim() && !node.parentElement?.closest("style, script") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
        });
        const range = document.createRange();
        range.selectNodeContents(walker.nextNode()!);
        const first = range.getClientRects()[0]!;
        // The glyph's centre against the first line of words' centre.
        return Math.abs(icon.top + icon.height / 2 - (first.top + first.height / 2));
      });
      expect.soft(offset, `card ${i}: the pin sits on the place's first line`).toBeLessThanOrEqual(6);
      const map = where.locator("a");
      if ((await map.count()) > 0) {
        await expect(map).toHaveAttribute("target", "_blank");
        expect((await map.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("leave every link and fold on a card its whole target: a press two pixels inside any edge lands on it", async ({ page }) => {
    /*
      A box 44 pixels tall is not a 44-pixel target when something later on the card sits on part
      of it: what comes later paints over it and takes the press there. The series card's rhythm
      line once sat six pixels up inside its title link's box (§366) while a measure of the box
      still said 44, and a series' dates were 24-pixel pills under a comment that said 44 — so this
      presses the edges of every link and fold on every card and asks which element answers. With
      a series of its own first: the seed has none, and a series card is the one whose title has a
      line right under it and whose dates are links.
    */
    test.setTimeout(150_000);
    const title = await publishSeries(page);
    try {
      const list = await cards(page);
      // One card for the three dates: the title, the map, the fold with the three dates, the door.
      const series = list.filter({ has: page.getByRole("link", { name: title, exact: true }) });
      await expect(series).toHaveCount(1);
      await expect(series.locator('[data-fact="where"] a')).toHaveCount(1);
      await expect(series.locator("details a")).toHaveCount(3);
      // «Următoarea:» leads the next date's own line (§113) — asserted here too, where a series always stands.
      await expect(series.locator('[data-fact="when"]')).toContainText(/^Următoarea:\s*(Luni|Marți|Miercuri|Joi|Vineri|Sâmbătă|Duminică), \d{1,2} /);

      const targets = list.locator("a, summary");
      const count = await targets.count();
      expect(count).toBeGreaterThan(0);
      let pressed = 0;
      for (let i = 0; i < count; i += 1) {
        const result = await targets.nth(i).evaluate((target) => {
          target.scrollIntoView({ block: "center", behavior: "instant" });
          const box = target.getBoundingClientRect();
          const press = (x: number, y: number) => {
            const hit = document.elementFromPoint(x, y);
            // The sticky header or footer over the point says nothing about the card: not counted.
            if (!hit || !hit.closest("#main")) return "chrome";
            return target.contains(hit) ? "itself" : `${hit.tagName.toLowerCase()} "${(hit.textContent ?? "").trim().slice(0, 40)}"`;
          };
          const [middleX, middleY] = [box.left + box.width / 2, box.top + box.height / 2];
          return {
            name: (target.textContent ?? "").trim().slice(0, 40),
            height: box.height,
            width: box.width,
            top: press(middleX, box.top + 2),
            bottom: press(middleX, box.bottom - 2),
            left: press(box.left + 2, middleY),
            right: press(box.right - 2, middleY),
          };
        });
        // To a tenth of a pixel: layout counts in sixty-fourths, and a 44-pixel fold at a fractional
        // offset measures 43.99997.
        expect.soft(Math.round(result.height * 10) / 10, `${i} «${result.name}»: 44 pixels tall`).toBeGreaterThanOrEqual(44);
        expect.soft(Math.round(result.width * 10) / 10, `${i} «${result.name}»: 44 pixels wide`).toBeGreaterThanOrEqual(44);
        for (const edge of ["top", "bottom", "left", "right"] as const) {
          if (result[edge] === "chrome") continue;
          pressed += 1;
          expect.soft(result[edge], `${i} «${result.name}»: a press at its ${edge} edge`).toBe("itself");
        }
      }
      expect(pressed).toBeGreaterThan(0);
    } finally {
      await removeSeries(page, title);
    }
  });

  test("put a clock beside the time on every card's date line", async ({ page }) => {
    /*
      By place, not by name: MUI names its icons (`data-testid="ScheduleIcon"`) only outside a
      production build, and this suite runs one — `listing-card.test.ts` checks the names. The
      line's own glyph, the calendar, leads it; the one glyph among its words is the clock, in the
      same piece as the time it stands before.
    */
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const when = list.nth(i).locator('[data-fact="when"]');
      await expect(when.locator(":scope > svg")).toHaveCount(1);
      const clock = when.locator(":scope > div svg");
      await expect(clock).toHaveCount(1);
      expect(Math.round((await clock.boundingBox())?.width ?? 0)).toBe(20);
      expect(await clock.evaluate((svg) => svg.parentElement?.textContent ?? "")).toMatch(/\d{1,2}:\d{2}/);
    }
  });

  test("keep a title's line as tall as its words: what follows starts one of the card's gaps under them, not under the link's reach", async ({ page }) => {
    /*
      The title's link is 44 pixels of target around 26 pixels of words, the rest given back as
      margin (§366) — given back only if the padding is inside the 44. Inside the listing's
      "other events" fold everything is content-box (a `<details>` slots its content where MUI's
      `box-sizing: inherit` does not reach), and until the link said border-box its heading stood
      44 tall and the line under it began 27 pixels below the title's words instead of 9: nothing
      overlapped, so no press showed it, and no box's own height did either.
    */
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const gap = await list.nth(i).locator("h2").evaluate((h2) => {
        // The words' own line boxes: the link is the range's container, so its padded box is not one of them.
        const range = document.createRange();
        range.selectNodeContents(h2.querySelector("a")!);
        const words = range.getClientRects();
        return h2.nextElementSibling!.getBoundingClientRect().top - words[words.length - 1]!.bottom;
      });
      // A line's gap (8) or a group's (12), and the line's half-leading (1).
      expect.soft(gap, `card ${i}: under the title's words`).toBeGreaterThanOrEqual(6);
      expect.soft(gap, `card ${i}: under the title's words`).toBeLessThanOrEqual(14);
    }
  });

  test("draw the route and the cost as pills, with no middle dots between them and no partner among them", async ({ page }) => {
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
    // "Împreună cu …" is not among any card's facts.
    await expect(page.locator('#main [data-testid="card-facts"]', { hasText: "Împreună cu" })).toHaveCount(0);
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
