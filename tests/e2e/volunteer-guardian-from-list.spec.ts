import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * «Confirmarea minorilor din lista de voluntari» (amends §768; the owner, 2026-11-11: «as vrea sa pot confirma si voluntarele minore»):
 * an Organizer, on the «Voluntari» list alone — at 320 px and on desktop — sees a volunteer under eighteen with «Acordul părintelui lipsește»
 * and no «Confirmă», records the parent's paper agreement from the row, and then confirms the volunteer; the press comes back to the same
 * list address, no hydration warning is logged and the page never scrolls sideways.
 *
 * The event and the volunteer are written straight into the database — the setup, not the subject — one per project and run.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

async function seed(tag: string, volunteerName: string): Promise<{ eventId: string }> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const event = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name, editorial_status, published_at, accepts_volunteers)
       VALUES ('GROUP_RUN', now() + interval '30 days', 'NONE', 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', true) RETURNING id`,
    );
    const eventId = event.rows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`,
      [eventId, `voluntari-lista-${tag}`, `Alergarea lista ${tag}`, `volunteers-list-${tag}`, `The list run ${tag}`],
    );
    const role = await client.query<{ id: string }>(
      `INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed) VALUES ($1, 'Punct de apă', 'Water point', 3) RETURNING id`,
      [eventId],
    );
    const email = `minora.${tag}@example.test`;
    const volunteer = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, name, email, canonical_email, canonicalization_version, phone, source, state, age, guardian_name, guardian_email)
       VALUES ($1, $2, $3, $3, 1, '0712345678', 'PUBLIC', 'REGISTERED', 15, 'Maria Părinte', $4) RETURNING id`,
      [eventId, volunteerName, email, `parinte.${tag}@example.test`],
    );
    await client.query(`INSERT INTO event_volunteer_role_choices (volunteer_id, role_id) VALUES ($1, $2)`, [volunteer.rows[0].id, role.rows[0].id]);
    await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [volunteer.rows[0].id, role.rows[0].id]);
    return { eventId };
  } finally {
    await client.end();
  }
}

/** Only the copy of the row the viewport shows: the table at desktop width, the phone's block below it. */
const shown = (page: Page, role: "button" | "link", name: string | RegExp) => page.getByRole(role, { name }).filter({ visible: true });

test.describe("«Voluntari»: a minor's parent from the list", () => {
  test("an Organizer records the parent's paper agreement from the row and then confirms the volunteer", async ({ page }, testInfo) => {
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}-gl`;
    const name = `Ioana Minora ${tag}`;
    const { eventId } = await seed(tag, name);
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) warnings.push(message.text());
    });
    page.on("pageerror", (error) => warnings.push(error.message));

    await signIn(page, "Dev Moderator");
    const address = `/ro/admin/volunteers?eventId=${eventId}&q=${encodeURIComponent(name).replace(/%20/g, "+")}`;
    await page.goto(address);
    await hydrated(page);

    // The row says what is missing, in the person's block's own words, and draws no «Confirmă» the server would refuse.
    await expect(page.getByTestId("volunteer-guardian-state").filter({ visible: true })).toHaveText("Acordul părintelui lipsește");
    await expect(shown(page, "button", /^Confirmă: /)).toHaveCount(0);
    await expect(shown(page, "button", /^Anulează: /)).toHaveCount(1);
    await expect(shown(page, "button", /^Trimite linkul părintelui/)).toBeVisible();
    await expect(shown(page, "link", /^PDF de semnat de părinte: /)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The sheet is a real PDF; the paper record asks first, then comes back to this very address.
    const sheet = await page.request.get(await shown(page, "link", /^PDF de semnat de părinte: /).getAttribute("href").then((href) => href ?? ""));
    expect(sheet.status()).toBe(200);
    expect(sheet.headers()["content-type"]).toBe("application/pdf");
    const paper = shown(page, "button", /^Acordul părintelui pe hârtie: /);
    expect((await paper.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await paper.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Acordul părintelui pe hârtie", exact: true }).click();

    // The same list, the row now with «Confirmă» and no parent's chip.
    const confirm = shown(page, "button", /^Confirmă: /);
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toContain(`eventId=${eventId}`);
    await expect(page.getByTestId("volunteer-guardian-state")).toHaveCount(0);
    expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await hydrated(page);
    await confirm.click();
    await expect(page.getByTestId("volunteer-state").filter({ visible: true })).toHaveText("Confirmat", { timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(warnings).toEqual([]);
  });
});
