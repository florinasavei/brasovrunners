import { expect, test } from "@playwright/test";

/**
 * BR-REQ-052-02 criterion 8 — what the event page's share buttons actually send
 * (`DECISIONS.md` §90, §140 and §299;
 * `events/ui/ShareLinks.tsx`, `events/share-links.ts`).
 *
 * The end-to-end server runs with `APP_BASE_URL` set to its own address, so the absolute URL
 * every share must carry is exactly the address the browser is on: the unit test holds the
 * builders to a fixed base, this holds the rendered anchors to the page.
 *
 * The network buttons are anchors — no script opens them, because iOS Safari refuses a popup
 * opened after an `await` — so the assertions are about attributes, which is what a tap follows.
 */
const EVENT = "/ro/evenimente/tura-pe-tampa";

test.describe("BR-REQ-052-02 criterion 8 — the share buttons", () => {
  test("hand Facebook the event's own absolute address, encoded once, in a new tab", async ({ page }) => {
    await page.goto(EVENT);
    const facebook = page.locator("#main").getByRole("link", { name: "Facebook" });
    const href = await facebook.getAttribute("href");
    expect(href).not.toBeNull();
    const share = new URL(href!);
    expect(`${share.origin}${share.pathname}`).toBe("https://www.facebook.com/sharer/sharer.php");
    // The page itself — never the site's root, never a path.
    expect(share.searchParams.get("u")).toBe(page.url());
    expect(href).toContain(`u=${encodeURIComponent(page.url())}`);
    await expect(facebook).toHaveAttribute("target", "_blank");
    await expect(facebook).toHaveAttribute("rel", /noopener/);
  });

  test("hand WhatsApp the title and the same address", async ({ page }) => {
    await page.goto(EVENT);
    const whatsapp = page.locator("#main").getByRole("link", { name: "WhatsApp" });
    const share = new URL((await whatsapp.getAttribute("href"))!);
    expect(share.host).toBe("wa.me");
    expect(share.searchParams.get("text")).toContain(page.url());
    expect(share.searchParams.get("text")).toContain("Tură pe Tâmpa");
    await expect(whatsapp).toHaveAttribute("target", "_blank");
  });

  test("offer the square card for Instagram: the picture as a download, or the share sheet where the browser has one", async ({ page }) => {
    await page.goto(EVENT);
    const main = page.locator("#main");
    // The server renders the download; a browser that can share a file from a touch screen
    // turns it into a button once hydrated. Either is the card, and either is a 44px target.
    const control = main.getByRole("link", { name: /Instagram/ }).or(main.getByRole("button", { name: /Instagram/ }));
    await expect(control).toBeVisible();
    const href = await control.getAttribute("href");
    if (href !== null) {
      expect(href).toMatch(/\/events\/tura-pe-tampa\/share-image$/);
      await expect(control).toHaveAttribute("download", "");
    }
    if (test.info().project.name === "mobile") {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("are 44-pixel targets on a phone", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "the finger's size is the phone's rule");
    await page.goto(EVENT);
    const row = page.locator("#main").getByRole("link", { name: /Facebook|WhatsApp|Google Calendar|\.ics/ });
    const count = await row.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i++) {
      const box = await row.nth(i).boundingBox();
      expect(box?.height ?? 0, `share link ${i}`).toBeGreaterThanOrEqual(44);
    }
  });
});
