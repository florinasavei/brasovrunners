import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §764 — «Ecusoane pentru voluntari» (BR-REQ-050-02, BR-REQ-060-01): the Organizer opens the badges' page
 * from the event's «Voluntari» card, chooses the larger strip in «Cum arată ecusonul» and saves it — the
 * preview follows before the save, the choice is there after it — then prints per role: one role's count
 * typed with its spares, the other's left at the people it needs, and a few badges «fără rol». The PDF
 * downloads with exactly that many badges (the file's own properties say how many), on the pages they take.
 *
 * §NNN adds the free-text line and the marker area: the Organizer ticks both in the designer, types the
 * texts, sees the preview follow, saves, finds them again after the save, and the sheet still holds the
 * badges asked for; and a size with no room for everything ticked is refused, in words, before anything is kept.
 *
 * The event and its two roles are written straight into the database — the setup, not the subject — one
 * per project and run, so the two projects never share a row.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** A race a month ahead with two volunteer roles: «Punct de apă» needs 3, «Sosire» needs 2. */
async function seedEvent(tag: string): Promise<{ id: string; water: string; finish: string }> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name) VALUES ('RACE', now() + interval '30 days', 'NONE', 'Poiana Brașov') RETURNING id`,
    );
    const id = rows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`,
      [id, `ecusoane-${tag}`, `Crosul cu ecusoane ${tag}`, `badges-${tag}`, `The cross with badges ${tag}`],
    );
    const roles = await client.query<{ id: string }>(
      `INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 3, 0), ($1, 'Sosire', 'Finish', 2, 1) RETURNING id`,
      [id],
    );
    return { id, water: roles.rows[0].id, finish: roles.rows[1].id };
  } finally {
    await client.end();
  }
}

