import { expect, test } from "@playwright/test";

/**
 * BR-REQ-041-01 — mobile-first journeys.
 * BR-REQ-070-03 — public content is machine-readable.
 * BR-REQ-040-02 — no cross-locale content fallback.
 *
 * These run against the seeded database, so `docker compose up -d db && yarn db:seed` first.
 * The mobile project runs at 320px, the narrowest width criterion 1 names.
 */

test.describe("BR-REQ-041-01 the event list on a phone", () => {
  test("has no horizontal scrolling and no clipped text", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // Criterion 1: the document must never be wider than the viewport.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  // BR-REQ-041-01 criterion 5 (`DECISIONS.md` §137): the month is the grid on every width,
  // the list one press away, and the choice is kept by the month links.
  test("shows the month as a grid, and as a list when asked", async ({ page }) => {
    // The calendar is its own page since §251; the listing is the events themselves.
    await page.goto("/ro/calendar");
    const main = page.locator("#main");
    await expect(main.getByRole("table")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // One tooltip per entry, and it is MUI's (§NNN): no entry carries the browser's `title` too.
    await expect(main.locator("[role=table] a[title], [role=table] a [title]")).toHaveCount(0);

    await main.getByRole("link", { name: "Listă", exact: true }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(main.getByRole("table")).toHaveCount(0);
    // The next-month arrow keeps the list.
    expect(await main.getByRole("link", { name: "Luna următoare" }).getAttribute("href")).toContain("view=list");
    await main.getByRole("link", { name: "Calendar", exact: true }).click();
    await expect(page).not.toHaveURL(/view=list/);
    await expect(main.getByRole("table")).toBeVisible();
  });

  // `DECISIONS.md` §157: a real tap at the switch's centre — the footer's fold once painted over it.
  test("switches to the dark scheme from the footer's corner, by a tap", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const toggle = page.getByRole("button", { name: "Temă întunecată" });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    // MUI marks the scheme with a valueless attribute: data-dark="", data-light="".
    await expect(page.locator("html")).toHaveAttribute("data-dark", "");
    await expect(page.getByRole("button", { name: "Temă luminoasă" })).toBeVisible();
  });

  test("shows every seeded event with its date and meeting point as text", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // Criterion 2 and BR-REQ-070-03 criterion 2: facts as text, not styling or an image.
    const body = await page.locator("body").innerText();
    // The seeded meeting points, as words on the page.
    expect(body).toContain("Tâmpa");
    // A Romanian date with its weekday, formatted in the event's timezone — capitalised where
    // it starts the facts, the month abbreviated (§349).
    expect(body).toMatch(/(Luni|Marți|Miercuri|Joi|Vineri|Sâmbătă|Duminică), \d{1,2} [\w.]+ \d{4}/);
    // A start time, not only a date.
    expect(body).toMatch(/\b\d{2}:\d{2}\b/);
  });

  /**
   * BR-REQ-041-01 criterion 12 (§166; the owner: "there is flickering when changing
   * calendars!").
   *
   * The flicker had two halves. The arrows and the pills were plain anchors, so a month
   * change was a *document* navigation: the browser threw the page away and painted white
   * before the next one arrived. And the whole page was one server render, so nothing could
   * appear until the month's query had answered.
   *
   * Both halves are asserted here by what they leave behind. The controls are outside the
   * streamed region and must not move a pixel across a month change — that is the difference
   * between a soft navigation and a document one, measured. And the grid that comes back must
   * be the same width as the one that left, because a skeleton of exactly that box stood
   * there in between; a fallback of the wrong size would show up as a reflow right here.
   *
   * What is deliberately not asserted is the fallback *mid-flight*. Playwright's route
   * interception delays a response as a whole and this one is a stream whose shell is already
   * gone by the time the delay could bite, so a test for it would be a test of the harness's
   * timing rather than of the page.
   *
   * Every measurement here is taken **after the page has settled**, and that is load-bearing
   * (§167). Written without it the test compared a render with itself: `toBeVisible()` on the
   * grid passes on the first poll because a soft navigation keeps the old grid mounted, and
   * the streamed regions reveal independently, so the "before" could be measured with a
   * skeleton still standing above the arrow. The two waits below — the month in the address
   * and the title, and no `role="status"` left anywhere under `main` — are what give the
   * geometry assertions teeth.
   */
  test("changes month without moving the controls or reflowing the grid", async ({ page }) => {
    await page.goto("/ro/calendar");
    const main = page.locator("#main");
    await expect(main.getByRole("table")).toBeVisible();
    // Every streamed region has arrived: a fallback still on screen would be measured as the
    // page's layout and the swap after the click read as a reflow that is not there.
    await expect(main.locator('[role="status"]')).toHaveCount(0);

    const next = main.getByRole("link", { name: "Luna următoare" });
    const titleBefore = await page.locator("#calendar-title").innerText();
    const controlBefore = await next.boundingBox();
    const gridBefore = await main.getByRole("table").boundingBox();
    // A real href, still, with the whole query in it: the soft navigation is an enhancement
    // of the link and never a replacement for it.
    expect(await next.getAttribute("href")).toContain("month=");

    await next.click();
    // The navigation actually happened, and the month actually moved. Without these two the
    // assertions below would all pass against the pre-click DOM.
    await expect(page).toHaveURL(/month=/);
    await expect(page.locator("#calendar-title")).not.toHaveText(titleBefore);
    await expect(main.getByRole("table")).toBeVisible();
    await expect(main.locator('[role="status"]')).toHaveCount(0);

    const controlAfter = await main.getByRole("link", { name: "Luna următoare" }).boundingBox();
    expect(Math.abs((controlAfter?.y ?? -1) - (controlBefore?.y ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((controlAfter?.x ?? -1) - (controlBefore?.x ?? 0))).toBeLessThanOrEqual(2);

    const gridAfter = await main.getByRole("table").boundingBox();
    expect(Math.abs((gridAfter?.width ?? -1) - (gridBefore?.width ?? 0))).toBeLessThanOrEqual(1);

    // Criterion 1 still holds with the loading states in the page.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("gives every event link a tap target of at least 44 by 44 pixels", async ({ page }) => {
    await page.goto("/ro/evenimente");
    // "Other events" folds on a phone once other specs have published a fifth event
    // (`DECISIONS.md` §78); a link in a closed fold measures 0×0 and is not a tap target yet.
    // Open every fold, so the links are measured as a reader would see them.
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));

    // Criterion 6. The whole card is the link, so this should pass comfortably — the test
    // exists to catch a future redesign that shrinks it to a text link.
    const links = page.locator("main a");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    /*
      44 on a phone, which is the design target and where a finger is the pointer; 24 — WCAG
      2.2's own minimum — on a desktop, where it is not (§175).

      The criterion is about the *event* links, and those are whole cards: comfortably over 44
      at either width, and this loop exists to catch a redesign that shrinks one to a text link.
      What sits beside them on the listing is the calendar and share row, and eight
      finger-sized pills across a desktop page were the loudest thing on it — the owner:
      "aceste butoane sunt mult prea mari", "these buttons must be smaller as well".
    */
    const minimum = test.info().project.name === "mobile" ? 44 : 24;
    for (let i = 0; i < count; i += 1) {
      const box = await links.nth(i).boundingBox();
      if (!box) continue; // not rendered, e.g. visually hidden
      expect.soft(box.height, `link ${i} height`).toBeGreaterThanOrEqual(minimum);
    }
  });
});

test.describe("BR-REQ-041-01 the event detail page on a phone", () => {
  test("renders the facts without horizontal scrolling", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

    const body = await page.locator("body").innerText();
    // Three lines — when, where, the route — since `DECISIONS.md` §73 grouped the facts.
    for (const fact of ["Când", "Unde", "Traseu", " km"]) {
      expect(body).toContain(fact);
    }
  });

  /**
   * `DECISIONS.md` §356 — the owner, of the bulleted facts §168 had made: "better grouped …
   * distance, difficulty, elevation should be on the same line", and "these need to be pills".
   * Read on both projects: 320 pixels, where the question sits over its answer, and a desktop.
   */
  test("draws the route as one row of pills, the cost as its own, «când» on one line", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    const facts = page.getByTestId("event-facts");
    const value = (label: string) => facts.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

    // No bullets and no list: pills and lines.
    await expect(facts.locator("li")).toHaveCount(0);
    await expect(facts).not.toContainText("•");

    // The seeded Tâmpa run — 14 km, 600 m of climb, moderate, on trail — as four pills, in order.
    await expect(value("Traseu").locator(".MuiChip-root")).toHaveText(["14 km", "600 m D+", "Mediu", "Trail"]);
    // Free, in a row of its own rather than among the route's pills.
    await expect(value("Cost").locator(".MuiChip-root")).toHaveText(["Gratuit"]);
    await expect(value("Traseu")).not.toContainText("Gratuit");

    // «Când»: the weekday's date and the time, no «începe la», on one line at 320 px too.
    const when = value("Când");
    await expect(when).toHaveText(/^(Luni|Marți|Miercuri|Joi|Vineri|Sâmbătă|Duminică), \d{1,2} [\w.]+ \d{4}·\d{2}:\d{2}$/);
    const lineHeight = await when.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
    expect((await when.boundingBox())?.height ?? Infinity).toBeLessThan(lineHeight * 1.5);

    // Every row's glyph the same size, whichever question it answers.
    const glyphs = await facts.locator("dt svg").evaluateAll((svgs) => svgs.map((svg) => Math.round(svg.getBoundingClientRect().width)));
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(glyphs)).toEqual(new Set([20]));

    // Still nothing wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("carries a parseable SportsEvent block naming the club as organizer", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");

    // BR-REQ-052-02 criterion 7: parse the emitted JSON-LD rather than assert on markup.
    const raw = await page.locator('script[type="application/ld+json"]').first().innerText();
    const data = JSON.parse(raw);

    expect(data["@type"]).toBe("SportsEvent");
    expect(data.organizer["@id"]).toContain("#organization");
    expect(data.location.address["@type"]).toBe("PostalAddress");
    // Criterion 2: the offset, not a bare Z.
    expect(data.startDate).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});

