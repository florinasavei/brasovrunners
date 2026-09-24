import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * BR-REQ-035-01, BR-REQ-041-01 — a waiting list with a limit, as a visitor reads it (§NNN), on
 * a phone and on a desktop: the room left under the button while the line has some; the full
 * sentence and no button once it is full; an event with no waiting list closed as full, without
 * mentioning one; and the registration form saying the same before anybody types.
 *
 * Each project writes its own three events straight into the database — the setup, not the
 * subject, as `support/action-link.ts` argues — so neither depends on the featured event the
 * other specs share, and the two projects never count each other's rows.
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

type Seeded = { eventId: string; slug: string };

/**
 * A published race, open for registration, with one place — taken — and `waiting` people in a
 * line of at most `limit`. Both languages, the same slug with the language after it.
 */
async function seedEvent(tag: string, limit: number, waiting: number): Promise<Seeded> {
  return withDatabase(async (client) => {
    const slug = `lista-${tag}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, waitlist_capacity, editorial_status, published_at, location_name)
       VALUES ('RACE', now() + interval '60 days', 'INTERNAL', 1, $1, 'PUBLISHED', now() - interval '1 day', 'Parcul Tractorul')
       RETURNING id`,
      [limit],
    );
    const eventId = rows[0].id;
    for (const locale of ["ro", "en"]) {
      await client.query(
        `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, $2, $3, $4, 'x')`,
        [eventId, locale, `${slug}-${locale}`, `Lista ${tag}`],
      );
    }
    const people = [{ status: "CONFIRMED" }, ...Array.from({ length: waiting }, () => ({ status: "WAITLISTED" }))];
    for (const [index, person] of people.entries()) {
      const email = `wl-${tag}-${index}@test.invalid`;
      const { rows: participant } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, 'Runner') RETURNING id`,
        [email],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
           confirmed_at, waitlisted_at)
         VALUES ($1, $2, $3::registration_status, 'ro', 'Runner', 'Runner', 1, now(), false, 1, true,
           CASE WHEN $3::text = 'CONFIRMED' THEN now() END, CASE WHEN $3::text = 'WAITLISTED' THEN now() END)`,
        [eventId, participant[0].id, person.status],
      );
    }
    return { eventId, slug };
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
    await client.query("DELETE FROM event_translations WHERE event_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids]);
  });
}

test.describe("BR-REQ-035-01 a waiting list with a limit, on the event page (§NNN)", () => {
  const created: string[] = [];
  test.afterAll(async () => removeEvents(created));

  test("says the room left, then that the line is full, then that an event with no line is closed", async ({ page }) => {
    test.setTimeout(90_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const room = await seedEvent(`${tag}-loc`, 3, 1);
    const full = await seedEvent(`${tag}-plin`, 1, 1);
    const none = await seedEvent(`${tag}-fara`, 0, 0);
    created.push(room.eventId, full.eventId, none.eventId);

    // Room left: the waiting list's button — a thumb's worth of it — and how many more it takes.
    await page.goto(`/ro/evenimente/${room.slug}-ro`);
    const join = page.getByRole("link", { name: "Intră pe lista de așteptare" });
    await expect(join).toBeVisible();
    expect((await join.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("waitlist-room")).toHaveText("Mai sunt 2 locuri pe lista de așteptare");
    await page.goto(`/en/events/${room.slug}-en`);
    await expect(page.getByTestId("waitlist-room")).toHaveText("2 places left on the waiting list");

    // Full: the sentence, and no button at all.
    await page.goto(`/ro/evenimente/${full.slug}-ro`);
    await expect(page.getByTestId("registration-full")).toHaveText("Locurile și lista de așteptare sunt pline.");
    await expect(page.getByRole("link", { name: "Intră pe lista de așteptare" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Înscrie-te la eveniment" })).toHaveCount(0);
    await page.goto(`/en/events/${full.slug}-en`);
    await expect(page.getByTestId("registration-full")).toHaveText("The places and the waiting list are full.");
    await expect(page.getByRole("link", { name: "Join the waiting list" })).toHaveCount(0);

    // No waiting list: closed as full, and no word about a line.
    await page.goto(`/ro/evenimente/${none.slug}-ro`);
    const closed = page.getByTestId("registration-full");
    await expect(closed).toHaveText("Toate locurile au fost ocupate, așa că înscrierile s-au închis.");
    await expect(page.getByRole("link", { name: "Intră pe lista de așteptare" })).toHaveCount(0);

    // The form, reached by its address, says the same before anybody types.
    await page.goto(`/ro/evenimente/${full.slug}-ro/inscriere`);
    await expect(page.getByTestId("registration-full-notice")).toHaveText("Locurile și lista de așteptare sunt pline.");

    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
