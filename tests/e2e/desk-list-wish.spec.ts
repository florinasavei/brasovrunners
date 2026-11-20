import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { capturedEmail } from "./support/captured-email";
import { hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-039-01, BR-REQ-037-08, BR-REQ-041-01 criterion 6, `DECISIONS.md` §1017 — the desk's eye records the runner's own spoken
 * wish (the owner, 2026-11-20: «dacă cineva are semnul ăsta de „Anonim” trebuie să îl pot schimba în „Cu nume” la click, dar cu
 * acordul lor»), walked by the desk's volunteer at 320 pixels and on a desktop against the production build:
 *
 * - «Voluntar» presses the eye «Anonim» — a thumb's 44 pixels —, the question names the person and the email, «Anulează» has the
 *   focus; «Da, a spus — afișează pe site» comes back to the row, which now says «Cu nume»;
 * - the person's email, as the server captured it, says what was recorded and carries the one-tap way back;
 * - the link, opened with nobody signed in, takes the name off in one press, and the desk says «Anonim» again;
 * - and no page of it scrolls sideways.
 *
 * The race and its runner are written straight into the database — the setup, not the subject — one per project and test, a week
 * ahead so the desk lists it, and removed after. Never a real person.
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

type Seeded = { eventId: string; registrationId: string; participantId: string; name: string; email: string };

/** A race a week away and one confirmed runner wearing number 1 who did not tick «Vreau să apar»: «Anonim» on the desk. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number, participant_list_visibility)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 5, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1, 'NAMES') RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `cu-nume-${tag}`,
      `Crosul numelor ${tag}`,
      `by-name-${tag}`,
      `The names race ${tag}`,
    ]);
    const name = `Ana Ochi ${tag}`;
    const email = `ana-ochi-${tag}@test.invalid`;
    const { rows: participants } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const participantId = participants[0].id;
    const { rows: registrations } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version,
         privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, email_confirmed_at, confirmed_at, bib_number, checkin_code)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'Ana', $4, 1, now(), false, 1, true, now(), now(), 1, $5) RETURNING id`,
      [eventId, participantId, name, `Ochi ${tag}`, deskCode()],
    );
    return { eventId, registrationId: registrations[0].id, participantId, name, email };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1 OR entity_id = $2", [seeded.registrationId, seeded.eventId]);
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  });
}

async function listOptOut(registrationId: string): Promise<boolean> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ list_opt_out: boolean }>("SELECT list_opt_out FROM registrations WHERE id = $1", [registrationId]);
    return rows[0].list_opt_out;
  });
}

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

const rowOf = (page: Page, seeded: Seeded): Locator => page.getByTestId("desk-row").filter({ hasText: seeded.name });

test.describe("§1017 BR-REQ-039-01 the desk records the runner's spoken wish to appear by name", () => {
  test.describe.configure({ timeout: 180_000 });

  test("«Anonim» pressed and confirmed shows «Cu nume»; the email's link takes the name off in one press", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await test.step("the volunteer opens the race: the eye says «Anonim», a thumb's 44 pixels", async () => {
        await signIn(page, "Dev Contributor");
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}`);
        await hydrated(page);
        const eye = rowOf(page, seeded).getByTestId("desk-site-name");
        await expect(eye).toHaveText("Anonim");
        expect((await eye.boundingBox())?.height ?? 0, "the eye is a thumb's target").toBeGreaterThanOrEqual(44);
        await fitsTheScreen(page);
      });

      await test.step("pressed, it asks first — the person by name, the email — with «Anulează» focused", async () => {
        await rowOf(page, seeded).getByTestId("desk-site-name").click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(`${seeded.name} ți-a spus acum că vrea să apară cu numele pe lista participanților și în clasament?`);
        await expect(dialog).toContainText("Numele apare pe site; persoana primește un email și poate retrage oricând.");
        await expect(dialog).toContainText(seeded.name);
        await expect(page.getByTestId("confirm-dialog-cancel")).toBeFocused();
        await expect(page.getByTestId("confirm-dialog-cancel")).toHaveText(/Anulează/);
        await fitsTheScreen(page);
        await dialog.getByRole("button", { name: "Da, a spus — afișează pe site" }).click();
      });

      await test.step("confirmed, the desk comes back to the row, which says «Cu nume»", async () => {
        await expect(page).toHaveURL(new RegExp(`[?&]row=${seeded.registrationId}&saved=listWishNamed#reg-${seeded.registrationId}$`), { timeout: 30_000 });
        await expect(rowOf(page, seeded).getByTestId("desk-site-name")).toHaveText("Cu nume");
        expect(await listOptOut(seeded.registrationId)).toBe(false);
        await fitsTheScreen(page);
      });

      let undo = "";
      await test.step("the person's email says what was recorded and carries the way back", async () => {
        await page.context().clearCookies();
        await signIn(page, "Dev Administrator");
        const mail = await capturedEmail(page, seeded.email, "La masa de ridicare a numerelor");
        expect(mail.text).toContain("ai cerut să apari cu numele pe lista participanților și în clasament");
        expect(mail.text).toContain("Dacă nu e așa, apasă butonul de mai jos");
        const link = mail.links.find((href) => /\/ro\/inregistrari\/lista\/[A-Za-z0-9_-]+/.test(href));
        expect(link, "the one-tap way back").toBeTruthy();
        undo = new URL(link!).pathname;
      });

      await test.step("the link, with nobody signed in, takes the name off in one press", async () => {
        await page.context().clearCookies();
        await page.goto(undo);
        await hydrated(page);
        await expect(page.getByText("Numele tău apare pe lista publică de participanți a acestui eveniment.")).toBeVisible();
        const press = page.getByRole("button", { name: "Nu vreau să apar pe lista de participanți & rezultate" });
        expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await press.click();
        await expect(page.getByText("Am reținut alegerea ta.")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText("Numele tău nu apare pe lista publică de participanți a acestui eveniment.")).toBeVisible();
        expect(await listOptOut(seeded.registrationId)).toBe(true);
        await fitsTheScreen(page);
      });

      await test.step("back at the desk, the eye says «Anonim» again", async () => {
        await signIn(page, "Dev Contributor");
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}`);
        await hydrated(page);
        await expect(rowOf(page, seeded).getByTestId("desk-site-name")).toHaveText("Anonim");
      });
    } finally {
      await cleanup(seeded);
    }
  });
});
