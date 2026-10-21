import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";
import { openRoleRow } from "./support/volunteer-roles";

/**
 * §764 — «Ecusoane pentru voluntari» (BR-REQ-050-02, BR-REQ-060-01): the Organizer opens the badges' page
 * from the event's «Voluntari» card, chooses the larger strip in «Cum arată ecusonul» and saves it — the
 * preview follows before the save, the choice is there after it — then prints per role: one role's count
 * typed with its spares, the other's left at the people it needs, and a few badges «fără rol». The PDF
 * downloads with exactly that many badges (the file's own properties say how many), on the pages they take.
 *
 * §776 adds the free-text line and the marker area: the Organizer ticks both in the designer, types the
 * texts, sees the preview follow, saves, finds them again after the save, and the sheet still holds the
 * badges asked for; and a size with no room for everything ticked is refused, in words, before anything is kept.
 *
 * §783 makes the one badge for everyone, with no role, the default: the first case chooses «Câte un ecuson pe rol» (the badge per role, §764, kept
 * as it was), and a case of its own prints in the one-badge mode — its colour chosen and refused below AA, «Câte ecusoane» starting at the
 * confirmed volunteers, «În plus», the PDF holding N plus the spares.
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

/** `count` confirmed volunteers of the event, written straight into the database: what the one badge's «Câte ecusoane» starts at (§783). */
async function confirmedVolunteers(eventId: string, count: number): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    for (let n = 1; n <= count; n += 1) {
      await client.query(
        `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, locale, state, source)
         VALUES ($1, NULL, $2, $3, $3, 1, '+40712345678', 'ro', 'CONFIRMED', 'STAFF')`,
        [eventId, `Voluntar ${n}`, `voluntar${n}-${eventId.slice(0, 8)}@example.test`],
      );
    }
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
    // A role's colour is part of its definition: the role's row, its «Mai multe», «Culoarea benzii» — and the one press of «Salvează toate rolurile» saves it
    // with every other role's change (§791): two roles' colours here, one press.
    const row = page.locator(`[data-testid="volunteer-role"][data-role-id="${event.water}"]`);
    const finishRow = page.locator(`[data-testid="volunteer-role"][data-role-id="${event.finish}"]`);
    await expect(row.getByTestId("volunteer-role-colour")).toContainText("Portocaliul clubului");
    // A role's line is a fold (§842): its boxes open in place.
    await openRoleRow(row);
    await openFold(row.getByTestId("volunteer-role-more"));
    await row.getByLabel("Culoarea benzii").selectOption({ label: "Roșu" });
    // §783: the colour serves the badge per role only, and the role's form says so in one line.
    await expect(row.getByTestId("badge-colour-per-role-only")).toContainText("doar când ecusonul e pe roluri");
    await openRoleRow(finishRow);
    await openFold(finishRow.getByTestId("volunteer-role-more"));
    await finishRow.getByLabel("Culoarea benzii").selectOption({ label: "Violet" });
    await page.getByRole("button", { name: "Salvează toate rolurile", exact: true }).click();
    await expect(page.getByTestId("toast")).toContainText("Am salvat 2 roluri.", { timeout: 30_000 });
    await hydrated(page);
    await openEditorBox(page, "Voluntari");
    await openEditorBox(page, "Roluri");
    await expect(row.getByTestId("volunteer-role-colour")).toContainText("Roșu");
    await expect(finishRow.getByTestId("volunteer-role-colour")).toContainText("Violet");
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
    // Since §783 one badge for everyone is the default: this case is about the badge per role, so it chooses them — and the preview follows.
    const mode = page.getByTestId("badge-mode");
    await openFold(page.getByTestId("badge-section-mode"));
    await expect(mode.getByRole("radio", { name: "Un singur ecuson pentru toți, fără rol" })).toBeChecked();
    await mode.getByRole("radio", { name: "Câte un ecuson pe rol" }).check();
    await expect(preview).toHaveAttribute("src", /[?&]mode=perRole(&|$)/, { timeout: 10_000 });
    await expect(page.getByTestId("badge-per-role-help")).toBeVisible();
    await openFold(page.getByTestId("badge-section-size"));
    const larger = page.getByTestId("badge-size").getByRole("radio", { name: /100 × 40 mm/ });
    await larger.check();
    await expect(preview).toHaveAttribute("src", /[?&]size=strip100(&|$)/, { timeout: 10_000 });
    const picture = await page.request.get((await preview.getAttribute("src")) as string);
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/png");

    // --- «Text liber» and «Spațiu pentru marker» (§776): each behind its own tick; the preview follows ----
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
    // The choice is kept: the closed line says it, and the radio is there again.
    await expect(page.getByTestId("badge-section-mode").locator("summary")).toContainText("Pe roluri");
    await openFold(page.getByTestId("badge-section-mode"));
    await expect(page.getByTestId("badge-mode").getByRole("radio", { name: "Câte un ecuson pe rol" })).toBeChecked();
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

  test("one badge for everyone, no role, is the default: its colour is chosen, the count starts at the confirmed volunteers, the PDF holds N plus the spares (§783)", async ({ page }) => {
    const tag = `${test.info().project.name}-single-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);
    await confirmedVolunteers(event.id, 4);

    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/events/${event.id}/badges`);
    await hydrated(page);
    await openFold(page.getByTestId("badge-design"));
    const preview = page.getByTestId("badge-design-preview").locator("img");
    // The default, for an event that never chose: one badge for everyone, and the preview is drawn so.
    const mode = page.getByTestId("badge-mode");
    await openFold(page.getByTestId("badge-section-mode"));
    await expect(mode.getByRole("radio", { name: "Un singur ecuson pentru toți, fără rol" })).toBeChecked();
    await expect(mode.getByRole("radio", { name: "Câte un ecuson pe rol" })).not.toBeChecked();
    await expect(page.getByTestId("badge-section-mode").locator("summary")).toContainText("Un singur ecuson");
    await expect(preview).toHaveAttribute("src", /[?&]mode=single(&|$)/);
    // Its band's colour is chosen like a role's: the select, then «Altă culoare» with the colour typed — shown only then — and its state in words.
    const single = page.getByTestId("badge-single-colour");
    await expect(single.getByTestId("badge-single-colour-state")).toContainText("Banda pe ecuson: Portocaliul clubului, contrast");
    await expect(single.getByLabel("Culoarea scrisă")).toBeHidden();
    await single.getByLabel("Culoarea benzii pe ecuson").selectOption({ label: "Roșu" });
    await expect(preview).toHaveAttribute("src", /[?&]singleColour=%23c62828(&|$)/, { timeout: 10_000 });
    await single.getByLabel("Culoarea benzii pe ecuson").selectOption({ label: "Altă culoare" });
    await expect(single.getByLabel("Culoarea scrisă")).toBeVisible();
    await single.getByLabel("Culoarea scrisă").fill("#808080");
    // A colour no word reads on is refused in words, before anything is kept.
    const save = page.getByRole("button", { name: "Salvează ecusonul", exact: true });
    await save.click();
    await expect(page.getByTestId("form-refusal")).toContainText("textul nu se citește bine pe culoarea aleasă", { timeout: 30_000 });
    await expect(page.getByTestId("form-refusal").getByRole("link", { name: "Culoarea scrisă" })).toBeVisible();
    // What was typed is still there, with «Altă culoare» still chosen.
    await expect(single.getByLabel("Culoarea benzii pe ecuson")).toHaveValue("typed");
    await expect(single.getByLabel("Culoarea scrisă")).toHaveValue("#808080");
    await single.getByLabel("Culoarea scrisă").fill("#6a1b9a");
    await expect(preview).toHaveAttribute("src", /[?&]singleColour=%236a1b9a(&|$)/, { timeout: 10_000 });
    // The sample of the one badge is a picture, with the designer's unsaved colour.
    const sample = await page.request.get((await preview.getAttribute("src")) as string);
    expect(sample.status()).toBe(200);
    expect(sample.headers()["content-type"]).toBe("image/png");
    await save.click();
    await page.waitForURL(/#box-badge-design$/, { timeout: 30_000 });
    await hydrated(page);
    // Kept: the closed line says it, and the colour is there again, in words.
    await openFold(page.getByTestId("badge-design"));
    await expect(page.getByTestId("badge-section-mode").locator("summary")).toContainText("Un singur ecuson");
    await openFold(page.getByTestId("badge-section-mode"));
    await expect(page.getByTestId("badge-single-colour-state")).toContainText("Banda pe ecuson: Violet, contrast");
    await expect(page.getByTestId("badge-single-colour").getByLabel("Culoarea benzii pe ecuson")).toHaveValue("#6a1b9a");
    // The roles' colours serve the badge per role only, and the card says so on its closed line.
    await expect(page.getByTestId("badge-colours").locator("summary")).toContainText("Doar pe roluri");

    // --- «Tipărire»: one pile, «Câte ecusoane» starting at the four confirmed volunteers, «În plus», no role ----
    const print = page.getByTestId("badge-print");
    await openFold(print);
    await expect(print.getByTestId("badge-print-row")).toHaveCount(1);
    await expect(print.getByTestId("badge-none")).toHaveCount(0);
    await expect(print.getByTestId("badge-count")).toHaveValue("4");
    await expect(print.getByTestId("badge-spares")).toHaveValue("0");
    await expect(print.getByTestId("badge-single-help")).toContainText("voluntarii confirmați ai evenimentului: 4");
    // The pile's picture is the saved badge: a picture, drawn without a role.
    const pile = await page.request.get((await print.getByTestId("badge-print-row").locator("img").getAttribute("src")) as string);
    expect(pile.status()).toBe(200);
    expect(pile.headers()["content-type"]).toBe("image/png");
    // The sheet as it stands: the four, one A4 page.
    const download = print.getByTestId("badge-download");
    const [plain] = await Promise.all([page.waitForEvent("download"), download.click()]);
    const plainBytes = readFileSync((await plain.path()) as string).toString("latin1");
    expect(plainBytes).toContain("(4 badges)");
    // 20 and 3 spares: 23 badges, two sheets of 16.
    await print.getByTestId("badge-count").fill("20");
    await print.getByTestId("badge-spares").fill("3");
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.suggestedFilename()).toMatch(/^badges-[0-9a-f]{8}-ro\.pdf$/);
    const bytes = readFileSync((await file.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("(23 badges)");
    expect(bytes.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
    // A pile past a file's worth comes back to this page with the reason.
    await print.getByTestId("badge-count").fill("1000");
    await print.getByTestId("badge-spares").fill("1");
    await Promise.all([page.waitForURL(/badges\?refused=total$/), download.click()]);
    await hydrated(page);
    await expect(page.getByTestId("badge-print-refused")).toContainText("prea multe ecusoane");
  });

  test("a size with no room for everything ticked is refused in words, and nothing is kept (§776)", async ({ page }) => {
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
    // The size chosen comes back chosen, with its boxes shown — not the saved size with them hidden behind it.
    await expect(page.getByTestId("badge-size").getByRole("radio", { name: "Altă dimensiune" })).toBeChecked();
    await expect(page.getByLabel("Înălțimea (mm)")).toBeVisible();
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
