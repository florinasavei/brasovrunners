import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { readSheet } from "../helpers/xlsx";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §785 — «cum stăm cu coloana de comentarii pentru participanți? asta trebuie de asemenea să fie și în Excel!»
 * (the owner, 2026-10-15): the Excel the registrations list's button downloads ends with «Note interne». An Organizer
 * writes a note on the registration's page (the real card), a second one — whose author's account is gone — is
 * written straight into the table, and the file the button hands over is read back as a workbook: the header
 * «Note interne» last and, in the registration's cell, both lines, the newest first, each «<data> · <rolul>:
 * <text>», the role and never a name. The CSV beside it carries the same column. The row is written straight into
 * the database and removed after.
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
    const email = `note-export-${tag}@test.invalid`;
    const name = `Exportat ${tag}`;
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

/** A note written straight into the table, an hour ago, with no author: its account is gone. */
async function seedOldNote(seeded: Seeded, body: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("INSERT INTO registration_notes (registration_id, body, created_at, updated_at) VALUES ($1, $2, now() - interval '1 hour', now() - interval '1 hour')", [
      seeded.registrationId,
      body,
    ]);
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    // The notes go with the registration (ON DELETE CASCADE); its trail rows and the export's are the test's own.
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}

test.describe("§785 «Note interne» in the registrations export", () => {
  test("the Excel an Organizer downloads ends with the notes: both lines, newest first, the role and never a name", async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      const older = "A sunat, vine cu o oră mai târziu";
      const newer = "Cere tricou S și vine cu un copil";
      await seedOldNote(seeded, older);

      await signIn(page, "Dev Moderator");
      // The second note through the real card.
      await page.goto(`/ro/admin/registrations/${seeded.registrationId}`);
      await hydrated(page);
      const card = page.locator("details#note-interne");
      await card.locator("summary").click();
      await card.getByRole("textbox", { name: /Adaugă o notă/ }).fill(newer);
      await card.getByRole("button", { name: "Salvează nota" }).click();
      await expect(page).toHaveURL(new RegExp(`${seeded.registrationId}\\?saved=noteAdded#note-interne$`));
      await hydrated(page);

      // The list, filtered to the one row; the button hands over the file.
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.name)}`);
      await hydrated(page);
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#main").getByRole("link", { name: "Descarcă Excel" }).click()]);
      const { rows } = readSheet(readFileSync(await download.path()));

      const header = rows[0] as string[];
      expect(header.at(-1)).toBe("Note interne");
      const mine = rows.find((row) => row[header.indexOf("Name")] === seeded.name);
      expect(mine, "the registration's row").toBeDefined();
      const lines = (mine!.at(-1) ?? "").split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(new RegExp(`^\\d{2}\\.\\d{2}\\.\\d{4} \\d{2}:\\d{2} · Organizator: ${newer}$`));
      expect(lines[1]).toMatch(new RegExp(`^\\d{2}\\.\\d{2}\\.\\d{4} \\d{2}:\\d{2} · cont șters: ${older}$`));
      // The role, never the colleague's name.
      expect(JSON.stringify(rows)).not.toContain("Dev Moderator");

      // The CSV beside it: the same column, the same two lines inside one quoted field.
      const csv = await page.request.get(`/api/admin/registrations/export?lang=ro&eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.name)}`);
      expect(csv.status()).toBe(200);
      const text = await csv.text();
      expect(text.split("\r\n")[0].split(",").at(-1)).toBe("Note interne");
      expect(text).toContain(`· Organizator: ${newer}\n`);
      expect(text).toContain(`· cont șters: ${older}"`);
    } finally {
      await cleanup(seeded);
    }
  });

  test("the Tehnic role gets no export at all, so no notes", async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seed(`${test.info().project.name}-tehnic-${Date.now().toString(36)}`);
    try {
      await seedOldNote(seeded, "doar pentru organizatori");
      await signIn(page, "Dev Technical");
      const response = await page.request.get(`/api/admin/registrations/export?format=xlsx&eventId=${seeded.eventId}`);
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain("doar pentru organizatori");
    } finally {
      await cleanup(seeded);
    }
  });
});
