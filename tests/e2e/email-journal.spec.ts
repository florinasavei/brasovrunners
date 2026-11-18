import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog, confirmWithoutEmail } from "./support/confirm";
import { FEATURED, hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §912 (the design «telling the owner about every email a staff press sends», slice 1) — one press through Next
 * itself: «Anulează înscrierea» runs as a real Server Action, so the email press scope (`notifications/press.ts`, an
 * `AsyncLocalStorage` the unit tests prove over PGlite by calling the services) must reach the insert through Next's
 * own request and its drain after the response. Every row the press queued carries its cause, one press id and the
 * Administrator who pressed, and «Emailuri azi» lists the person's email under that press, with the name.
 *
 * Desktop only: one runner of its own, written straight into the database — the setup, not the subject
 * (`resend-now.spec.ts`) — and cancelled by the press under test.
 *
 * §NNN — and the same press answered «Anulează înscrierea fără email»: the question ends in two answers (the owner,
 * 2026-11-18: «vreau mereu sa confirm daca trimit un mail»), no box ticked in advance; the outlined one cancels with no
 * «Înscriere anulată» queued for the person, and the toast says the email did not leave.
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

test.describe("§912 every email a staff press queues carries the press, and «Emailuri azi» lists it", () => {
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
    // The toast after the press (slice 2): the act, then what the press queued, to how many and when — never the name.
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Înscrierea a fost anulată. Pleacă ", { timeout: 30_000 });
    await expect(toast).toContainText("„Înscriere anulată” către 1 persoană");
    await expect(toast).not.toContainText(name);

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

  test("«Anulează înscrierea fără email» cancels and queues nothing for the person, and the toast says the email did not leave (§NNN)", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = Date.now().toString(36);
    const name = `Fără email ${tag}`;
    const email = `email-skip-${tag}@test.invalid`;
    const registrationId = await seedRunner(name, email);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${registrationId}`);
    await hydrated(page);
    const cancelCard = page.getByTestId("cancel-registration");
    await openFold(cancelCard);
    await cancelCard.getByTestId("cancel-registration-form").getByRole("textbox", { name: "Motivul" }).fill("nu mai vine");
    await cancelCard.getByRole("button", { name: "Anulează înscrierea" }).click();
    // Two answers, no box: the email is the answer pressed.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Pleacă 1 email către ${name}: „Înscriere anulată”.`);
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByTestId("confirm-dialog-confirm")).toHaveText("Anulează înscrierea și trimite emailul");
    await expect(dialog.getByTestId("confirm-dialog-skip-email")).toHaveText("Anulează înscrierea fără email");
    await expect(dialog.getByTestId("confirm-dialog-cancel")).toBeFocused();
    await confirmWithoutEmail(page);
    await page.waitForURL(/saved=registrationCancelled/);
    const toast = page.getByTestId("toast");
    await expect(toast).toContainText("Înscrierea a fost anulată.", { timeout: 30_000 });
    await expect(toast).toContainText("1 email nu a plecat, cum ai ales.");

    // Cancelled, and nothing queued for the person: the outbox is where the platform captures every email it sends.
    const state = await withDatabase(async (client) => {
      const { rows: registration } = await client.query<{ status: string }>("SELECT status FROM registrations WHERE id = $1", [registrationId]);
      const { rows: queued } = await client.query<{ message_type: string }>(
        "SELECT message_type FROM email_outbox WHERE registration_id = $1 AND message_type = 'REGISTRATION_CANCELLED'",
        [registrationId],
      );
      return { status: registration[0]?.status, queued: queued.length };
    });
    expect(state).toEqual({ status: "CANCELLED", queued: 0 });
  });
});
