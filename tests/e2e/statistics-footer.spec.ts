import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { readSheet, startListRows } from "../helpers/xlsx";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §787 (amends §172 and §581) — «the Excel should have a statistics footer so that I can show „how many Brașov
 * Runners”, how many active, etc., grouped by category» (the owner, 2026-10-15). The button on the registrations
 * list hands over the Excel of an event with registrations in every shape the footer tells apart; the file is read
 * back as a workbook and the «Statistici» block under the table — after one empty row — says the counts: the
 * states, the club's runners, the categories, with a test registration in none of them. The English file says the
 * same in English, and the CSV beside it carries no footer.
 *
 * The event and its registrations are written straight into the database — the setup, not the subject, as
 * `export-diacritics.spec.ts` argues — and removed afterwards, so no other spec's counts change.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

const TITLE = "Cursa Cifrelor";

type Seeded = { eventId: string; participantIds: string[] };

/** A birth date that makes the person `years` old on the race day, 60 days from now, with a month to spare either side. */
const BORN = (years: number) => `(CURRENT_DATE + 60 - interval '${years} years' - interval '30 days')::date`;

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, surface, starts_at, timezone, capacity, registration_mode, editorial_status, published_at)
       VALUES ('RACE', 'ASPHALT', now() + interval '60 days', 'Europe/Bucharest', 50, 'INTERNAL', 'PUBLISHED', now() - interval '1 day')
       RETURNING id`,
    );
    const eventId = eventRows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $4), ($1, 'en', $3, $4)`, [eventId, `cifre-${tag}-ro`, `figures-${tag}-en`, TITLE]);

    const participantIds: string[] = [];
    const people: Array<{ status: string; sex: string; born: string; club?: string; declared?: boolean; kind?: string }> = [
      { status: "CONFIRMED", sex: "FEMALE", born: BORN(25), declared: true },
      { status: "CONFIRMED", sex: "MALE", born: BORN(35), club: "Runners Brașov" },
      { status: "CONFIRMED", sex: "FEMALE", born: BORN(25) },
      { status: "PENDING_EMAIL_CONFIRMATION", sex: "MALE", born: BORN(35) },
      { status: "WAITLISTED", sex: "FEMALE", born: BORN(52) },
      { status: "CANCELLED", sex: "MALE", born: "NULL" },
      // A test registration behaves like a real one and is in no count the club is given.
      { status: "CONFIRMED", sex: "FEMALE", born: BORN(25), declared: true, kind: "TEST" },
    ];
    for (const [index, person] of people.entries()) {
      const email = `cifre-${tag}-${index}@test.invalid`;
      const name = `Cifre ${tag} ${index}`;
      const { rows: participantRows } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      participantIds.push(participantRows[0].id);
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, kind, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, confirmed_at,
           waitlisted_at, sex, birth_date, club_name, club_member_declared)
         VALUES ($1, $2, $3, $4, 'ro', $5, $5, 'PUBLIC', 1, now(), false, 1, $6, $7, $8, ${person.born}, $9, $10)`,
        [
          eventId,
          participantRows[0].id,
          person.status,
          person.kind ?? "REAL",
          name,
          person.status === "CONFIRMED" ? new Date() : null,
          person.status === "WAITLISTED" ? new Date() : null,
          person.sex,
          person.club ?? null,
          person.declared ?? false,
        ],
      );
    }
    return { eventId, participantIds };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [seeded.participantIds]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM event_translations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  } finally {
    await client.end();
  }
}

/** The sheet's rows from the footer's title on, empty rows kept as `[]`. */
function footerOf(rows: (string | undefined)[][], title: string) {
  const at = rows.findIndex((row) => row?.[0] === title);
  expect(at, `the «${title}» block under the table`).toBeGreaterThan(0);
  return Array.from({ length: rows.length - at }, (_, index) => rows[at + index] ?? []);
}

test.describe("§787 «Statistici» under the registrations Excel", () => {
  test("the Excel the list's button downloads ends with the statistics: states, club, categories, no test row", async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}`);
      await hydrated(page);
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#main").getByRole("link", { name: "Exportă Excel" }).click()]);
      const { rows } = readSheet(readFileSync(await download.path()));

      // Six real registrations in the table; the footer starts after one empty row.
      expect(startListRows(rows)).toHaveLength(1 + 6);
      expect(rows[7]).toBeUndefined();
      expect(rows[8]).toEqual(["Statistici"]);
      const footer = footerOf(rows, "Statistici");
      expect(footer.slice(1, 16)).toEqual([
        ["Total", "6"],
        ["Confirmați (activi)", "3"],
        ["Așteaptă confirmarea adresei", "1"],
        ["Așteaptă semnarea declarației", "0"],
        ["Pe lista de așteptare", "1"],
        ["Au o ofertă de loc", "0"],
        ["Anulați", "1"],
        ["Expirați", "0"],
        ["Brașov Runners", "2"],
        ["Brașov Runners, confirmați", "2"],
        // The tick alone (§796): one of the two club runners ticked the box.
        ["Au bifat că sunt membri Brașov Runners", "1"],
        ["Alții, nu Brașov Runners", "4"],
        // The special guests (§643): none in this race, so the confirmed part of the places line is all the confirmed (§615).
        ["Invitați speciali", "0"],
        ["Invitați speciali, confirmați", "0"],
        ["Confirmați care ocupă un loc", "3"],
      ]);
      const at = footer.findIndex((row) => row[0] === "Categorie");
      expect(footer.slice(at, at + 5)).toEqual([
        ["Categorie", "Total", "Confirmați (activi)", "Brașov Runners", "Brașov Runners, confirmați"],
        ["Feminin, 18-29 ani", "2", "2", "1", "1"],
        ["Feminin, 50-59 ani", "1", "0", "0", "0"],
        ["Masculin, 30-39 ani", "2", "1", "1", "1"],
        ["Fără categorie", "1", "0", "0", "0"],
      ]);

      // The same file in English, from the same route the English page's button asks.
      const english = await page.request.get(`/api/admin/registrations/export?eventId=${seeded.eventId}&format=xlsx&lang=en`);
      expect(english.status()).toBe(200);
      const inEnglish = footerOf(readSheet(Buffer.from(await english.body())).rows, "Statistics");
      expect(inEnglish.slice(1, 4)).toEqual([["Total", "6"], ["Confirmed (active)", "3"], ["Waiting for the address to be confirmed", "1"]]);
      expect(inEnglish.map((row) => row[0])).toContain("Female, 18-29");

      // The CSV beside it is rows only: a footer would be read as registrations.
      const csv = await page.request.get(`/api/admin/registrations/export?eventId=${seeded.eventId}`);
      expect(csv.status()).toBe(200);
      const text = await csv.text();
      expect(text).not.toMatch(/Statistici|Categorie|Alții/);
      expect(text.trimEnd().split("\r\n")).toHaveLength(1 + 6);
    } finally {
      await cleanup(seeded);
    }
  });
});
