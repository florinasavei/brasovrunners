import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * «Schimbă adresa» on the registration's own page, phone first (the owner, 2026-11-11: «aparent nu pot modifica mailul
 * unei persoane???»): the card «Adresa de email» fits 320 pixels with no sideways scroll, its question says what
 * happens to the old links and — the person having given it — that the consent to offers is withdrawn, as its own
 * sentence after the statement, and a confirmed move shows the new address on the card. The rows are written straight
 * into the database and removed after.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { registrationId: string; oldEmail: string; newEmail: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const oldEmail = `adresa-veche-${tag}@test.invalid`;
    const name = `Adresa ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name, email_verified_at)
       VALUES ($1, $1, $1, 1, $2, now() - interval '3 days') RETURNING id`,
      [oldEmail, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
         email_confirmed_at, confirmed_at, promo_consent, promo_consent_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '3 days', false, 1,
         now() - interval '3 days', now() - interval '3 days', true, now() - interval '3 days')
       RETURNING id`,
      [eventRows[0].id, participantRows[0].id, name],
    );
    return { registrationId: rows[0].id, oldEmail, newEmail: `adresa-noua-${tag}@test.invalid` };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM email_outbox WHERE registration_id = $1 OR recipient_email = ANY($2)", [seeded.registrationId, [seeded.oldEmail, seeded.newEmail]]);
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE canonical_email = ANY($1)", [[seeded.oldEmail, seeded.newEmail]]);
  } finally {
    await client.end();
  }
}

test.describe("«Schimbă adresa» on the registration's page", () => {
  test("the card fits 320 pixels, its question says the consent goes, and the move shows the new address", async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await page.setViewportSize({ width: 320, height: 800 });
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations/${seeded.registrationId}`);
      await hydrated(page);

      const card = page.getByTestId("address-card");
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByTestId("address-current")).toContainText(seeded.oldEmail);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const box = card.locator('input[name="email"]');
      await box.fill(seeded.newEmail);
      await card.getByRole("button", { name: "Schimbă adresa" }).click();
      const dialog = page.getByRole("dialog", { name: "Schimbi adresa?" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Linkurile trimise la adresa veche nu mai funcționează.");
      // The consent's sentence follows the statement; the question is the title's alone.
      await expect(dialog).toContainText("cea nouă primește pasul următor. Acordul pentru oferte și beneficii se retrage");
      await cancelDialog(page, "Schimbi adresa?");

      await card.getByRole("button", { name: "Schimbă adresa" }).click();
      await confirmDialog(page, "Schimbi adresa?");
      await expect(page.getByTestId("address-current")).toContainText(seeded.newEmail, { timeout: 30_000 });
      await expect(page.getByTestId("address-changed")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await cleanup(seeded);
    }
  });
});
