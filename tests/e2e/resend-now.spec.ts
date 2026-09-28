import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { chooseAlternative } from "./support/confirm";
import { FEATURED, signIn } from "./support/featured-event";

/**
 * §540 (amending §513, §80, §68; the owner, 2026-09-28: «cand retrimit un mail trebuie sa am optiunea
 * de bypass la cron ca sa pot retrimite instant!») — under the scheduled timing a resend asks which:
 * «Trimite acum, fără să aștepte trecerea programată», the primary answer, or «Pune la coadă pentru
 * trecerea programată». The first leaves after the press's response and names the press on the
 * registration's trail; the second waits in the queue, as every resend did before.
 *
 * Desktop only: «Când pleacă emailurile» is one `platform_settings` row the whole server reads, and
 * the spec sets it to the scheduled pass for its own presses and puts back what it found. The
 * runner is written straight into the database — the setup, not the subject (`gdpr-data.spec.ts`).
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

/** A confirmed runner on the featured event: the registration's resend sends its confirmation. */
async function seedRunner(tag: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const email = `resend-now-${tag}@test.invalid`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, `Resend ${tag}`],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now())
       RETURNING id`,
      [eventRows[0].id, participantRows[0].id, `Resend ${tag}`],
    );
    return rows[0].id;
  });
}

test.describe("§540 a resend may leave now, past the scheduled pass", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("an Administrator sends a resend now, then queues the next one for the round", async ({ page }) => {
    test.setTimeout(90_000);
    const registrationId = await seedRunner(Date.now().toString(36));
    // The scheduled pass for this spec's presses, and whatever was stored before put back after.
    const before = await withDatabase(async (client) => {
      const { rows } = await client.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE key = 'deliveryTiming'");
      await client.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('deliveryTiming', '{"timing":"scheduled"}'::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      );
      return rows[0]?.value ?? null;
    });

    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations/${registrationId}`);
      const resend = page.getByTestId("resend-form");

      // «Trimite acum», the primary answer.
      await resend.getByRole("button", { name: "Retrimite emailul" }).click();
      const dialog = page.getByRole("dialog", { name: "Retrimiți emailul?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("confirm-dialog-alternative")).toHaveText("Pune la coadă pentru trecerea programată");
      await expect(dialog).toContainText("Deocamdată, emailurile automate pleacă la trecerea programată");
      await dialog.getByTestId("confirm-dialog-confirm").click();
      await expect(dialog).toBeHidden();
      // The banner and the toast say it leaves now; the trail names the press.
      await expect(page.getByRole("alert").filter({ hasText: "Emailul pleacă acum, fără să aștepte trecerea programată." })).toBeVisible();
      await expect(page.getByTestId("toast-live")).toContainText("Emailul pleacă acum, fără să aștepte trecerea programată.");
      await expect(page.getByText(/Trimis acum, ocolind trecerea programată/)).toBeVisible();
      // The drain after the response sent it, whatever the timing says (this suite's server captures).
      await expect
        .poll(() =>
          withDatabase(async (client) => {
            const { rows } = await client.query<{ status: string }>(
              "SELECT status FROM email_outbox WHERE registration_id = $1 AND is_manual_resend AND participant_id IS NOT NULL",
              [registrationId],
            );
            return rows.map((row) => row.status);
          }),
        )
        .toEqual(["SENT"]);

      // «Pune la coadă», the quiet one: the row waits for the round.
      await resend.getByRole("button", { name: "Retrimite emailul" }).click();
      await chooseAlternative(page, "Retrimiți emailul?");
      await expect(page.getByRole("alert").filter({ hasText: "Emailul a fost pus în coadă din nou." })).toBeVisible();
      // One toast at a time (§384): the second waits for the first to go.
      await expect(page.getByTestId("toast-live")).toContainText("Emailul a fost pus la coadă din nou.", { timeout: 15_000 });
      const queued = await withDatabase(async (client) => {
        const { rows } = await client.query<{ status: string; sent_now: boolean | null }>(
          `SELECT status, (payload_json ->> 'sentNow') = 'true' AS sent_now FROM email_outbox
           WHERE registration_id = $1 AND is_manual_resend AND participant_id IS NOT NULL ORDER BY created_at`,
          [registrationId],
        );
        return rows;
      });
      expect(queued).toHaveLength(2);
      expect(queued[1]).toMatchObject({ status: "PENDING" });
      expect(queued[1].sent_now).not.toBe(true);
    } finally {
      await withDatabase(async (client) => {
        if (before === null) await client.query("DELETE FROM platform_settings WHERE key = 'deliveryTiming'");
        else await client.query("UPDATE platform_settings SET value = $1::jsonb WHERE key = 'deliveryTiming'", [JSON.stringify(before)]);
      });
    }
  });
});
