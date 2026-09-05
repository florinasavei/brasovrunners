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

  test("shows every seeded event with its date and meeting point as text", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // Criterion 2 and BR-REQ-070-03 criterion 2: facts as text, not styling or an image.
    const body = await page.locator("body").innerText();
    expect(body).toContain("Punct de întâlnire");
    expect(body).toContain("Ora de start");
    // A Romanian long-form date, formatted in the event's timezone.
    expect(body).toMatch(/\b(luni|marți|miercuri|joi|vineri|sâmbătă|duminică), \d{1,2} \w+ \d{4}/);
    // A start time, not only a date.
    expect(body).toMatch(/\b\d{2}:\d{2}\b/);
  });

  test("gives every event link a tap target of at least 44 by 44 pixels", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // Criterion 6. The whole card is the link, so this should pass comfortably — the test
    // exists to catch a future redesign that shrinks it to a text link.
    const links = page.locator("main a");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const box = await links.nth(i).boundingBox();
      if (!box) continue; // not rendered, e.g. visually hidden
      expect.soft(box.height, `link ${i} height`).toBeGreaterThanOrEqual(44);
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
    for (const fact of ["Punct de întâlnire", "Distanță", "Înscriere"]) {
      expect(body).toContain(fact);
    }
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
      The meeting point, the difficulty and the cost are deliberately NOT translated: they are
      one value for the whole event (`DECISIONS.md` §36), so the English page shows the club's
      own words. That is the accepted trade for not entering every event's place twice, and it
      is asserted here so nobody "fixes" it back into two columns by accident.
    */
    expect(body).toContain("Stația de telecabină Tâmpa");
    expect(body).toContain("Gratuit");
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
    // A race has two times, each labelled: the gathering and the gun.
    expect(heroText).toContain("Ora de întâlnire");
    expect(heroText).toContain("Startul cursei");
    expect(heroText).toContain("Punct de întâlnire");
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
  test("is in the header on every page, with the current language marked", async ({ page }) => {
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

  test("does not push the header past a 320px viewport", async ({ page }) => {
    await page.goto("/ro/evenimente");

    const header = page.locator("header");
    await expect(header).toBeVisible();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("carries navigation that marks the section you are in", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");

    // The signpost an event page had none of: before this, the only way back to the listing
    // was the logo, which is a convention rather than something a visitor reads.
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    const events = nav.getByRole("link", { name: "Evenimente" });
    await expect(events).toBeVisible();

    // Marked current on a page *inside* the section, not only on its index.
    await expect(nav.locator("[aria-current='page']")).toHaveCount(1);

    // BR-REQ-041-01 criterion 6, on the control every page now carries.
    const box = await events.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await events.click();
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
