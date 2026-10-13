import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * An event as a JSON file (§NNN), walked through the pages: export a seeded event from its editor,
 * bring the file in as a new draft, then bring a changed copy over that draft after reading the diff —
 * and the role that may do none of it is refused on the page and at the route.
 *
 * Serial, because the second test reads what the first made. The file is edited between the steps
 * (a free page address and a title of its own per project and run), the way the club edits a file it
 * carries between two sites; `UNIQUE(locale, slug)` would otherwise make the two projects, running in
 * parallel against one database, fight over the same suffix.
 */

let sourceId = "";
let importedId = "";

const asFile = (data: unknown) => ({ name: "event.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });

test.describe.serial("An event as a JSON file", () => {
  test("is exported from the editor, imported as a new draft, then written over that draft after its diff", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");

    // The seeded interval session: nothing here changes it, and the export only reads it.
    await page.goto("/ro/admin?q=Antrenament+de+intervale");
    await hydrated(page);
    const href = await page.locator('a[aria-label^="Editează Antrenament de intervale"]').first().getAttribute("href");
    sourceId = /\/admin\/events\/([0-9a-f-]{36})/.exec(href ?? "")?.[1] ?? "";
    expect(sourceId).not.toBe("");

    // The export is a button in the editor's last card, and downloads `<slug>-<day>.json`.
    await page.goto(`/ro/admin/events/${sourceId}`);
    await hydrated(page);
    await openEditorBox(page, "Duplică sau șterge evenimentul");
    const exportButton = page.getByTestId("event-json-export");
    await expect(exportButton).toHaveText("Exportă evenimentul (JSON)");
    expect((await exportButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/^antrenament-de-intervale-olimpia-\d{4}-\d{2}-\d{2}\.json$/);
    const text = readFileSync(await download.path(), "utf8");
    const file = JSON.parse(text) as { format: string; version: number; event: { translations: Record<"ro" | "en", { title: string; slug: string }> }; media: unknown[] };
    expect(file.format).toBe("brasovrunners-event");
    expect(file.version).toBe(1);
    expect(file.event.translations.ro.title).toBe("Antrenament de intervale");
    expect(Object.keys(file.event)).not.toContain("registrations");
    expect(text).not.toMatch(/@/);

    // A free page address and a title of its own, as a person carrying the file would.
    const slugs = { ro: `import-${suffix}-ro`, en: `import-${suffix}-en` };
    const title = `Importat ${suffix}`;
    for (const locale of ["ro", "en"] as const) file.event.translations[locale] = { ...file.event.translations[locale], slug: slugs[locale], title: `${title} ${locale}` };

    // The list offers the import to an Administrator.
    await page.goto("/ro/admin");
    await hydrated(page);
    await page.getByTestId("event-json-link").click();
    await expect(page).toHaveURL(/\/ro\/admin\/events\/import$/);
    await hydrated(page);

    // As a new event: the file is read by the server, summarised, and a draft is made.
    await page.getByTestId("event-json-input").setInputFiles(asFile(file));
    await expect(page.getByTestId("event-json-summary")).toContainText(`${title} ro`);
    await expect(page.getByTestId("event-json-new")).toContainText(slugs.ro);
    const createButton = page.getByTestId("event-json-new-button");
    expect((await createButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await createButton.click();
    await expect(page.getByTestId("event-json-result")).toContainText("Ciorna a fost creată");
    await page.getByTestId("event-json-open").click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    importedId = /\/admin\/events\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
    expect(importedId).not.toBe("");
    expect(importedId).not.toBe(sourceId);
    await hydrated(page);
    await expect(page.locator('[name="translations.ro.title"]')).toHaveValue(`${title} ro`);
    // A draft: its page is nobody's but the staff's.
    const publicPage = await page.request.get(`/ro/evenimente/${slugs.ro}`);
    expect(publicPage.status()).toBe(404);

    // Over an existing event: the diff first, and only the confirmed press writes.
    file.event.translations.ro.title = `${title} ro, changed`;
    await page.goto("/ro/admin/events/import");
    await hydrated(page);
    await page.getByTestId("event-json-input").setInputFiles(asFile(file));
    await expect(page.getByTestId("event-json-summary")).toBeVisible();
    await page.getByTestId("event-json-mode-over").click();
    // Every control a thumb must hit is at least 44 pixels tall (BR-REQ-041-01 criterion 6).
    for (const id of ["event-json-mode-new", "event-json-mode-over", "event-json-target"]) {
      expect((await page.getByTestId(id).boundingBox())?.height ?? 0, id).toBeGreaterThanOrEqual(43.5);
    }
    await page.getByTestId("event-json-target").selectOption(importedId);
    await expect(page.getByTestId("event-json-diff")).toBeVisible();
    const changes = page.getByTestId("event-json-change");
    await expect(changes).toHaveCount(1);
    await expect(page.locator('[data-testid="event-json-change"][data-key="translations.ro.title"]')).toContainText(`${title} ro, changed`);
    // Reading the diff wrote nothing.
    const apply = page.getByTestId("event-json-over-button");
    await expect(apply).toBeDisabled();
    await page.getByTestId("event-json-confirm").getByRole("checkbox").check();
    await expect(apply).toBeEnabled();
    expect((await apply.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await apply.click();
    await expect(page.getByTestId("event-json-result")).toContainText("Gata: 1 câmp schimbat");
    await page.getByTestId("event-json-open").click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${importedId}`));
    await hydrated(page);
    await expect(page.locator('[name="translations.ro.title"]')).toHaveValue(`${title} ro, changed`);
  });

  test("is an Administrator's alone: no link, no page, no download", async ({ page, request }) => {
    expect(sourceId).not.toBe("");
    // Not signed in: refused at the route.
    expect((await request.get(`/api/admin/events/${sourceId}/export`)).status()).toBe(401);

    await signIn(page, "Dev Moderator");
    await expect(page.getByTestId("event-json-link")).toHaveCount(0);
    const answer = await page.goto("/ro/admin/events/import");
    expect(answer?.status()).toBe(404);
    expect((await page.request.get(`/api/admin/events/${sourceId}/export`)).status()).toBe(403);
  });
});
