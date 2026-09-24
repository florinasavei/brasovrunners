import { expect, test } from "@playwright/test";
import { formatDay } from "../../src/i18n/dates";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §341, §NNN — the owner, of a series row reading "Publicat · 8 date · Ciornă ·
 * 1 date": "ce înseamnă această 1 ciornă?", and then of the line that replaced the chip: "tot nu
 * e clar ce e cu data asta în ciornă… ai pus grămadă de text degeaba în tooltip… practic asta e
 * data din aia de viitor generată automat?".
 *
 * A series started from a published event, with "Publică datele noi automat" left unticked,
 * makes every new date a draft the site never shows. This walks the whole fix on the list: the
 * line says what the dates are — created by the series itself, not on the site — links each to
 * its editor, keeps one short sentence behind its "?", and carries the two fixes: "Publică
 * automat de acum" switches the rule on and comes back to the list, and "Publică" publishes
 * exactly the dates listed, after which the line is gone. A Redactor reads the same line and is
 * offered neither.
 */
test.describe("BR-REQ-050-02 a series' draft dates, named on the list and fixed from it", () => {
  test("says what the drafts are, and publishes them — and the rule — from the list", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const title = `Cros lunar ${suffix}`;
    const slug = `cros-lunar-${suffix}`;
    const englishSlug = `monthly-cross-${suffix}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
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
    // A draft's link as the list writes it (§350 weekday on every date): the short form, starting
    // the link, so capitalised — "Vin., 9 oct. 2026". The same calendar day in UTC as in Brașov at 09:00.
    const short = (date: Date) => formatDay(date, { locale: "ro", timeZone: "UTC", style: "short" });

    await signIn(page, "Dev Administrator");

    // Created and published in one press (§315), so the series it starts is not a draft itself:
    // only a published source's rule can ever make a *published* copy — the whole point here is
    // that this one is deliberately left to make drafts instead.
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    // A date and a 24-hour time, each on MUI's picker (`DECISIONS.md` §70, §303).
    await fillDateField(page, "Începutul evenimentului", ymd(first));
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Un cros lunar, pentru seria de ciorne.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Monthly cross ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "A monthly cross, for the drafts series.");
    await page.getByRole("button", { name: "Creează și publică" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    await hydrated(page);
    const sourceUrl = page.url().split("?")[0];

    const main = page.locator("#main");
    await expect(main.getByText("Publicat", { exact: true })).toBeVisible();

    // The tick first, the frequency after it (§169), in the Recurență box. "Publică datele noi
    // automat" is ticked by default now (§350) and is unticked here — this is the case the whole
    // feature is about.
    const recurrence = await openEditorBox(page, "Recurență");
    await recurrence.getByRole("checkbox", { name: "Repetă evenimentul" }).check();
    await fillDateField(page, "Până la (opțional)", ymd(new Date(first.getTime() + 14 * DAY)));
    await expect(field("publish")).toBeChecked();
    await recurrence.getByRole("checkbox", { name: "Publică datele noi automat" }).uncheck();
    await recurrence.getByRole("button", { name: "Creează datele" }).click();
    await page.getByRole("dialog", { name: "Creezi datele?" }).getByRole("button", { name: "Creează datele" }).click();
    // Two dates after the source, both drafts: the alert already reads as Romanian ("2 date").
    await expect(page.locator("#admin-alert")).toContainText("2 date create acum", { timeout: 15_000 });
    await hydrated(page);
    await expect(main.getByTestId("repeat-publish")).toContainText("publicarea automată e oprită");

    // The list: the bare "Ciornă · 2 date" chip is gone, replaced by the named line — a single
    // "Publicat · 1 dată" chip is everything the status column says about the series' state.
    await page.goto("/ro/admin");
    await hydrated(page);
    const row = page.locator("tr, li").filter({ visible: true }).filter({ has: page.getByRole("link", { name: title, exact: true }) });
    const line = row.getByTestId("series-drafts");
    await expect(row.getByText("3 date", { exact: true })).toBeVisible(); // the series badge: source + two drafts
    await expect(row.getByText("Publicat · 1 dată", { exact: true })).toBeVisible();
    // What the dates are, in words: made by the series itself, and not on the site.
    await expect(line).toContainText("2 date noi, create automat, nu sunt pe site:");

    const firstDraftLink = line.getByRole("link", { name: short(new Date(first.getTime() + 7 * DAY)), exact: true });
    await expect(firstDraftLink).toBeVisible();
    await expect(line.getByRole("link", { name: short(new Date(first.getTime() + 14 * DAY)), exact: true })).toBeVisible();

    // The "?" is one short sentence now, not the paragraphs describing where the switch is.
    const hint = line.getByRole("button", { name: /Seria își creează singură datele pe următoarele 8 săptămâni/ });
    await hint.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("fiecare dată nouă rămâne ciornă până o publici");
    await expect(tooltip).not.toContainText("Salvează setarea");
    await expect(tooltip).not.toContainText("Publică cele bifate");
    await page.mouse.move(0, 0);

    // The two fixes, on the line itself, each a thumb's size on a phone (BR-REQ-041-01 criterion 6),
    // and the line inside the viewport at 320 px.
    const publish = line.getByRole("button", { name: "Publică", exact: true });
    const autoPublish = line.getByRole("button", { name: "Publică automat de acum" });
    for (const button of [publish, autoPublish]) {
      await expect(button).toBeVisible();
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const lineBox = await line.boundingBox();
    expect((lineBox?.x ?? 0) + (lineBox?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);

    // The link is real: it opens the draft's own editor, where it is a draft and nothing else.
    await firstDraftLink.click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);
    const draftUrl = page.url().split("?")[0];
    await expect(page.getByTestId("editor-heading").locator("xpath=..").getByText("Ciornă", { exact: true })).toBeVisible();

    // A Redactor reads the same line and is offered neither fix: publishing is the
    // Administrator's (§201), and the server would refuse it anyway (BR-REQ-060-01).
    await page.context().clearCookies();
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin");
    await hydrated(page);
    await expect(line).toContainText("2 date noi, create automat, nu sunt pe site:");
    await expect(line.getByRole("button", { name: /^Publică/ })).toHaveCount(0);
    await page.context().clearCookies();
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin");
    await hydrated(page);

    // "Publică automat de acum": asks first, says it is about the dates to come, and lands back
    // on the list — the dates already made are still drafts, and the line now says just that.
    await autoPublish.click();
    const autoDialog = page.getByRole("dialog", { name: "Pornești publicarea automată?" });
    await expect(autoDialog).toContainText("De acum, fiecare dată nouă pe care o creează seria apare singură pe site.");
    await expect(autoDialog).toContainText("pe acelea le publici cu „Publică”");
    await autoDialog.getByRole("button", { name: "Pornește", exact: true }).click();
    await expect(page).toHaveURL(/\/ro\/admin\?saved=repeatPublishOn/, { timeout: 15_000 });
    await expect(page.locator("#admin-alert")).toContainText("Publicarea automată e pornită");
    await hydrated(page);
    await expect(line).toContainText("2 date în ciornă, nu sunt pe site:");
    await expect(line.getByRole("button", { name: "Publică automat de acum" })).toHaveCount(0);

    // "Publică": exactly the two dates listed, after its confirmation — then the line is gone and
    // the series is published whole.
    await publish.click();
    const publishDialog = page.getByRole("dialog", { name: "Publici 2 date?" });
    await expect(publishDialog).toContainText("se deschid înscrierile");
    await publishDialog.getByRole("button", { name: "Publică", exact: true }).click();
    await expect(page.locator("#admin-alert")).toContainText("2 evenimente publicate. 0 nu au putut fi publicate", { timeout: 15_000 });
    await hydrated(page);
    await expect(row.getByText("Publicat · 3 date", { exact: true })).toBeVisible();
    await expect(line).toHaveCount(0);

    // The date that was a draft is published, and the series' own switch reads on.
    await page.goto(draftUrl);
    await hydrated(page);
    await expect(page.getByTestId("editor-heading").locator("xpath=..").getByText("Publicat", { exact: true })).toBeVisible();
    await page.goto(sourceUrl);
    await hydrated(page);
    await openEditorBox(page, "Recurență");
    await expect(main.getByTestId("repeat-publish")).toContainText("Datele noi ale seriei se publică automat");
    await expect(main.getByTestId("repeat-publish").getByRole("checkbox", { name: "Publică datele noi automat" })).toBeChecked();
  });
});