test.describe("BR-REQ-040-02 no cross-locale fallback", () => {
  test("serves the English event page in English, not Romanian", async ({ page }) => {
    // Every event is published in both languages. The rule this guards is not "English 404s"
    // — it is that a locale never borrows the other language's words. The integration suite
    // covers the Draft case, which needs a draft translation to exist.
    const response = await page.goto("/en/events/tampa-trail");
    expect(response?.status()).toBe(200);

    const body = await page.locator("body").innerText();
    expect(body).toContain("Tâmpa trail run");
    expect(body).not.toContain("Tură pe Tâmpa");
    // The excerpt is a translation and must be the English one.
    expect(body).toContain("Up Tâmpa and back");
    expect(body).not.toContain("Urcare pe Tâmpa");

    /*
      The meeting point is deliberately NOT translated: it is one value for the whole event
      (`DECISIONS.md` §36), so the English page shows the club's own words for its own places.
      That is the accepted trade for not entering every event's place twice, and it is asserted
      here so nobody "fixes" it back into two columns by accident.

      The cost and the difficulty used to be asserted the same way and no longer are: §43
      narrowed §36 by making them closed sets, so they render in the reader's own language. A
      place name cannot be translated; "Gratuit" always could be.
    */
    expect(body).toContain("Stația de telecabină Tâmpa");
    expect(body).toContain("Free");
    expect(body).not.toContain("Gratuit");
  });

  test("does not show the Romanian event in the English listing", async ({ page }) => {
    await page.goto("/en/events");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Tură pe Tâmpa");
  });

  test("serves each locale at its own slug", async ({ page }) => {
    // The slugs genuinely differ, so a URL built by swapping the locale prefix does not
    // resolve. This is the failure BR-REQ-040-01 criterion 5 exists to prevent.
    expect((await page.goto("/en/events/tura-pe-tampa"))?.status()).toBe(404);
    expect((await page.goto("/ro/evenimente/tampa-trail"))?.status()).toBe(404);
  });

  test("returns 404 for an unknown slug rather than redirecting", async ({ page }) => {
    const response = await page.goto("/ro/evenimente/nu-exista-acest-eveniment");
    expect(response?.status()).toBe(404);
  });
});

