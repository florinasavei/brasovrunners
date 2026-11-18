import { expect, test } from "@playwright/test";
import { cleanup, seed } from "./support/column-widths-seed";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §977, BR-REQ-041-01 — a backoffice table wider than its frame scrolls from its top too: a second scrollbar right above
 * the frame, kept in step with the frame's own both ways and never written while a hand drags it, sticky under the site
 * header while the table is on screen, gone when the table fits. Walked on the registrations list at a small laptop's width.
 *
 * A file of its own, for one launch option: headless Chromium starts with `--hide-scrollbars`, which leaves the bar a
 * pixel tall with no track to grab; this file's browser draws scrollbars as a person's screen does. Playwright takes
 * `launchOptions` only at a file's top level (in a describe group it would force a new worker), so the walk left
 * `admin-column-widths.spec.ts`, whose seed it shares (`support/column-widths-seed.ts`). The config's own executable is kept (§501).
 */

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("§977 a scrollbar at the top too: it moves the frame, the frame moves it, and it goes when the table fits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the bar is the wide table's: the phone's blocks have no columns to scroll");
  test.setTimeout(120_000);
  const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
  try {
    // The small laptop of §943: the list's columns ask for more than this frame has.
    await page.setViewportSize({ width: 1000, height: 800 });
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
    await hydrated(page);
    const main = page.locator("#main");
    const frame = main.locator("#table-frame-registrations");
    const bar = main.locator('[data-top-scrollbar="table-frame-registrations"]');
    await expect(frame.locator('table[data-table-id="registrations"]')).toHaveCount(1);

    // Shown while the frame overflows, right above it, decoration only: no name, no tab stop.
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    await expect(bar).toHaveAttribute("tabindex", "-1");
    const geometry = await bar.evaluate((element) => {
      const frameElement = document.getElementById("table-frame-registrations") as HTMLElement;
      return {
        barRoom: element.scrollWidth - element.clientWidth,
        frameRoom: frameElement.scrollWidth - frameElement.clientWidth,
        above: element.getBoundingClientRect().bottom <= frameElement.getBoundingClientRect().top + 0.5,
        position: getComputedStyle(element).position,
        top: Number.parseFloat(getComputedStyle(element).top),
        // The site header's own height: stuck at the window's top it ends there (the environment notice above it scrolls away).
        header: (document.querySelector("[data-sticky-header]") as HTMLElement | null)?.offsetHeight ?? 0,
      };
    });
    expect(geometry.frameRoom).toBeGreaterThan(1);
    // Both reach exactly as far, so one position means the same column in both.
    expect(Math.abs(geometry.barRoom - geometry.frameRoom)).toBeLessThanOrEqual(1);
    expect(geometry.above).toBe(true);
    // Sticky right under the site header: its real height, so no strip of rows between them and nothing behind it.
    expect(geometry.position).toBe("sticky");
    expect(geometry.header).toBeGreaterThan(0);
    expect(Math.abs(geometry.top - geometry.header)).toBeLessThanOrEqual(1);

    // The bar moves the frame…
    await bar.evaluate((element) => element.scrollTo({ left: 120 }));
    await expect.poll(() => frame.evaluate((element) => Math.round(element.scrollLeft))).toBe(120);
    // …a wheel over it too…
    await bar.hover();
    await page.mouse.wheel(60, 0);
    await expect.poll(() => frame.evaluate((element) => Math.round(element.scrollLeft))).toBeGreaterThan(120);
    // …and the frame moves the bar, which then rests: no answer back and forth.
    await frame.evaluate((element) => element.scrollTo({ left: 40 }));
    await expect.poll(() => bar.evaluate((element) => Math.round(element.scrollLeft))).toBe(40);
    expect(await frame.evaluate((element) => Math.round(element.scrollLeft))).toBe(40);
    // At the frame's end the bar is at its own end, and the pinned verbs' fade (§943, the same watcher) is gone.
    await frame.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await expect.poll(() => bar.evaluate((element) => Math.round(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBe(0);
    await expect(frame).not.toHaveAttribute("data-more-end");

    // A hand on the bar's thumb: the frame follows, and the bar is never written — no late echo of the frame's «scroll»
    // pulls the thumb back under the pointer (the review's Chromium run: written 39 times, once 23 px back, mid-drag).
    await frame.evaluate((element) => element.scrollTo({ left: 0 }));
    await expect.poll(() => bar.evaluate((element) => Math.round(element.scrollLeft))).toBe(0);
    await bar.evaluate((element) => {
      const own = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft") as PropertyDescriptor;
      const record = { writes: 0, trail: [] as number[] };
      (window as unknown as { barRecord: typeof record }).barRecord = record;
      Object.defineProperty(element, "scrollLeft", {
        configurable: true,
        get: () => own.get?.call(element),
        set: (value: number) => {
          record.writes++;
          own.set?.call(element, value);
        },
      });
      element.addEventListener("scroll", () => record.trail.push(element.scrollLeft), { passive: true });
    });
    const track = await bar.boundingBox();
    if (!track) throw new Error("the bar has no box");
    // A track one can grab — the 12 px drawn — not the pixel `--hide-scrollbars` leaves.
    expect(track.height).toBeGreaterThanOrEqual(10);
    expect(track.height).toBeLessThanOrEqual(14);
    const y = track.y + track.height - 6;
    await page.mouse.move(track.x + 8, y);
    await page.mouse.down();
    for (let step = 1; step <= 40; step++) await page.mouse.move(track.x + 8 + step * 8, y);
    await page.mouse.up();
    const record = await page.evaluate(() => (window as unknown as { barRecord: { writes: number; trail: number[] } }).barRecord);
    expect(record.trail.length).toBeGreaterThan(1);
    expect(record.writes).toBe(0);
    for (let index = 1; index < record.trail.length; index++) expect(record.trail[index]).toBeGreaterThanOrEqual(record.trail[index - 1] - 0.5);
    const moved = await bar.evaluate((element) => element.scrollLeft);
    expect(moved).toBeGreaterThan(0);
    await expect.poll(() => frame.evaluate((element) => element.scrollLeft)).toBeCloseTo(moved, 0);

    // A screen where the table fits: no bar.
    await page.setViewportSize({ width: 3000, height: 900 });
    await expect.poll(() => frame.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await expect(bar).toBeHidden();
    // Back to the laptop: back again.
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(bar).toBeVisible();

    // A long list — the one row drawn forty times over, the browser's layout being the subject, not the rows — read
    // halfway down: the bar has stayed at the window's top, right under the site header — no strip, no overlap.
    await frame.evaluate((element) => {
      const body = element.querySelector("tbody") as HTMLTableSectionElement;
      const row = body.querySelector("tr") as HTMLTableRowElement;
      for (let copy = 0; copy < 40; copy++) body.append(row.cloneNode(true));
    });
    // Scrolled 400 px past the bar's own place on the page — wherever the «Sumar», the filters and the notices above
    // the table end — so the bar is past its natural position while the forty rows keep the table on screen.
    await bar.evaluate(() => window.scrollTo({ top: 0 }));
    const target = await bar.evaluate((element) => {
      const top = Math.round(element.getBoundingClientRect().top + window.scrollY + 400);
      window.scrollTo({ top });
      return top;
    });
    const stuck = await bar.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      sticky: Number.parseFloat(getComputedStyle(element).top),
      frameBottom: (document.getElementById("table-frame-registrations") as HTMLElement).getBoundingClientRect().bottom,
      headerBottom: (document.querySelector("[data-sticky-header]") as HTMLElement).getBoundingClientRect().bottom,
      scrolled: window.scrollY,
    }));
    expect(stuck.scrolled).toBeGreaterThanOrEqual(target - 1);
    expect(stuck.frameBottom).toBeGreaterThan(stuck.top);
    expect(Math.abs(stuck.top - stuck.sticky)).toBeLessThanOrEqual(1);
    expect(Math.abs(stuck.top - stuck.headerBottom)).toBeLessThanOrEqual(1);
    // …and scrolling it there still moves the frame.
    await bar.evaluate((element) => element.scrollTo({ left: 90 }));
    await expect.poll(() => frame.evaluate((element) => Math.round(element.scrollLeft))).toBe(90);
  } finally {
    await cleanup(seeded);
  }
});
