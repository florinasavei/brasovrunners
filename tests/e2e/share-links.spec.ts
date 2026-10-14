import { expect, type Page, test } from "@playwright/test";

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

/**
 * «Adaugă în calendar» is one small pill that opens the five doors (§NNN; the owner, 2026-10-14: «asta ar
 * trebui să fie collapsed»): a native `<details>`, closed on arrival. Opened the way a person opens it — by
 * pressing the pill — and returned, so a spec presses a door only after it.
 */
async function openCalendar(page: Page) {
  const fold = page.getByTestId("event-calendar");
  await expect(fold).not.toHaveAttribute("open", /.*/);
  await fold.getByTestId("event-calendar-toggle").click();
  await expect(fold).toHaveAttribute("open", "");
  return fold;
}

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
    // card, and either is a small pill like its neighbours (§767).
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

  test("offer the event's own five calendar doors, in the subscription panel's words and order (§767)", async ({ page }) => {
    await page.goto(EVENT);
    // Closed on arrival: one pill, none of the five doors in view.
    const toggle = page.getByTestId("event-calendar-toggle");
    await expect(toggle).toHaveText("Adaugă în calendar");
    for (const door of ["Google Calendar", "Apple Calendar", /^Outlook/, "Descarcă fișierul .ics"]) await expect(page.locator("#main").getByRole("link", { name: door })).toBeHidden();
    const fold = await openCalendar(page);
    const links = fold.getByTestId("event-calendar-doors").getByRole("link");
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

  test("opens by the keyboard, shows the five doors on one wrapping line under the pill, and closes again (§NNN)", async ({ page }) => {
    await page.goto(EVENT);
    const fold = page.getByTestId("event-calendar");
    const toggle = fold.getByTestId("event-calendar-toggle");
    // A small pill with its glyph, the words and the chevron; the house's 28 pixels, not a 44-pixel bar.
    const closedBox = (await toggle.boundingBox())!;
    expect(closedBox.height).toBeGreaterThanOrEqual(24);
    expect(closedBox.height).toBeLessThanOrEqual(36);
    await expect(toggle.locator("svg")).toHaveCount(2);
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(fold).toHaveAttribute("open", "");
    const doors = fold.getByTestId("event-calendar-doors").getByRole("link");
    await expect(doors).toHaveCount(5);
    // Under the pill (measured again: the page may have scrolled to the focused pill), never beside it or above it, and each door's own small pill.
    const openBox = (await toggle.boundingBox())!;
    const pillBottom = openBox.y + openBox.height;
    for (let index = 0; index < 5; index += 1) {
      const box = (await doors.nth(index).boundingBox())!;
      expect(box.y, `door ${index} under the pill`).toBeGreaterThanOrEqual(pillBottom - 1);
      expect(box.height, `door ${index}`).toBeLessThanOrEqual(36);
    }
    await page.keyboard.press("Space");
    await expect(fold).not.toHaveAttribute("open", /.*/);
    await expect(doors.first()).toBeHidden();
    // The share row above is the one it was: the networks, each still a link on the page.
    await expect(page.locator("#main").getByRole("link", { name: "Facebook" })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "WhatsApp" })).toBeVisible();
  });

  test.describe("with scripts off", () => {
    test.use({ javaScriptEnabled: false });

    test("opens with the pill alone: a native fold needs no script (§NNN)", async ({ page }) => {
      await page.goto(EVENT);
      const fold = page.getByTestId("event-calendar");
      await expect(fold).not.toHaveAttribute("open", /.*/);
      await expect(page.locator("#main").getByRole("link", { name: "Google Calendar" })).toBeHidden();
      await fold.getByTestId("event-calendar-toggle").click();
      await expect(fold).toHaveAttribute("open", "");
      await expect(page.locator("#main").getByRole("link", { name: "Google Calendar" })).toBeVisible();
    });
  });

  test("are small pills at 320 pixels, a row that wraps, nothing wider than the page (§767)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(EVENT);
    // The closed pill itself, at 320: a small pill inside the page, its chevron turned only once open.
    const closedPill = (await page.getByTestId("event-calendar-toggle").boundingBox())!;
    expect(closedPill.height).toBeGreaterThanOrEqual(24);
    expect(closedPill.height).toBeLessThanOrEqual(36);
    expect(closedPill.x + closedPill.width).toBeLessThanOrEqual(320);
    const chevron = page.getByTestId("event-calendar-toggle").locator("[data-chevron]");
    const turned = () => chevron.evaluate((el) => getComputedStyle(el).transform);
    expect(await turned()).toBe("none");
    await openCalendar(page);
    await expect.poll(turned).not.toBe("none");
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

  test("keep a tap band around the small pill that never covers a neighbour: above and below, two pixels inside an edge is the pill's own (§767)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(EVENT);
    // The closed summary pill: the band around it is its own too, and two pixels inside an edge is the pill.
    const toggle = page.getByTestId("event-calendar-toggle");
    await toggle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const toggleBox = (await toggle.boundingBox())!;
    for (const y of [toggleBox.y - 3, toggleBox.y + 2, toggleBox.y + toggleBox.height - 2, toggleBox.y + toggleBox.height + 3]) {
      const own = await toggle.evaluate((el, point) => {
        const found = document.elementFromPoint(point.x, point.y);
        return found !== null && (found === el || el.contains(found));
      }, { x: toggleBox.x + toggleBox.width / 2, y });
      expect(own, `the calendar pill at y=${y}`).toBe(true);
    }
    await openCalendar(page);
    const main = page.locator("#main");
    const probe = async (name: RegExp | string, offset: "above" | "below" | "insideTop" | "insideBottom") => {
      // The Instagram control is a link until the browser can share a file, then a button.
      const link = main.getByRole("link", { name }).or(main.getByRole("button", { name })).first();
      await link.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const box = (await link.boundingBox())!;
      const y = { above: box.y - 3, below: box.y + box.height + 3, insideTop: box.y + 2, insideBottom: box.y + box.height - 2 }[offset];
      return link.evaluate(
        (el, point) => {
          const found = document.elementFromPoint(point.x, point.y);
          return found !== null && (found === el || el.contains(found));
        },
        { x: box.x + box.width / 2, y },
      );
    };
    // Inside the band, just outside the pill: still the pill.
    expect(await probe("Facebook", "above"), "three pixels above Facebook").toBe(true);
    expect(await probe("Facebook", "below"), "three pixels below Facebook").toBe(true);
    // Two pixels inside any edge of any pill, the share row's last line included (it sits right above the
    // calendar row's first): that pill's own, so the band of the pill beside it never takes the press.
    for (const name of ["Facebook", "WhatsApp", /^(Descarcă poza|Instagram)$/, "Google Calendar", "Apple Calendar", /^Outlook\.com/, /^Outlook la serviciu/, /^Descarcă fișierul \.ics$/]) {
      expect(await probe(name, "insideTop"), `two pixels inside the top of ${String(name)}`).toBe(true);
      expect(await probe(name, "insideBottom"), `two pixels inside the bottom of ${String(name)}`).toBe(true);
    }
  });
});
