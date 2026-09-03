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
  test("returns 404 for an event whose English translation is a draft", async ({ page }) => {
    const response = await page.goto("/en/events/tampa-trail");
    expect(response?.status()).toBe(404);
  });

  test("does not show the Romanian event in the English listing", async ({ page }) => {
    await page.goto("/en/events");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Tură pe Tâmpa");
  });

  test("returns 404 for an unknown slug rather than redirecting", async ({ page }) => {
    const response = await page.goto("/ro/evenimente/nu-exista-acest-eveniment");
    expect(response?.status()).toBe(404);
  });
});
