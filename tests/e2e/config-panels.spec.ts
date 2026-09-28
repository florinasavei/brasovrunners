import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-04, BR-REQ-090-05, `DECISIONS.md` §265 — the configuration screens are panels.
 *
 * The owner: "partea de configurare ar trebui să aibă subtaburi, pt status, general, mailuri,
 * captcha, etc". Both screens had grown to seven panels on one scroll, so the anti-bot switch —
 * the one control the club may need on the day it refuses real people — was below the price of
 * every service the club uses.
 *
 * What this walk protects is the part a unit test cannot: that each panel actually renders its
 * own sections and *not* the others, that a bare URL opens on the first one, and that a
 * nonsense panel falls back rather than showing an empty page.
 */
test.describe("§265 the configuration panels", () => {
  test.skip(() => test.info().project.name !== "desktop", "one viewport is enough");

  test("keeps what is owed on «Sarcini», and the anti-bot switch and the costs on «Setări» (§516)", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");

    // «Sarcini» from a bare URL: the checklist, and no cost table and no switch any more.
    await page.goto("/ro/admin/tasks");
    await expect(main.getByRole("heading", { name: "Cât costă" })).toHaveCount(0);
    const tasksNav = main.getByRole("navigation", { name: "Ce mai este de făcut" });
    await expect(tasksNav.getByRole("link", { name: "Club", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(tasksNav.getByRole("link", { name: "Costuri" })).toHaveCount(0);
    await expect(tasksNav.getByRole("link", { name: "Anti-robot" })).toHaveCount(0);

    // «Setări» from the main bar lands on its first tab, and the tab row is the map.
    await page.goto("/ro/admin/settings");
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/emails$/);
    const settingsNav = main.getByRole("navigation", { name: "Setări" });
    // Six for an Administrator: the five tabs of /admin/settings and «Configurație» (/devs) last.
    // «Contact» is «Pagini»'s since 2026-09-28 (the test below).
    await expect(settingsNav.getByRole("link")).toHaveText(["Emailuri", "Termene", "Aspect", "Costuri", "Anti-robot", "Configurație"]);
    await expect(settingsNav.getByRole("link", { name: "Emailuri" })).toHaveAttribute("aria-current", "page");

    // The switch, one press away.
    await settingsNav.getByRole("link", { name: "Anti-robot" }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/platform/);
    await expect(main.getByRole("heading", { name: /anti-bot/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Cât costă" })).toHaveCount(0);
    // A platform setting since §450: the Administrator reads the state and gets a sentence, no button.
    await expect(main.getByTestId("bot-check-read-only")).toBeVisible();
    await expect(main.getByTestId("honeypot-form")).toHaveCount(0);
    await expect(main.getByTestId("bot-check-form")).toHaveCount(0);

    // And the prices.
    await main.getByRole("navigation", { name: "Setări" }).getByRole("link", { name: "Costuri" }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/costs/);
    await expect(main.getByRole("heading", { name: "Cât costă" })).toBeVisible();

    // The old addresses answer with the new ones (a 308 from the proxy).
    await page.goto("/ro/admin/tasks?panel=botCheck");
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/platform$/);
    await page.goto("/ro/admin/tasks?panel=costs");
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/costs$/);
    await page.goto("/ro/admin/emails?lang=en");
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/emails\?lang=en$/);
    await page.goto("/ro/admin/pages/appearance");
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/appearance$/);

    // A panel nobody offered reads as the first one, never as an empty screen.
    await page.goto("/ro/admin/tasks?panel=nonsense");
    await expect(tasksNav.getByRole("link", { name: "Club", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("a row of «Sarcini» → «Club» links into the «Setări» tab that does it (§516)", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");
    await page.goto("/ro/admin/tasks");
    // No Turnstile keys on the test server, so the anti-robot row is open and carries its link.
    const link = main.getByTestId("task-target").filter({ hasText: "Setări → Anti-robot" }).first();
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/platform#bot-check$/);
    await expect(main.getByTestId("bot-check")).toBeVisible();
  });

  /*
    The owner, 2026-09-28: «când dau click pe pagina de contact mă duce automat la Setări... ar
    trebui să rămân în același loc». Every entry of «Pagini»'s row is an address under
    `/admin/pages`, so pressing any of them keeps «Pagini» lit in the main bar and the row under it,
    with the pressed entry marked; the old «Setări» → «Contact» address answers with the new one.
  */
  test("«Pagini»'s row keeps the reader in «Pagini», «Contact» included", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");
    await page.goto("/ro/admin/pages");

    for (const entry of [
      { name: "Contact", url: /\/ro\/admin\/pages\/contact$/ },
      { name: "Echipa", url: /\/ro\/admin\/pages\/team$/ },
      { name: "Întrebări frecvente", url: /\/ro\/admin\/pages\/faq$/ },
      { name: "Membri", url: /\/ro\/admin\/pages\/members$/ },
      { name: "Paginile clubului", url: /\/ro\/admin\/pages$/ },
    ]) {
      await main.getByRole("navigation", { name: "Pagini" }).getByRole("link", { name: entry.name, exact: true }).click();
      await expect(page, entry.name).toHaveURL(entry.url);
      await expect(page.getByRole("tab", { name: "Pagini" }), entry.name).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "Setări" }), entry.name).toHaveAttribute("aria-selected", "false");
      const row = main.getByRole("navigation", { name: "Pagini" });
      await expect(row.getByRole("link", { name: entry.name, exact: true }), entry.name).toHaveAttribute("aria-current", "page");
    }

    // The contact page is the same two cards it was on «Setări».
    await page.goto("/ro/admin/pages/contact");
    await expect(main.locator("#contact-recipients")).toBeVisible();
    await expect(main.locator("#shown-contact-address")).toBeVisible();
    await expect(main.getByRole("navigation", { name: "Setări" })).toHaveCount(0);

    // The old address, a fragment and a query with it, lands on the new one (a 308 from the proxy).
    await page.goto("/ro/admin/settings/contact?saved=contactRecipients#contact-recipients");
    await expect(page).toHaveURL(/\/ro\/admin\/pages\/contact\?saved=contactRecipients#contact-recipients$/);
  });

  test("the anti-bot switch is the Superadministrator's to press (§450)", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    const main = page.locator("#main");
    await page.goto("/ro/admin/settings/platform");
    await expect(main.getByTestId("honeypot-form")).toBeVisible();
    await expect(main.getByTestId("bot-check-read-only")).toHaveCount(0);
  });

  test("divides the system screen into status, general and email", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");

    await page.goto("/ro/devs");
    // Status: the database's month. Not the variables — those are the general panel's.
    await expect(main.getByRole("heading", { name: /Baza de date/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Configurație" })).toHaveCount(0);

    // «Setări»'s row is the page's one row (§360, §520): «Configurație» marked, its panels after it
    // in the same row, no second row under it — and the main bar lights «Setări», having no
    // «Configurație» entry of its own.
    const panels = main.getByRole("navigation", { name: "Setări" });
    await expect(panels.getByRole("link", { name: "Configurație", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(main.getByRole("navigation", { name: "Configurația acestui mediu" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Setări" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Configurație" })).toHaveCount(0);

    await panels.getByRole("link", { name: "Configurație · General" }).click();
    await expect(page).toHaveURL(/panel=general/);
    await expect(main.getByRole("heading", { name: "Configurație" })).toBeVisible();
    await expect(main.getByRole("heading", { name: /Roluri/i })).toBeVisible();

    await panels.getByRole("link", { name: "Configurație · Emailuri" }).click();
    await expect(page).toHaveURL(/panel=email/);
    await expect(main.getByRole("heading", { name: /e-?mail/i }).first()).toBeVisible();
    await expect(main.getByRole("heading", { name: "Configurație" })).toHaveCount(0);

    // The anti-bot switch is the club's, on «Setări» → «Anti-robot» (§516): the same row's tab.
    await panels.getByRole("link", { name: "Anti-robot", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/platform/);

    // And back: «Configurație» is a tab of the same row, one tap from «Anti-robot» or «Costuri».
    await main.getByRole("navigation", { name: "Setări" }).getByRole("link", { name: "Configurație", exact: true }).click();
    await expect(page).toHaveURL(/\/ro\/devs$/);
  });
});

/**
 * §360 — every backoffice sub-navigation is one row of secondary tabs (the owner, 2026-09-24:
 * "I do not like the subtabs/buttons of the configs and todos").
 *
 * They were pill buttons that wrapped into a second row of buttons at 320 pixels. What a unit
 * test cannot see is the layout: one line whatever the width, scrolling sideways inside itself
 * rather than widening the page, every entry still a 44-pixel target, and the current one
 * underlined. The row is squeezed by hand to prove the scrolling, because at 320 pixels today's
 * labels happen to fit — a longer label, or English, must scroll, never wrap.
 */
test.describe("§360 the sub-tabs on a phone", () => {
  test.skip(() => test.info().project.name !== "mobile", "the phone is the case this protects");

  test("are one row of links that scrolls sideways instead of wrapping, with no page overflow", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");

    const rows = [
      { url: "/ro/admin/tasks", nav: "Ce mai este de făcut", current: "Club" },
      { url: "/ro/devs?panel=general", nav: "Setări", current: "Configurație · General" },
      { url: "/ro/admin/gallery/pictures", nav: "Galerie foto", current: "Imagini" },
      // «Setări»'s tabs (§516): the row that must scroll on a phone rather than wrap.
      { url: "/ro/admin/settings/costs", nav: "Setări", current: "Costuri" },
    ];
    for (const row of rows) {
      await page.goto(row.url);
      const nav = main.getByRole("navigation", { name: row.nav });
      await expect(nav.getByRole("link", { name: row.current, exact: true })).toHaveAttribute("aria-current", "page");
      // Links, not buttons: nothing here reads as an action.
      await expect(nav.getByRole("button")).toHaveCount(0);

      const facts = await nav.evaluate((element) => {
        const links = [...element.querySelectorAll("a")];
        const current = links.find((link) => link.getAttribute("aria-current") === "page") ?? links[0];
        const others = links.filter((link) => link !== current);
        const underlineOf = (link: Element) => getComputedStyle(link).borderBottomColor;
        const tops = () => new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))).size;
        const measured = {
          lines: tops(),
          shortest: Math.min(...links.map((link) => link.getBoundingClientRect().height)),
          pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
          underline: getComputedStyle(current).borderBottomWidth,
          underlineColour: underlineOf(current),
          // Compared with the current one's colour rather than with transparent, so a pointer
          // resting over an entry (its grey hover line) cannot make this flaky.
          othersUnderlined: others.some((link) => underlineOf(link) === underlineOf(current)),
          weight: getComputedStyle(current).fontWeight,
        };
        // Squeezed to less than its words — narrower than any one label — still one line, and it scrolls.
        element.style.width = "60px";
        const squeezed = { lines: tops(), overflows: element.scrollWidth > element.clientWidth };
        element.scrollLeft = 10_000;
        const scrolled = element.scrollLeft > 0;
        element.style.width = "";
        element.scrollLeft = 0;
        return { ...measured, squeezed, scrolled };
      });

      expect(facts.lines, row.url).toBe(1);
      expect(facts.shortest, row.url).toBeGreaterThanOrEqual(44);
      expect(facts.pageOverflows, row.url).toBe(false);
      expect(facts.underline, row.url).toBe("2px");
      expect(facts.underlineColour, row.url).not.toBe("rgba(0, 0, 0, 0)");
      expect(facts.othersUnderlined, row.url).toBe(false);
      expect(facts.weight, row.url).toBe("600");
      expect(facts.squeezed, row.url).toEqual({ lines: 1, overflows: true });
      expect(facts.scrolled, row.url).toBe(true);
    }
  });
});
