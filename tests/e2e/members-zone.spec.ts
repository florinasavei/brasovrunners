import { expect, test, type Page } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §731 — the current tab's box is inside the row's box (the row scrolls sideways, so a tab past the edge is
 * cut off), on the 320-px phone and on desktop alike.
 */
async function expectCurrentInRow(page: Page, row = page.getByTestId("members-tabs").locator("nav")) {
  // The row scrolls its current entry into view once hydrated (`SubNavCurrent`), so it is polled.
  await expect
    .poll(async () => {
      const box = await row.boundingBox();
      const current = await row.locator('a[aria-current="page"]').boundingBox();
      if (!box || !current) return "missing";
      return current.x >= box.x - 0.5 && current.x + current.width <= box.x + box.width + 0.5 ? "in view" : `out: ${current.x}..${current.x + current.width} of ${box.x}..${box.x + box.width}`;
    })
    .toBe("in view");
}

/**
 * §524 — a club member signs in through the development switcher's «Dev Member», lands on the
 * members' zone with the club's words and the next runs, and is sent back there from `/admin`: the
 * backoffice is not theirs. (`signIn` in the support file waits for `/admin`, which a member never
 * reaches, so the member signs in here.) §715 amended: the zone opens on «Alergări», the tabs run
 * «Alergări» · «Coduri de reducere» · «Magazin», and the runs' old address redirects to the zone. The open
 * «Cine vine» under the next run, with real answers, is `rsvp.spec.ts` («§715 …»): it makes the run and the answers.
 */
test.describe("§524 the members' zone", () => {
  test("a member lands on the zone and /admin sends them back to it", async ({ page }) => {
    await page.goto("/ro/autentificare?to=members");
    await page.getByRole("button", { name: /Dev Member/ }).click();
    await expect(page).toHaveURL(/\/ro\/zona-membri$/, { timeout: 30_000 });
    await hydrated(page);

    await expect(page.getByRole("heading", { level: 1, name: "Zona membrilor" })).toBeVisible();
    await expect(page.getByTestId("members-greeting")).toContainText("Dev Member");
    await expect(page.getByTestId("members-backoffice")).toHaveCount(0);

    // The tabs (§715 amended), in the owner's order — the zone opens on «Alergări», its own address — each an address of its own;
    // «Magazin» is drawn only once the privacy notice in force names the shop (BR-REQ-053-01).
    const tabs = page.getByTestId("members-tabs");
    // Below `sm` a tab says its short word (§731), so the names are matched by their first word.
    const codes = tabs.getByRole("link", { name: /^Coduri/ });
    const runs = tabs.getByRole("link", { name: /^Alergări/ });
    await expect(runs).toHaveAttribute("aria-current", "page");
    await expect(codes).toBeVisible();
    await expectCurrentInRow(page);
    // Three entries, «Alergări» first, and on the phone the codes link's accessible name is exactly the short word.
    await expect(tabs.getByRole("link")).toHaveCount(3);
    await expect(tabs.getByRole("link").nth(0)).toHaveText(/^Alergări/);
    await expect(tabs.getByRole("link").nth(1)).toHaveText(/^Coduri/);
    await expect(tabs.getByRole("link").nth(2)).toHaveText(/^Magazin/);
    if (test.info().project.name !== "desktop") {
      await expect(tabs.getByRole("link", { name: "Coduri", exact: true })).toBeVisible();
    }
    for (const name of [/^Coduri/, /^Alergări/]) {
      const box = await tabs.getByRole("link", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The runs are what the zone shows first: their section is on the landing, and the codes' are not.
    await expect(page.getByTestId("members-upcoming")).toBeVisible();
    await expect(page.getByTestId("members-codes").or(page.getByTestId("members-codes-empty"))).toHaveCount(0);
    // A card's «Cine vine» is never a fold here (with no run answered, there is none to draw).
    await expect(page.locator('[data-testid="members-upcoming"] details[data-testid="rsvp-who"]')).toHaveCount(0);
    await codes.click();
    await expect(page).toHaveURL(/\/ro\/zona-membri\/coduri$/);
    await expect(page.getByTestId("members-tabs").getByRole("link", { name: /^Coduri/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("members-upcoming")).toHaveCount(0);
    await expectCurrentInRow(page);
    await tabs.getByRole("link", { name: /^Magazin/ }).click();
    await expect(page).toHaveURL(/\/ro\/zona-membri\/magazin$/);
    await expect(page.getByTestId("members-tabs").getByRole("link", { name: /^Magazin/ })).toHaveAttribute("aria-current", "page");
    await expectCurrentInRow(page);
    await page.getByTestId("members-tabs").getByRole("link", { name: /^Alergări/ }).click();
    await expect(page).toHaveURL(/\/ro\/zona-membri$/);
    await expect(page.getByTestId("members-tabs").getByRole("link", { name: /^Alergări/ })).toHaveAttribute("aria-current", "page");
    await expectCurrentInRow(page);
    await expect(page.getByTestId("members-upcoming")).toBeVisible();

    // Every address made before the zone opened on the runs still works: the runs' old one is a permanent redirect to the zone.
    await page.goto("/ro/zona-membri/alergari");
    await expect(page).toHaveURL(/\/ro\/zona-membri$/);
    await expect(page.getByTestId("members-tabs").getByRole("link", { name: /^Alergări/ })).toHaveAttribute("aria-current", "page");
    await page.goto("/en/members-area/runs");
    await expect(page).toHaveURL(/\/en\/members-area$/);

    await page.goto("/ro/admin");
    await expect(page).toHaveURL(/\/ro\/zona-membri$/);
  });
});

/**
 * §731 — the backoffice's own rows: on the 320-px phone the current entry of «Setări» (six entries, the last
 * one the widest) and of «Pagini» (grouped, with glyphs) is inside the row's box, scrolled there by
 * `SubNavCurrent` when the row is wider than the screen.
 */
test.describe("§731 the backoffice's rows keep the current entry in view", () => {
  for (const path of ["/ro/admin/settings/platform", "/ro/admin/settings/costs", "/ro/admin/pages/members", "/ro/admin/gallery/pictures"]) {
    test(`${path}`, async ({ page }) => {
      await signIn(page, "Dev Administrator");
      await page.goto(path);
      await hydrated(page);
      const row = page.locator("nav").filter({ has: page.locator('ul > li > a[aria-current="page"]') });
      await expect(row).toHaveCount(1);
      await expectCurrentInRow(page, row);
    });
  }
});
