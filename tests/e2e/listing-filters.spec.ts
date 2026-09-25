import { expect, test, type Page } from "@playwright/test";
import { hydrated } from "./support/featured-event";

/**
 * BR-REQ-041-01 — the listing's filters (`DECISIONS.md` §NNN, amending §133 and §401; the owner,
 * 2026-09-25: "un buton de filtre, collapsed by default, checkboxuri pe pill-uri și mai multe
 * filtre").
 *
 * Read against the sample seed's upcoming rows, by name, never by a count — other specs on both
 * projects add events to the same database: the featured "Crosul aniversar" (a race, mixed
 * surface, 10 km, medium), "Tură pe Tâmpa" (a group run on a trail, 14 km, medium) and
 * "Antrenament de intervale" (a group run on asphalt, hard, no distance).
 */

const RACE = "Crosul aniversar Brașov Runners";
const TRAIL_RUN = "Tură pe Tâmpa";
const INTERVALS = "Antrenament de intervale";

/** A card's or the hero's title, by its exact words — found in a closed fold too (the phone's "other events" folds past four cards). */
const heading = (page: Page, name: string) =>
  page.locator("#main").locator("h1, h2, h3").filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
const panel = (page: Page) => page.locator("#main").getByTestId("listing-filters");
/** A box by its own name and value — found in a closed fold too, where it has no role to find it by. */
const box = (page: Page, name: string, value: string) => panel(page).locator(`input[type="checkbox"][name="${name}"][value="${value}"]`);

