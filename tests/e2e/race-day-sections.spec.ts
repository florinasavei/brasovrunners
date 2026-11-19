import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-037-08, BR-REQ-041-01 criterion 6, `DECISIONS.md` §1002 — the desk's list folded by state (the owner, 2026-11-19: «Pe
 * ziua cursei trebuie să fac secțiuni collapsible în funcție de status»), walked by the desk's volunteer at 320 pixels and on a
 * desktop against the production build:
 *
 * - the sections in the table's working order, each summary «<words> (N)», a thumb's 44 pixels, «De ridicat numărul» and «Fără
 *   declarație semnată» open, the rest shut;
 * - «Marchează prezent» on a runner of the whole list comes back to that runner's row, now in «Prezenți», drawn open and in
 *   sight; «Anulează prezența» there brings them back to «De ridicat numărul»;
 * - a search by name draws only the section it found somebody in, open; a race number of a cancelled runner draws «Anulate sau
 *   expirate», open, the red line first;
 * - and no page of it scrolls sideways.
 *
 * The race and its people are written straight into the database — the setup, not the subject — one set per project and test,
 * a week ahead so the desk lists it, and removed after. Never a real person.
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

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const deskCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

type Person = { id: string; name: string };
type Seeded = { eventId: string; people: Record<"ana" | "bogdan" | "cristina" | "dan" | "elena" | "florin" | "gina" | "ion", Person>; participantIds: string[] };

/**
 * A full race a week away — the three confirmed, the declaration's hold and the open offer take its five places, so the one who
 * waits stays waiting — with one person in each state and a cancelled runner wearing number 9.
 */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 5, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `sectiuni-${tag}`,
      `Crosul secțiunilor ${tag}`,
      `sections-${tag}`,
      `The sections race ${tag}`,
    ]);
    const participantIds: string[] = [];
    const person = async (first: string, status: string, columns: { bib?: number; checkedIn?: boolean } = {}): Promise<Person> => {
      const name = `${first} Secțiuni ${tag}`;
      const email = `${first.toLowerCase()}-sectiuni-${tag}@test.invalid`;
      const { rows: participants } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      participantIds.push(participants[0].id);
      const confirmed = status === "CONFIRMED";
      const { rows: registrations } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
           results_name_consent, results_consent_version, email_confirmed_at, confirmed_at, bib_number, checkin_code, checked_in_at, waitlisted_at, hold_expires_at,
           cancelled_at, cancellation_source)
         VALUES ($1, $2, $3::registration_status, 'ro', $4, $4, $5, $6, 1, now(), false, 1,
           CASE WHEN $3 = 'PENDING_EMAIL_CONFIRMATION' THEN NULL ELSE now() END,
           CASE WHEN $3 = 'CONFIRMED' THEN now() ELSE NULL END,
           $7, $8, ${columns.checkedIn ? "now()" : "NULL"},
           CASE WHEN $3 IN ('WAITLISTED', 'WAITLIST_OFFERED') THEN now() ELSE NULL END,
           CASE WHEN $3 IN ('WAITLIST_OFFERED', 'PENDING_DECLARATION') THEN now() + interval '3 days' ELSE NULL END,
           CASE WHEN $3 = 'CANCELLED' THEN now() ELSE NULL END,
           CASE WHEN $3 = 'CANCELLED' THEN 'ADMIN'::registration_cancellation_source ELSE NULL END) RETURNING id`,
        [eventId, participants[0].id, status, name, first, `Secțiuni ${tag}`, columns.bib ?? null, confirmed ? deskCode() : null],
      );
      return { id: registrations[0].id, name };
    };
    const people = {
      ana: await person("Ana", "CONFIRMED", { bib: 1 }),
      bogdan: await person("Bogdan", "CONFIRMED", { bib: 2 }),
      cristina: await person("Cristina", "PENDING_DECLARATION"),
      dan: await person("Dan", "CONFIRMED", { bib: 3, checkedIn: true }),
      elena: await person("Elena", "PENDING_EMAIL_CONFIRMATION"),
      florin: await person("Florin", "WAITLIST_OFFERED"),
      gina: await person("Gina", "WAITLISTED"),
      ion: await person("Ion", "CANCELLED", { bib: 9 }),
    };
    return { eventId, people, participantIds };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    const ids = Object.values(seeded.people).map((person) => person.id);
    await client.query("DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[]) OR entity_id = $2", [ids, seeded.eventId]);
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [seeded.participantIds]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  });
}

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

/**
 * The page landed on the row (`#reg-<id>`): the row stands at the top of the screen, under the sticky header's clearance — or
 * the page is scrolled to its end, where no row can rise further — never left where the press happened.
 */
async function landedOn(row: Locator): Promise<void> {
  await expect
    .poll(async () =>
      row.evaluate((element) => {
        const top = Math.round(element.getBoundingClientRect().top);
        const atEnd = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1;
        return atEnd || (top >= 0 && top <= 160) ? "on the row" : `the row is ${top} px down the screen`;
      }),
    )
    .toBe("on the row");
}

