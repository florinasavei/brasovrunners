import { expect, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-050-02 criteria 7, 15, 16 and 17 (`DECISIONS.md` §128, §130, §131, §134) — a series
 * from the event page keeps the event's own day; the editor of a date says which date it is
 * and shows the others as chips that tick the dates a save reaches, the arrow on each opening
 * it; the preset "this and the following dates" ticks them, and the save reaches them at the
 * same hour on each date's own day.
 */
test.describe("BR-REQ-050-02 a series: its own day, the header, and a save for the following dates", () => {
  test("makes a Sunday-and-Wednesday series, opens a date by its chip, and moves the following ones to 08:50", async ({ page }) => {
    test.setTimeout(90_000);
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
    const long = (date: Date) => new Intl.DateTimeFormat("ro-RO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
    const short = (date: Date) => new Intl.DateTimeFormat("ro-RO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date);
    const escape = (words: string) => words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    await signIn(page, "Dev Superadministrator");

    await page.goto("/ro/admin/events/new");
    await field("event.startsAtDate").fill(ymd(first));
    await field("event.startsAtTime").fill("08:00");
    await field("event.locationName").fill("Stația de telecabină Tâmpa");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(`tura-de-duminica-${suffix}`);
    await field("translations.en.title").fill(`Sunday hill ${suffix}`);
    await field("translations.en.slug").fill(`sunday-hill-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);

    // Recurrence is a tick first and the frequency after it (§169): nothing below is on the
    // page until the box is ticked.
    const main = page.locator("#main");
    await main.getByRole("checkbox", { name: "Repetă evenimentul" }).check();

    // The event's own day is ticked and locked (§128); Wednesday is added, until four weeks on.
    const sunday = main.getByRole("checkbox", { name: "Du" });
    await expect(sunday).toBeChecked();
    await expect(sunday).toBeDisabled();
    await main.getByRole("checkbox", { name: "Mi" }).check();
    await field("until").fill(ymd(plus(28)));
    await main.getByRole("button", { name: "Creează edițiile" }).click();
    const dialog = page.getByRole("dialog", { name: "Creezi edițiile?" });
    await dialog.getByRole("button", { name: "Creează edițiile" }).click();
    await expect(page.locator("#admin-alert")).toContainText("8 ediții create", { timeout: 15_000 });
    await hydrated(page);

    // The header (§131, §134): which date this is, every date as a chip — this one current,
    // the others tickable — and "Toate" in front of them.
    await expect(main.getByRole("heading", { name: new RegExp(`Editezi data de ${escape(long(first))}(,| la) 08:00`) })).toBeVisible();
    await expect(main.getByText("Data 1 din 9 ale seriei")).toBeVisible();
    await expect(main.locator(".MuiChip-root[aria-current='page']")).toHaveText(short(first));
    await expect(main.getByRole("checkbox", { name: short(plus(3)), exact: true })).toHaveAttribute("aria-checked", "false");
    await expect(main.getByRole("button", { name: "Toate", exact: true })).toBeVisible();

    // The second date — the Wednesday after — one press on its arrow away.
    await main.getByLabel(`Deschide data de ${short(plus(3))}`, { exact: true }).click();
    await expect(main.getByRole("heading", { name: new RegExp(`Editezi data de ${escape(long(plus(3)))}(,| la) 08:00`) })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText("Data 2 din 9 ale seriei")).toBeVisible();
    await hydrated(page);

    // 08:50 for this date and the following ones (§130, §134): the preset in the folded box
    // ticks the six chips after this one; the two before it stay unticked.
    await field("event.startsAtTime").fill("08:50");
    const scopeBox = main.locator("details").filter({ hasText: "Salvează pentru" });
    await expect(scopeBox.locator("summary")).toContainText("Doar această dată");
    await scopeBox.locator("summary").click();
    await scopeBox.getByRole("button", { name: "Această dată și următoarele", exact: true }).click();
    await expect(scopeBox.locator("summary")).toContainText("Această dată și următoarele (7)");
    await expect(main.getByRole("checkbox", { name: short(plus(28)), exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(main.getByRole("checkbox", { name: short(first), exact: true })).toHaveAttribute("aria-checked", "false"); // the source is before this date
    await main.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.locator("#admin-alert")).toContainText("Salvat — și pe încă 7 date ale seriei", { timeout: 15_000 });
    await hydrated(page);

    // The last Sunday is at 08:50 now; the source Sunday before this date is still at 08:00.
    await main.getByLabel(`Deschide data de ${short(plus(28))}`, { exact: true }).click();
    await expect(main.getByRole("heading", { name: new RegExp(`Editezi data de ${escape(long(plus(28)))}(,| la) 08:50`) })).toBeVisible({ timeout: 15_000 });
    await expect(field("event.startsAtTime")).toHaveValue("08:50");
    await main.getByLabel(`Deschide data de ${short(first)}`, { exact: true }).click();
    await expect(main.getByRole("heading", { name: new RegExp(`Editezi data de ${escape(long(first))}(,| la) 08:00`) })).toBeVisible({ timeout: 15_000 });
    await expect(field("event.startsAtTime")).toHaveValue("08:00");
  });
});
