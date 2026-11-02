import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §888 (BR-REQ-037-05, BR-REQ-034-02, BR-REQ-060-01) — the owner, 2026-11-01: the internal list is notes, the
 * official waiting list the real queue, told apart in one read on a phone at 320 px; a line moves from the first
 * to the second in one press («Mută pe lista oficială»), or is offered a place at once («Oferă-i un loc acum»),
 * each dialog naming the address and asking for the relay tick itself.
 *
 * The event, its one confirmed runner and the two lines are written straight into the database — the setup, not
 * the subject (`hidden-list.spec.ts`) — one event per project and run, so the two projects never share a row.
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

type Seeded = { eventId: string; mara: string; luca: string };

/** A full race (one place, one confirmed runner) and two people on its internal list, each with an address and a note. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 1, 'Parcul Tractorul', 'PUBLISHED', now()) RETURNING id`,
    );
    const eventId = eventRows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      eventId,
      `lista-interna-${tag}`,
      `Crosul listei ${tag}`,
      `internal-list-${tag}`,
      `The list race ${tag}`,
    ]);
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [`list-full-${tag}@test.invalid`, `Plin ${tag}`],
    );
    await client.query(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now())`,
      [eventId, participantRows[0].id, `Plin ${tag}`],
    );
    const insertLine = async (first: string) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO event_reserve_entries (event_id, first_name, last_name, email, note) VALUES ($1, $2, $3, $4, 'a scris pe formularul de contact') RETURNING id`,
          [eventId, first, `Lista${tag.replace(/[^a-z0-9]/gi, "")}`, `${first.toLowerCase()}-${tag}@test.invalid`],
        )
      ).rows[0].id;
    return { eventId, mara: await insertLine("Mara"), luca: await insertLine("Luca") };
  });
}

async function registrationOf(eventId: string, first: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string; status: string; vouched: string | null; notes: string }>(
      `SELECT r.id, r.status, r.email_confirmed_by_staff_user_id AS vouched,
         (SELECT count(*)::text FROM registration_notes n WHERE n.registration_id = r.id) AS notes
       FROM registrations r WHERE r.event_id = $1 AND r.registered_name LIKE $2`,
      [eventId, `${first} %`],
    );
    return rows[0];
  });
}

const capacityOf = (eventId: string) => withDatabase(async (client) => (await client.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [eventId])).rows[0].capacity);

/** No page wider than the screen: the 320-pixel rule (§1.5). */
async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Answer the line's dialog: the tick first — the confirm button waits for it — then the confirm. */
async function tickAndConfirm(page: Page, title: string, expected: { address: string; button: string; says?: string }) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(expected.address);
  if (expected.says) await expect(dialog).toContainText(expected.says);
  const confirm = dialog.getByTestId("confirm-dialog-confirm");
  await expect(confirm).toHaveText(expected.button);
  await expect(confirm).toBeDisabled();
  await dialog.getByTestId("confirm-tick").click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
}

test.describe("§888 the internal list and the official waiting list, told apart; a line moved or offered a place in one press", () => {
  test.describe.configure({ timeout: 90_000 });

  test("the Administrator reads the two lists apart, moves one line to the official list and offers the other a supplementary place", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}`);
    await hydrated(page);

    // One read: the internal list says it is notes; the official one says it is the queue.
    const internal = page.getByTestId("registrations-reserve");
    await openFold(internal);
    await expect(internal.getByRole("heading", { name: /Lista internă \(doar notițe\)/ })).toBeVisible();
    await expect(internal).toContainText("Doar notițe");
    const official = page.getByTestId("registrations-waitlist-add");
    await expect(official.getByRole("heading", { name: /Lista oficială de așteptare/ })).toBeVisible();

    // Each line: the two verbs, 44 pixels tall, inside the screen.
    const maraLine = internal.getByTestId("reserve-entry").filter({ hasText: "Mara" });
    const move = maraLine.getByTestId("reserve-move");
    const offer = maraLine.getByTestId("reserve-offer");
    await expect(move).toHaveText("Mută pe lista oficială");
    await expect(offer).toHaveText("Oferă-i un loc acum");
    for (const button of [move, offer]) expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await fitsTheScreen(page);

    // «Mută pe lista oficială»: the full race puts Mara at the back of the line, the note with her, the line gone.
    await move.click();
    await tickAndConfirm(page, "Muți pe lista oficială de așteptare?", { address: `mara-${tag}@test.invalid`, button: "Mută pe lista oficială" });
    await page.waitForURL(/from=reserve/);
    await expect(page.getByTestId("registrations-reserve").getByTestId("reserve-entry").filter({ hasText: "Mara" })).toHaveCount(0);
    const mara = await registrationOf(seeded.eventId, "Mara");
    expect(mara.status).toBe("WAITLISTED");
    expect(mara.vouched).not.toBeNull();
    expect(mara.notes).toBe("1");
    expect(await capacityOf(seeded.eventId)).toBe(1);

    // «Oferă-i un loc acum» on the full race: the dialog names the capacity it becomes, and its button the added place.
    await hydrated(page);
    const lucaLine = page.getByTestId("registrations-reserve").getByTestId("reserve-entry").filter({ hasText: "Luca" });
    await lucaLine.getByTestId("reserve-offer").click();
    await tickAndConfirm(page, "Îi oferi un loc acum?", { address: `luca-${tag}@test.invalid`, button: "Adaugă un loc și oferă-i locul", says: "capacitatea devine 2" });
    await page.waitForURL(/saved=registrationOfferedRaised/);
    const luca = await registrationOf(seeded.eventId, "Luca");
    expect(luca.status).toBe("WAITLIST_OFFERED");
    expect(luca.notes).toBe("1");
    expect(await capacityOf(seeded.eventId)).toBe(2);
    await expect(page.getByTestId("registrations-reserve").getByTestId("reserve-entry")).toHaveCount(0);

    // «Trimite-i oferta» is on Mara's waiting row of the list, any time before the start.
    await hydrated(page);
    await page.getByRole("button", { name: `Acțiuni pentru Mara Lista${tag.replace(/[^a-z0-9]/gi, "")}` }).click();
    await expect(page.getByRole("menuitem", { name: /Trimite-i oferta/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await fitsTheScreen(page);
  });

  test("the Organizer keeps the internal list's own verbs and gets neither one-press move", async ({ page }) => {
    const tag = `${test.info().project.name}-org-${Date.now().toString(36)}`;
    const seeded = await seed(tag);

    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}`);
    const internal = page.getByTestId("registrations-reserve");
    await openFold(internal);
    await expect(internal.getByTestId("reserve-entry")).toHaveCount(2);
    await expect(internal.getByTestId("reserve-note-form")).toHaveCount(2);
    await expect(internal.getByTestId("reserve-delete-form")).toHaveCount(2);
    await expect(internal.getByTestId("reserve-move")).toHaveCount(0);
    await expect(internal.getByTestId("reserve-offer")).toHaveCount(0);
    await expect(internal.getByTestId("reserve-full-form")).toHaveCount(0);
    await fitsTheScreen(page);
  });
});
