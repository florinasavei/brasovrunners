import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §NNN, BR-REQ-041-01 — a backoffice table's columns can be resized: on the registrations list at
 * desktop width, a column's edge is dragged, the width survives a reload, «Lățimi implicite» puts
 * the table back to its automatic layout, and the edge is a separator whose `aria-valuenow` the
 * arrow keys move by 16. At 320 px the phone layout has no columns, so no edge and no reset.
 *
 * Everything here is the browser's own layout — `col` alignment under `table-layout: fixed` with
 * collapsed borders, pointer capture, the restore after a reload — which no unit test can reach.
 *
 * One registration is written straight into the database so the list is not empty (the setup, not
 * the subject, as `promo-filter.spec.ts` argues), and removed afterwards.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; registrationId: string; participantId: string; tag: string };

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>(
      "SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1",
      [FEATURED.slug],
    );
    const eventId = eventRows[0].id;
    const email = `columns-${tag}@test.invalid`;
    const name = `Coloane ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
         promo_consent, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED'::registration_status, 'ro', $3, $3, 'PUBLIC', 1, now(), false, 1, true, false, now())
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    return { eventId, registrationId: rows[0].id, participantId: participantRows[0].id, tag };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}

/** The `<col>`'s laid-out width, as the browser gives it — the width every cell below it takes. */
async function columnWidth(page: Page, key: string): Promise<number> {
  return page
    .locator(`#main table[data-table-id="registrations"] th[data-column="${key}"]`)
    .evaluate((th) => Math.round(th.getBoundingClientRect().width));
}

async function inlineWidth(page: Page, key: string): Promise<string> {
  return page
    .locator(`#main table[data-table-id="registrations"] col[data-column="${key}"]`)
    .evaluate((col) => (col as HTMLElement).style.width);
}

async function drag(page: Page, handle: Locator, by: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("the column's edge has no box");
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by / 2, y, { steps: 5 });
  await page.mouse.move(x + by, y, { steps: 5 });
  await page.mouse.up();
}

test.describe("§NNN a backoffice table's columns can be resized", () => {
  test("drag, reload, reset and the keyboard on the registrations list", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop project drives the pointer; the phone has its own test below");
    test.setTimeout(90_000);
    const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await signIn(page, "Dev Administrator");
      const address = `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`;
      await page.goto(address);
      await hydrated(page);

      const main = page.locator("#main");
      const handle = main.locator('[data-column-resize="name"]');
      const reset = main.getByTestId("admin-table-reset-widths");
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute("role", "separator");
      await expect(reset).toHaveCount(0);
      // A focusable separator says its value from the start, not only after a drag.
      await expect(handle).toHaveAttribute("aria-valuenow", /^\d+$/);

      const before = await columnWidth(page, "name");
      await drag(page, handle, 120);
      await expect.poll(() => columnWidth(page, "name")).toBeGreaterThanOrEqual(before + 100);
      const widened = await columnWidth(page, "name");
      await expect(main.locator('table[data-table-id="registrations"]')).toHaveAttribute("data-resized", "true");
      await expect(reset).toBeVisible();
      // Wider than the frame, the frame scrolls sideways; the page never does.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.reload();
      await hydrated(page);
      await expect.poll(() => columnWidth(page, "name")).toBe(widened);
      await expect(reset).toBeVisible();
      await expect(handle).toHaveAttribute("aria-valuenow", String(widened));

      // «Lățimi implicite»: the table is automatic again, and the focus lands on a column edge.
      await reset.click();
      await expect(reset).toHaveCount(0);
      await expect(main.locator('table[data-table-id="registrations"]')).not.toHaveAttribute("data-resized");
      expect(await inlineWidth(page, "name")).toBe("");
      await expect.poll(() => columnWidth(page, "name")).toBe(before);
      await expect(main.locator('[role="separator"]').first()).toBeFocused();

      // The keyboard: one press of the right arrow is 16 px more.
      await handle.focus();
      const now = Number(await handle.getAttribute("aria-valuenow"));
      await page.keyboard.press("ArrowRight");
      await expect(handle).toHaveAttribute("aria-valuenow", String(now + 16));
      await expect.poll(() => inlineWidth(page, "name")).toBe(`${now + 16}px`);

      // Home goes to the column's own floor: its heading «Nume» is never cut inside a word.
      await page.keyboard.press("Home");
      const heading = main.locator('table[data-table-id="registrations"] th[data-column="name"] [data-column-heading]');
      const fits = await heading.evaluate((span) => {
        const box = span.getBoundingClientRect();
        const th = span.closest("th") as HTMLElement;
        return box.right <= th.getBoundingClientRect().right && span.getClientRects().length >= 1;
      });
      expect(fits).toBe(true);
    } finally {
      await cleanup(seeded);
    }
  });

  test("the phone layout has no column edge and no reset", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the 320-px phone");
    test.setTimeout(60_000);
    const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
      await hydrated(page);
      const main = page.locator("#main");
      await expect(main.getByRole("link", { name: `Deschide înscrierea lui Coloane ${seeded.tag}`, exact: true })).toBeVisible();
      await expect(main.locator("[data-column-resize]").filter({ visible: true })).toHaveCount(0);
      await expect(main.getByTestId("admin-table-reset-widths").filter({ visible: true })).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
