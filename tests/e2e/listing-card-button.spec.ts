import { expect, test } from "@playwright/test";

/**
 * BR-REQ-041-01 criterion 6 (44-pixel controls) and `DECISIONS.md` §305 — every card on the
 * listing carries a button to the event's page, in words. The title was the only link, and the
 * owner, looking at the two weekly runs: "am nevoie de un buton pe carduri pentru 'descrierea
 * completa a evenimentului'".
 */
test.describe("§305 the listing card's door to the page", () => {
  test("every card offers 'Descrierea completă a evenimentului', 44px tall, to its event's page", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const main = page.locator("#main");
    const buttons = main.getByRole("link", { name: "Descrierea completă a evenimentului" });
    const first = buttons.first();
    // Wait for the first one before counting: the listing streams its cards after the shell
    // (§166), and a count taken the instant the page loads is a count of nothing — which is how
    // this spec failed on CI's desktop run and passed on its mobile run.
    await expect(first).toBeVisible();
    // The seed publishes events; every card — series or single date — gets the button.
    expect(await buttons.count()).toBeGreaterThan(0);
    const box = await first.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await first.getAttribute("href")).toMatch(/^\/ro\/evenimente\/[^/]+$/);

    // And it is the same door the card already opens: every card links its title (§NNN; no card
    // is one whole link any more) — so the card's first link and the button agree. CI's seed has
    // no multi-date series, so there the cards are all single-date.
    const card = first.locator("xpath=ancestor::li[1]");
    const cardHref = await card.getByRole("link").first().getAttribute("href");
    expect(await first.getAttribute("href")).toBe(cardHref);
  });
});
