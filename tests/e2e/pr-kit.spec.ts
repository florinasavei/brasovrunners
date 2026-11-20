import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-060-01, BR-REQ-041-01 criteria 1 and 6, §NNN — «PR Kit» for the volunteers too (the owner, 2026-11-20: «also put them
 * in the backoffice website and call it "PR Kit" so we can download it at any time, even the volunteers can do that»), on a
 * production build, at 320 pixels and on a desktop:
 *
 * - a «Voluntar» opens «PR Kit» from the backoffice's top bar;
 * - the page holds the logo in two shapes and three inks, the sticker sheets, the poster and the colour, and nothing on it
 *   scrolls sideways;
 * - every download is a 44-pixel target, and a press on a sticker sheet saves a PDF named from the club's slug.
 */
async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("§NNN «PR Kit» for a volunteer", () => {
  test("a «Voluntar» opens «PR Kit» from the top bar and saves a sticker sheet as a PDF", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    await page.getByRole("tab", { name: "PR Kit" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/pr-kit$/);
    await expect(page.getByRole("heading", { name: "PR Kit", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "PR Kit" })).toHaveAttribute("aria-selected", "true");

    await expect(page.getByTestId("pr-kit-logo-tile")).toHaveCount(6);
    await expect(page.getByTestId("pr-kit-sheet")).toHaveCount(6);
    await expect(page.getByTestId("pr-kit-poster")).toBeVisible();
    await expect(page.getByTestId("pr-kit-colour-hex")).toContainText("#");
    // The previews are the kit's own files, served and drawn.
    const preview = page.getByTestId("pr-kit-logo-tile").first().locator("img");
    await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await fitsTheScreen(page);

    // Every download a thumb can hit.
    const links = page.locator('a[href^="/api/admin/pr-kit/"]');
    expect(await links.count()).toBeGreaterThanOrEqual(6 * 3 + 6);
    for (const box of await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(Math.round(box.height * 10) / 10).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.width * 10) / 10).toBeGreaterThanOrEqual(44);
    }

    const sheet = page.getByTestId("pr-kit-sheet").filter({ has: page.locator('a[href="/api/admin/pr-kit/stickers/qr-12"]') });
    const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("link").click()]);
    expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+-stickers-qr-12-per-sheet\.pdf$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g)).toHaveLength(1);
    // Still on the page: a download is not a navigation.
    await expect(page).toHaveURL(/\/ro\/admin\/pr-kit$/);
    await fitsTheScreen(page);
  });

  test("a logo's PDF and the poster download for a volunteer as well", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    await page.goto("/ro/admin/pr-kit");
    const pdf = page.getByTestId("pr-kit-logo-pdf").first();
    const [logo] = await Promise.all([page.waitForEvent("download"), pdf.click()]);
    expect(logo.suggestedFilename()).toMatch(/^[a-z0-9-]+-logo-primary\.pdf$/);
    // The suite's server sets a channel address (`playwright.config.ts`), so the poster is offered.
    const [poster] = await Promise.all([page.waitForEvent("download"), page.getByTestId("pr-kit-poster-download").click()]);
    expect(poster.suggestedFilename()).toMatch(/^[a-z0-9-]+-youtube-poster-a4-ro\.pdf$/);
  });
});
