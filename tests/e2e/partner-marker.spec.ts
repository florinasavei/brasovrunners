import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-020-01 criteria 18 and 19 (`DECISIONS.md` §NNN) — an event held with a partner wears the
 * handshake on the listing card, on its page's overline and in the calendar; and a calendar entry
 * has one tooltip, never the browser's as well, never one inside another.
 *
 * The owner, 2026-09-24: "I would like to have a special marker with this partnered event, so that
 * people know this is not a regular Brașov Runners group run — show like a handshake icon on the
 * card and in the calendar."
 *
 * It creates and publishes its **own** event, the way `event-route.spec.ts` does, rather than
 * giving a seeded one a partner: other specs read and unpublish the seeded rows, and two projects
 * run in parallel against one database. The date is fixed in a month nothing else uses, so the
 * calendar can be opened on it directly; the title is unique per project and run, so an earlier
 * run's event in the same month is never the one measured.
 */

const DATE = "2027-04-17";
const MONTH = "2027-04";

/**
 * The handshake glyph, by its drawing: a production build has no `data-testid="HandshakeIcon"` —
 * MUI writes that attribute only outside production — so the glyph is found by the start of its
 * path, `@mui/icons-material/Handshake`'s own.
 */
const HANDSHAKE = 'svg:has(path[d^="M16.48 10.41"])';

let title = "";
let englishTitle = "";
let englishSlug = "";
let slug = "";
let partner = "";

test.describe.serial("BR-REQ-020-01 criterion 18 the partner marker", () => {
  test("an event held with a partner is created and published", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    title = `Alergare cu partener ${suffix}`;
    slug = `alergare-cu-partener-${suffix}`;
    englishSlug = `run-with-partner-${suffix}`;
    englishTitle = `Run with a partner ${suffix}`;
    partner = `Festivalul Exemplu ${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await fillDateField(page, "Începutul evenimentului", DATE);
    await fillTimeField(page, "Ora", "10:00");
    await field("event.locationName").fill("Piața Sfatului");
    // The meeting point is asked once per language since §362, both required.
    await field("event.locationNameEn").fill("Piața Sfatului (Council Square)");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(englishTitle);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    // The partner's card (§344): a name is all a partner needs; no description, no link.
    await openEditorBox(page, "Parteneri");
    await field("event.coHosts[0].name").fill(partner);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);

    // Publication counts the short description in both languages (`AGENTS.md` §11.2).
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      // Idempotent: the fold is shared across the language tabs since BR-V1.81, so the English
      // one is already open once the Romanian is, and a second click would close it.
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Alergare de probă, împreună cu un partener.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "A trial run, held with a partner.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the listing card carries one chip with the handshake and the partner's name", async ({ page }) => {
    await page.goto("/ro/evenimente");
    // Every fold open, so a card in "other events" is measured as a reader who opened it sees it.
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
    const card = page.locator("li").filter({ has: page.getByRole("heading", { name: title }) });
    const chip = card.locator(".MuiChip-root").filter({ hasText: `În parteneriat cu ${partner}` });
    await expect(chip).toHaveCount(1);
    await expect(chip.locator(HANDSHAKE)).toHaveCount(1);
    // At 320 pixels the name wraps inside the card rather than widening the page.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // The English listing says it in English, and never in Romanian.
    await page.goto("/en/events");
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
    const englishCard = page.locator("li").filter({ has: page.getByRole("heading", { name: englishTitle }) });
    await expect(englishCard.locator(".MuiChip-root").filter({ hasText: `With ${partner}` })).toHaveCount(1);
    await expect(englishCard).not.toContainText("În parteneriat");
  });

  test("the event page says it on the overline, in each language", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    const overline = page.getByTestId("overline-partner");
    await expect(overline).toContainText(`În parteneriat cu ${partner}`);
    await expect(overline.locator(HANDSHAKE)).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto(`/en/events/${englishSlug}`);
    await expect(page.getByTestId("overline-partner")).toContainText(`With ${partner}`);
  });

  test("the calendar's grid entry names the partner, carries no title attribute, and opens one tooltip", async ({ page }) => {
    await page.goto(`/ro/calendar?month=${MONTH}`);
    const entry = page.locator(`#main [role=table] a[aria-label*="${title}"]`);
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-label", `10:00 ${title}. În parteneriat cu ${partner}`);
    await expect(entry.locator(HANDSHAKE)).toHaveCount(1);
    // The browser's own tooltip is a `title` attribute; no calendar entry carries one.
    await expect(page.locator("#main [role=table] a[title], #main [role=table] a [title]")).toHaveCount(0);
    expect((await entry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // A pointer on a phone is a tap, which follows the link; the tooltip is a desktop's to hover.
    if (test.info().project.name === "mobile") return;
    await entry.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText(`10:00 ${title}`);
    await expect(tooltip).toContainText(`În parteneriat cu ${partner}`);
    // On the mark itself — where the ⚠ opened a second tooltip over the first — still one.
    await entry.locator(HANDSHAKE).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
  });

  test("the calendar's grid entry shows the same tooltip on keyboard focus", async ({ page }) => {
    await page.goto(`/ro/calendar?month=${MONTH}`);
    await hydrated(page);
    const entry = page.locator(`#main [role=table] a[aria-label*="${title}"]`);
    // Focus from the keyboard: the entry before it, then Tab — MUI opens a tooltip on a visible focus.
    await entry.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(entry).toBeFocused();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText(`În parteneriat cu ${partner}`);
  });

  test("the calendar's agenda puts the handshake beside the entry, named", async ({ page }) => {
    await page.goto(`/ro/calendar?month=${MONTH}&view=list`);
    const entry = page.locator(`#main a[aria-label*="${title}"]`);
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-label", `10:00 ${title}. În parteneriat cu ${partner}`);
    await expect(entry.getByRole("img", { name: `În parteneriat cu ${partner}` })).toHaveCount(1);
    await expect(entry.locator(HANDSHAKE)).toHaveCount(1);
    await expect(entry).not.toHaveAttribute("title", /.*/);
    await expect(entry.locator("[title], title")).toHaveCount(0);

    // The agenda row has no tooltip of its own (§261); the handshake's is the only one.
    if (test.info().project.name === "mobile") return;
    await entry.locator(HANDSHAKE).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
    await expect(page.getByRole("tooltip")).toHaveText(`În parteneriat cu ${partner}`);
  });

  test("the English calendar names the partner in English", async ({ page }) => {
    await page.goto(`/en/calendar?month=${MONTH}`);
    const entry = page.locator(`#main [role=table] a[aria-label*="${partner}"]`).filter({ has: page.locator(HANDSHAKE) });
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-label", new RegExp(`\\. With ${partner}$`));
  });
});
