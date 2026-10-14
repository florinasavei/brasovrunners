import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §NNN — «Ecusoane pentru voluntari» (BR-REQ-050-02, BR-REQ-060-01): the Organizer opens the badges' page
 * from the event's «Voluntari» card, chooses the larger strip in «Cum arată ecusonul» and saves it — the
 * preview follows before the save, the choice is there after it — then prints per role: one role's count
 * typed with its spares, the other's left at the people it needs, and a few badges «fără rol». The PDF
 * downloads with exactly that many badges (the file's own properties say how many), on the pages they take.
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

test.describe("§NNN volunteer badges, designed and printed per role", () => {
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

  test("the Tehnic role meets the 404 an unknown page gets, and the sheet refuses it", async ({ page }) => {
    const tag = `${test.info().project.name}-dev-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);
    await signIn(page, "Dev Technical");
    const response = await page.goto(`/ro/admin/events/${event.id}/badges`);
    expect(response?.status()).toBe(404);
    expect((await page.request.get(`/api/admin/events/${event.id}/badges?locale=ro`)).status()).toBe(403);
  });
});
