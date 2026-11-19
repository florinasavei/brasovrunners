import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmWithoutEmail } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * §NNN, BR-REQ-038-01, BR-REQ-041-01 — «Dă-i un BIB gol» (the owner, 2026-11-19, holding the sheet of spares: «trebuie să
 * pot aloca numere dintre cele goale, adică astea»): an Administrator gives a runner whose named bib is already printed
 * one of the desk's free spares; the registration's page then says the spare's number, and the spares' card on the
 * event's editor lists it with the runner's name, a link to the registration.
 *
 * What only a browser shows: the fold opens, the native select posts the spare chosen, the house's question names that
 * very number (filled from the select at the press) and the printed number it retires, «… fără email» answers it, the
 * press lands back on the page with the toast, and every control a thumb must hit is 44 pixels high — at 320 pixels wide
 * and on a desktop. The service's rules are `tests/integration/registrations/give-spare-bib.test.ts`.
 *
 * The race is written straight into the database — the setup, not the subject — one per project and test, so the two
 * projects never share a row.
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

/** A draft race with three spares reserved (154–156), and a confirmed runner wearing 27, its bib already printed. */
async function seedRace(tag: string): Promise<{ eventId: string; registrationId: string; name: string }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, walk_in_bib_start, walk_in_bib_count)
       VALUES ('RACE', now() + interval '60 days', 'INTERNAL', 50, 'Parcul Tractorul', 154, 3) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      eventId,
      `bib-gol-${tag}`,
      `Crosul BIB-urilor goale ${tag}`,
      `blank-bib-${tag}`,
      `The blank bib race ${tag}`,
    ]);
    const name = `Radu Pop ${tag}`;
    const email = `blank-bib-${tag}@test.invalid`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows: registrationRows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at,
         bib_number, bib_printed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now(), 27, now())
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    return { eventId, registrationId: registrationRows[0].id, name };
  });
}

async function numberOf(registrationId: string): Promise<{ bib_number: number | null; printed: boolean }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ bib_number: number | null; printed: boolean }>(
      `SELECT bib_number, bib_printed_at IS NOT NULL AS printed FROM registrations WHERE id = $1`,
      [registrationId],
    );
    return rows[0];
  });
}

async function bibAudits(registrationId: string): Promise<unknown[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ metadata_json: unknown }>(
      `SELECT metadata_json FROM audit_logs WHERE action = 'registration.bib_set' AND entity_id = $1 ORDER BY created_at`,
      [registrationId],
    );
    return rows.map((row) => row.metadata_json);
  });
}

test.describe("§NNN «Dă-i un BIB gol»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an Administrator gives a printed runner a blank bib: the page wears its number and the card lists it", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, registrationId, name } = await seedRace(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${registrationId}`);
    await hydrated(page);

    const raceDay = page.getByTestId("race-day");
    await expect(raceDay).toContainText("Numărul de concurs: 27. E tipărit, deci se schimbă doar cu un BIB gol.");
    // The typed box never offers to move a printed number (§311); the blank bib does.
    await expect(page.getByTestId("set-bib-form")).toHaveCount(0);
    const form = page.getByTestId("spare-bib-form");
    const fold = form.locator("details").first();
    await openFold(fold);
    // The fold's own line is a thumb's target too.
    expect((await fold.locator(":scope > summary").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The free spares, lowest first and chosen.
    const select = form.getByRole("combobox", { name: "BIB-ul gol" });
    await expect(select).toHaveValue("154");
    await expect(select.locator("option")).toHaveText(["154", "155", "156"]);
    const press = form.getByRole("button", { name: "Dă-i BIB-ul" });
    for (const control of [select, press]) expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await select.selectOption("155");
    await press.click();
    // The question names the number chosen and the printed one it retires, and the email is the answer pressed.
    const dialog = page.getByRole("dialog", { name: "Îi dai BIB-ul gol?" });
    await expect(dialog).toContainText(`${name} poartă de acum numărul 155, de pe BIB-ul gol.`);
    await expect(dialog).toContainText("Numărul 27 se retrage și nu se mai dă nimănui, iar BIB-ul tipărit cu el nu mai e valabil.");
    await expect(dialog.getByTestId("confirm-dialog-skip-email")).toHaveText("Dă-i BIB-ul fără email");
    await confirmWithoutEmail(page, "Îi dai BIB-ul gol?");

    await expect(page).toHaveURL(/[?&]saved=bibSet#admin-alert$/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Număr salvat.");
    await expect(page.getByTestId("race-day")).toContainText("Numărul de concurs: 155. E tipărit, deci se schimbă doar cu un BIB gol.");
    expect(await numberOf(registrationId)).toEqual({ bib_number: 155, printed: true });
    expect(await bibAudits(registrationId)).toEqual([{ eventId, from: 27, to: 155, spare: true, printedReplaced: true, emailSkipped: true }]);

    // The spares' card on the event's editor: «155 → name», a link to the registration, and how many are still free.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await openEditorBox(page, "Alocare și tipărire");
    const spares = page.getByTestId("bib-spares");
    await openFold(spares);
    await expect(spares.getByTestId("bib-spares-state")).toContainText("libere încă 2 din 3");
    const lines = spares.getByTestId("bib-spares-given-line");
    await expect(lines).toHaveCount(1);
    const link = lines.getByRole("link", { name: `155 → ${name}` });
    await expect(link).toHaveAttribute("href", `/ro/admin/registrations/${registrationId}`);
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
