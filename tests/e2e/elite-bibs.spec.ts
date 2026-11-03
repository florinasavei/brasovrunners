import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §895, BR-REQ-038-01, BR-REQ-060-01 — «Elită — doar numele pe BIB» (the owner, 2026-11-03, «Listă separată»): the race's
 * elite runners as a list of names under «Alocare și tipărire», printed with the name where the number goes. Not
 * registrations.
 *
 * What only a browser can see here, and the unit and PGlite tests cannot: the card stands inside the event's save form,
 * so its add is a detached form wrapped around that save form (`BibPrint.tsx#EliteBibForms`) and each line's «Șterge»
 * submits a hidden, asked-first form beside it through `form=`. So, as the Administrator: a name and a number added
 * land back on the card with its fold open (`#bib-elite`) and the toast; a number already on the list is refused on its
 * box with what was typed kept; «Salvează» on the event posts nothing of the card — its required name box empty does not
 * block the save, and no line is added or doubled; the delete asks first, naming the person. As the Organizer: the list
 * and its sheet, never the add box or a delete. And a registered runner marked «Elită» (§NNN) from the registrations
 * list's «⋮» — a client menu submitting a hidden form — wears the chip, is listed «înscris» on the card and counted in
 * its sheet, and comes off from the same menu.
 *
 * The race is written straight into the database — the setup, not the subject — one per project and test, so the two
 * projects never share a row.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** A draft race taking registrations on the site — where race numbers, and so the print card, exist (§350). */
async function seedRace(tag: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name)
       VALUES ('RACE', now() + interval '60 days', 'INTERNAL', 50, 'Parcul Tractorul') RETURNING id`,
    );
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      rows[0].id,
      `elita-${tag}`,
      `Crosul elitei ${tag}`,
      `elite-${tag}`,
      `The elite race ${tag}`,
    ]);
    return rows[0].id;
  });
}

/** A confirmed runner of the race, wearing `bibNumber` — a registration, for the elite mark (§NNN). */
async function seedRunner(eventId: string, tag: string, name: string, bibNumber: number): Promise<string> {
  return withDatabase(async (client) => {
    const email = `elite-mark-${tag}@test.invalid`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at, bib_number)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now(), $4)
       RETURNING id`,
      [eventId, participantRows[0].id, name, bibNumber],
    );
    return rows[0].id;
  });
}

async function eliteMarkOf(registrationId: string): Promise<boolean> {
  return withDatabase(async (client) => (await client.query<{ elite: boolean }>(`SELECT elite FROM registrations WHERE id = $1`, [registrationId])).rows[0].elite);
}

async function eliteLines(eventId: string): Promise<{ name: string; bib_number: number | null }[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ name: string; bib_number: number | null }>(
      `SELECT name, bib_number FROM event_elite_entries WHERE event_id = $1 ORDER BY created_at, id`,
      [eventId],
    );
    return rows;
  });
}

/**
 * «Alocare și tipărire» › the elite fold, opened as a person does, with every box around it: «Participare, înscrieri și
 * regulament» › «Numere de concurs (BIB)» for the Administrator, «Participare, înscrieri și regulament» alone for the
 * Organizer, who has no settings to see (§542).
 */
async function openEliteCard(page: Page): Promise<Locator> {
  await openEditorBox(page, "Alocare și tipărire");
  const card = page.getByTestId("bib-elite");
  await openFold(card);
  return card;
}

