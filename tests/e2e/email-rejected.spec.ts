import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §NNN (amending §663, §650; the data decision §NNN) — «Email respins» drawn where the club looks, phone
 * first. The owner, 2026-10-07, on two «Confirmată» cards each with «Email respins»: «Cum e posibil să fie
 * email respins dar și confirmat? Am nevoie de mai multe info in app». A confirmed registration whose
 * race-number email the address refused: the filter «Doar cu un email respins (n)» keeps it, the card says
 * in one line under the name which email, why and when — a plain 44-pixel link, no tooltip island — and the
 * link opens the registration's «Emailuri», open by itself, with the whole story and the provider's small
 * print; under the address the place is said to stay. The rows are written straight into the database and
 * removed after.
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
         idempotency_key, status, last_error, provider_detail, rejection_cause, rejected_at, created_at, sent_at)
       VALUES ($1, $2, 'BIB_ASSIGNED', 'ro', $3, '{}'::jsonb, $4, 'BOUNCED', '550 5.1.1 mailbox unavailable',
         '550 5.1.1 mailbox unavailable', 'no-such-address', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day')`,
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

test.describe("§NNN «Email respins» says which email, why and what to do, where the club looks", () => {
  test("a confirmed row whose race-number email was refused: one line under the name, a link to «Emailuri»", async ({ page }) => {
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
      // The tick says how many it keeps.
      await expect(main.getByTestId("registrations-filter-bounced").getByRole("checkbox", { name: /^Doar cu un email respins \(\d+\)$/ })).toBeChecked();
      await expect(main.getByRole("link", { name: `Deschide înscrierea lui ${seeded.name}`, exact: true })).toBeVisible();

      // One line under the name: the cause, the email's short name, the day — a link, never a chip with a tooltip.
      const line = main.locator('[data-testid="email-state-line"]:visible');
      await expect(line).toHaveCount(1);
      // Each part unbreakable (non-breaking spaces inside it): `\s` reads both.
      await expect(line).toHaveText(/^Adresa\snu\sexistă\s·\sNumărul\sde\sconcurs\s·\s/);
      await expect(line).toHaveAttribute("href", /#emailuri$/);
      await expect(main.locator('[data-testid="email-rejected"]')).toHaveCount(0);
      // No list carries the provider's words.
      await expect(line).not.toContainText("550");
      const box = await line.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      // At a phone's width it wraps between parts, two lines at most.
      if ((page.viewportSize()?.width ?? 1280) < 600) expect(box?.height ?? 0).toBeLessThanOrEqual(64);
      await line.focus();
      await expect(page.getByRole("tooltip")).toHaveCount(0);

      // The link opens the registration's «Emailuri», open by itself while somebody must act.
      await line.click();
      await expect(page).toHaveURL(new RegExp(`/ro/admin/registrations/${seeded.registrationId}#emailuri$`));
      await hydrated(page);
      const section = page.locator("details#emailuri");
      await expect(section).toHaveAttribute("open", "");
      await expect(section).toContainText("Respins: „Numărul de concurs dat de mână”");
      await expect(section).toContainText("Serverul destinatarului spune că adresa nu există.");
      await expect(section).toContainText("Motivul dat de furnizor: 550 5.1.1 mailbox unavailable");
      await expect(section).toContainText("Numărul de concurs · către participant");
      await expect(section).toContainText("Trimis = predat furnizorului de email.");
      // Under the address: the same line, and the place stays — never «a new registration» on a confirmed one.
      const todo = page.getByTestId("email-state-todo");
      await expect(todo).toContainText("Locul rămâne confirmat; la masă îl găsiți după nume.");
      await expect(todo).not.toContainText("înscriere nouă");
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