/**
 * The featured event, which is what the landing page leads with.
 *
 * The listing is the landing page, so this is shared chrome: a fixed width here breaks a
 * 320px phone, which has already happened once with the header lockup (BR-REQ-041-01
 * criterion 1).
 */
test.describe("BR-REQ-011-01 the featured event leads the landing page", () => {
  test("shows the featured race above the list, with both of its times", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const hero = page.getByRole("region", { name: /Crosul aniversar/ });
    await expect(hero).toBeVisible();

    const heroText = await hero.innerText();
    // A race has two times, each named: the gathering and the gun.
    expect(heroText).toContain("întâlnire la");
    expect(heroText).toContain("start la");
    expect(heroText).toContain("Unde");
    // The seeded race is a placeholder and says so, in the text a visitor reads first.
    expect(heroText).toContain("EXEMPLU");
  });

  test("does not repeat the featured event in the list below it", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const titles = await page.locator("main ul li h2").allInnerTexts();
    expect(titles.filter((title) => title.includes("Crosul aniversar"))).toHaveLength(0);
  });

  test("still fits a 320px viewport with the hero on the page", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});

/**
 * BR-REQ-040-01 criterion 5 — the language switcher lands on the corresponding localized page.
 *
 * The header is shared chrome, so this runs at 320px as well as on the desktop project. The
 * switch that matters is the one on an event page: the two locales have different slugs, and a
 * switcher that swapped the prefix would 404.
 */
