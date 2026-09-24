import { expect, type Page, test } from "@playwright/test";
import { formatDay } from "../../src/i18n/dates";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { editorBox, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-050-02 criteria 7, 15, 16 and 17 (`DECISIONS.md` §128, §130, §131, and the editor's
 * boxes, §NNN) — a series from the event page keeps the event's own day; the Recurență box on any
 * date says which date it is, the rule, the next dates and how the series renews itself; the save
 * reaches "this date and the following" by default — three radios in the Salvare box, the dates
 * one by one folded under them — at the same hour on each date's own day; and from a copied date
 * the automatic publication is switched and the recurrence stopped.
 */

/*
  The dates as the editor writes them — the site's short form (`src/i18n/dates.ts`, §NNN weekday
  on every date): "Dum., 4 oct. 2026, 08:00" where a date starts a line or a link, "dum., 4 oct.
  2026" inside the Salvare box's sentence. The dates below are at noon UTC, the same calendar day
  in Brașov, and the time is the one the event was given on its own clock.
*/
const label = (date: Date, time: string) => `${formatDay(date, { locale: "ro", timeZone: "UTC", style: "short" })}, ${time}`;
const dayOf = (date: Date) => formatDay(date, { locale: "ro", timeZone: "UTC", style: "short", position: "inline" });

/** The editor of one date of the series, opened from the Salvare box's list of dates (15.1). */
async function openDate(page: Page, text: string) {
  const pick = page.getByTestId("series-pick-dates");
  await openFold(pick);
  await pick.locator("div").filter({ hasText: text }).last().getByRole("link", { name: "deschide" }).click();
}

test.describe("BR-REQ-050-02 a series: its own day, the Recurență box, and a save for the following dates", () => {
  test("makes a Sunday-and-Wednesday series, saves the following dates at 08:50, then stops it from a copy", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const title = `Tură de duminică ${suffix}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);

    // Inside the eight-week horizon the series is created to (§122): the first Sunday at
    // least a week away, four weeks of dates after it — Wednesdays +3, +10, +17, +24 and
    // Sundays +7, +14, +21, +28: eight dates after the source.
    const DAY = 86_400_000;
    const today = new Date();
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7, 12));
    while (first.getUTCDay() !== 0) first.setTime(first.getTime() + DAY);
    const plus = (days: number) => new Date(first.getTime() + days * DAY);
    const ymd = (date: Date) => date.toISOString().slice(0, 10);

    await signIn(page, "Dev Superadministrator");

    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await fillDateField(page, "Începutul evenimentului", ymd(first));
    await fillTimeField(page, "Ora", "08:00");
    await field("event.locationName").fill("Stația de telecabină Tâmpa");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(`tura-de-duminica-${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Sunday hill ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`sunday-hill-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);

    // Recurrence is a tick first and the frequency after it (§169), in the Recurență box — folded
    // on an event that does not repeat, with "Nu se repetă" on its closed line.
    const recurrence = await openEditorBox(page, "Recurență");
    await recurrence.getByRole("checkbox", { name: "Repetă evenimentul" }).check();

    // The event's own day is ticked and locked (§128); Wednesday is added, until four weeks on.
    const sunday = recurrence.getByRole("checkbox", { name: "Du" });
    await expect(sunday).toBeChecked();
    await expect(sunday).toBeDisabled();
    await recurrence.getByRole("checkbox", { name: "Mi" }).check();
    await fillDateField(page, "Până la (opțional)", ymd(plus(28)));
    // The rule in one live sentence, before the press.
    await expect(recurrence.getByTestId("repeat-rule-sentence")).toContainText("În fiecare miercuri și duminică, la 08:00");
    // "Publică datele noi automat" is shown and ticked by default (§NNN); this event is a draft,
    // so the box says its dates stay drafts while it is one.
    await expect(recurrence.getByRole("checkbox", { name: "Publică datele noi automat" })).toBeChecked();
    await expect(recurrence.getByTestId("repeat-publish-field")).toContainText("Cât timp evenimentul e ciornă");
    await recurrence.getByRole("button", { name: "Creează datele" }).click();
    const dialog = page.getByRole("dialog", { name: "Creezi datele?" });
    await dialog.getByRole("button", { name: "Creează datele" }).click();
    await expect(page.locator("#admin-alert")).toContainText("8 date create acum", { timeout: 15_000 });
    await hydrated(page);

    // The heading says which date this is; the Recurență box is open on a series, from any date.
    await expect(page.getByTestId("editor-heading")).toHaveText(title);
    await expect(page.getByText(`Data 1 din 9 · ${title}`)).toBeVisible();
    const series = page.getByTestId("recurrence-series");
    await expect(series).toHaveAttribute("open", "");
    await expect(series).toContainText(`până la ${dayOf(plus(28))}`);
    await expect(series).toContainText("Datele următoare");

    // The second date — the Wednesday after — one press on "Data următoare".
    await series.getByRole("link", { name: `Data următoare: ${label(plus(3), "08:00")} →` }).click();
    await expect(page.getByText(`Data 2 din 9 · ${title}`)).toBeVisible({ timeout: 15_000 });
    await hydrated(page);

    // 08:50 for this date and the following ones (§130): the default now (§NNN, reversing §240),
    // said in the Salvare box as a radio and a sentence counting the dates the save reaches.
    await openEditorBox(page, "Data și ora");
    await fillTimeField(page, "Ora", "08:50");
    const scope = page.getByTestId("series-scope");
    await expect(scope.getByRole("radio", { name: "Această dată și următoarele" })).toBeChecked();
    await expect(page.getByTestId("series-scope-count")).toContainText(`Salvarea schimbă 8 date: ${dayOf(plus(3))} și următoarele 7, până la ${dayOf(plus(28))}.`);
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.locator("#admin-alert")).toContainText("Salvat — și pe încă 7 date ale seriei", { timeout: 15_000 });
    await hydrated(page);

    // The last Sunday is at 08:50 now, opened from the dates one by one (15.1).
    await openDate(page, label(plus(28), "08:50"));
    await expect(page.getByText(`Data 9 din 9 · ${title}`)).toBeVisible({ timeout: 15_000 });
    await hydrated(page);
    await expect(field("event.startsAtTime")).toHaveValue("08:50");

    // From this copied date: the series' publication switched off, on the source's rule…
    const copySeries = page.getByTestId("recurrence-series");
    const repeatPublish = copySeries.getByTestId("repeat-publish");
    await expect(repeatPublish).toContainText("Publicarea automată e pornită, dar așteaptă");
    await repeatPublish.getByRole("checkbox", { name: "Publică datele noi automat" }).uncheck();
    await repeatPublish.getByRole("button", { name: "Salvează setarea" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Publicarea automată a fost oprită", { timeout: 15_000 });
    await hydrated(page);
    await expect(page.getByTestId("repeat-publish")).toContainText("publicarea automată e oprită");

    // …and the recurrence stopped, with a confirmation that says what stays.
    await page.getByTestId("recurrence-series").getByRole("button", { name: "Oprește recurența" }).click();
    const stop = page.getByRole("dialog", { name: "Oprește recurența" });
    await expect(stop).toContainText("cele deja create rămân");
    await stop.getByRole("button", { name: "Oprește recurența" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Seria e oprită", { timeout: 15_000 });
    await hydrated(page);
    await expect(page.getByTestId("recurrence-series")).toContainText("nu se mai creează date noi");
    await expect(page.getByTestId("repeat-publish")).toHaveCount(0);

    // The source Sunday before the saved dates is still at 08:00 — and, its rule stopped, it is a
    // one-off again whose Recurență box can start a series anew.
    await page.getByTestId("recurrence-series").getByRole("link", { name: "Deschide seria" }).click();
    await expect(editorBox(page, "Recurență")).toContainText("Nu se repetă", { timeout: 15_000 });
    await expect(field("event.startsAtTime")).toHaveValue("08:00");
  });
});
