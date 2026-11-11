import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * «De la parteneri» (the decision «De la parteneri»; BR-REQ-037-05, BR-REQ-060-01) in a real browser, on both projects: the tick
 * «E de la parteneri» with its box on a line of the internal list (the add, the line's fold, unticking), on a registration's page
 * (the Administrator's card; the Organizer reads the chip and has no form), the chip on the list's row and the list's filter —
 * and nothing of the new card, fold or filter wider than the screen at 320 px.
 *
 * The event and its two confirmed runners are written straight into the database — the setup, not the subject — one event per
 * project and run. Made-up people and made-up partners only.
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

type Seeded = { eventId: string; ana: string; surname: string };

/** An event with room, and two confirmed registrations: Ana and Bia, one surname per run. */
async function seed(tag: string): Promise<Seeded> {
  const surname = `Partener${tag.replace(/[^a-z0-9]/gi, "")}`;
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 10, 'Parcul Tractorul', 'PUBLISHED', now()) RETURNING id`,
    );
    const eventId = eventRows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`, [
      eventId,
      `partener-${tag}`,
      `Crosul partenerilor ${tag}`,
      `partner-${tag}`,
      `The partners' race ${tag}`,
    ]);
    const ids: Record<string, string> = {};
    for (const first of ["Ana", "Bia"]) {
      const { rows: participantRows } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [`${first.toLowerCase()}-${tag}@test.invalid`, `${first} ${surname}`],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now()) RETURNING id`,
        [eventId, participantRows[0].id, `${first} ${surname}`],
      );
      ids[first] = rows[0].id;
    }
    return { eventId, ana: ids.Ana, surname };
  });
}

/** No page wider than the screen: the 320-pixel rule (§1.5). */
async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("«De la parteneri»: the tick and its box, the chip, the filter", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the internal list: a line added with the tick wears the chip; its fold renames the partner and unticking clears it", async ({ page }) => {
    const tag = `${test.info().project.name}-line-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const partner = `Brutaria Exemplu ${tag}`;
    const renamed = `Cafeneaua de Test ${tag}`;

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}`);
    await hydrated(page);
    const internal = page.locator("#main").getByTestId("registrations-reserve");
    await openFold(internal);

    // A tick without a name is refused at the box: the line is not written.
    const add = internal.getByTestId("reserve-add-form");
    await add.locator('input[name="firstName"]').fill("Dana");
    await add.locator('input[name="lastName"]').fill(seeded.surname);
    await add.getByTestId("partner-tick").check();
    await expect(add.locator('input[name="partnerName"]')).toBeVisible();
    await fitsTheScreen(page);
    await add.locator('button[type="submit"]').click();
    await expect(add).toContainText("Scrie numele partenerului sau sponsorului, sau debifează");
    await expect(internal.getByTestId("reserve-entry")).toHaveCount(0);

    // With the name, the line is written and wears the chip.
    await add.locator('input[name="partnerName"]').fill(partner);
    await add.locator('button[type="submit"]').click();
    const line = internal.getByTestId("reserve-entry").filter({ hasText: "Dana" });
    await expect(line).toHaveCount(1, { timeout: 30_000 });
    await hydrated(page);
    await openFold(internal);
    await expect(line.getByTestId("partner-chip")).toContainText(`Partener: ${partner}`);
    await fitsTheScreen(page);

    // The line's own fold changes the name.
    const fold = line.getByTestId("reserve-partner");
    await openFold(fold);
    await expect(fold.getByTestId("partner-tick")).toBeChecked();
    await expect(fold.getByTestId("partner-name")).toHaveValue(partner);
    expect((await fold.getByTestId("reserve-partner-save").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await fitsTheScreen(page);
    await fold.getByTestId("partner-name").fill(renamed);
    await fold.getByTestId("reserve-partner-save").click();
    await expect(page.getByTestId("toast")).toContainText("Partenerul a fost salvat", { timeout: 30_000 });
    await hydrated(page);
    await openFold(internal);
    await expect(internal.getByTestId("reserve-entry").filter({ hasText: "Dana" }).getByTestId("partner-chip")).toContainText(`Partener: ${renamed}`);

    // Unticking clears it.
    const again = internal.getByTestId("reserve-entry").filter({ hasText: "Dana" }).getByTestId("reserve-partner");
    await openFold(again);
    await again.getByTestId("partner-tick").uncheck();
    await again.getByTestId("reserve-partner-save").click();
    await expect(page.getByTestId("toast")).toBeVisible({ timeout: 30_000 });
    await hydrated(page);
    await openFold(internal);
    await expect(internal.getByTestId("reserve-entry").filter({ hasText: "Dana" })).toHaveCount(1);
    await expect(internal.getByTestId("partner-chip")).toHaveCount(0);
    await fitsTheScreen(page);
  });

  test("a registration's page: the Administrator sets the name, the page and the list wear the chip, the filter keeps that row; the Organizer has no form", async ({ page }) => {
    const tag = `${test.info().project.name}-page-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const partner = `Brutaria Exemplu ${tag}`;

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${seeded.ana}`);
    await hydrated(page);
    const card = page.getByTestId("registration-partner");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("partner-tick")).not.toBeChecked();
    await fitsTheScreen(page);
    await card.getByTestId("partner-tick").check();
    await card.getByTestId("partner-name").fill(partner);
    await card.getByTestId("registration-partner-save").click();
    await expect(page.getByTestId("toast")).toContainText("Partenerul a fost salvat", { timeout: 30_000 });
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("partner-chip").filter({ visible: true })).toContainText(`Partener: ${partner}`);
    await expect(page.getByTestId("registration-partner").getByTestId("partner-name")).toHaveValue(partner);
    await fitsTheScreen(page);

    // The list's row wears the chip (the table's copy or the phone card's: one of them is shown).
    const listUrl = `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.surname)}`;
    await page.goto(listUrl);
    await hydrated(page);
    const main = page.locator("#main");
    await expect(main.getByTestId("partner-chip").filter({ visible: true })).toHaveCount(1);
    await expect(main.getByTestId("partner-chip").filter({ visible: true })).toContainText(`Partener: ${partner}`);
    await expect(main.getByText(`Bia ${seeded.surname}`).filter({ visible: true }).first()).toBeVisible();
    await fitsTheScreen(page);

    // The filter «De la parteneri»: only Ana's row is left.
    const filter = main.getByTestId("registrations-filter-partner");
    await filter.scrollIntoViewIfNeeded();
    await expect(filter).toBeVisible();
    await fitsTheScreen(page);
    await filter.getByRole("checkbox", { name: "De la parteneri" }).check();
    await main.getByRole("button", { name: "Filtrează" }).click();
    await page.waitForURL(/partner=1/);
    await hydrated(page);
    await expect(main.getByText(`Ana ${seeded.surname}`).filter({ visible: true }).first()).toBeVisible();
    await expect(main.getByText(`Bia ${seeded.surname}`).filter({ visible: true })).toHaveCount(0);
    await expect(main.getByTestId("registrations-filter-partner").getByRole("checkbox", { name: "De la parteneri" })).toBeChecked();
    await fitsTheScreen(page);
  });

  test("the Organizer reads the chip on the registration's page and is handed no form", async ({ page }) => {
    const tag = `${test.info().project.name}-org-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const partner = `Brutaria Exemplu ${tag}`;
    await withDatabase((client) => client.query("UPDATE registrations SET partner_name = $2 WHERE id = $1", [seeded.ana, partner]));

    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/registrations/${seeded.ana}`);
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("partner-chip").filter({ visible: true })).toContainText(`Partener: ${partner}`);
    await expect(page.getByTestId("registration-partner")).toHaveCount(0);
    await expect(page.getByTestId("registration-partner-form")).toHaveCount(0);
    await fitsTheScreen(page);
  });
});
