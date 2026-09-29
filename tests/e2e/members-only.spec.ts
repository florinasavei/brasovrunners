import { expect, test } from "@playwright/test";
import { hydrated } from "./support/featured-event";
import { createMembersOnlyFixture, membersFixture, removeMembersOnlyFixture } from "./support/members-only";

/**
 * §552 — «Doar pentru membrii BVR» and «Coduri de reducere», in the browser.
 *
 * A stranger: the listing, the calendar feed and the sitemap never name the members' event, and its
 * page and `.ics` answer 404. A member signed in through the development switcher's «Dev Member»:
 * the zone lists the event on the listing's own card and shows the partner's code with «Copiază
 * codul», and the event's page opens — the live twin, `private, no-store` (§549) — `noindex`, with
 * no share buttons, its `.ics` the twin's own file. The fixtures are written
 * straight into the database, one set per project, and removed after (`support/members-only.ts`).
 */
test.describe.configure({ mode: "serial" });

test.describe("§552 events and codes for the members alone", () => {
  let fixture: ReturnType<typeof membersFixture>;

  test.beforeAll(async ({}, testInfo) => {
    fixture = membersFixture(testInfo.project.name);
    await createMembersOnlyFixture(fixture);
  });
  test.afterAll(async () => {
    await removeMembersOnlyFixture(fixture);
  });

  test("a stranger never meets the event: not on the listing, not in the feed or the sitemap, 404 on its page", async ({ page, request }) => {
    await page.goto("/ro/evenimente");
    await hydrated(page);
    await expect(page.getByText(fixture.title)).toHaveCount(0);

    const feed = await request.get("/ro/events/calendar.ics");
    expect(await feed.text()).not.toContain(fixture.title);
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).not.toContain(fixture.ro);

    expect((await request.get(`/ro/evenimente/${fixture.ro}`)).status()).toBe(404);
    // The file routes keep the internal segment, as the page's own link does (`events/[slug]/page.tsx`).
    expect((await request.get(`/ro/events/${fixture.ro}/calendar.ics`)).status()).toBe(404);
    // The members' own file, the live twin's (§549): 404 to a stranger too, and kept by nobody.
    const twinIcs = await request.get(`/ro/live/events/${fixture.ro}/calendar.ics`);
    expect(twinIcs.status()).toBe(404);
    expect(twinIcs.headers()["cache-control"]).toContain("no-store");
  });

  test("a member sees the event and the code in the zone, and opens the event's page", async ({ page }) => {
    await page.goto("/ro/autentificare?to=members");
    await page.getByRole("button", { name: /Dev Member/ }).click();
    await expect(page).toHaveURL(/\/ro\/zona-membri$/, { timeout: 30_000 });
    await hydrated(page);

    const events = page.getByTestId("members-events");
    await expect(events.getByRole("heading", { name: "Evenimente pentru membri" })).toBeVisible();
    await expect(events.getByRole("link", { name: fixture.title })).toBeVisible();

    const code = page.getByTestId("member-code").filter({ hasText: fixture.partner });
    await expect(code).toContainText(fixture.code);
    await expect(code).toContainText("10% la tot.");
    const copy = code.getByTestId("copy-code");
    await expect(copy).toContainText("Copiază codul");
    const box = await copy.boundingBox();
    expect(Math.round((box?.height ?? 0) * 10) / 10).toBeGreaterThanOrEqual(44);

    await events.getByRole("link", { name: fixture.title }).click();
    await expect(page).toHaveURL(new RegExp(`/ro/evenimente/${fixture.ro}$`));
    await expect(page.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible();
    await expect(page.getByText("Doar pentru membri").first()).toBeVisible();
    // After a client-side hop the zone's own `noindex` may still sit beside the page's: every one says it.
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    expect(await page.locator('meta[name="robots"]').evaluateAll((metas) => metas.every((meta) => (meta.getAttribute("content") ?? "").includes("noindex")))).toBe(true);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    // No share buttons on the page itself (the footer keeps the club's own Facebook link).
    await expect(page.locator("main").getByRole("link", { name: /Facebook|WhatsApp/ })).toHaveCount(0);
    // The page is the live twin's, per request (§549): no shared cache or browser keeps a member's page.
    const pageAnswer = await page.request.get(`/ro/evenimente/${fixture.ro}`);
    expect(pageAnswer.status()).toBe(200);
    expect(pageAnswer.headers()["cache-control"]).toContain("no-store");
    expect(pageAnswer.headers()["cache-control"]).toContain("private");
    // Its calendar file is the twin's too; the static one stays a 404 whoever asks.
    const icsLink = page.locator("main").getByRole("link", { name: "Fișier .ics" });
    await expect(icsLink).toHaveAttribute("href", `/ro/live/events/${fixture.ro}/calendar.ics`);
    const ics = await page.request.get(`/ro/live/events/${fixture.ro}/calendar.ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["cache-control"]).toBe("private, no-store, max-age=0");
    expect(await ics.text()).toContain(fixture.title);
    expect((await page.request.get(`/ro/events/${fixture.ro}/calendar.ics`)).status()).toBe(404);
    // No sideways scroll at any width the project runs at.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