test.describe("BR-REQ-041-01 the listing's filters are one collapsed button", () => {
  test("closed by default: one «Filtre» button, the boxes hidden, the hero and the list as before", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const fold = panel(page);
    await expect(fold).toBeVisible();
    await expect(fold).not.toHaveAttribute("open", "");
    await expect(fold.locator("summary")).toHaveText("Filtre");
    await expect(page.getByRole("form", { name: "Filtrele evenimentelor" })).toBeHidden();
    await expect(page.locator("#main").getByTestId("active-filters")).toHaveCount(0);
    await expect(heading(page, RACE)).toBeVisible();

    // The button and every box are thumb-sized (criterion 6); the pill inside the label is small.
    const summaryBox = await fold.locator("summary").boundingBox();
    expect(Math.round(summaryBox!.height * 10) / 10).toBeGreaterThanOrEqual(44);
    await fold.locator("summary").click();
    const labels = fold.locator("form label");
    expect(await labels.count()).toBeGreaterThan(1);
    for (const label of await labels.all()) {
      const box = await label.boundingBox();
      expect.soft(Math.round(box!.height * 10) / 10, await label.innerText()).toBeGreaterThanOrEqual(44);
    }
    // Groups drawn from the calendar's own values, each only where it narrows: the seed has two
    // kinds, three surfaces, two difficulties — and every row is free, so no cost group at all.
    const form = page.getByRole("form", { name: "Filtrele evenimentelor" });
    await expect(form.getByRole("group", { name: "Tipul" })).toBeVisible();
    await expect(form.getByRole("group", { name: "Terenul" })).toBeVisible();
    await expect(form.getByRole("group", { name: "Dificultatea" })).toBeVisible();
    await expect(form.getByRole("checkbox", { name: "Gratuit", exact: true })).toHaveCount(0);
  });

  test("with a script each tick applies at once, OR within a group, and the hero follows", async ({ page }) => {
    await page.goto("/ro/evenimente");
    await hydrated(page);
    const fold = panel(page);
    await fold.locator("summary").click();

    // "Trail": the trail run only — the featured race is on a mixed surface, so it leaves the hero.
    await fold.getByRole("checkbox", { name: "Trail", exact: true }).check();
    await expect(page).toHaveURL(/[?&]surface=TRAIL(&|$)/);
    await expect(heading(page, TRAIL_RUN)).toBeVisible();
    await expect(heading(page, INTERVALS)).toHaveCount(0);
    await expect(heading(page, RACE)).toHaveCount(0);
    await expect(fold).toHaveAttribute("open", "");
    await expect(fold.locator("summary")).toHaveText("Filtre (1)");

    // "Mixt" too: either surface — the race is back at the top, the trail run still listed.
    await fold.getByRole("checkbox", { name: "Mixt", exact: true }).check();
    await expect(page).toHaveURL(/surface=TRAIL.*surface=MIXED|surface=MIXED.*surface=TRAIL/);
    await expect(heading(page, RACE)).toBeVisible();
    await expect(heading(page, TRAIL_RUN)).toBeVisible();
    await expect(heading(page, INTERVALS)).toHaveCount(0);

    // Closed, the ticks show as chips; one chip's ✕ unticks just that one, and the boxes follow.
    await fold.locator("summary").click();
    const active = page.locator("#main").getByTestId("active-filters");
    await expect(active).toBeVisible();
    await active.getByRole("link", { name: "Scoate filtrul: Trail" }).click();
    await expect(page).not.toHaveURL(/TRAIL/);
    await expect(heading(page, TRAIL_RUN)).toHaveCount(0);
    await expect(heading(page, RACE)).toBeVisible();
    await expect(box(page, "surface", "TRAIL")).not.toBeChecked();
    await expect(box(page, "surface", "MIXED")).toBeChecked();

    // "Șterge filtrele" is the plain listing again.
    await active.getByRole("link", { name: "Șterge filtrele" }).click();
    await expect(page).toHaveURL(/\/ro\/evenimente$/);
    await expect(heading(page, INTERVALS)).toBeAttached();
    await expect(page.locator("#main").getByTestId("active-filters")).toHaveCount(0);
  });

  test("AND across groups; an address from before the panel still means what it meant", async ({ page }) => {
    // A group run AND hard: the intervals only, no hero (the race is neither).
    await page.goto("/ro/evenimente?type=GROUP_RUN&difficulty=HARD");
    await expect(heading(page, INTERVALS)).toBeAttached();
    await expect(heading(page, TRAIL_RUN)).toHaveCount(0);
    await expect(heading(page, RACE)).toHaveCount(0);
    await expect(panel(page).locator("summary")).toHaveText("Filtre (2)");

    // Two kinds at once: everything the seed has upcoming.
    await page.goto("/ro/evenimente?type=RACE&type=GROUP_RUN");
    await expect(heading(page, RACE)).toBeVisible();
    await expect(heading(page, TRAIL_RUN)).toBeAttached();

    // `?type=RACE` — a link from the chip row — is still "races".
    await page.goto("/ro/evenimente?type=RACE");
    await expect(heading(page, RACE)).toBeVisible();
    await expect(heading(page, TRAIL_RUN)).toHaveCount(0);
    await expect(box(page, "type", "RACE")).toBeChecked();

    // Nothing matches: the page says so in the filters' words, and the way back is on it.
    await page.goto("/ro/evenimente?type=RACE&difficulty=HARD");
    await expect(page.locator("#main")).toContainText("Niciun eveniment nu se potrivește filtrelor alese.");
    await expect(page.locator("#main").getByTestId("active-filters").getByRole("link", { name: "Șterge filtrele" })).toBeVisible();

    // English, in English.
    await page.goto("/en/events?type=RACE&difficulty=HARD");
    await expect(panel(page).locator("summary")).toHaveText("Filters (2)");
    await expect(page.locator("#main")).toContainText("No event matches the filters you chose.");
  });

  test("the calendar reads the same address, keeps it through its own links, and carries the same button", async ({ page }) => {
    // The year the race falls in (it is three weeks out, so this year or the next).
    const now = new Date();
    let year = now.getFullYear();
    await page.goto(`/ro/calendar?year=${year}`);
    if ((await page.locator(`[aria-label*="${RACE}"]`).count()) === 0) {
      year += 1;
      await page.goto(`/ro/calendar?year=${year}`);
    }
    await expect(page.locator(`[aria-label*="${RACE}"]`).first()).toBeAttached();
    const intervalsUnfiltered = await page.locator(`[aria-label*="${INTERVALS}"]`).count();

    await page.goto(`/ro/calendar?year=${year}&type=RACE`);
    await expect(page.locator(`[aria-label*="${RACE}"]`).first()).toBeAttached();
    if (intervalsUnfiltered > 0) await expect(page.locator(`[aria-label*="${INTERVALS}"]`)).toHaveCount(0);
    await expect(panel(page).locator("summary")).toHaveText("Filtre (1)");
    // The month and year links keep the filter; the form keeps the year.
    await expect(page.getByRole("link", { name: "Lună", exact: true })).toHaveAttribute("href", /type=RACE/);
    await expect(panel(page).locator('form input[type="hidden"][name="year"]')).toHaveValue(String(year));
  });
});

