import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN, BR-REQ-071-01, BR-REQ-041-01, BR-REQ-060-01 — «Șterge» on a list of «Liste date sponsorilor», and where the
 * folds of an event's registrations page stand (the owner, 2026-11-15: «vreau să pot șterge (hard delete) și faza asta,
 * pentru că am generat din greșeală!», and of the folds: «vreau să fie sub „căutare și filtrare"» — «Sub tabel»).
 *
 * What only a browser can see, and the unit and PGlite tests cannot: the press is a form in a fold inside a fold, below
 * the table — so, as the Administrator: «Caută și filtrează» stands above the registrations and «Lista pentru
 * sponsori» below them; the fold and the register inside it open; the list made by mistake has «Șterge», which asks
 * first by the list's recipient and says when the press is right; confirmed, the page comes back to the register, both
 * folds open, the row gone and the others left. The Organizer reads the same register with no «Șterge».
 *
 * The race and its lists are written straight into the database — the setup, not the subject — one set per project and
 * test, so the two projects never share a row. Never a real person: the recipients are made up.
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

/** A race with one confirmed runner and three lists in the trail, the newest the one made by mistake. */
async function seed(tag: string): Promise<{ eventId: string; mistake: string; kept: string[] }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 50, 'Parcul Tractorul') RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      eventId,
      `registru-${tag}`,
      `Crosul registrului ${tag}`,
      `register-${tag}`,
      `The register race ${tag}`,
    ]);
    const email = `register-${tag}@test.invalid`;
    const { rows: people } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, `Ana Pop ${tag}`],
    );
    await client.query(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, privacy_notice_version, privacy_acknowledged_at,
         results_name_consent, results_consent_version, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, now())`,
      [eventId, people[0].id, `Ana Pop ${tag}`],
    );
    const lists: Array<[string, string, number, string]> = [
      [`Nistor ${tag}`, "26 days", 5, "csv"],
      [`Diana ${tag}`, "12 days", 11, "xlsx"],
      [`Ovidiu ${tag}`, "1 day", 19, "xlsx"],
    ];
    for (const [recipient, ago, count, format] of lists) {
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata_json, created_at)
         VALUES ('registrations.sponsor_list_exported', 'event', $1, $2::jsonb, now() - $3::interval)`,
        [eventId, JSON.stringify({ eventId, format, count, recipient, registrationIds: [] }), ago],
      );
    }
    return { eventId, mistake: `Ovidiu ${tag}`, kept: [`Diana ${tag}`, `Nistor ${tag}`] };
  });
}

const trailOf = (eventId: string, action: string) =>
  withDatabase(async (client) =>
    (await client.query<{ metadata: Record<string, unknown> }>("SELECT metadata_json AS metadata FROM audit_logs WHERE action = $1 AND entity_id = $2 ORDER BY created_at", [action, eventId])).rows.map((row) => row.metadata),
  );

const listUrl = (eventId: string) => `/ro/admin/registrations?eventId=${eventId}`;
const top = async (page: Page, selector: string) => (await page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().top + window.scrollY)) as number;

/** The register's rows as a person sees them: the table on a desk, the lines on a phone — whichever is shown. */
const visibleRows = (page: Page) => page.getByTestId("sponsor-register").locator('[data-testid="sponsor-register-row"]:visible, [data-testid="sponsor-register-lines"] > li:visible');

test.describe("§NNN «Șterge» on a list of the sponsors' register, below the table", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Administrator finds the register below the registrations, deletes the list made by mistake — asked first — and the others stay", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId, mistake, kept } = await seed(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(listUrl(eventId));
    await hydrated(page);

    // ---- The page's order: the filter, then the registrations, then the folds --------------------------------------
    const filters = await top(page, '[data-testid="registrations-filters"]');
    const rows = await top(page, `#main :is(tr, li):visible:has-text("Ana Pop ${tag}")`);
    const sponsors = await top(page, '[data-testid="registrations-sponsors"]');
    const invitations = await top(page, "#registrations-invitations");
    const outbox = await top(page, '[data-testid="outbox-panel"]');
    expect(filters).toBeLessThan(rows);
    expect(rows).toBeLessThan(sponsors);
    expect(sponsors).toBeLessThan(invitations);
    expect(invitations).toBeLessThan(outbox);

    // ---- The register, a fold inside the fold, both closed on arrival -----------------------------------------------
    const fold = page.getByTestId("registrations-sponsors");
    const register = page.getByTestId("sponsor-register");
    await expect(fold).not.toHaveAttribute("open", "");
    await openFold(fold);
    await openFold(register);
    await expect(visibleRows(page)).toHaveCount(3);
    const row = visibleRows(page).filter({ hasText: mistake });
    const press = row.getByRole("button", { name: new RegExp(`^Șterge din registru lista pentru ${mistake}`) });
    await expect(press).toHaveText(/Șterge/);
    await expect(press.locator("svg")).toHaveCount(1);
    await press.click();

    // ---- It asks first: which list, what goes with it, that nobody is emailed, and when the press is right ----------
    const dialog = page.getByRole("dialog", { name: "Ștergi lista din registru?" });
    await expect(dialog).toContainText(mistake);
    await expect(dialog).toContainText("«Dată partenerilor»");
    await expect(dialog).toContainText(`Nu pleacă niciun email către ${mistake}.`);
    await expect(dialog).toContainText("Șterge doar o listă făcută din greșeală, care n-a ajuns la nimeni.");
    await confirmDialog(page, "Ștergi lista din registru?");

    // ---- Back at the register, open, with what is left ---------------------------------------------------------------
    await expect(page).toHaveURL(/[?&]saved=sponsorListDeleted/, { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`eventId=${eventId}`));
    await expect(page).toHaveURL(/#sponsor-register$/);
    await expect(page.getByTestId("toast-live")).toContainText("Lista a fost ștearsă din registru.", { timeout: 30_000 });
    await hydrated(page);
    await expect(page.getByTestId("registrations-sponsors")).toHaveAttribute("open", "");
    await expect(page.getByTestId("sponsor-register")).toHaveAttribute("open", "");
    await expect(visibleRows(page)).toHaveCount(2);
    await expect(page.getByTestId("sponsor-register")).not.toContainText(mistake);
    for (const recipient of kept) await expect(page.getByTestId("sponsor-register")).toContainText(recipient);

    // The trail: the list's own row is gone, and one row says a list was deleted — never whose it was.
    const left = await trailOf(eventId, "registrations.sponsor_list_exported");
    expect(left.map((metadata) => metadata.recipient).sort()).toEqual([...kept].sort());
    const deleted = await trailOf(eventId, "registrations.sponsor_list_record_deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ count: 19, format: "xlsx" });
    expect(JSON.stringify(deleted[0])).not.toContain(mistake);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("the Organizer reads the same register and is offered no «Șterge»", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId } = await seed(tag);
    await signIn(page, "Dev Moderator");
    await page.goto(listUrl(eventId));
    await hydrated(page);
    await openFold(page.getByTestId("registrations-sponsors"));
    await openFold(page.getByTestId("sponsor-register"));
    await expect(visibleRows(page)).toHaveCount(3);
    await expect(page.getByTestId("sponsor-register").getByRole("button", { name: /Șterge/ })).toHaveCount(0);
    expect(await trailOf(eventId, "registrations.sponsor_list_exported")).toHaveLength(3);
  });
});
