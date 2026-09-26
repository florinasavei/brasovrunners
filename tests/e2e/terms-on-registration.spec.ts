import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, signIn } from "./support/featured-event";

/**
 * §NNN — the terms a runner accepted expressly on the form (§421), where the club reads them: a
 * line on the registration's page in the same shape as the privacy notice's, and the export's
 * last two columns. A staff entry says the paper carries the terms, and its cells are blank.
 *
 * The registrations are written straight into the database — the setup, not the subject, as
 * `gdpr-data.spec.ts` argues — so the spec does not depend on the featured event's window.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

const ACCEPTED_AT = "2026-09-25T10:00:00.000Z";

type Seeded = { eventId: string; publicId: string; staffId: string; tag: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>(
      "SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1",
      [FEATURED.slug],
    );
    const eventId = eventRows[0].id;
    const insert = async (who: string, source: "PUBLIC" | "STAFF", termsVersion: number | null, termsAcceptedAt: string | null) => {
      const email = `terms-${who}-${tag}@test.invalid`;
      const name = `Termeni ${who} ${tag}`;
      const { rows: participantRows } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, terms_version, terms_accepted_at,
           results_name_consent, results_consent_version, list_opt_out, confirmed_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, $4, 1, $5, $6, $7, false, 1, true, now())
         RETURNING id`,
        [eventId, participantRows[0].id, name, source, ACCEPTED_AT, termsVersion, termsAcceptedAt],
      );
      return rows[0].id;
    };
    const publicId = await insert("public", "PUBLIC", 1, ACCEPTED_AT);
    const staffId = await insert("staff", "STAFF", null, null);
    return { eventId, publicId, staffId, tag };
  } finally {
    await client.end();
  }
}

test.describe("§NNN the accepted terms on the registration's page and in the export", () => {
  test("the page names the notice's and the terms' versions; the CSV carries the terms in its last two columns", async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${seeded.publicId}`);
    await expect(page.getByTestId("timeline-privacy-notice")).toContainText("Nota de informare luată la cunoștință:");
    await expect(page.getByTestId("timeline-privacy-notice")).toContainText("(v1)");
    await expect(page.getByTestId("timeline-terms")).toContainText("Termenii și condițiile acceptați expres:");
    await expect(page.getByTestId("timeline-terms")).toContainText("(v1)");

    await page.goto(`/ro/admin/registrations/${seeded.staffId}`);
    await expect(page.getByTestId("timeline-terms")).toHaveText("Termenii și condițiile: pe hârtie — înscriere adăugată de echipă");

    const response = await page.request.get(`/api/admin/registrations/export?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
    expect(response.status()).toBe(200);
    const [header, ...lines] = (await response.text()).split("\r\n");
    expect(header.split(",").slice(-2)).toEqual(["Terms version", "Terms accepted"]);
    const publicLine = lines.find((line) => line.includes("Termeni public"));
    const staffLine = lines.find((line) => line.includes("Termeni staff"));
    expect(publicLine?.split(",").slice(-2)).toEqual(["1", ACCEPTED_AT]);
    expect(staffLine?.split(",").slice(-2)).toEqual(["", ""]);
  });
});
