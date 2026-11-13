import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * «Note interne» for volunteers, walked as an Organizer at 320 pixels and on a desktop: on the «Voluntari» list the row carries
 * «Adaugă o notă» (44 pixels high, its name naming the person) and no marker; the dialog saves the note and comes back to the same
 * list address with the marker counting it; the person's page has «Note interne» as its first fold, open, the note in it; «Șterge»
 * asks first and the note and the marker go. No hydration warning, no horizontal scroll. The volunteer is written straight into the
 * database, on the sample featured event, and removed after (its notes go with it).
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; volunteerId: string; name: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const eventId = eventRows[0].id;
    const name = `Voluntar Notat ${tag}`;
    // A row the club typed, with no address: on the list only, never emailed.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, name, source, state, created_at, updated_at) VALUES ($1, $2, 'STAFF', 'REGISTERED', now(), now()) RETURNING id`,
      [eventId, name],
    );
    return { eventId, volunteerId: rows[0].id, name };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    // The notes go with the volunteer (ON DELETE CASCADE); the trail rows naming them are the test's own.
    await client.query("DELETE FROM event_volunteers WHERE id = $1", [seeded.volunteerId]);
    await client.query("DELETE FROM audit_logs WHERE metadata_json @> jsonb_build_object('volunteerId', $1::text)", [seeded.volunteerId]);
  } finally {
    await client.end();
  }
}

const personUrl = (seeded: Seeded) => `/ro/admin/volunteers/${seeded.volunteerId}`;
const listUrl = (seeded: Seeded) => `/ro/admin/volunteers?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.name)}&sort=name&dir=asc`;

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("«Note interne» for volunteers", () => {
  test("an Organizer adds a note from the «Voluntari» list, sees the marker, finds the card first and open, and deletes the note", async ({ page }) => {
    test.setTimeout(150_000);
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Moderator");

      // The list: no marker yet, «Adaugă o notă» on the row in both copies (the table and the phone cards), one visible.
      await page.goto(listUrl(seeded));
      await hydrated(page);
      await expect(page.locator('#main [data-testid="notes-mark"]')).toHaveCount(0);
      expect(await page.locator('#main [data-testid="note-add-open"]').count()).toBe(2);
      const control = page.locator('#main [data-testid="note-add-open"]:visible');
      await expect(control).toHaveCount(1);
      await expect(control).toHaveAttribute("aria-label", `Adaugă o notă la ${seeded.name}`);
      await expect(control).toHaveAttribute("href", new RegExp(`/admin/volunteers/${seeded.volunteerId}#note-interne$`));
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await fitsTheScreen(page);

      // The dialog: whose note, the help, the limit; a refusal is said at the box with the words kept.
      await control.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(`Notă internă pentru ${seeded.name}`);
      await expect(dialog).toContainText("Cel mult 2000 de caractere.");
      await dialog.getByRole("textbox", { name: /Adaugă o notă/ }).fill("   ");
      await dialog.getByRole("button", { name: "Salvează nota" }).click();
      await expect(dialog.getByTestId("form-refusal")).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: /Adaugă o notă/ })).toHaveValue("   ");
      await fitsTheScreen(page);

      // Saved: back at the same list address, the dialog gone, the toast, and the marker counts the note.
      const words = "Vine doar dimineața, are mașină";
      await dialog.getByRole("textbox", { name: /Adaugă o notă/ }).fill(words);
      await dialog.getByRole("button", { name: "Salvează nota" }).click();
      const mark = page.locator('#main [data-testid="notes-mark"]:visible');
      await expect(mark).toHaveCount(1);
      await hydrated(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Nota a fost salvată.").first()).toBeVisible();
      const address = new URL(page.url());
      expect([address.searchParams.get("eventId"), address.searchParams.get("q"), address.searchParams.get("sort")]).toEqual([seeded.eventId, seeded.name, "name"]);
      expect(page.url()).not.toContain("mașină");
      await expect(mark).toContainText("1 notă");
      expect((await mark.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.locator("#main")).not.toContainText("dimineața");
      // …and under a mouse's pointer the marker says the note's own words (§945), as the registrations list's does; away from it, gone.
      if (test.info().project.name === "desktop") {
        await mark.hover();
        await expect(page.getByRole("tooltip")).toContainText(words);
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).toHaveCount(0);
      }
      await fitsTheScreen(page);

      // The marker opens the person's page: «Note interne» is its first fold, open, the note in it.
      await mark.click();
      await expect(page).toHaveURL(new RegExp(`${seeded.volunteerId}#note-interne$`));
      await hydrated(page);
      const first = page.locator("#main details").first();
      await expect(first).toHaveAttribute("id", "note-interne");
      await expect(first).toHaveAttribute("open", "");
      await expect(first.getByTestId("note-body")).toHaveText(words);
      await expect(first.getByTestId("note-by")).toContainText("Dev Moderator");
      await expect(first.locator("summary")).toContainText("1 notă");
      await fitsTheScreen(page);

      // «Șterge» asks first; the note goes, the card stays open on «nicio notă», and the list's marker goes too.
      await first.getByRole("button", { name: "Șterge" }).click();
      await confirmDialog(page, "Ștergi nota?");
      await expect(page).toHaveURL(new RegExp(`${seeded.volunteerId}\\?saved=noteDeleted#note-interne$`));
      await hydrated(page);
      await expect(page.locator("details#note-interne")).toHaveAttribute("open", "");
      await expect(page.getByTestId("note")).toHaveCount(0);
      await expect(page.locator("details#note-interne summary")).toContainText("nicio notă");
      await page.goto(personUrl(seeded));
      await hydrated(page);
      await expect(page.locator("details#note-interne")).not.toHaveAttribute("open", "");
      await page.goto(listUrl(seeded));
      await hydrated(page);
      await expect(page.locator('#main [data-testid="notes-mark"]')).toHaveCount(0);
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
