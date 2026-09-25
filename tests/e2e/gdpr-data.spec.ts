import { createHash, randomBytes } from "node:crypto";
import { confirmDialog } from "./support/confirm";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-031-05, BR-REQ-060-01 — the data-handling pass (§322), walked in a browser.
 *
 * The unit and integration suites prove the rules; this proves the pages that carry them render
 * on a production build and answer the right roles: the emergency details open on demand for the
 * Organizer, who has no withdrawal control; the emergency sheet is theirs and a 404 for a
 * volunteer; the participant deletes their health note from their own link; and the
 * Administrator finds everything held about an address without the address entering the URL.
 *
 * The registration is written straight into the database — the setup, not the subject, as
 * `support/action-link.ts` argues — so the spec does not depend on the featured event's
 * registration window.
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

type Seeded = { eventId: string; registrationId: string; email: string; name: string; manageSecret: string };

/** A confirmed runner on the featured event, with a phone, an emergency contact and a health note. */
async function seedRunner(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>(
      "SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1",
      [FEATURED.slug],
    );
    const eventId = eventRows[0].id;
    const email = `gdpr-${tag}@test.invalid`;
    const name = `Gdpr ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const participantId = participantRows[0].id;
    const { rows: registrationRows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
         confirmed_at, phone, emergency_contact_name, emergency_contact_phone,
         health_notes, health_consent_version, health_consent_at, strava_url)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true,
         now(), '+40711111111', 'Ion Contact', '+40722222222',
         'astm, inhalator in rucsac', 1, now(), 'https://www.strava.com/athletes/12345')
       RETURNING id`,
      [eventId, participantId, name],
    );
    const registrationId = registrationRows[0].id;
    const manageSecret = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO email_action_tokens (participant_id, registration_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, 'MANAGE_REGISTRATION', $3, now() + interval '2 hours')`,
      [participantId, registrationId, createHash("sha256").update(manageSecret, "utf8").digest("hex")],
    );
    return { eventId, registrationId, email, name, manageSecret };
  });
}

const tagOf = (project: string) => `${project}-${Date.now().toString(36)}`;

test.describe("BR-REQ-031-05 the emergency details, for the people they are for (§322)", () => {
  test("the Organizer opens them on demand and prints the sheet; a volunteer gets a 404", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const runner = await seedRunner(tagOf(test.info().project.name));

    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/registrations/${runner.registrationId}`);
    await expect(page.getByRole("heading", { name: "Urgențe și sănătate" })).toBeVisible();
    // Folded: nothing is read, and nothing recorded, until somebody asks.
    await expect(page.getByText("astm, inhalator in rucsac")).toHaveCount(0);
    const show = page.getByRole("link", { name: "Arată telefonul, persoana de contact și nota medicală" });
    expect((await show.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await show.click();
    await expect(page.getByText("astm, inhalator in rucsac")).toBeVisible();
    await expect(page.getByText("+40711111111")).toBeVisible();
    await expect(page.getByText("Ion Contact · +40722222222")).toBeVisible();
    // The Organizer reads and changes nothing: no withdrawal control (§289, §15.11).
    await expect(page.getByRole("heading", { name: "Retrage consimțământul" })).toHaveCount(0);

    await page.goto(`/ro/admin/events/${runner.eventId}/urgente`);
    await expect(page.getByRole("heading", { name: /Fișă de urgență — confidențial/ })).toBeVisible();
    await expect(page.getByTestId("emergency-row").filter({ hasText: runner.name })).toContainText("astm, inhalator in rucsac");

    const volunteer = await browser.newContext();
    const desk = await volunteer.newPage();
    await signIn(desk, "Dev Contributor");
    const refused = await desk.goto(`/ro/admin/events/${runner.eventId}/urgente`);
    expect(refused?.status()).toBe(404);
    await volunteer.close();
  });

  test("the Administrator withdraws consent from the registration's page", async ({ page }) => {
    const runner = await seedRunner(tagOf(test.info().project.name));

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${runner.registrationId}`);
    await expect(page.getByRole("heading", { name: "Retrage consimțământul" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Nota medicală și acordul pentru ea" }).check();
    await page.locator('form:has([name="health"]) [name="reason"]').fill("cerere scrisă");
    await page.getByRole("button", { name: "Retrage", exact: true }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=consentWithdrawn/);

    const healthNotes = await withDatabase(async (client) => {
      const { rows } = await client.query<{ health_notes: string | null }>("SELECT health_notes FROM registrations WHERE id = $1", [
        runner.registrationId,
      ]);
      return rows[0].health_notes;
    });
    expect(healthNotes).toBeNull();
  });
});

test.describe("BR-REQ-031-05 the participant withdraws their own health note (§322)", () => {
  test("deletes it from the manage link, and the button goes with it", async ({ page }) => {
    const runner = await seedRunner(tagOf(test.info().project.name));

    await page.goto(`/ro/inregistrari/gestionare/${runner.manageSecret}`);
    await hydrated(page);
    const button = page.getByRole("button", { name: "Șterge nota medicală" });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();

    await expect(page.getByText("Am șters nota medicală și acordul pentru ea.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Șterge nota medicală" })).toHaveCount(0);
    // The socials were not touched, and their own button is still offered.
    await expect(page.getByRole("button", { name: "Șterge Strava și Instagram" })).toBeVisible();
  });
});

test.describe("BR-REQ-060-01 everything held about a person, for the Administrator (§322)", () => {
  test("finds the address by its canonical form and never puts it in the URL", async ({ page }) => {
    const runner = await seedRunner(tagOf(test.info().project.name));

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/registrations/person");
    await page.getByRole("textbox", { name: "Adresa de email" }).fill(runner.email.toUpperCase());
    await page.getByRole("button", { name: "Caută" }).click();
    await page.waitForURL(/\?q=/);

    expect(decodeURIComponent(page.url()).toLowerCase()).not.toContain(runner.email);
    await expect(page.getByRole("heading", { name: "Înscrieri (1)" })).toBeVisible();
    await expect(page.getByText("astm, inhalator in rucsac")).toBeVisible();
    await expect(page.getByRole("link", { name: "Descarcă JSON" })).toBeVisible();
  });
});
