import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §NNN — the registrations list's bulk cancel says how many it will email.
 *
 * The ticks exist only in the browser, so the server hands the dialog what each row adds and the
 * dialog sums the ticked ones at the press: a real registration the cancel can reach is one
 * email; one whose address was never confirmed has no edge to CANCELLED and is refused, emailing
 * nobody; a test row is emailed but counted nowhere the club is given (§30). The toast afterwards
 * states the same number, from the rows the service actually cancelled.
 *
 * Each project writes its own event straight into the database — the setup, not the subject, as
 * `support/action-link.ts` argues — so the two never tick each other's rows.
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

type Person = { status: string; kind: "REAL" | "TEST" };

async function seedEvent(tag: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, editorial_status, published_at, location_name)
       VALUES ('RACE', now() + interval '20 days', 'INTERNAL', 10, 'PUBLISHED', now() - interval '1 day', 'Parcul Tractorul')
       RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'x')`, [
      eventId,
      `anulare-${tag}`,
      `Cursa anulărilor ${tag}`,
    ]);
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'en', $2, $3, 'x')`, [
      eventId,
      `cancel-${tag}`,
      `Cancel race ${tag}`,
    ]);
    const people: Person[] = [
      { status: "CONFIRMED", kind: "REAL" },
      { status: "WAITLISTED", kind: "REAL" },
      { status: "PENDING_EMAIL_CONFIRMATION", kind: "REAL" },
      { status: "CONFIRMED", kind: "TEST" },
    ];
    for (const [index, person] of people.entries()) {
      const email = `bulk-${tag}-${index}@test.invalid`;
      const { rows: participant } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, `Alergător ${index}`],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, kind, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
           confirmed_at, waitlisted_at)
         VALUES ($1, $2, $3::registration_status, $4::registration_kind, 'ro', $5, $5, 1, now(), false, 1, true,
           CASE WHEN $3::text = 'CONFIRMED' THEN now() END,
           CASE WHEN $3::text = 'WAITLISTED' THEN now() END)`,
        [eventId, participant[0].id, person.status, person.kind, `Anulat ${tag} ${index}`],
      );
    }
    return eventId;
  });
}

async function removeEvents(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ participant_id: string }>(
      "DELETE FROM registrations WHERE event_id = ANY($1::uuid[]) RETURNING participant_id",
      [ids],
    );
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [rows.map((row) => row.participant_id)]);
    await client.query("DELETE FROM audit_logs WHERE entity_type = 'event' AND entity_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM event_translations WHERE event_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids]);
  });
}

test.describe("§NNN the bulk cancel counts the emails it will send", () => {
  const created: string[] = [];
  test.afterAll(async () => removeEvents(created));

  test("the dialog sums the ticked real rows it can cancel, and the toast says the same number", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedEvent(tag);
    created.push(eventId);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    const main = page.locator("#main");
    const tick = (index: number) => main.getByRole("checkbox", { name: `Selectează înscrierea lui Anulat ${tag} ${index}` });
    const panel = main.locator("details").filter({ has: page.getByText("Anulează înscrierile bifate", { exact: true }) });
    await panel.locator(":scope > summary").click();
    const press = () => panel.getByRole("button", { name: "Anulează cele bifate" }).click();
    const dialog = page.getByRole("dialog", { name: "Anulezi înscrierile bifate?" });

    // One real, confirmed row: one email.
    await tick(0).check();
    await press();
    await expect(dialog.getByTestId("confirm-email")).toHaveText("Se va trimite un email către 1 participant.");
    await cancelDialog(page, "Anulezi înscrierile bifate?");

    // All four: the waiting-list row adds one; the unconfirmed address and the test row add nobody.
    for (const index of [1, 2, 3]) await tick(index).check();
    await press();
    await expect(dialog.getByTestId("confirm-email")).toHaveText("Se va trimite un email către 2 participanți.");
    await cancelDialog(page, "Anulezi înscrierile bifate?");

    // Only the rows that email nobody the club counts: no email line at all.
    await tick(0).uncheck();
    await tick(1).uncheck();
    await press();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("confirm-email")).toHaveCount(0);
    await cancelDialog(page, "Anulezi înscrierile bifate?");

    // Through it: the toast counts the real rows cancelled, the same two.
    for (const index of [0, 1]) await tick(index).check();
    await panel.locator('input[name="reason"]').fill("Test automat");
    await press();
    await confirmDialog(page, "Anulezi înscrierile bifate?");
    await expect(page.getByTestId("toast")).toContainText("2 înscrieri anulate; 2 emailuri puse la coadă.", { timeout: 30_000 });
  });
});