test.describe("§895 «Elită — doar numele pe BIB»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Administrator adds, is refused a number already used, saves the event without posting a name, and deletes", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const name = `Eliud Kipchoge ${tag}`;
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    let card = await openEliteCard(page);
    await expect(card.getByTestId("bib-elite-empty")).toBeVisible();
    // The sample elite bib is the preview route's elite picture, drawn with the saved design.
    await expect(card.getByTestId("bib-elite-sample").locator("img")).toHaveAttribute("src", /[?&]elite=1(&|$)/);

    const add = card.getByTestId("bib-elite-add");
    await add.getByRole("textbox", { name: /Numele de pe BIB/ }).fill(name);
    await add.getByRole("textbox", { name: /Număr \(opțional\)/ }).fill("901");
    const press = add.getByRole("button", { name: "Adaugă pe lista de elită" });
    // A thumb's target, with its glyph (BR-REQ-041-01 criterion 6, §521).
    expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(press.locator("svg")).toHaveCount(1);
    await press.click();

    // Back on the card with the toast that says nobody was told — the card and every fold around it open (`saved=eliteAdded`).
    await expect(page.getByTestId("toast-live")).toContainText("Numele e pe lista de elită.", { timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]saved=eliteAdded#bib-elite$/);
    await hydrated(page);
    card = page.getByTestId("bib-elite");
    for (const fold of [page.locator("#box-registration"), page.getByTestId("bib-print"), card]) await expect(fold).toHaveAttribute("open", "");
    await expect(card.getByTestId("bib-elite-entry")).toHaveCount(1);
    await expect(card.getByTestId("bib-elite-entry")).toContainText(name);
    await expect(card.getByTestId("bib-elite-entry")).toContainText("nr. 901");
    expect(await eliteLines(eventId)).toEqual([{ name, bib_number: 901 }]);

    // The sheet of every elite bib: a PDF, `-elite` in its name.
    const download = card.getByTestId("bib-elite-download");
    await expect(download).toContainText("Descarcă BIB-urile de elită (1)");
    const sheet = await page.request.get((await download.getAttribute("href")) as string);
    expect(sheet.status()).toBe(200);
    expect(sheet.headers()["content-type"]).toBe("application/pdf");
    expect(sheet.headers()["content-disposition"] ?? "").toMatch(/-elite\.pdf/);

    // 901 is that line's now: a second name with it is refused on the number's box, and both boxes keep what was typed.
    const second = card.getByTestId("bib-elite-add");
    await second.getByRole("textbox", { name: /Numele de pe BIB/ }).fill("Faith Kipyegon");
    await second.getByRole("textbox", { name: /Număr \(opțional\)/ }).fill("901");
    await second.getByRole("button", { name: "Adaugă pe lista de elită" }).click();
    await expect(card.getByTestId("form-refusal")).toContainText("Numărul acesta e deja folosit la eveniment", { timeout: 30_000 });
    await expect(second.getByRole("textbox", { name: /Numele de pe BIB/ })).toHaveValue("Faith Kipyegon");
    await expect(second.getByRole("textbox", { name: /Număr \(opțional\)/ })).toHaveValue("901");
    expect(await eliteLines(eventId)).toHaveLength(1);

    // «Salvează» on the event: the card's boxes belong to their own form, so its empty, required name box does not block
    // the save, and the number typed beside it is never posted — no line added, none doubled.
    await second.getByRole("textbox", { name: /Numele de pe BIB/ }).fill("");
    await second.getByRole("textbox", { name: /Număr \(opțional\)/ }).fill("902");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/, { timeout: 30_000 });
    await hydrated(page);
    expect(await eliteLines(eventId)).toEqual([{ name, bib_number: 901 }]);
    card = await openEliteCard(page);
    await expect(card.getByTestId("bib-elite-entry")).toHaveCount(1);

    // «Șterge» asks first, naming the person, and only the dialog's own button deletes.
    const remove = card.getByTestId("bib-elite-entry").getByRole("button", { name: "Șterge" });
    expect((await remove.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await remove.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Ștergi numele de pe lista de elită?");
    await expect(dialog).toContainText(`${name} nu se mai tipărește pe BIB-urile de elită.`);
    await dialog.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("toast-live")).toContainText("Numele a fost șters de pe lista de elită.", { timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]saved=eliteDeleted#bib-elite$/);
    await hydrated(page);
    await expect(page.getByTestId("bib-elite")).toHaveAttribute("open", "");
    await expect(page.getByTestId("bib-elite").getByTestId("bib-elite-empty")).toBeVisible();
    expect(await eliteLines(eventId)).toEqual([]);
  });

  // §NNN (the owner, 2026-11-03: «ar trebui să pot marca pe cineva ca elită oricând», «Rămâne înscris»).
  test("the Administrator marks a registered runner elite from the list's «⋮» and unmarks them; the elite card lists them «înscris»", async ({ page }) => {
    const tag = `${test.info().project.name}-mark-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const name = `Ana Elita ${tag}`;
    const registrationId = await seedRunner(eventId, tag, name, 21);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    // Read inside #main: the list streams, and a copy beside it can stand there for a moment.
    const main = page.locator("#main");
    await expect(main.getByTestId("elite-chip")).toHaveCount(0);

    await main.getByRole("button", { name: `Acțiuni pentru ${name}` }).click();
    const mark = page.getByRole("menuitem", { name: "Marchează ca elită" });
    // A thumb's target with its glyph (BR-REQ-041-01 criterion 6, §521); polled, the menu grows in.
    await expect.poll(async () => (await mark.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(mark.locator("svg")).toHaveCount(1);
    await expect(page.getByRole("menuitem", { name: "Nu mai e elită" })).toHaveCount(0);
    // It asks nothing (§384): the press is the mark.
    await mark.click();
    await expect(page).toHaveURL(/[?&]saved=eliteMarked/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Marcat ca elită", { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`eventId=${eventId}`));
    await hydrated(page);
    // The row is drawn twice (table and phone list), each with its chip.
    await expect(page.locator("#main").getByTestId("elite-chip").first()).toContainText("Elită");
    expect(await eliteMarkOf(registrationId)).toBe(true);

    // The elite card lists them, read-only, and counts them in its sheet.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    const card = await openEliteCard(page);
    await expect(card.getByTestId("bib-elite-registered")).toHaveCount(1);
    await expect(card.getByTestId("bib-elite-registered")).toContainText(name);
    await expect(card.getByTestId("bib-elite-registered")).toContainText("înscris");
    await expect(card.getByTestId("bib-elite-registered")).toContainText("nr. 21");
    await expect(card.getByTestId("bib-elite-registered").getByRole("button")).toHaveCount(0);
    const download = card.getByTestId("bib-elite-download");
    await expect(download).toContainText("Descarcă BIB-urile de elită (1)");
    const sheet = await page.request.get((await download.getAttribute("href")) as string);
    expect(sheet.status()).toBe(200);
    expect(sheet.headers()["content-type"]).toBe("application/pdf");

    // And off again, from the same menu.
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    await page.locator("#main").getByRole("button", { name: `Acțiuni pentru ${name}` }).click();
    await expect(page.getByRole("menuitem", { name: "Marchează ca elită" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Nu mai e elită" }).click();
    await expect(page).toHaveURL(/[?&]saved=eliteUnmarked/, { timeout: 30_000 });
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("elite-chip")).toHaveCount(0);
    expect(await eliteMarkOf(registrationId)).toBe(false);
  });

  test("the Organizer reads the list and its sheet, and has no add box and no delete", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    await withDatabase((client) => client.query(`INSERT INTO event_elite_entries (event_id, name, bib_number) VALUES ($1, $2, 7)`, [eventId, `Faith Kipyegon ${tag}`]));
    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);

    const card = await openEliteCard(page);
    await expect(card.getByTestId("bib-elite-entry")).toHaveCount(1);
    await expect(card.getByTestId("bib-elite-entry")).toContainText(`Faith Kipyegon ${tag}`);
    await expect(card.getByTestId("bib-elite-entry")).toContainText("nr. 7");
    await expect(card.getByTestId("bib-elite-add")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Șterge" })).toHaveCount(0);
    await expect(card).toContainText("Doar un administrator adaugă sau șterge nume.");
    await expect(card.getByTestId("bib-elite-download")).toBeVisible();
  });
});
