import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN, BR-REQ-037-07, BR-REQ-041-01 — «La confirmare primește un BIB gol» on the invitation form (the owner, 2026-11-19:
 * «când invit pe cineva, trebuie să pot să-i dau unul dintre locurile de rezervă» — «Ambele»): an Administrator sends an
 * invitation that will wear one of the desk's blank spare bibs once its registration is confirmed.
 *
 * What only a browser shows: the tick is drawn under «Elită» on a race with spares, saying which are free now, as tall as a
 * thumb needs (44 pixels); ticked, the house's question says what it does; the real press stores it; the invitation's row
 * then wears «BIB gol la confirmare» — at 320 pixels wide and on a desktop, nothing scrolling sideways. Which spare the
 * confirmation gives, by every path, is `tests/integration/registrations/invitation-blank-bib.test.ts`.
 *
 * The race is written straight into the database — the setup, not the subject — one per project and test, so the two
 * projects never share a row; never a real person: the name and the address are made up.
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

/** A published race sixty days off, its sheet of spares printed: 154–156. */
async function seedRace(tag: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, walk_in_bib_start, walk_in_bib_count, editorial_status, published_at)
       VALUES ('RACE', now() + interval '60 days', 'INTERNAL', 50, 'Parcul Tractorul', 154, 3, 'PUBLISHED', now()) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      eventId,
      `invitatie-bib-gol-${tag}`,
      `Crosul invitaților cu BIB gol ${tag}`,
      `invitation-blank-bib-${tag}`,
      `The invited blank bib race ${tag}`,
    ]);
    return eventId;
  });
}

const fitsTheWidth = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

test.describe("§NNN «La confirmare primește un BIB gol»", () => {
  test.describe.configure({ timeout: 180_000 });

  test.afterAll(async () => {
    // A live counted invitation would hold a place across runs: withdraw ours.
    await withDatabase((client) =>
      client.query(`UPDATE event_invitations SET withdrawn_at = now() WHERE canonical_email LIKE 'e2e-blankbib-%' AND accepted_at IS NULL AND withdrawn_at IS NULL`),
    );
  });

  test("an Administrator ticks it on the form, the question says it, and the invitation's row wears it", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const email = `e2e-blankbib-${tag}@test.invalid`;
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);

    await page.getByTestId("registrations-invite-link").click();
    const panel = page.getByTestId("registrations-invitations");
    await expect(panel).toHaveAttribute("open", "");
    const form = panel.getByTestId("invite-form");

    // The tick, its line naming the free spares, and a thumb's height.
    const block = form.getByTestId("invite-blank-bib");
    await expect(block).toContainText("La confirmare primește un BIB gol");
    await expect(block).toContainText("libere acum (3): 154–156");
    const tick = block.getByTestId("invite-blank-bib-tick");
    await expect(tick).not.toBeChecked();
    expect((await block.locator("label").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(fitsTheWidth)).toBe(true);

    await form.locator('[name="inviteeName"]').fill("Dana Invitata");
    await form.locator('[name="inviteeEmail"]').fill(email);
    await tick.check();
    await form.getByTestId("invite-submit").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("La confirmare, fiecare primește cel mai mic BIB gol liber atunci.");
    await dialog.getByRole("button", { name: /Trimite invitațiile|Adaugă .* și trimite/ }).click();
    await expect(page).toHaveURL(/saved=invitationsSent/, { timeout: 30_000 });

    const stored = await withDatabase((client) =>
      client.query<{ blank_bib: boolean }>(`SELECT blank_bib FROM event_invitations WHERE event_id = $1 AND canonical_email = $2`, [eventId, email]),
    );
    expect(stored.rows).toEqual([{ blank_bib: true }]);

    // A fresh load: «Invitații» is closed by default; opened, the row wears the tick's chip.
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    await hydrated(page);
    await panel.locator("summary").first().click();
    await expect(panel).toHaveAttribute("open", "");
    const row = page.getByTestId("invitation-row").filter({ hasText: email });
    await expect(row.getByTestId("invitation-blank-bib-chip")).toContainText("BIB gol la confirmare");
    expect(await page.evaluate(fitsTheWidth)).toBe(true);
  });
});
