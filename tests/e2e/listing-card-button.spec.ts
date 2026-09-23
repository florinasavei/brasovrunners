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
    // The seed publishes at least one series; every card gets the button.
    expect(await buttons.count()).toBeGreaterThan(0);

    const first = buttons.first();
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await first.getAttribute("href")).toMatch(/^\/ro\/evenimente\/[^/]+$/);

    // And it is the same door the title opens: the card's heading link and the button agree.
    const card = first.locator("xpath=ancestor::li[1]");
    const titleHref = await card.getByRole("heading", { level: 2 }).getByRole("link").getAttribute("href");
    expect(await first.getAttribute("href")).toBe(titleHref);
  });
});
