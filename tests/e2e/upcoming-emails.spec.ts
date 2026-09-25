import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN — "Următoarele emailuri automate" on `/admin/emails`: the reminders the job will send are
 * listed ahead of time, each with its event (a link to the editor) and its message (a link to the
 * preview card further down).
 *
 * The sample events take no registration (every seeded one is `NONE`, §28) and the sample race is
 * three weeks out, past the fourteen-day horizon; so the spec adds its own: a draft event three
 * days out — invisible on the public site, so no other spec meets it — with one confirmed
 * registration. It is removed afterwards, whatever happened. Desktop only: one database, and the
 * rows are not the phone's to check.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const DAY = 24 * 60 * 60_000;

test.describe("§NNN the upcoming automatic emails on /admin/emails", () => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Proba emailuri automate ${suffix}`;
  let eventId = "";
  let participantId = "";

  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "one database; the rows are checked once");
    const now = Date.now();
    await withClient(async (client) => {
      const event = await client.query<{ id: string }>(
        `INSERT INTO events (type, starts_at, registration_mode, editorial_status, location_name, confirmation_opens_days_before)
         VALUES ('RACE', $1, 'INTERNAL', 'DRAFT', 'Parcul Tractorul', 0) RETURNING id`,
        [new Date(now + 3 * DAY)],
      );
      eventId = event.rows[0].id;
      await client.query(
        `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`,
        [eventId, `proba-emailuri-${suffix}`, title, `automatic-emails-${suffix}`, `Automatic emails check ${suffix}`],
      );
      const address = `forecast-${suffix}@example.test`;
      const participant = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, 'Ana Forecast') RETURNING id`,
        [address],
      );
      participantId = participant.rows[0].id;
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, confirmed_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', 'Ana Forecast', 'Ana F.', 1, $3, false, 1, $3)`,
        [eventId, participantId, new Date(now - 2 * DAY)],
      );
    });
  });

  test.afterEach(async () => {
    if (!eventId) return;
    await withClient(async (client) => {
      await client.query("DELETE FROM email_outbox WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = $1)", [eventId]);
      await client.query("DELETE FROM registrations WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM participants WHERE id = $1", [participantId]);
      await client.query("DELETE FROM event_translations WHERE event_id = $1", [eventId]);
      await client.query("DELETE FROM events WHERE id = $1", [eventId]);
    });
  });

  test("lists the event's reminder, links to its editor and to the message's preview", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const panel = page.locator("#main").getByTestId("upcoming-emails");
    // Closed by default (§336), directly above the messages it links to.
    await expect(panel).not.toHaveAttribute("open", "");
    await expect(panel.locator(":scope > summary")).toContainText(/trimiter/);
    const order = await page.locator("#main details[id]").evaluateAll((folds) => folds.map((fold) => fold.id));
    expect(order.indexOf("upcoming-emails")).toBe(order.indexOf("participant-emails") - 1);

    await openFold(panel);
    const rows = panel.getByTestId("upcoming-email").filter({ hasText: title });
    // The reminder a day from now, and the race number when registration closes at the start (§214).
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveAttribute("data-type", "BIB_ASSIGNED");
    const row = rows.first();
    await expect(row).toHaveAttribute("data-type", "EVENT_REMINDER");
    await expect(row.getByTestId("upcoming-email-recipients")).toHaveText("1 destinatar acum");
    await expect(row.getByTestId("upcoming-email-event")).toHaveAttribute("href", `/ro/admin/events/${eventId}`);

    // The message links to its preview card, which opens where it is.
    await row.getByTestId("upcoming-email-type").click();
    await expect(page).toHaveURL(/#email-EVENT_REMINDER$/);
    await expect(page.locator("#email-EVENT_REMINDER")).toHaveAttribute("open", "");

    // The club-copy line, with the way to the panel that sets it.
    await expect(panel.getByTestId("upcoming-emails-club-copy")).toContainText("Copie club");
  });

  test("says the same in English", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/en/admin/emails");
    const panel = page.locator("#main").getByTestId("upcoming-emails");
    await openFold(panel);
    const row = panel.getByTestId("upcoming-email").filter({ hasText: `Automatic emails check ${suffix}` }).and(page.locator('[data-type="EVENT_REMINDER"]'));
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("upcoming-email-recipients")).toHaveText("1 recipient now");
  });
});
