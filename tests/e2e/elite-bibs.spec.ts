import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §NNN, BR-REQ-038-01, BR-REQ-060-01 — «Elită — doar numele pe BIB» (the owner, 2026-11-03, «Listă separată»): the race's
 * elite runners as a list of names under «Alocare și tipărire», printed with the name where the number goes. Not
 * registrations.
 *
 * What only a browser can see here, and the unit and PGlite tests cannot: the card stands inside the event's save form,
 * so its add is a detached form wrapped around that save form (`BibPrint.tsx#EliteBibForms`) and each line's «Șterge»
 * submits a hidden, asked-first form beside it through `form=`. So, as the Administrator: a name and a number added
 * land back on the card with its fold open (`#bib-elite`) and the toast; a number already on the list is refused on its
 * box with what was typed kept; «Salvează» on the event posts nothing of the card — its required name box empty does not
 * block the save, and no line is added or doubled; the delete asks first, naming the person. As the Organizer: the list
 * and its sheet, never the add box or a delete.
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

test.describe("§NNN «Elită — doar numele pe BIB»", () => {
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
