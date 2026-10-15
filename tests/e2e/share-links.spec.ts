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
 * «Adaugă în calendar» is one small pill that opens the five doors (§772; the owner, 2026-10-14: «asta ar
 * trebui să fie collapsed»): a native `<details>`, closed on arrival, the LAST pill of the share row
 * (§781, 2026-10-15: «These should be inline to save space»), its body a dropdown panel under it. Opened the
 * way a person opens it — by pressing the pill — and returned, so a spec presses a door only after it.
 */
async function openCalendar(page: Page) {
  const fold = page.getByTestId("event-calendar");
  await expect(fold).not.toHaveAttribute("open", /.*/);
  await fold.getByTestId("event-calendar-toggle").click();
  await expect(fold).toHaveAttribute("open", "");
  return fold;
}

/** Every pill of the share row — the networks, the picture's control and the calendar's summary — with its box, in page order. */
async function rowPills(page: Page) {
  const row = page.getByTestId("event-share-row");
  const pills = row.locator(":scope > a, :scope > button, :scope > details > summary");
  return pills.evaluateAll((elements) =>
    elements.map((el) => {
      const box = el.getBoundingClientRect();
      return { text: (el.textContent ?? "").trim(), x: Math.round(box.x * 10) / 10, y: Math.round((box.y + window.scrollY) * 10) / 10, width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 };
    }),
  );
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

  test("opens by the keyboard, shows the five doors in a panel under the pill, and closes again (§772, §781)", async ({ page }) => {
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
      // Each door a small pill; the longest word may take a second line in a 320-pixel panel (§781).
      expect(box.height, `door ${index}`).toBeLessThanOrEqual(48);
    }
    await page.keyboard.press("Space");
    await expect(fold).not.toHaveAttribute("open", /.*/);
    await expect(doors.first()).toBeHidden();
    // The share row above is the one it was: the networks, each still a link on the page.
    await expect(page.locator("#main").getByRole("link", { name: "Facebook" })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "WhatsApp" })).toBeVisible();
  });

  test("keeps the calendar pill in the share row, last, and the open panel moves no pill (§781)", async ({ page }) => {
    await page.goto(EVENT);
    const before = await rowPills(page);
    const texts = before.map((pill) => pill.text);
    // Caption aside: the networks, the picture's control (a link, or the Instagram button once the browser can share a file) and the calendar last.
    expect(texts[texts.length - 1]).toBe("Adaugă în calendar");
    expect(texts).toEqual(expect.arrayContaining(["Facebook", "WhatsApp"]));
    expect(texts.length).toBeGreaterThanOrEqual(4);
    // All the same pill: the calendar summary is as tall as the network pill beside it (a bare summary is content-box and would read 34 beside 28).
    const facebookPill = before.find((pill) => pill.text === "Facebook")!;
    for (const pill of before) expect(Math.abs(pill.height - facebookPill.height), `${pill.text} as tall as Facebook`).toBeLessThanOrEqual(1);
    // One row: the calendar pill shares a line with the pill before it where the width allows (the wide viewport), and otherwise
    // wraps below it — never above, never the second ROW of a two-row block.
    const last = before[before.length - 1];
    const prior = before[before.length - 2];
    const wide = (page.viewportSize()?.width ?? 0) >= 1000;
    if (wide) expect(Math.abs(last.y - prior.y), "the calendar pill on the line of the pill before it").toBeLessThanOrEqual(1);
    else expect(last.y).toBeGreaterThanOrEqual(prior.y - 1);
    // The row's own height is the pills' lines: no second block under it for the calendar.
    const rowBox = (await page.getByTestId("event-share-row").boundingBox())!;
    const rowHeight = rowBox.height;
    await openCalendar(page);
    const after = await rowPills(page);
    expect(after, "no pill moved or resized when the panel opened").toEqual(before);
    expect((await page.getByTestId("event-share-row").boundingBox())!.height, "the row did not grow").toBe(rowHeight);
    // The panel hangs under the last line, above what follows: the thing painted at its centre is the panel's own.
    const panel = page.getByTestId("event-calendar-panel");
    await page.getByTestId("event-calendar-toggle").evaluate((el) => el.scrollIntoView({ block: "start" }));
    const box = (await panel.boundingBox())!;
    const panelTop = await panel.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(panelTop, "the panel hangs under the last line of the row").toBeGreaterThanOrEqual(last.y + last.height - 1);
    const viewport = page.viewportSize()!;
    expect(box.x, "panel inside the page, left").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "panel inside the page, right").toBeLessThanOrEqual(viewport.width);
    // Painted at its first line (the panel can run past the viewport's foot): the top edge's inside, over the page's own content.
    const painted = await panel.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const found = document.elementFromPoint(rect.x + rect.width - 6, rect.y + 6);
      return found !== null && el.contains(found);
    });
    expect(painted, "the panel is above the content under it").toBe(true);
    // Closed again: the pills are where they were.
    await page.getByTestId("event-calendar-toggle").click();
    await expect(page.getByTestId("event-calendar")).not.toHaveAttribute("open", /.*/);
    expect(await rowPills(page)).toEqual(before);
  });

  test("closes on Escape and on a press outside, and a press inside the panel leaves it open (§781)", async ({ page }) => {
    await page.goto(EVENT);
    const fold = page.getByTestId("event-calendar");
    const toggle = page.getByTestId("event-calendar-toggle");
    // The island attaches when the page hydrates: press until it has opened and Escape closes it.
    await openCalendar(page);
    await expect(async () => {
      await toggle.focus();
      await page.keyboard.press("Escape");
      await expect(fold).not.toHaveAttribute("open", /.*/, { timeout: 500 });
    }).toPass();
    await expect(toggle, "focus stays on the pill after Escape").toBeFocused();
    // A press outside the fold: the row's own caption is outside it, a plain line of text that does nothing.
    await openCalendar(page);
    await page.getByTestId("event-share-row").getByText("Dă mai departe:").click();
    await expect(fold).not.toHaveAttribute("open", /.*/);
    // A press inside the panel (the file's note) closes nothing.
    await openCalendar(page);
    await page.getByTestId("event-calendar-snapshot").click();
    await expect(fold).toHaveAttribute("open", "");
    // The pill closes it too, as before.
    await toggle.click();
    await expect(fold).not.toHaveAttribute("open", /.*/);
  });

  test.describe("with scripts off", () => {
    test.use({ javaScriptEnabled: false });

    test("opens with the pill alone: a native fold needs no script, and the panel is the same CSS (§772, §781)", async ({ page }) => {
      await page.goto(EVENT);
      const fold = page.getByTestId("event-calendar");
      await expect(fold).not.toHaveAttribute("open", /.*/);
      await expect(page.locator("#main").getByRole("link", { name: "Google Calendar" })).toBeHidden();
      const before = await rowPills(page);
      await fold.getByTestId("event-calendar-toggle").click();
      await expect(fold).toHaveAttribute("open", "");
      await expect(page.locator("#main").getByRole("link", { name: "Google Calendar" })).toBeVisible();
      expect(await rowPills(page), "no pill moved without scripts either").toEqual(before);
      // The pill closes it: Escape and a press outside are the island's, which needs scripts.
      await fold.getByTestId("event-calendar-toggle").click();
      await expect(fold).not.toHaveAttribute("open", /.*/);
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
      // A door in the open panel (§781) has the panel's padding and border less than the row's 288 pixels: the longest word
      // («Outlook la serviciu sau la școală») may take two lines there, and is still no taller than two of them.
      const inPanel = await row.nth(i).evaluate((el) => el.closest('[data-testid="event-calendar-panel"]') !== null);
      expect(box?.height ?? 0, `share link ${i}`).toBeLessThanOrEqual(inPanel ? 48 : 36);
      expect((box?.x ?? 0) + (box?.width ?? 0), `share link ${i} inside the page`).toBeLessThanOrEqual(320);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The open panel (§781) stays inside the 320 pixels, whichever line of the wrapped row the pill is on.
    const panel = (await page.getByTestId("event-calendar-panel").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(320);
    // And the row wrapped: more than one line of pills.
    const ys = new Set((await rowPills(page)).map((pill) => Math.round(pill.y)));
    expect(ys.size, "the share row wraps at 320 pixels").toBeGreaterThan(1);
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