test.describe("BR-REQ-041-01 the filters work with no script at all", () => {
  /*
    The panel needs no script: a native `<details>`, a GET form, plain links. Since §NNN nothing on
    the listing or the calendar sits behind a streamed `<Suspense>` boundary — React reveals a
    streamed region with an inline script, so a browser with scripts off used to be left with the
    loading shapes, the panel among them. These are that browser: scripts off, a real press on the
    fold, a real tick, a real press on «Aplică», and the narrowed page read as a person reads it.
  */
  test.describe("scripts off", () => {
    test.use({ javaScriptEnabled: false });

    test("the server's HTML is a complete GET form: a native fold, named boxes, an apply button, plain links", async ({ page }) => {
      await page.goto("/ro/evenimente?type=RACE");
      const html = await page.content();
      const form = html.match(/<form\b[^>]*>/)?.[0] ?? "";
      expect(form).toContain('method="get"');
      expect(form).toContain('action="/ro/evenimente"');
      expect(form).toContain('aria-label="Filtrele evenimentelor"');
      expect(html).toMatch(/<details[^>]*data-testid="listing-filters"/);
      expect(html).toMatch(/<input type="checkbox" name="type" checked="" value="RACE"/);
      expect(html).toMatch(/<input type="checkbox" name="surface" value="TRAIL"/);
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Aplică</);
      // An active chip is an ordinary link to the address without its tick.
      expect(html).toMatch(/<a[^>]*aria-label="Scoate filtrul: Concurs"[^>]*href="\/ro\/evenimente"/);
      // Nothing is left waiting for a script to reveal it (§NNN): no loading shape anywhere.
      await expect(page.locator("#main [role='status']")).toHaveCount(0);
    });

    test("on the listing: open the fold, tick «Trail», press «Aplică», read the narrowed list", async ({ page }) => {
      await page.goto("/ro/evenimente");
      // Everything the page has is shown, not only present in the HTML: the list and the panel.
      await expect(heading(page, RACE)).toBeVisible();
      const fold = panel(page);
      await expect(fold.locator("summary")).toBeVisible();
      await fold.locator("summary").click();
      await expect(fold).toHaveAttribute("open", "");
      await fold.getByRole("checkbox", { name: "Trail", exact: true }).check();
      await fold.getByRole("button", { name: "Aplică", exact: true }).click();

      await expect(page).toHaveURL(/\/ro\/evenimente\?surface=TRAIL$/);
      await expect(heading(page, TRAIL_RUN)).toBeVisible();
      await expect(heading(page, RACE)).toHaveCount(0);
      await expect(heading(page, INTERVALS)).toHaveCount(0);
      // The ticks say themselves, closed, as links: one press takes the tick away again.
      await expect(panel(page).locator("summary")).toHaveText("Filtre (1)");
      const active = page.locator("#main").getByTestId("active-filters");
      await active.getByRole("link", { name: "Scoate filtrul: Trail" }).click();
      await expect(page).toHaveURL(/\/ro\/evenimente$/);
      await expect(heading(page, RACE)).toBeVisible();
    });

    test("on the calendar: the same fold, tick «Concurs», press «Aplică», read the narrowed year", async ({ page }) => {
      // The year the race falls in (it is three weeks out, so this year or the next).
      let year = new Date().getFullYear();
      await page.goto(`/ro/calendar?year=${year}`);
      if ((await page.locator(`[aria-label*="${RACE}"]`).count()) === 0) {
        year += 1;
        await page.goto(`/ro/calendar?year=${year}`);
      }
      await expect(page.locator(`[aria-label*="${RACE}"]`).first()).toBeVisible();
      const intervalsUnfiltered = await page.locator(`[aria-label*="${INTERVALS}"]`).count();

      const fold = panel(page);
      await fold.locator("summary").click();
      await fold.getByRole("checkbox", { name: "Concurs", exact: true }).check();
      await fold.getByRole("button", { name: "Aplică", exact: true }).click();

      // The form kept the year it was on, and the year is narrowed to races.
      await expect(page).toHaveURL(new RegExp(`/ro/calendar\\?year=${year}&type=RACE$`));
      await expect(page.locator(`[aria-label*="${RACE}"]`).first()).toBeVisible();
      if (intervalsUnfiltered > 0) await expect(page.locator(`[aria-label*="${INTERVALS}"]`)).toHaveCount(0);
      await expect(panel(page).locator("summary")).toHaveText("Filtre (1)");
      await expect(page.locator("#main [role='status']")).toHaveCount(0);
    });
  });

  test("submitted natively — no island in the way — the form lands on the address a link would, and the page renders it", async ({ page }) => {
    await page.goto("/ro/evenimente");
    await hydrated(page);
    const fold = panel(page);
    await fold.locator("summary").click();
    // Tick without a change event and submit the form itself: exactly what a browser does with
    // scripts off, since the island only ever listens for `change`.
    await fold.locator("form").evaluate((form: HTMLFormElement) => {
      for (const selector of ['input[name="type"][value="RACE"]', 'input[name="surface"][value="TRAIL"]']) {
        (form.querySelector(selector) as HTMLInputElement).checked = true;
      }
      form.submit();
    });
    await expect(page).toHaveURL(/\/ro\/evenimente\?type=RACE&surface=TRAIL$/);
    // A race AND on a trail: nothing in the seed is both.
    await expect(heading(page, RACE)).toHaveCount(0);
    await expect(heading(page, TRAIL_RUN)).toHaveCount(0);
    // Closed again after the load, the ticks are chips; each is a plain link.
    await expect(panel(page)).not.toHaveAttribute("open", "");
    const active = page.locator("#main").getByTestId("active-filters");
    await expect(active.getByRole("link", { name: "Scoate filtrul: Concurs" })).toBeVisible();
    await active.getByRole("link", { name: "Scoate filtrul: Trail" }).click();
    await expect(page).not.toHaveURL(/TRAIL/);
    await expect(heading(page, RACE)).toBeVisible();
  });
});
