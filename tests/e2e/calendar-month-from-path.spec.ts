import { expect, type Page, test } from "@playwright/test";

/**
 * BR-REQ-041-01 criterion 12 and §NNN (amending §116, §137, §475, §549) — the month on screen is
 * the month in the address, on a first load and after every arrow, select, «Azi» and swipe.
 *
 * The owner, 2026-09-29, on production: «nu pot schimba luna din săgeți (deși se schimbă în query
 * params) dar nu văd evenimentele din octombrie; de asemenea s-a stricat și la swipe pe telefon».
 * The arrows led to `/ro/calendar?month=2026-10`. The bare calendar is a static page (§549), and
 * Next's router takes a static page's prefetched copy as the answer for every query of its address;
 * once the header's «Calendar» link had prefetched it, a press put October in the address, asked
 * the server nothing and left September on screen. On Vercel the prefetch arrives as the page's
 * whole `.rsc` (measured: 94 KB, `X-Matched-Path: /[locale]/calendar.rsc`), where `next start`
 * answers it with the segments alone — which is why a local run never saw it. `vercelPrefetch`
 * below answers a segment prefetch the way Vercel does, so the old addresses fail against
 * `next start` too (checked with the same answer on a build of `qa` before the fix: September
 * under `?month=2026-10`, and the second press went to `?month=2026-10` again).
 */

/** Vercel's answer to a segment prefetch of a static page: the page's whole flight data. */
async function vercelPrefetch(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!request.headers()["next-router-segment-prefetch"]) return route.continue();
    const url = new URL(request.url());
    url.searchParams.delete("_rsc");
    const response = await page.request.get(url.toString(), { headers: { rsc: "1" } });
    return route.fulfill({ response });
  });
}

/** The month's heading, as the page writes it: «octombrie 2026». */
function monthTitle(locale: "ro" | "en", year: number, month: number): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

/** This month in Brașov, and the one after. */
function thisAndNext(): { now: { year: number; month: number }; next: { year: number; month: number }; after: { year: number; month: number } } {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  const shift = (by: number) => {
    const index = year * 12 + (month - 1) + by;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  };
  return { now: { year, month }, next: shift(1), after: shift(2) };
}

const pad = (month: number) => String(month).padStart(2, "0");
const title = (page: Page) => page.locator("#calendar-title");

test.describe("§NNN the calendar shows the month its address names", () => {
  test("reached by the header's prefetched link, the arrows move the month on screen, not only the address", async ({ page }) => {
    await vercelPrefetch(page);
    const { now, next, after } = thisAndNext();
    await page.goto("/ro/evenimente");
    // The header's «Calendar» link is prefetched — the very copy that used to answer every query.
    await page.locator('header a[href="/ro/calendar"]').first().click();
    await expect(page).toHaveURL(/\/ro\/calendar$/);
    await expect(title(page)).toHaveText(monthTitle("ro", now.year, now.month));

    const nextArrow = page.locator("#main").getByRole("link", { name: "Luna următoare" });
    await nextArrow.click();
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${next.year}-${pad(next.month)}$`));
    await expect(title(page)).toHaveText(monthTitle("ro", next.year, next.month));
    // The second press starts from the month on screen, not from the one before it.
    await nextArrow.click();
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${after.year}-${pad(after.month)}$`));
    await expect(title(page)).toHaveText(monthTitle("ro", after.year, after.month));

    await page.locator("#main").getByRole("link", { name: "Luna anterioară" }).click();
    await expect(title(page)).toHaveText(monthTitle("ro", next.year, next.month));
    // «Azi» is the bare calendar, and an arrow from it still moves the month.
    await page.locator("#main").getByRole("link", { name: "Azi", exact: true }).click();
    await expect(page).toHaveURL(/\/ro\/calendar$/);
    await expect(title(page)).toHaveText(monthTitle("ro", now.year, now.month));
    await nextArrow.click();
    await expect(title(page)).toHaveText(monthTitle("ro", next.year, next.month));
  });

  test("a direct link to a month's path shows that month, and an old ?month= address is sent there", async ({ page }) => {
    const { next } = thisAndNext();
    await page.goto(`/en/calendar/${next.year}-${pad(next.month)}`);
    await expect(title(page)).toHaveText(monthTitle("en", next.year, next.month));

    const response = await page.goto(`/ro/calendar?month=${next.year}-${pad(next.month)}&view=list`);
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${next.year}-${pad(next.month)}/list$`));
    await expect(title(page)).toHaveText(monthTitle("ro", next.year, next.month));
    // A period nobody can ask for is no page at all.
    expect((await page.request.get("/ro/calendar/2026-13")).status()).toBe(404);
  });

  test("the month select, the year and list chips go to the period's own path", async ({ page }) => {
    await vercelPrefetch(page);
    const { now, next } = thisAndNext();
    await page.goto("/ro/calendar");
    // The select keeps the year it is on: in December, "the next month" chosen there is January of the same year.
    await page.locator("#main").getByRole("combobox", { name: "Luna", exact: true }).selectOption(String(next.month));
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${now.year}-${pad(next.month)}#calendar$`));
    await expect(title(page)).toHaveText(monthTitle("ro", now.year, next.month));

    await page.locator("#main").getByRole("link", { name: "Listă", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${now.year}-${pad(next.month)}/list$`));
    await page.locator("#main").getByRole("link", { name: "An", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${now.year}$`));
    await expect(title(page)).toHaveText(String(now.year));
    await page.locator("#main").getByRole("link", { name: "Anul următor" }).click();
    await expect(title(page)).toHaveText(String(now.year + 1));
  });

  test("a sideways swipe on a touch screen steps the month on screen (§475)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a swipe is a touch gesture; the desktop project has a mouse");
    await vercelPrefetch(page);
    const { now, next } = thisAndNext();
    await page.goto("/ro/evenimente");
    await page.locator('header a[href="/ro/calendar"]').first().click();
    await expect(title(page)).toHaveText(monthTitle("ro", now.year, now.month));

    const grid = page.locator("#main").getByRole("table");
    const box = await grid.boundingBox();
    if (!box) throw new Error("the month's grid is drawn");
    const y = box.y + box.height / 2;
    const touch = { pointerType: "touch", isPrimary: true, pointerId: 7, bubbles: true };
    await grid.dispatchEvent("pointerdown", { ...touch, clientX: box.x + box.width - 20, clientY: y });
    await grid.dispatchEvent("pointermove", { ...touch, clientX: box.x + box.width / 2, clientY: y });
    await grid.dispatchEvent("pointerup", { ...touch, clientX: box.x + 20, clientY: y });
    await expect(page).toHaveURL(new RegExp(`/ro/calendar/${next.year}-${pad(next.month)}$`));
    await expect(title(page)).toHaveText(monthTitle("ro", next.year, next.month));
  });
});
