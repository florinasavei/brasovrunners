import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * Three small things on the public site the owner asked for, 2026-09-25 (`DECISIONS.md` §401):
 * of the event page's «Împreună cu» row, "this should be block, and collapsible"; of the
 * listing, "filters still need to be a bit above the grid" and, 22:15, "I want to see that
 * «colaboration» event in the filters as well".
 *
 * One event, held with two partners, created and published once and read by all three specs
 * below — the way `partner-marker.spec.ts` creates its own rather than giving a seeded row a
 * partner, since other specs read and unpublish the seeded ones and two projects share one
 * database. Its kind is "Cafea" (COFFEE), which the sample seed never uses, so the type filter's
 * AND-combination with "Colaborare" can be proven against a kind nothing else answers to.
 */

const DATE = "2027-06-12";

let title = "";
let englishTitle = "";
let slug = "";
let englishSlug = "";
let partnerA = "";
let partnerB = "";

/**
 * The partner marker's glyph, Material's `Handshake` (§367, §391): found by the start of its
 * own path, like `partner-marker.spec.ts` and `headlamp.spec.ts` — a production build carries
 * no `data-testid` on an MUI icon, which is written only outside production.
 */
const HANDSHAKE = 'svg:has(path[d^="M16.48 10.41c-.39.39-1.04.39-1.43 0l-4.47-4.46"])';