test.describe("§764 volunteer badges, designed and printed per role", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer saves a design from the volunteers' card, and the PDF holds the badges asked for", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);

    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    // One button on the «Voluntari» card opens the badges' page.
    await openEditorBox(page, "Voluntari");
    await openEditorBox(page, "Roluri");
    // A role's colour is part of its definition: «Modifică» on the role's row, «Culoarea benzii», «Salvează».
    const row = page.locator(`[data-testid="volunteer-role"][data-role-id="${event.water}"]`);
    await expect(row.getByTestId("volunteer-role-colour")).toContainText("Portocaliul clubului");
    await openFold(row.locator("summary", { hasText: "Modifică" }).locator("xpath=.."));
    await row.getByLabel("Culoarea benzii").selectOption({ label: "Roșu" });
    await row.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);
    await openEditorBox(page, "Voluntari");
    await openEditorBox(page, "Roluri");
    await expect(row.getByTestId("volunteer-role-colour")).toContainText("Roșu");
    const link = page.getByTestId("volunteer-badges-link");
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await link.click();
    await page.waitForURL(new RegExp(`/ro/admin/events/${event.id}/badges$`));
    await hydrated(page);
    await expect(page.getByRole("heading", { name: /Ecusoane pentru voluntari/ })).toBeVisible();
    // No horizontal scroll at the project's width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The colour saved on the role's row is the one «Culorile rolurilor» says here.
    await openFold(page.getByTestId("badge-colours"));
    await expect(page.locator(`[data-testid="badge-colour-row"][data-role-id="${event.water}"]`).getByTestId("badge-colour-state")).toContainText("Roșu");

    // --- «Cum arată ecusonul»: the larger strip; the preview follows before the save -----------
    const designer = page.getByTestId("badge-design");
    await openFold(designer);
    const preview = page.getByTestId("badge-design-preview").locator("img");
    await expect(preview).toHaveAttribute("src", /[?&]size=strip90(&|$)/);
    await openFold(page.getByTestId("badge-section-size"));
    const larger = page.getByTestId("badge-size").getByRole("radio", { name: /100 × 40 mm/ });
    await larger.check();
    await expect(preview).toHaveAttribute("src", /[?&]size=strip100(&|$)/, { timeout: 10_000 });
    const picture = await page.request.get((await preview.getAttribute("src")) as string);
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/png");

    // --- «Text liber» and «Spațiu pentru marker» (§NNN): each behind its own tick; the preview follows ----
    const free = page.getByTestId("badge-section-free");
    await openFold(free);
    await expect(free.locator("summary")).toContainText("Fără text liber");
    await page.getByRole("checkbox", { name: "O linie de text liber" }).check();
    await page.getByLabel("Text liber (română)").fill("Bea apă la fiecare punct");
    await page.getByLabel("Text liber (engleză)").fill("Drink water at every point");
    await expect(preview).toHaveAttribute("src", /[?&]showFreeText=1(&|$)/, { timeout: 10_000 });
    await expect(preview).toHaveAttribute("src", /[?&]freeTextRo=Bea\+ap/);
    const marker = page.getByTestId("badge-section-marker");
    await openFold(marker);
    await expect(marker.locator("summary")).toContainText("Fără spațiu pentru marker");
    await page.getByRole("checkbox", { name: "Un spațiu pentru marker, lângă nume" }).check();
    await page.getByLabel("Eticheta spațiului (română)").fill("Tură");
    await page.getByLabel("Eticheta spațiului (engleză)").fill("Shift");
    await expect(preview).toHaveAttribute("src", /[?&]showMarker=1(&|$)/, { timeout: 10_000 });
    await expect(preview).toHaveAttribute("src", /[?&]markerLabelRo=Tur/);
    // The sample with both is a picture, not a refusal.
    const both = await page.request.get((await preview.getAttribute("src")) as string);
    expect(both.status()).toBe(200);
    expect(both.headers()["content-type"]).toBe("image/png");
    const save = page.getByRole("button", { name: "Salvează ecusonul", exact: true });
    expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await save.click();
    await page.waitForURL(/#box-badge-design$/);
    await hydrated(page);
    // Saved: the closed line says the size and how many fit on a sheet, and the choice is there again.
    await expect(designer.locator("summary").first()).toContainText("100 × 40 mm · 14 pe foaie");
    await openFold(page.getByTestId("badge-design"));
    await openFold(page.getByTestId("badge-section-size"));
    await expect(page.getByTestId("badge-size").getByRole("radio", { name: /100 × 40 mm/ })).toBeChecked();
    // Both new sections are kept: their closed lines say what is written, and the boxes hold it again.
    await expect(page.getByTestId("badge-section-free").locator("summary")).toContainText("Bea apă la fiecare punct");
    await expect(page.getByTestId("badge-section-marker").locator("summary")).toContainText("Tură / Shift");
    await openFold(page.getByTestId("badge-section-free"));
    await expect(page.getByRole("checkbox", { name: "O linie de text liber" })).toBeChecked();
    await expect(page.getByLabel("Text liber (română)")).toHaveValue("Bea apă la fiecare punct");
    await expect(page.getByLabel("Text liber (engleză)")).toHaveValue("Drink water at every point");
    await openFold(page.getByTestId("badge-section-marker"));
    await expect(page.getByRole("checkbox", { name: "Un spațiu pentru marker, lângă nume" })).toBeChecked();
    await expect(page.getByLabel("Eticheta spațiului (română)")).toHaveValue("Tură");
    await expect(page.getByLabel("Eticheta spațiului (engleză)")).toHaveValue("Shift");
    // The saved badge's own picture draws with both: the address carries no unsaved design, so this is the stored one.
    const savedPicture = await page.request.get(`/api/admin/events/${event.id}/badges/preview?locale=ro&role=${event.water}&v=x`);
    expect(savedPicture.status()).toBe(200);
    expect(savedPicture.headers()["content-type"]).toBe("image/png");

    // --- «Tipărire»: per role, with spares and the badges «fără rol» ---------------------------
    const print = page.getByTestId("badge-print");
    await openFold(print);
    const water = print.locator(`[data-testid="badge-print-row"][data-role-id="${event.water}"]`);
    const finish = print.locator(`[data-testid="badge-print-row"][data-role-id="${event.finish}"]`);
    // By default, the people each role needs.
    await expect(water.getByTestId("badge-count")).toHaveValue("3");
    await expect(finish.getByTestId("badge-count")).toHaveValue("2");
    await water.getByTestId("badge-count").fill("4");
    await water.getByTestId("badge-spares").fill("2");
    await print.getByTestId("badge-none").fill("5");
    const download = print.getByTestId("badge-download");
    expect((await download.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.suggestedFilename()).toMatch(/^badges-[0-9a-f]{8}-ro\.pdf$/);
    const bytes = readFileSync((await file.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // 4 + 2 for the water point, 2 at the finish, 5 «fără rol»: 13 — one sheet of 14 at 100 × 40 mm.
    expect(bytes.toString("latin1")).toContain("(13 badges)");
    expect(bytes.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);

    // A total the file cannot take comes back to this page with the reason, not as a bare JSON answer.
    await water.getByTestId("badge-count").fill("300");
    await water.getByTestId("badge-spares").fill("300");
    await finish.getByTestId("badge-count").fill("300");
    await finish.getByTestId("badge-spares").fill("300");
    await print.getByTestId("badge-none").fill("300");
    await Promise.all([page.waitForURL(/badges\?refused=total$/), download.click()]);
    await hydrated(page);
    await expect(page.getByTestId("badge-print-refused")).toContainText("prea multe ecusoane");
    // The card with the boxes opens by itself.
    await expect(page.getByTestId("badge-print")).toHaveAttribute("open", "");
  });

  test("a size with no room for everything ticked is refused in words, and nothing is kept (§NNN)", async ({ page }) => {
    const tag = `${test.info().project.name}-small-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);
    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/events/${event.id}/badges`);
    await hydrated(page);
    await openFold(page.getByTestId("badge-design"));
    // The limit said before the save: how tall a badge the line and the telephone need together.
    await openFold(page.getByTestId("badge-section-size"));
    await expect(page.getByTestId("badge-extras-need")).toContainText("34 mm");
    await page.getByTestId("badge-size").getByRole("radio", { name: "Altă dimensiune" }).check();
    await page.getByLabel("Lățimea (mm)").fill("60");
    await page.getByLabel("Înălțimea (mm)").fill("30");
    await openFold(page.getByTestId("badge-section-free"));
    await page.getByRole("checkbox", { name: "O linie de text liber" }).check();
    await page.getByLabel("Text liber (română)").fill("Bea apă");
    await page.getByLabel("Text liber (engleză)").fill("Drink");
    await openFold(page.getByTestId("badge-section-phone"));
    await page.getByRole("checkbox", { name: "Telefonul coordonatorului" }).check();
    await page.getByLabel("Numărul de telefon").fill("0712 345 678");
    await page.getByRole("button", { name: "Salvează ecusonul", exact: true }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toContainText("un ecuson de 60 × 30 mm nu are loc pentru tot ce ai bifat", { timeout: 30_000 });
    await expect(refusal).toContainText("linia de text liber, telefonul coordonatorului");
    await expect(refusal).toContainText("34 mm");
    // The refusal links the height's box; what was typed is still there.
    await expect(refusal.getByRole("link", { name: "Înălțimea (mm)" })).toBeVisible();
    await expect(page.getByLabel("Text liber (română)")).toHaveValue("Bea apă");
    // Nothing was kept: the event's design is still empty.
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const { rows } = await client.query<{ badge_design: unknown }>("SELECT badge_design FROM events WHERE id = $1", [event.id]);
      expect(rows[0].badge_design).toBeNull();
    } finally {
      await client.end();
    }
    // The height the sentence named saves.
    await page.getByLabel("Înălțimea (mm)").fill("34");
    await page.getByRole("button", { name: "Salvează ecusonul", exact: true }).click();
    await page.waitForURL(/#box-badge-design$/, { timeout: 30_000 });
  });

  test("the Tehnic role meets the 404 an unknown page gets, and the sheet refuses it", async ({ page }) => {
    const tag = `${test.info().project.name}-dev-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);
    await signIn(page, "Dev Technical");
    const response = await page.goto(`/ro/admin/events/${event.id}/badges`);
    expect(response?.status()).toBe(404);
    expect((await page.request.get(`/api/admin/events/${event.id}/badges?locale=ro`)).status()).toBe(403);
  });
});
