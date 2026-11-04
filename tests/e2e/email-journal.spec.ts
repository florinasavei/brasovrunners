import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { FEATURED, hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN (the design «telling the owner about every email a staff press sends», slice 1) — one press through Next
 * itself: «Anulează înscrierea» runs as a real Server Action, so the email press scope (`notifications/press.ts`, an
 * `AsyncLocalStorage` the unit tests prove over PGlite by calling the services) must reach the insert through Next's
 * own request and its drain after the response. Every row the press queued carries its cause, one press id and the
 * Administrator who pressed, and «Emailuri azi» lists the person's email under that press, with the name.
 *
 * Desktop only: one runner of its own, written straight into the database — the setup, not the subject
 * (`resend-now.spec.ts`) — and cancelled by the press under test.
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

/** A confirmed runner on the featured event, with no email queued yet: every row about it is the press's. */
async function seedRunner(name: string, email: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now())
       RETURNING id`,
      [eventRows[0].id, participantRows[0].id, name],
    );
    return rows[0].id;
  });
}

test.describe("§NNN every email a staff press queues carries the press, and «Emailuri azi» lists it", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one runner, cancelled once");
  });

  test("an Administrator's «Anulează înscrierea» stamps its email, and the day's list names the press and the person", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = Date.now().toString(36);
    const name = `Jurnal ${tag}`;
    const email = `email-journal-${tag}@test.invalid`;
    const registrationId = await seedRunner(name, email);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${registrationId}`);
    await hydrated(page);
    const cancelCard = page.getByTestId("cancel-registration");
    await openFold(cancelCard);
    await cancelCard.getByRole("textbox", { name: "Motivul" }).fill("nu mai vine");
    await cancelCard.getByRole("button", { name: "Anulează înscrierea" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=registrationCancelled/);

    // Every row about the runner is the press's: its cause, one id, and the Administrator as the requester.
    const stamps = await withDatabase(async (client) => {
      const { rows } = await client.query<{ message_type: string; cause: string | null; press_id: string | null; by: string | null }>(
        `SELECT e.message_type, e.cause, e.press_id, s.display_name AS by
           FROM email_outbox e LEFT JOIN staff_users s ON s.id = e.requested_by_staff_user_id
          WHERE e.registration_id = $1 ORDER BY e.created_at`,
        [registrationId],
      );
      return rows;
    });
    expect(stamps.map((row) => row.message_type)).toContain("REGISTRATION_CANCELLED");
    for (const row of stamps) expect(row, row.message_type).toMatchObject({ cause: "registrations.cancel", by: "Dev Administrator" });
    expect(stamps[0].press_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(stamps.map((row) => row.press_id)).size).toBe(1);

    // «Emailuri azi»: the press with its words and who pressed, the person by name and address.
    await page.goto("/ro/admin/settings/emails/today");
    await expect(page.getByTestId("email-journal-summary")).toContainText("Emailuri azi");
    const press = page.getByTestId("email-journal-press").filter({ hasText: email });
    await expect(press).toHaveCount(1);
    await expect(press.getByTestId("email-journal-press-head")).toContainText("Anulează înscrierea · de Dev Administrator");
    await expect(press).toContainText(`${name} · ${email}`);
    await expect(press).toContainText("„Înscriere anulată”");
  });
});
