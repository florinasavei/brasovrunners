import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §663 (amending §650, §76, §83) — «Email respins» says which email, when and why. The owner,
 * 2026-10-04, on rows «Confirmată» kept by the rejected-email filter: «Cum poți să nu fi primit mail
 * dar să fii și confirmat? Adaugă tooltips și informații». A confirmed registration whose race-number
 * email bounced: the filter «Doar cu un email respins» keeps it, the chip is a client island that
 * hydrates without a warning, opens its tooltip on keyboard focus and on a tap, and its accessible
 * name says the sentences once — no `aria-describedby` repeating them. The registration's page says
 * the same under the address. The rows are written straight into the database and removed after.
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
    const email = `respins-${tag}@test.invalid`;
    const name = `Respins ${tag}`;
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
    await client.query(
      `INSERT INTO email_outbox (registration_id, participant_id, message_type, locale, recipient_email, payload_json,
         idempotency_key, status, last_error, created_at, sent_at)
       VALUES ($1, $2, 'BIB_ASSIGNED', 'ro', $3, '{}'::jsonb, $4, 'BOUNCED', '550 5.1.1 mailbox unavailable',
         now() - interval '1 day', now() - interval '1 day')`,
      [rows[0].id, participantRows[0].id, email, `e2e-respins-${tag}`],
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
    // The outbox row goes with the registration (ON DELETE CASCADE).
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}

test.describe("§663 «Email respins» says which email, when and why", () => {
  test("a confirmed row whose race-number email bounced: the filter keeps it, the chip opens on focus and says it once", async ({ page }) => {
    test.setTimeout(90_000);
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&bounced=1&q=${encodeURIComponent(seeded.name)}`);
      await hydrated(page);
      const main = page.locator("#main");
      await expect(main.getByTestId("registrations-filter-bounced").getByRole("checkbox", { name: "Doar cu un email respins" })).toBeChecked();
      await expect(main.getByRole("link", { name: `Deschide înscrierea lui ${seeded.name}`, exact: true })).toBeVisible();

      const chip = main.locator('[data-testid="email-rejected"]:visible');
      await expect(chip).toHaveCount(1);
      // One channel: the name holds the label, the sentences and the reason; nothing describes it again.
      await expect(chip).toHaveAttribute("aria-label", /^Email respins\. Respins: „/);
      // The email by its «Emailuri» name, never the message type.
      await expect(chip).toHaveAttribute("aria-label", /„Numărul de concurs dat de mână”, trimis /);
      const name = (await chip.getAttribute("aria-label")) ?? "";
      expect(name).toContain("Sună persoana");
      expect(name).toContain("Motivul dat de furnizor: 550 5.1.1 mailbox unavailable");
      expect(name).not.toContain("..");
      const box = await chip.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      await chip.focus();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText("Adresa a fost confirmată");
      await expect(tooltip).toContainText("Sună persoana");
      await expect(chip).not.toHaveAttribute("aria-describedby", /.+/);
      await expect(chip).not.toHaveAttribute("aria-labelledby", /.+/);

      // The registration's page: the same chip beside the name, the same words under the address.
      await page.goto(`/ro/admin/registrations/${seeded.registrationId}`);
      await hydrated(page);
      await expect(page.locator('#main [data-testid="email-rejected"]:visible')).toHaveCount(1);
      await expect(page.locator("#main")).toContainText("un email trimis după aceea a fost respins");
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