test.describe.serial("BR-REQ-020-01 the partners' block, the filter row's gap and the collaboration chip", () => {
  test("an event held with two partners is created and published", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    title = `Cafea cu parteneri ${suffix}`;
    slug = `cafea-cu-parteneri-${suffix}`;
    englishSlug = `coffee-with-partners-${suffix}`;
    englishTitle = `Coffee with partners ${suffix}`;
    partnerA = `Prima Cafenea ${suffix}`;
    partnerB = `A Doua Cafenea ${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Cafea", exact: true }).click();
    await fillDateField(page, "Începutul evenimentului", DATE);
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Piața Sfatului");
    await field("event.locationNameEn").fill("Piața Sfatului (Council Square)");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(englishTitle);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);

    // Two partners, the block's own test needs both named in the summary.
    await openEditorBox(page, "Parteneri");
    await field("event.coHosts[0].name").fill(partnerA);
    await page.getByRole("button", { name: "Adaugă un partener" }).click();
    await field("event.coHosts[1].name").fill(partnerB);

    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);

    // Publication counts the short description in both languages (`AGENTS.md` §11.2).
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "O cafea de probă, ținută împreună cu doi parteneri.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "A trial coffee run, held with two partners.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the partners' block is a collapsible section, closed on a phone, open from `sm`, with both partners' names in the summary", async ({
    page,
  }) => {
    const isMobile = test.info().project.name === "mobile";

    for (const [pathname, expectedTitle, lead] of [
      [`/ro/evenimente/${slug}`, title, "Împreună cu"],
      [`/en/events/${englishSlug}`, englishTitle, "Together with"],
    ] as const) {
      await page.goto(pathname);
      await expect(page.getByRole("heading", { level: 1, name: expectedTitle })).toBeVisible();

      const section = page.locator("section#partners");
      const fold = section.getByTestId("partners-fold");
      const summary = fold.locator(":scope > summary");
      await expect(summary).toBeVisible();
      // The Handshake glyph by name, the "Împreună cu" / "Together with" lead, and both partner
      // names — never a link, never a card, in the summary itself.
      await expect(summary.locator(HANDSHAKE)).toHaveCount(1);
      await expect(summary).toContainText(lead);
      await expect(summary).toContainText(partnerA);
      await expect(summary).toContainText(partnerB);
      // The 44-pixel tap target (BR-REQ-041-01 criterion 6): the summary is what a thumb hits.
      expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      const card = section.getByTestId("partner-card").first();
      if (isMobile) {
        // Closed by default on a phone: the browser renders nothing of a closed `<details>`,
        // so the cards inside it are not visible until it opens.
        await expect(card).not.toBeVisible();
        await expect(fold).not.toHaveAttribute("open", "");
        await summary.click();
        await expect(fold).toHaveAttribute("open", "");
        await expect(card).toBeVisible();
      } else {
        // From `sm` up the section is visible on arrival — no click needed — because the CSS
        // forces `::details-content` open the same way the listing's "other events" fold does.
        await expect(card).toBeVisible();
      }
      // Both cards are there, whichever state got them on screen.
      await expect(section.getByTestId("partner-card")).toHaveCount(2);
    }
  });

  test("the filter row sits one density-token step above the grid at 320/360/390/412px and on desktop (§376 fix round finding 6)", async ({
    page,
  }) => {
    const isMobile = test.info().project.name === "mobile";
    const measure = async (expectMin: number, expectMax: number) => {
      await page.goto("/ro/evenimente");
      const filterRow = page.getByRole("navigation", { name: "Tipul evenimentului" });
      await expect(filterRow).toBeVisible();
      const grid = page.locator('[data-testid="other-events"], #main > ul').first();
      await expect(grid).toBeVisible();
      const [filterBox, gridBox] = await Promise.all([filterRow.boundingBox(), grid.boundingBox()]);
      expect(filterBox, "the filter row has a box").not.toBeNull();
      expect(gridBox, "the grid has a box").not.toBeNull();
      const gap = gridBox!.y - (filterBox!.y + filterBox!.height);
      expect(gap).toBeGreaterThanOrEqual(expectMin);
      expect(gap).toBeLessThanOrEqual(expectMax);
    };
    if (isMobile) {
      // `DENSITY.sectionGap` on a phone is 16px (2 spacing units), at every width the owner named.
      for (const width of [320, 360, 390, 412]) {
        await page.setViewportSize({ width, height: 800 });
        await measure(15, 17);
      }
    } else {
      // From `sm` up the step is 24px (3 spacing units) — the desktop project's own viewport.
      await measure(23, 25);
    }
  });

  test("the «Colaborare» chip is offered once a partnered event exists, narrows the listing, and AND-combines with the kind", async ({
    page,
  }) => {
    await page.goto("/ro/evenimente");
    await expect(page.locator("#main ul > li h2, #main h1").first()).toBeAttached();
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));

    const chip = page.locator("nav").filter({ hasText: "Colaborare" }).locator(".MuiChip-root", { hasText: "Colaborare" });
    await expect(chip).toHaveCount(1);
    await expect(chip.locator(HANDSHAKE)).toHaveCount(1);

    // The grid, never the hero — the partner filter does not touch the hero, exactly like the
    // kind filter (`listingSections`'s own rule, unchanged). A seeded weekly run, never
    // partnered, is what proves the narrowing — checked by name rather than by a total count,
    // since another project's run of this same spec may have left its own partnered event in
    // this database (each run's title carries the project name and a timestamp, so the two
    // never collide on the one this test actually looks for).
    const grid = page.locator('[data-testid="other-events"] ul, #main > ul').first();
    const seededRun = grid.getByRole("heading", { name: "Antrenament de intervale" });
    await expect(seededRun).toBeVisible();

    // Pressing it narrows the address and the grid to partnered events only.
    await chip.click();
    await expect(page).toHaveURL(/[?&]partner=1/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(seededRun).toHaveCount(0);

    // AND-combined with the kind: this event's own kind still shows it…
    await page.goto("/ro/evenimente?type=COFFEE&partner=1");
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    // …a kind it does not carry shows nothing, even though the chip stays offered so the page
    // can still say what it is filtered by (§133's own rule, extended to "Colaborare").
    await page.goto("/ro/evenimente?type=RACE&partner=1");
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
    await expect(page.locator("nav").filter({ hasText: "Colaborare" }).locator(".MuiChip-root", { hasText: "Colaborare" })).toHaveCount(1);

    // The English page reads it in English, and never in Romanian.
    await page.goto(`/en/events?partner=1`);
    await expect(page.getByRole("heading", { name: englishTitle })).toBeVisible();
    await expect(page.locator("nav").filter({ hasText: "Partnership" }).locator(".MuiChip-root", { hasText: "Partnership" })).toHaveCount(1);
  });
});
