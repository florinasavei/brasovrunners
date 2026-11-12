import { expect, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * «De la parteneri» (the decision «De la parteneri»; BR-REQ-037-05, BR-REQ-060-01) in a real browser, on both projects: the tick
 * «E de la parteneri» with its box on a line of the internal list (the add, the line's fold, unticking), on a registration's page
 * (the Administrator's card; the Organizer reads the chip and has no form), the name in the list's column «Partener» and the list's
 * filter — and, since the list's column «Partener», the column itself: «Coloane», the row's editor (a partner picked and one
 * typed), the filter by one partner, the Organizer's column without a press, a long name — and nothing wider than the screen.
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

type Seeded = { eventId: string; ana: string; bia: string; surname: string };

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
    return { eventId, ana: ids.Ana, bia: ids.Bia, surname };
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
    await expect(internal.getByTestId("partner-chip")).toHaveCount(0, { timeout: 30_000 });
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

    // The list's row shows the name in its column «Partener» (the table's copy or the phone card's: one of them is shown),
    // and no chip any more: the column says it (the list's column «Partener»).
    const listUrl = `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.surname)}`;
    await page.goto(listUrl);
    await hydrated(page);
    const main = page.locator("#main");
    await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveCount(1);
    await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveText(partner);
    await expect(main.getByTestId("partner-chip").filter({ visible: true })).toHaveCount(0);
    await expect(main.getByText(`Bia ${seeded.surname}`).filter({ visible: true }).first()).toBeVisible();
    await fitsTheScreen(page);

    // The filter «De la parteneri», a select now: «De la orice partener» leaves only Ana's row, and still says `partner=1`.
    const filter = main.getByTestId("registrations-filter-partner");
    await filter.scrollIntoViewIfNeeded();
    await expect(filter).toBeVisible();
    await fitsTheScreen(page);
    await filter.getByRole("combobox").click();
    await page.getByRole("option", { name: "De la orice partener", exact: true }).click();
    await main.getByRole("button", { name: "Filtrează" }).click();
    await page.waitForURL(/partner=1/);
    await hydrated(page);
    await expect(main.getByText(`Ana ${seeded.surname}`).filter({ visible: true }).first()).toBeVisible();
    await expect(main.getByText(`Bia ${seeded.surname}`).filter({ visible: true })).toHaveCount(0);
    await expect(main.getByTestId("registrations-filter-partner").getByRole("combobox")).toHaveText("De la orice partener");
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

test.describe("the list's column «Partener»: seen, hidden, set from the row, filtered by one partner", () => {
  test.describe.configure({ timeout: 150_000 });

  /** The row's editor of one person, on the layout this project shows (the table's copy or the phone card's). */
  // The press's accessible name begins with the word it shows (WCAG 2.5.3): «Alege…» on a row with no partner, «Schimbă…» on one with.
  async function openEditor(page: Page, name: string, verb: "Alege" | "Schimbă" = "Alege") {
    const press = page.locator("#main").getByRole("button", { name: `${verb} partenerul pentru ${name}`, exact: true }).filter({ visible: true });
    await expect(press).toContainText(verb);
    await expect(press).toHaveCount(1);
    expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await press.click();
    const dialog = page.getByTestId("partner-row-dialog");
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("the Administrator sees the column, «Coloane» hides it, the row sets a picked and a typed partner, the filter keeps one partner", async ({ page }) => {
    const tag = `${test.info().project.name}-col-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const bakery = `Brutaria Exemplu ${tag}`;
    const cafe = `Cafeneaua de Test ${tag}`;
    await withDatabase((client) => client.query("UPDATE registrations SET partner_name = $2 WHERE id = $1", [seeded.bia, bakery]));
    const desktop = test.info().project.name === "desktop";

    await signIn(page, "Dev Administrator");
    const listUrl = `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.surname)}&sort=name&dir=asc`;
    await page.goto(listUrl);
    await hydrated(page);
    const main = page.locator("#main");
    // Bia's partner in the column, as plain text; Ana has none yet.
    await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveText([bakery]);
    await fitsTheScreen(page);

    if (desktop) {
      // «Partener» is the last column, right before the row's verbs (the owner, 2026-11-12: «Coloana de partener ar trebui să
      // apară ultima»). At 1280 px the table is wider than its frame: the verbs' column is pinned and never the cell the frame
      // cuts, and the column and the row's partner, scrolled to, stand whole between the frame's left edge and the verbs.
      await page.setViewportSize({ width: 1280, height: 900 });
      const table = main.locator('table[data-table-id="registrations"]');
      const header = table.locator('th[data-column="partner"]');
      await expect(header).toBeVisible();
      expect(await table.locator("thead th").evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).dataset.column).slice(-2))).toEqual(["partner", "__actions"]);
      const beside = async (target: import("@playwright/test").Locator) => {
        await target.scrollIntoViewIfNeeded();
        return target.evaluate((element) => {
          const frame = (element.closest("table") as HTMLTableElement).parentElement as HTMLElement;
          const verbs = (element.closest("table") as HTMLTableElement).querySelector("thead th[data-pinned]") as HTMLElement;
          const box = element.getBoundingClientRect();
          const edge = frame.getBoundingClientRect();
          const pinned = verbs.getBoundingClientRect();
          return {
            left: box.left >= edge.left - 0.5,
            right: box.right <= pinned.left + 0.5,
            verbsInFrame: pinned.left >= edge.left - 0.5 && pinned.right <= edge.right + 0.5,
          };
        });
      };
      expect(await beside(header)).toEqual({ left: true, right: true, verbsInFrame: true });
      expect(await beside(table.getByTestId("row-partner").first())).toEqual({ left: true, right: true, verbsInFrame: true });
      // «Coloane» hides it and brings it back (the phone's cards have no such menu: every field is a line).
      const heading = main.locator('table[data-table-id="registrations"] th[data-column="partner"]');
      await expect(heading).toBeVisible();
      await main.getByTestId("admin-table-columns").click();
      const toggle = page.getByRole("menuitemcheckbox", { name: "Partener", exact: true });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
      await page.keyboard.press("Escape");
      await expect(heading).toBeHidden();
      await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveCount(0);
      await main.getByTestId("admin-table-columns").click();
      await page.getByRole("menuitemcheckbox", { name: "Partener", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(heading).toBeVisible();
      await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveText([bakery]);
    }

    /** Where Ana's row stands in the window: its row of the wide table, or the block that stands for it on a phone. */
    const placeOf = () =>
      page.evaluate((anchor) => {
        const drawn = [document.getElementById(anchor), ...document.querySelectorAll(`[data-row-anchor="${anchor}"]`)].find((element) => element !== null && element.getClientRects().length > 0);
        return drawn ? Math.round(drawn.getBoundingClientRect().top) : null;
      }, `reg-${seeded.ana}`);

    // Ana's row: the event's partner picked from the select.
    let dialog = await openEditor(page, `Ana ${seeded.surname}`);
    await fitsTheScreen(page);
    const pressedAt = await placeOf();
    expect(pressedAt).not.toBeNull();
    await dialog.getByTestId("partner-row-choice").selectOption({ label: bakery });
    await dialog.getByTestId("partner-row-save").click();
    await page.waitForURL(/saved=partnerSaved/);
    await hydrated(page);
    // The press came back to the row it changed, and the row stands where it was pressed (the owner, 2026-11-12: «Mă disperă
    // … că atunci când fac un edit gen „aleg partenerul” și navighezi»): the list did not jump to its top, nor the row to the window's.
    expect(new URL(page.url()).hash).toBe(`#reg-${seeded.ana}`);
    await expect.poll(async () => Math.abs(((await placeOf()) ?? 99_999) - (pressedAt ?? 0)), { timeout: 10_000 }).toBeLessThanOrEqual(3);
    await expect(page.getByTestId("toast")).toContainText("Partenerul a fost salvat");
    // Back on the same list: the event, the search and the sort kept.
    const back = new URL(page.url());
    expect([back.searchParams.get("eventId"), back.searchParams.get("q"), back.searchParams.get("sort"), back.searchParams.get("dir")]).toEqual([seeded.eventId, seeded.surname, "name", "asc"]);
    await expect(main.getByTestId("partner-saved-alert")).toContainText("Partenerul a fost salvat");
    await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveText([bakery, bakery]);

    // Ana's row again: a new partner typed wins over the select.
    dialog = await openEditor(page, `Ana ${seeded.surname}`, "Schimbă");
    await expect(dialog.getByTestId("partner-row-choice")).toHaveValue(bakery);
    await dialog.getByTestId("partner-row-new").fill(cafe);
    await dialog.getByTestId("partner-row-save").click();
    await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveText([cafe, bakery], { timeout: 30_000 });
    await hydrated(page);
    await fitsTheScreen(page);

    // The filter by one partner: the new one leaves Ana alone, and the export links carry it.
    const filter = main.getByTestId("registrations-filter-partner");
    await filter.scrollIntoViewIfNeeded();
    await filter.getByRole("combobox").click();
    await page.getByRole("option", { name: cafe, exact: true }).click();
    await main.getByRole("button", { name: "Filtrează" }).click();
    await page.waitForURL(/partnerName=/);
    await hydrated(page);
    await expect(main.getByText(`Ana ${seeded.surname}`).filter({ visible: true }).first()).toBeVisible();
    await expect(main.getByText(`Bia ${seeded.surname}`).filter({ visible: true })).toHaveCount(0);
    await expect(main.getByTestId("row-partner").filter({ visible: true })).toHaveText([cafe]);
    for (const link of await main.locator('a[href^="/api/admin/registrations/export"]').all()) {
      expect(new URL((await link.getAttribute("href")) ?? "", "http://localhost").searchParams.get("partnerName")).toBe(cafe);
    }
    await fitsTheScreen(page);
  });

  test("the Organizer sees the column and no press; a 120-character name widens nothing", async ({ page }) => {
    const tag = `${test.info().project.name}-long-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    // One word of 120 characters, the harder case: nothing to break between but the column's own wrap.
    const long = "Partenerulcunumefoartelung".repeat(5).slice(0, 120);
    const desktop = test.info().project.name === "desktop";
    const listUrl = `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.surname)}`;
    // The wide table's own width (it may scroll inside its frame at any name): what a long name must not change.
    const tableWidth = () => page.evaluate(() => document.querySelector('table[data-table-id="registrations"]')?.scrollWidth ?? 0);

    await signIn(page, "Dev Moderator");
    const main = page.locator("#main");
    const shown = main.getByTestId("row-partner").filter({ visible: true });
    await withDatabase((client) => client.query("UPDATE registrations SET partner_name = $2 WHERE id = $1", [seeded.ana, "Scurt"]));
    await page.goto(listUrl);
    await hydrated(page);
    await expect(shown).toHaveText(["Scurt"]);
    const shortWidth = await tableWidth();

    await withDatabase((client) => client.query("UPDATE registrations SET partner_name = $2 WHERE id = $1", [seeded.ana, long]));
    await page.goto(listUrl);
    await hydrated(page);
    await expect(shown).toHaveText([long]);
    await expect(main.getByTestId("partner-row-open")).toHaveCount(0);
    await fitsTheScreen(page);
    // The name wraps inside its column: on a phone never past the screen's edge, on the wide table never wider than the column
    // a short name gets, and never wider than its bound.
    const box = await shown.boundingBox();
    if (desktop) {
      expect(Math.abs((await tableWidth()) - shortWidth)).toBeLessThanOrEqual(1);
      expect(box?.width ?? Infinity).toBeLessThanOrEqual(16 * 16 + 1);
    } else {
      expect(box ? box.x + box.width : Infinity).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    }

    // The Administrator's press sits under the same long name and still fits.
    await page.context().clearCookies();
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.surname)}`);
    await hydrated(page);
    await expect(main.getByTestId("partner-row-open").filter({ visible: true })).toHaveCount(2);
    await fitsTheScreen(page);
  });
});
