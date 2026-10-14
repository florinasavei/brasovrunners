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
    // The server renders the download ("Descarcă poza"); a browser that can share a file from
    // a touch screen turns it into a button once hydrated, labelled "Instagram". Either is the
    // card, and either is a small pill like its neighbours (§NNN).
    const control = main.getByRole("link", { name: /Descarcă poza/ }).or(main.getByRole("button", { name: /Instagram/ }));
    await expect(control).toBeVisible();
    const href = await control.getAttribute("href");
    if (href !== null) {
      expect(href).toMatch(/\/events\/tura-pe-tampa\/share-image$/);
      await expect(control).toHaveAttribute("download", "");
    }
    const height = (await control.boundingBox())?.height ?? 0;
    expect(height).toBeGreaterThanOrEqual(24);
    expect(height).toBeLessThanOrEqual(36);
  });

  test("offer the event's own five calendar doors, in the subscription panel's words and order (§NNN)", async ({ page }) => {
    await page.goto(EVENT);
    const row = page.locator("#main").getByText("Adaugă în calendar:").locator("..");
    const links = row.getByRole("link");
    await expect(links).toHaveText(["Google Calendar", "Apple Calendar", "Outlook.com (cont personal)", "Outlook la serviciu sau la școală", "Descarcă fișierul .ics"]);
    const hrefs = await links.evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));
    const google = new URL(hrefs[0]);
    expect(`${google.origin}${google.pathname}`).toBe("https://calendar.google.com/calendar/render");
    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("text")).toBe("Tură pe Tâmpa");
    const wallClock = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
    for (const [index, host] of [
      [2, "outlook.live.com"],
      [3, "outlook.office.com"],
    ] as const) {
      const outlook = new URL(hrefs[index]);
      expect(`${outlook.origin}${outlook.pathname}`).toBe(`https://${host}/calendar/0/deeplink/compose`);
      expect(outlook.searchParams.get("path")).toBe("/calendar/action/compose");
      expect(outlook.searchParams.get("rru")).toBe("addevent");
      expect(outlook.searchParams.get("subject")).toBe("Tură pe Tâmpa");
      // The event's own wall clock with its offset: the `+` survived the encoding.
      expect(outlook.searchParams.get("startdt")).toMatch(wallClock);
      expect(outlook.searchParams.get("enddt")).toMatch(wallClock);
    }
    // Apple Calendar opens the file where it is; only the last door saves it.
    expect(hrefs[1]).toMatch(/\/events\/tura-pe-tampa\/calendar\.ics$/);
    expect(hrefs[4]).toBe(hrefs[1]);
    await expect(links.nth(1)).not.toHaveAttribute("download", /.*/);
    await expect(links.nth(4)).toHaveAttribute("download", "");
    for (const index of [0, 2, 3]) await expect(links.nth(index)).toHaveAttribute("target", "_blank");
  });

  test("are small pills at 320 pixels, a row that wraps, nothing wider than the page (§NNN)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(EVENT);
    const row = page.locator("#main").getByRole("link", { name: /^(Facebook|WhatsApp|Google Calendar|Apple Calendar|Outlook.*|Descarcă fișierul \.ics)$/ });
    const count = await row.count();
    expect(count).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < count; i++) {
      const box = await row.nth(i).boundingBox();
      // The house's small pill: over WCAG 2.2's 24, nowhere near the old 44.
      expect(box?.height ?? 0, `share link ${i}`).toBeGreaterThanOrEqual(24);
      expect(box?.height ?? 0, `share link ${i}`).toBeLessThanOrEqual(36);
      expect((box?.x ?? 0) + (box?.width ?? 0), `share link ${i} inside the page`).toBeLessThanOrEqual(320);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("keep a 44-pixel tap area around the small pill: an invisible band above and below (§NNN)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(EVENT);
    const facebook = page.locator("#main").getByRole("link", { name: "Facebook" });
    await facebook.evaluate((link) => link.scrollIntoView({ block: "center" }));
    const box = (await facebook.boundingBox())!;
    const landed = await facebook.evaluate(
      (link, point) => {
        const found = document.elementFromPoint(point.x, point.y);
        return found !== null && (found === link || link.contains(found));
      },
      { x: box.x + box.width / 2, y: box.y - 6 },
    );
    expect(landed, "a press six pixels above the pill still lands on it").toBe(true);
  });
});