/** The desk's sections, in the page's order. */
const sections = (page: Page) => page.locator('[data-testid^="desk-section-"]');
const section = (page: Page, key: string) => page.getByTestId(`desk-section-${key}`);
const summaryOf = (fold: Locator) => fold.locator(":scope > summary");
const rowOf = (fold: Locator, person: Person) => fold.getByTestId("desk-row").filter({ hasText: person.name });

test.describe("§1002 BR-REQ-037-08 the desk's list folded by state", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the sections in the working order, a check-in back on its row in «Prezenți» opened, a search opening what it found", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const { ana, dan, gina, ion } = seeded.people;
    try {
      await test.step("the volunteer opens the race: six sections, «<words> (N)», the first two open, each summary a thumb's target", async () => {
        await signIn(page, "Dev Contributor");
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}`);
        await hydrated(page);
        await expect(sections(page).locator(":scope > summary")).toHaveText([
          "De ridicat numărul (2)",
          "Fără declarație semnată (1)",
          "Prezenți (1)",
          "Adresă neconfirmată (1)",
          "Ofertă de loc deschisă (1)",
          "Pe lista de așteptare (1)",
        ]);
        // Each summary is a heading, found by its words.
        await expect(page.getByRole("heading", { level: 3, name: "De ridicat numărul (2)" })).toBeVisible();
        for (const [key, open] of [
          ["toPickUp", true],
          ["unsigned", true],
          ["checkedIn", false],
          ["addressUnconfirmed", false],
          ["offered", false],
          ["waitlisted", false],
        ] as const) {
          if (open) await expect(section(page, key), key).toHaveAttribute("open", "");
          else await expect(section(page, key), key).not.toHaveAttribute("open");
          expect((await summaryOf(section(page, key)).boundingBox())?.height ?? 0, `${key}'s summary is a thumb's 44 pixels`).toBeGreaterThanOrEqual(44);
        }
        // The cancelled runner is on no section of the whole list.
        await expect(section(page, "voided")).toHaveCount(0);
        // A shut section's rows are out of sight until it is opened: the present runner's row is there, not shown.
        await expect(rowOf(section(page, "checkedIn"), dan)).toBeHidden();
        await fitsTheScreen(page);
      });

      await test.step("«Marchează prezent» on the whole list: back on the row, in «Prezenți», opened and in sight", async () => {
        await rowOf(section(page, "toPickUp"), ana).getByRole("button", { name: "Marchează prezent", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`[?&]row=${ana.id}&saved=checkedIn#reg-${ana.id}$`), { timeout: 30_000 });
        const present = section(page, "checkedIn");
        await expect(present).toHaveAttribute("open", "");
        await expect(summaryOf(present)).toHaveText("Prezenți (2)");
        await expect(summaryOf(section(page, "toPickUp"))).toHaveText("De ridicat numărul (1)");
        const row = rowOf(present, ana);
        await expect(row).toContainText("Prezent la");
        await expect(row).toBeInViewport();
        await landedOn(row);
        await fitsTheScreen(page);
      });

      await test.step("«Anulează prezența» from «Prezenți»: back in «De ridicat numărul», open, «Prezenți» shut again", async () => {
        await hydrated(page);
        await rowOf(section(page, "checkedIn"), ana).getByRole("button", { name: "Anulează prezența", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`[?&]row=${ana.id}&saved=checkinUndone#reg-${ana.id}$`), { timeout: 30_000 });
        await expect(summaryOf(section(page, "toPickUp"))).toHaveText("De ridicat numărul (2)");
        await expect(section(page, "toPickUp")).toHaveAttribute("open", "");
        await expect(rowOf(section(page, "toPickUp"), ana)).toBeInViewport();
        await landedOn(rowOf(section(page, "toPickUp"), ana));
        await expect(summaryOf(section(page, "checkedIn"))).toHaveText("Prezenți (1)");
        await expect(section(page, "checkedIn")).not.toHaveAttribute("open");
      });

      await test.step("a search by name draws only the section it found somebody in, open", async () => {
        await hydrated(page);
        await page.getByRole("textbox", { name: "Nume, număr sau cod" }).fill(gina.name);
        await page.getByRole("button", { name: "Caută" }).click();
        await expect(page).toHaveURL(/[?&]q=/, { timeout: 30_000 });
        await expect(sections(page)).toHaveCount(1);
        await expect(section(page, "waitlisted")).toHaveAttribute("open", "");
        await expect(summaryOf(section(page, "waitlisted"))).toHaveText("Pe lista de așteptare (1)");
        await expect(rowOf(section(page, "waitlisted"), gina)).toBeVisible();
        await fitsTheScreen(page);
      });

      await test.step("a cancelled runner's number draws «Anulate sau expirate», open, the red line first", async () => {
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}&q=9`);
        await hydrated(page);
        await expect(sections(page)).toHaveCount(1);
        const voided = section(page, "voided");
        await expect(voided).toHaveAttribute("open", "");
        await expect(summaryOf(voided)).toHaveText("Anulate sau expirate (1)");
        await expect(rowOf(voided, ion).getByTestId("desk-void")).toBeVisible();
        await fitsTheScreen(page);
      });
    } finally {
      await cleanup(seeded);
    }
  });
});
