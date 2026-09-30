import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §581 (amending §570) — «Doar cu oferte și beneficii» on the registrations list: the owner,
 * 2026-09-30, «cum pot exporta participanții, doar cei care au bifat că vor datele publicate pentru
 * parteneri?». The box sits with the filters, wears the offers box's megaphone, narrows the list to
 * who said yes, and both exports beside the list follow it; the CSV names the public-list tick.
 *
 * The registrations are written straight into the database — the setup, not the subject, as
 * `terms-on-registration.spec.ts` argues — and removed afterwards, so the featured event's counts
 * stay what the other specs expect.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; registrationIds: string[]; participantIds: string[]; tag: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const eventId = eventRows[0].id;
    const seeded: Seeded = { eventId, registrationIds: [], participantIds: [], tag };
    const insert = async (who: string, promo: boolean, listOptOut: boolean) => {
      const email = `promo-${who}-${tag}@test.invalid`;
      const name = `Oferte ${who} ${tag}`;
      const { rows: participantRows } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
           promo_consent, promo_consent_at, confirmed_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now(), false, 1, $4, $5, $6, now())
         RETURNING id`,
        [eventId, participantRows[0].id, name, listOptOut, promo, promo ? new Date().toISOString() : null],
      );
      seeded.participantIds.push(participantRows[0].id);
      seeded.registrationIds.push(rows[0].id);
    };
    await insert("da", true, false);
    await insert("nu", false, true);
    return seeded;
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM registrations WHERE id = ANY($1::uuid[])", [seeded.registrationIds]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [seeded.participantIds]);
  } finally {
    await client.end();
  }
}

test.describe("§581 «Doar cu oferte și beneficii»: the list and its export", () => {
  test("the box narrows the list to who said yes, keeps its glyph and 44 px, and both exports follow it", async ({ page }) => {
    test.setTimeout(90_000);
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
      await hydrated(page);
      // One element per person: the row's own link, by its name, inside `#main`. The list draws a
      // name twice (the table on a laptop, the card on a phone, one of them `display: none`), and
      // while the page streams Next can hold a hidden copy of it outside `#main` — four matches for
      // free text (CI on #299). A role locator skips what is hidden; the search keeps the rows ours.
      const main = page.locator("#main");
      const row = (who: "da" | "nu") => main.getByRole("link", { name: `Deschide înscrierea lui Oferte ${who} ${seeded.tag}`, exact: true });
      const rows = main.getByRole("link", { name: new RegExp(`^Deschide înscrierea lui Oferte (da|nu) ${seeded.tag}$`) });
      await expect(row("da")).toBeVisible();
      await expect(row("nu")).toBeVisible();
      await expect(rows).toHaveCount(2);

      const filter = main.getByTestId("registrations-filter-promo");
      await filter.scrollIntoViewIfNeeded();
      await expect(filter.getByTestId("registrations-filter-promo-glyph")).toBeVisible();
      const box = filter.getByRole("checkbox", { name: "Doar cu oferte și beneficii" });
      const target = await filter.locator(".MuiCheckbox-root").boundingBox();
      expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
      await box.check();
      await main.getByRole("button", { name: "Filtrează" }).click();
      await expect(page).toHaveURL(/[?&]promo=1/);
      await hydrated(page);
      // The list narrows to who said yes: one row left, and it is hers.
      await expect(row("da")).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(row("nu")).toHaveCount(0);
      await expect(main.getByTestId("registrations-filter-promo").getByRole("checkbox", { name: "Doar cu oferte și beneficii" })).toBeChecked();

      // The export beside the list carries the filter: the file is the rows on screen.
      const excel = main.getByRole("link", { name: "Exportă Excel" });
      await expect(excel).toHaveAttribute("href", /[?&]promo=1/);
      const csvHref = await main.getByRole("link", { name: "Exportă CSV" }).getAttribute("href");
      expect(csvHref).toMatch(/[?&]promo=1/);
      const response = await page.request.get(csvHref!);
      expect(response.status()).toBe(200);
      const [header, ...lines] = (await response.text()).split("\r\n");
      expect(lines.some((line) => line.includes(`Oferte da ${seeded.tag}`))).toBe(true);
      expect(lines.some((line) => line.includes(`Oferte nu ${seeded.tag}`))).toBe(false);
      // The public-list tick in its own column, right after the socials (§581).
      const at = header.split(",").indexOf("Public list & results");
      expect(header.split(",")[at - 1]).toBe("Socials on the public list");
      expect(lines.find((line) => line.includes(`Oferte da ${seeded.tag}`))?.split(",")[at]).toBe("Yes");
    } finally {
      await cleanup(seeded);
    }
  });
});
