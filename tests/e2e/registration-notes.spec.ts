import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §NNN — «Note interne» on a registration (the owner, 2026-10-15: «ca și Admins, trebuie să putem lăsa
 * comentarii pe fiecare înscriere în parte, doar pentru organizatori și administratori»), walked as an
 * Organizer, phone first. The card is closed with «nicio notă» in its line; a note is typed and saved and the
 * card comes back open with the note, its author and «1 notă» in the line; the registrations list marks the row
 * with the sticky note and the count — a 44-pixel link that opens the card — and «Șterge» asks first and takes
 * the note and the marker away. The Tehnic role does not get the registration's page at all. The row is
 * written straight into the database and removed after.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; registrationId: string; participantId: string; name: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const eventId = eventRows[0].id;
    const email = `note-${tag}@test.invalid`;
    const name = `Notat ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
         email_confirmed_at, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '3 days', false, 1,
         now() - interval '3 days', now() - interval '3 days')
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    return { eventId, registrationId: rows[0].id, participantId: participantRows[0].id, name };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    // The notes go with the registration (ON DELETE CASCADE); its trail rows are the test's own.
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}

const detailUrl = (seeded: Seeded) => `/ro/admin/registrations/${seeded.registrationId}`;
const listUrl = (seeded: Seeded) => `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.name)}`;

/** The card never widens the page: no horizontal scroll at the screen's width. */
async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("§NNN «Note interne» on a registration", () => {
  test("an Organizer adds a note, sees the card's count and the list's marker, and deletes it", async ({ page }) => {
    test.setTimeout(120_000);
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Moderator");

      // The card is there, closed, and says there is nothing in it.
      await page.goto(detailUrl(seeded));
      await hydrated(page);
      const card = page.locator("details#note-interne");
      await expect(card).toBeVisible();
      await expect(card).not.toHaveAttribute("open", "");
      await expect(card.locator("summary")).toContainText("Note interne");
      await expect(card.locator("summary")).toContainText("nicio notă");
      // No marker on a list row that has none.
      await page.goto(listUrl(seeded));
      await hydrated(page);
      await expect(page.locator('#main [data-testid="notes-mark"]')).toHaveCount(0);
      await page.goto(detailUrl(seeded));
      await hydrated(page);

      // Open it: the help, no notes yet, the form.
      await card.locator("summary").click();
      await expect(card).toHaveAttribute("open", "");
      await expect(card.getByTestId("notes-help")).toHaveText("Doar organizatorii și administratorii văd notele. Nu scrie date medicale sau alte date sensibile.");
      await expect(card.getByTestId("notes-empty")).toBeVisible();

      // Write and save: back on the card, open, with the note, who wrote it and «1 notă» in the closed line.
      const words = "Cere tricou S și vine cu un copil";
      await card.getByRole("textbox", { name: /Adaugă o notă/ }).fill(words);
      await card.getByRole("button", { name: "Salvează nota" }).click();
      await expect(page).toHaveURL(new RegExp(`${seeded.registrationId}\\?saved=noteAdded#note-interne$`));
      await hydrated(page);
      await expect(card).toHaveAttribute("open", "");
      await expect(card.getByTestId("note-body")).toHaveText(words);
      await expect(card.getByTestId("note-by")).toContainText("Dev Moderator");
      await expect(card.locator("summary")).toContainText("1 notă");
      // The words are not in the address.
      expect(page.url()).not.toContain("tricou");
      await fitsTheScreen(page);

      // The list marks the row: the sticky note and the count, a 44-pixel link that opens the card.
      await page.goto(listUrl(seeded));
      await hydrated(page);
      const mark = page.locator('#main [data-testid="notes-mark"]:visible');
      await expect(mark).toHaveCount(1);
      await expect(mark).toContainText("1 notă");
      expect((await mark.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.locator("#main")).not.toContainText("tricou");
      await mark.click();
      await expect(page).toHaveURL(new RegExp(`${seeded.registrationId}#note-interne$`));
      await hydrated(page);
      await expect(page.locator("details#note-interne")).toHaveAttribute("open", "");

      // «Șterge» asks first, then the note and the marker are gone.
      await page.getByTestId("note").getByRole("button", { name: "Șterge" }).click();
      await confirmDialog(page, "Ștergi nota?");
      await expect(page).toHaveURL(new RegExp(`${seeded.registrationId}\\?saved=noteDeleted#note-interne$`));
      await hydrated(page);
      await expect(page.locator("details#note-interne")).toHaveAttribute("open", "");
      await expect(page.getByTestId("note")).toHaveCount(0);
      await expect(page.locator("details#note-interne summary")).toContainText("nicio notă");
      await page.goto(listUrl(seeded));
      await hydrated(page);
      await expect(page.locator('#main [data-testid="notes-mark"]')).toHaveCount(0);
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });

  test("the Tehnic role gets no registration page, so no card; the Administrator sees the card", async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seed(`${test.info().project.name}-roles-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Technical");
      const response = await page.goto(detailUrl(seeded));
      expect(response?.status()).toBe(404);
      await expect(page.locator("details#note-interne")).toHaveCount(0);

      await signIn(page, "Dev Administrator");
      await page.goto(detailUrl(seeded));
      await hydrated(page);
      await expect(page.locator("details#note-interne")).toBeVisible();
    } finally {
      await cleanup(seeded);
    }
  });
});