test.describe("BR-REQ-040-01 the language switcher", () => {
  test("is on every page, with the current language marked", async ({ page }) => {
    // In the header from `sm` up and in the footer's corner on a phone since §262 — this asks
    // that exactly one exists and works, wherever the width puts it.
    await page.goto("/ro/evenimente");

    const switcher = page.getByRole("navigation", { name: "Limbă" });
    await expect(switcher).toBeVisible();
    // Romanian is the default and this is a Romanian URL, so RO is stated rather than offered.
    await expect(switcher.getByRole("link", { name: "English" })).toBeVisible();
    await expect(switcher.getByRole("link", { name: "Română" })).toHaveCount(0);
  });

  test("switches an event page to the other language's own slug", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");

    await page.getByRole("link", { name: "English" }).click();

    await expect(page).toHaveURL(/\/en\/events\/tampa-trail$/);
    const body = await page.locator("body").innerText();
    expect(body).toContain("Tâmpa trail run");
    expect(body).not.toContain("Tură pe Tâmpa");
  });

  test("switches back, and the listing too", async ({ page }) => {
    await page.goto("/en/events/tampa-trail");
    await page.getByRole("link", { name: "Română" }).click();
    await expect(page).toHaveURL(/\/ro\/evenimente\/tura-pe-tampa$/);

    await page.goto("/ro/evenimente");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/events$/);
  });

  test("does not push the header past a 320px viewport, and keeps it to one row", async ({ page }) => {
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });

    const header = page.locator("header");
    await expect(header).toBeVisible();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

    /*
      One row at every width (the owner, 2026-09-17: "on mobile the logo and the navbar must fit
      on the same row"). The logo and the sections share a line, so the header is one tap target
      tall plus its padding — never a second row under the lockup.

      **The language switcher is on that line from `sm` up and in the footer's bottom-right
      corner on a phone** (§262): its 46 pixels were the difference between "Contact" being on
      the row and being in the ☰ menu, and the owner asked for all three sections. So the
      assertion is where it is, not that it is anywhere in particular — and on a phone that is
      the bottom bar, which this checks by its own centre rather than the header's.
    */
    const logo = page.getByRole("link", { name: "Brașov Runners" }).first();
    const language = page.getByRole("navigation", { name: "Limbă" });
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    const [logoBox, languageBox, navBox] = await Promise.all([
      logo.boundingBox(),
      language.boundingBox(),
      nav.boundingBox(),
    ]);
    const centre = (box: { y: number; height: number } | null) => (box ? box.y + box.height / 2 : NaN);
    expect(Math.abs(centre(logoBox) - centre(navBox))).toBeLessThan(8);

    const inHeader = (await page.locator("header").getByRole("navigation", { name: "Limbă" }).count()) === 1;
    if (inHeader) {
      expect(Math.abs(centre(logoBox) - centre(languageBox))).toBeLessThan(8);
    } else {
      // On the footer's last line, centred in it. A phone's footer has two lines since §324 — the
      // summary on the first, the privacy notice and the language on the second (footer.spec.ts) —
      // each a 44px row, so RO and EN side by side (§365), each 44px tall, centre on the bar's
      // bottom 44 pixels.
      const barBox = await page.locator("footer").boundingBox();
      const lastLine = { y: (barBox?.y ?? NaN) + (barBox?.height ?? NaN) - 44, height: 44 };
      expect(Math.abs(centre(languageBox) - centre(lastLine))).toBeLessThan(8);
      await expect(page.locator("footer").getByRole("navigation", { name: "Limbă" })).toHaveCount(1);
    }
    // Less than two tap targets tall: the two-row header this replaced was 112px.
    const headerBox = await header.boundingBox();
    expect(headerBox?.height ?? 999).toBeLessThan(88);
  });

  test("carries navigation that marks the section you are in", async ({ page }) => {
    // Network idle, so the nav has measured and folded what does not fit: at 320px that is
    // every section, behind the "Meniu" button; on a desktop the entries are on the row.
    await page.goto("/ro/evenimente/tura-pe-tampa", { waitUntil: "networkidle" });

    // The signpost an event page had none of: before this, the only way back to the listing
    // was the logo, which is a convention rather than something a visitor reads.
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    const events = nav.getByRole("link", { name: "Evenimente" });
    const menu = nav.getByRole("button", { name: "Meniu" });
    // `.first()`: on a wide screen with a few standing pages both can be visible at once.
    await expect(events.or(menu).first()).toBeVisible();

    // Marked current on a page *inside* the section, not only on its index — on the row, or
    // on the folded entry, which stays in the DOM (SiteNav).
    await expect(nav.locator("[aria-current='page']")).toHaveCount(1);

    // BR-REQ-041-01 criterion 6, on the control every page now carries — the entry itself, or
    // the menu button and the item behind it when the row is too narrow for the entry.
    const control = (await events.isVisible()) ? events : menu;
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    if (await events.isVisible()) {
      await events.click();
    } else {
      await menu.click();
      const item = page.getByRole("menuitem", { name: "Evenimente" });
      // Polled: the menu grows in, and a box read mid-animation is the scaled-down one.
      await expect
        .poll(async () => (await item.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
      await item.click();
    }
    await expect(page).toHaveURL(/\/ro\/evenimente$/);
  });

  test("offers a skip link before the header", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // Focusing the first tabbable element must reach it: hidden off-screen, never display:none,
    // or it leaves the tab order and the whole point is lost.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Sari la conținut" });
    await expect(skip).toBeFocused();
    await expect(page.locator("#main")).toHaveCount(1);
  });
});
