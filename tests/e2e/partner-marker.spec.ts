import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { cardOnListing, languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-020-01 criteria 18 and 19 (`DECISIONS.md` §367, amended §375) — an event held with a
 * partner wears the handshake on the listing card, on its page's overline and in the calendar;
 * and a calendar entry has one tooltip, never the browser's as well, never one inside another.
 *
 * The owner, 2026-09-24: "I would like to have a special marker with this partnered event, so that
 * people know this is not a regular Brașov Runners group run — show like a handshake icon on the
 * card and in the calendar." And, amending §367 the same day: "For the partnership, I just need 1
 * icon, I do not need to show the full partners list, there might be multiple partners." So the
 * marker is a generic label — "Colaborare" / "Partnership" — never the partner's
 * name, though the event still carries a real partner to prove the marker reads `readCoHosts` and
 * not a hardcoded flag.
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
 * The partner marker's glyph, Material's `Handshake` (§367, reverted from §379/§386's 🤝 emoji
 * by §391 — the owner, 2026-09-25: "wow shit handshake icon is super ugly! Use the MUI icon
 * ASAP"): found by the start of its own path (`@mui/icons-material/Handshake`), like
 * `headlamp.spec.ts`'s torch, since a production build carries no `data-testid` — MUI writes
 * that attribute only outside production.
 */
const HANDSHAKE = 'svg:has(path[d^="M16.48 10.41c-.39.39-1.04.39-1.43 0l-4.47-4.46"])';

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
    // The partner's card (§344): a name, a description in both languages and one link — the
    // fullest card the box can hold — so the no-overflow check below (§375 amended, finding 5)
    // covers more than the smallest possible card, a name alone.
    await openEditorBox(page, "Parteneri");
    await field("event.coHosts[0].name").fill(partner);
    const coHostsSection = page.locator('[id="field-event.coHosts"]');
    await field("event.coHosts[0].descriptionRo").fill("Organizăm împreună acest eveniment, an de an.");
    await field("event.coHosts[0].descriptionEn").fill("We organize this event together, year after year.");
    await coHostsSection.getByRole("group", { name: "Linkul 1 al partenerului 1", exact: true }).getByRole("combobox").click();
    await page.getByRole("option", { name: "Înscriere la partener" }).click();
    await field("event.coHosts[0].links[0].url").fill("https://bm.example.test/inscriere");
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
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the listing card carries one chip with the handshake and the generic label, never the partner's name", async ({ page }) => {
    await page.goto("/ro/evenimente");
    // `cardOnListing` opens "other events" first — a phone listing folded by more than four
    // cards (§78, another spec's fixtures among them) would otherwise stay closed over this one.
    const card = await cardOnListing(page, title);
    const chip = card.locator(".MuiChip-root").filter({ hasText: "Colaborare" });
    await expect(chip).toHaveCount(1);
    await expect(chip).not.toContainText(partner);
    await expect(chip.locator(HANDSHAKE)).toHaveCount(1);
    // At 320 pixels the label wraps inside the card rather than widening the page.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // The English listing says it in English, and never in Romanian.
    await page.goto("/en/events");
    const englishCard = await cardOnListing(page, englishTitle);
    await expect(englishCard.locator(".MuiChip-root").filter({ hasText: "Partnership" })).toHaveCount(1);
    await expect(englishCard).not.toContainText("Colaborare");
    await expect(englishCard).not.toContainText(partner);
  });

  test("the event page says it on the overline, in each language, never the partner's name", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    const overline = page.getByTestId("overline-partner");
    await expect(overline).toContainText("Colaborare");
    await expect(overline).not.toContainText(partner);
    await expect(overline.locator(HANDSHAKE)).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Since §376 the partner card sits in its own `<section id="partners">` after the `<dl>`
    // closes, behind a `<details>` fold closed by default on a phone (`ListingBody`'s "other
    // events" device) and forced open from `sm` up by CSS — only where the browser supports
    // `::details-content` (§401). Opened on every project, by its summary (`openFold`,
    // idempotent, by keyboard: from `sm` up the summary takes no pointer), so the spec never
    // depends on that selector's support.
    await openFold(page.locator("section#partners").getByTestId("partners-fold"));
    // The partner's own card — description and a link, not a name alone — stays inside its
    // `<section>` at the narrowest viewport the suite runs (§375 amended, finding 5): the name
    // has no `overflowWrap` of its own (the description and the link labels do), so this is the
    // check that would catch it running long.
    const partnerCard = page.getByTestId("partner-card");
    await expect(partnerCard).toContainText("Organizăm împreună");
    await expect(partnerCard.getByRole("link", { name: `Înscriere la ${partner}` })).toBeVisible();
    const [cardBox, sectionBox] = await Promise.all([
      partnerCard.boundingBox(),
      partnerCard.locator("xpath=ancestor::section[@id='partners']").boundingBox(),
    ]);
    expect(cardBox, "the partner card has a box").not.toBeNull();
    expect(sectionBox, "the partner card's section has a box").not.toBeNull();
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(sectionBox!.x + sectionBox!.width + 0.5);

    await page.goto(`/en/events/${englishSlug}`);
    await expect(page.getByTestId("overline-partner")).toContainText("Partnership");
    await expect(page.getByTestId("overline-partner")).not.toContainText(partner);
  });

  test("the calendar's grid entry carries the generic label, no title attribute, and opens one tooltip", async ({ page }) => {
    await page.goto(`/ro/calendar?month=${MONTH}`);
    const entry = page.locator(`#main [role=table] a[aria-label*="${title}"]`);
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-label", `10:00 ${title}. Colaborare`);
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
    await expect(tooltip).toContainText("Colaborare");
    await expect(tooltip).not.toContainText(partner);
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
    await expect(tooltip).toContainText("Colaborare");
  });

  test("the calendar's agenda puts the handshake beside the entry, named with the generic label", async ({ page }) => {
    await page.goto(`/ro/calendar?month=${MONTH}&view=list`);
    const entry = page.locator(`#main a[aria-label*="${title}"]`);
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-label", `10:00 ${title}. Colaborare`);
    await expect(entry.getByRole("img", { name: "Colaborare" })).toHaveCount(1);
    await expect(entry.locator(HANDSHAKE)).toHaveCount(1);
    await expect(entry).not.toHaveAttribute("title", /.*/);
    await expect(entry.locator("[title], title")).toHaveCount(0);

    // The agenda row has no tooltip of its own (§261); the handshake's is the only one.
    if (test.info().project.name === "mobile") return;
    await entry.locator(HANDSHAKE).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
    await expect(page.getByRole("tooltip")).toHaveText("Colaborare");
  });

  test("the English calendar carries the generic label in English", async ({ page }) => {
    await page.goto(`/en/calendar?month=${MONTH}`);
    // The English calendar's title is the English one — the Romanian title never appears there.
    const entry = page.locator(`#main [role=table] a[aria-label*="${englishTitle}"]`).filter({ has: page.locator(HANDSHAKE) });
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-label", /\. Partnership$/);
    await expect(entry).not.toHaveAttribute("aria-label", new RegExp(partner));
  });
});
