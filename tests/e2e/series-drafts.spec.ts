import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §NNN — the owner, of a series row reading "Publicat · 8 date · Ciornă ·
 * 1 date": "ce înseamnă această 1 ciornă?". A series started from a published event, with
 * "Publică edițiile create" left unticked, makes every new date a draft the site never shows —
 * and until now the list said nothing beyond a bare, wrongly-pluralised count.
 *
 * This walks the whole fix: the list names the missing dates, links each to its own editor, and
 * explains why (`SeriesDraftLine`, `seriesDrafts`); the editor carries the switch the
 * explanation points at (`setRepeatPublish`), and turning it on is what makes the line go away
 * for every date made after that.
 */
test.describe("BR-REQ-050-02 a series' draft dates, named on the list and fixed from the editor", () => {
  test("names the drafts on the list, explains why, and the switch turns the reason off", async ({ page }) => {
    test.setTimeout(90_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const title = `Cros lunar ${suffix}`;
    const slug = `cros-lunar-${suffix}`;
    const englishSlug = `monthly-cross-${suffix}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = page.locator(`#locale-panel-${locale}`);
      await panel.locator("summary").filter({ hasText: "Rezumat" }).click();
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    // A week away, well inside the eight-week horizon `repeatEvent` creates into immediately
    // (§122) — unlike a hand-picked date months out, which would make nothing yet.
    const DAY = 86_400_000;
    const today = new Date();
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 8, 9));
    const ymd = (date: Date) => date.toISOString().slice(0, 10);
    const short = (date: Date) => new Intl.DateTimeFormat("ro-RO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date);

    await signIn(page, "Dev Administrator");

    // Created and published in one press (§315), so the series it starts is not a draft itself:
    // only a published source's rule can ever make a *published* copy — the whole point here is
    // that this one is deliberately left to make drafts instead.
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    // MUI pickers since the pickers landed beside the series hints (§NNN): driven, not filled.
    await fillDateField(page, "Începutul evenimentului", ymd(first));
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Un cros lunar, pentru seria de ciorne.");
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Monthly cross ${suffix}`);
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "A monthly cross, for the drafts series.");
    await page.getByRole("button", { name: "Creează și publică" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    await hydrated(page);

    const main = page.locator("#main");
    await expect(main.getByText("Publicat", { exact: true })).toBeVisible();

    // The tick first, the frequency after it (§169): "Publică edițiile create" stays unticked —
    // this is the case the whole feature is about.
    await main.getByRole("checkbox", { name: "Repetă evenimentul" }).check();
    await fillDateField(page, "Până la (opțional)", ymd(new Date(first.getTime() + 14 * DAY)));
    await expect(field("publish")).not.toBeChecked();
    await main.getByRole("button", { name: "Creează edițiile" }).click();
    await page.getByRole("dialog", { name: "Creezi edițiile?" }).getByRole("button", { name: "Creează edițiile" }).click();
    // Two Sundays after the source, both drafts: the alert already reads as Romanian ("2 date").
    await expect(page.locator("#admin-alert")).toContainText("2 date create acum", { timeout: 15_000 });
    await hydrated(page);

    // The editor now carries the switch the list's hint points at: off, because the source is
    // live but the rule said not to — the explanation's own words for that state.
    const repeatPublish = main.getByTestId("repeat-publish");
    await expect(repeatPublish).toContainText("publicarea automată e oprită");
    await expect(repeatPublish.getByRole("button", { name: "Publică datele noi automat" })).toBeVisible();

    // The list: the bare "Ciornă · 2 date" chip is gone, replaced by the named line — a single
    // "Publicat · 1 dată" chip is now everything the status column says about the series' state.
    await page.goto("/ro/admin");
    await hydrated(page);
    const row = page.locator("tr, li").filter({ visible: true }).filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await expect(row.getByText("3 date", { exact: true })).toBeVisible(); // the series badge: source + two drafts
    await expect(row.getByText("Publicat · 1 dată", { exact: true })).toBeVisible();
    await expect(row.getByText("2 date în ciornă — nu apar pe site:")).toBeVisible();

    const firstDraftLink = row.getByRole("link", { name: short(new Date(first.getTime() + 7 * DAY)), exact: true });
    await expect(firstDraftLink).toBeVisible();
    await expect(row.getByRole("link", { name: short(new Date(first.getTime() + 14 * DAY)), exact: true })).toBeVisible();

    // The "?" carries the reason this series makes drafts, reachable without hovering (it is
    // also the button's accessible name).
    const hint = row.getByRole("button", { name: /publicarea automată e oprită/ });
    await expect(hint).toBeVisible();

    // The tooltip itself opens, not merely its accessible name: both sentences are there, on
    // their own lines (`TOOLTIP_TEXT_SX`'s `pre-line`), not collapsed into one run-on paragraph —
    // the defect the owner reported this whole feature over.
    await hint.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("O dată în ciornă nu e pe site");
    await expect(tooltip).toContainText("publicarea automată e oprită");
    // Where the switch really is, and what the list's tick really does (§NNN hints): the source
    // event's "Evenimentul se repetă" and its button, and the bar's verb for a series' tick.
    await expect(tooltip).toContainText("la „Evenimentul se repetă”, apasă „Publică datele noi automat”");
    await expect(tooltip).toContainText("bifează seria în listă");
    await expect(tooltip).toContainText("„Publică cele bifate”");
    await expect(tooltip).not.toContainText("setările seriei");
    await expect(tooltip).toHaveCSS("white-space", "pre-line");

    // The link is real: it opens the draft's own editor, where it is a draft and nothing else.
    await firstDraftLink.click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);
    await expect(page.locator("#main").getByText("Ciornă", { exact: true })).toBeVisible();

    // Back on the list, then the source (the title link points at the next occurrence, which is
    // this series' first and only published date): the switch the hint pointed at. Turning it on
    // makes the reason go away for every date the series makes from here on.
    await page.goto("/ro/admin");
    await hydrated(page);
    await row.getByRole("link", { name: title, exact: true }).click();
    await hydrated(page);
    await main.getByTestId("repeat-publish").getByRole("button", { name: "Publică datele noi automat" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Publicarea automată a fost pornită", { timeout: 15_000 });
    await expect(main.getByTestId("repeat-publish")).toContainText("Datele noi ale seriei se publică automat");
  });
});
