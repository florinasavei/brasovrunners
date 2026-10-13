import { expect, type Browser, type Locator, type Page, test } from "@playwright/test";
import { GRADIENT, LOOK_ACCENT } from "../../src/theme/brand";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * BR-REQ-070-02, `DECISIONS.md` §723 — the new look's accent colour is the club's setting, walked as
 * the club walks it: «Setări» → «Aspect» → «Tema v2» → «Culoarea de accent», a preset or a
 * colour typed into «Personalizat», saved behind the question. A public page then wears it as MUI's
 * primary and the band's variable; the backoffice, which shares the layout, never does; a grey is
 * refused in words. The setting is switched through the screen, never written directly (that would
 * not expire the public cache's copy), and put back — off, pink — whatever happens.
 *
 * Desktop project only and serial: one shared `platform_settings` row, which `header-nav.spec.ts`
 * switches too, so the suite runs it on one worker (CI does).
 */
const PRIMARY_MAIN = "--mui-palette-primary-main";
const BAND = "--br-accent-tint";

/** `#rrggbb` as the browser computes a colour. */
function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function lookPanel(page: Page): Promise<Locator> {
  await page.goto("/ro/admin/settings/appearance");
  await hydrated(page);
  const panel = page.locator("#main").getByTestId("site-look");
  if (await panel.evaluate((element) => element.tagName === "DETAILS")) await openFold(panel);
  return panel;
}

async function save(page: Page, panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: "Salvează tema" }).click();
  await confirmDialog(page, "Schimbi tema site-ului?");
}

/** The look and its accent, saved through the screen in a context of its own. */
async function setLook(browser: Browser, look: "on" | "off", accent: "pink" | "blue" | "orange"): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, "Dev Administrator");
    const panel = await lookPanel(page);
    await panel.getByTestId(`site-look-option-${look}`).click();
    await panel.getByTestId(`site-look-accent-option-${accent}`).click();
    await save(page, panel);
    await expect(page.locator("#admin-alert").getByText("Tema site-ului a fost salvată", { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
}

/** A custom property as the page's root computes it, lower-cased. */
async function rootVariable(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim().toLowerCase(), name);
}

test.describe("§723 the new look's accent colour", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("a preset: the public page wears the club's blue as its primary and its band", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on", "blue");
    try {
      await page.goto("/ro/evenimente");
      await expect(page.locator("html")).toHaveAttribute("data-look", "2026");
      expect(await rootVariable(page, PRIMARY_MAIN)).toBe(LOOK_ACCENT.blue.light.accentInk);
      expect(await rootVariable(page, BAND)).toBe(GRADIENT.heroTint);
      // A filled pill wears it: the calendar's «Vezi detalii» (the header's «Vino cu noi» left the header, §724).
      await page.goto("/ro/calendar");
      const pill = page.getByTestId("calendar-next-details").first();
      expect(await pill.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(rgbOf(LOOK_ACCENT.blue.light.accentInk));
    } finally {
      await setLook(browser, "off", "pink");
    }
  });

  test("a typed colour: its shades shown live, saved, worn by the public page and never by the backoffice; a grey refused in words", async ({ page, browser }) => {
    test.slow();
    try {
      await signIn(page, "Dev Administrator");
      let panel = await lookPanel(page);
      await panel.getByTestId("site-look-option-on").click();

      // A grey: said live, and refused by the server in the rule's words.
      const box = panel.getByTestId("site-look-accent-hex");
      await box.fill("#808080");
      await expect(panel.getByTestId("site-look-accent-verdict")).toContainText("prea aproape de gri");
      await save(page, panel);
      await expect(page.getByText("culoarea de accent e prea aproape de gri", { exact: false }).first()).toBeVisible();

      // A colour: typing selects «Personalizat», and the shades the server will derive are written out.
      panel = await lookPanel(page);
      await panel.getByTestId("site-look-option-on").click();
      await panel.getByTestId("site-look-accent-hex").fill("1F6FEB");
      await expect(panel.locator('input[name="accent"][value="custom"]')).toBeChecked();
      await expect(panel.getByTestId("site-look-accent-verdict")).toContainText("Se poate");
      const shades = (await panel.getByTestId("site-look-accent-shades").textContent()) ?? "";
      const [, accentInk] = shades.match(/#[0-9a-f]{6}/g) ?? [];
      expect(accentInk).toMatch(/^#[0-9a-f]{6}$/);
      await save(page, panel);
      await expect(page.locator("#admin-alert").getByText("Tema site-ului a fost salvată", { exact: false })).toBeVisible();
      await expect(page.getByTestId("site-look-accent-current")).toContainText("#1f6feb");

      // The backoffice carries the look's attribute (one layout) and none of its colours.
      expect(await rootVariable(page, PRIMARY_MAIN)).not.toBe(accentInk);

      await page.goto("/ro/evenimente");
      await expect(page.locator("html")).toHaveAttribute("data-look", "2026");
      expect(await rootVariable(page, PRIMARY_MAIN)).toBe(accentInk);
      expect(await rootVariable(page, BAND)).toMatch(/^#[0-9a-f]{6}$/);
    } finally {
      await setLook(browser, "off", "pink");
    }
  });

  test("at 320px the screen does not scroll sideways and the options keep their words", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page, "Dev Administrator");
    const panel = await lookPanel(page);
    await panel.getByTestId("site-look-accent-option-orange").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(panel.getByTestId("site-look-accent-option-orange")).toContainText("Portocaliu");
  });
});
