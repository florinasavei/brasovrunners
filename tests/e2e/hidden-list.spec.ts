import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * §647 (amending §643; the owner, 2026-10-02: «Nu îmi place deloc cum arată bifa asta, trebuia să fie
 * doar radio» — and the caption cut off at the right of his phone) — «Lista ascunsă» on a registration's
 * page: two radios under a heading with the incognito glyph, the server's state checked, inside the
 * page at 320 pixels with 44-pixel targets; a change asks the dialog, «Anulează» puts the radio back,
 * «Da» puts the registration on the hidden list.
 *
 * The event and the runner are written straight into the database — the setup, not the subject
 * (`resend-now.spec.ts`) — one of each per project and run, so the two projects never share a row.
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

/** A race with the hidden list switched on, and one confirmed runner on it, counted. */
async function seedRunner(tag: string): Promise<string> {
  return (await seed(tag)).registrationId;
}

async function seed(tag: string): Promise<{ eventId: string; registrationId: string }> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, hidden_list_enabled)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 10, 'Parcul Tractorul', true) RETURNING id`,
    );
    const eventId = eventRows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`,
      [eventId, `lista-ascunsa-${tag}`, `Crosul ascuns ${tag}`, `hidden-list-${tag}`, `The hidden race ${tag}`],
    );
    const email = `hidden-list-${tag}@test.invalid`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, `Pacemaker ${tag}`],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 1, now(), false, 1, true, now())
       RETURNING id`,
      [eventId, participantRows[0].id, `Pacemaker ${tag}`],
    );
    return { eventId, registrationId: rows[0].id };
  });
}

test.describe("§647 «Lista ascunsă» as a radio", () => {
  test.describe.configure({ timeout: 60_000 });

  test("two radios inside the page, 44-pixel targets; «Anulează» puts it back, «Da» puts the runner on the list", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const id = await seedRunner(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/registrations/${id}`);
    await hydrated(page);

    const section = page.getByTestId("outside-capacity");
    await expect(section.getByRole("heading", { name: "Lista ascunsă" })).toBeVisible();
    const group = section.getByRole("radiogroup", { name: "Lista ascunsă" });
    const counted = group.getByRole("radio", { name: "Se numără între locurile evenimentului" });
    const hidden = group.getByRole("radio", { name: "Pe lista ascunsă" });
    await expect(counted).toBeChecked();
    await expect(hidden).not.toBeChecked();
    // No outlined button any more: the radio is the control.
    await expect(section.getByRole("button", { name: /Pune pe lista ascunsă|afara locurilor/i })).toHaveCount(0);

    // Inside the screen at 320 pixels: the section, its caption and the page never scroll sideways.
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const box = await section.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    const caption = section.getByText("Pentru organizatori, pacemakeri, invitați", { exact: false });
    const captionBox = await caption.boundingBox();
    expect((captionBox?.x ?? 0) + (captionBox?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // A thumb's target: each radio's row is at least 44 pixels tall (BR-REQ-041-01 criterion 6).
    for (const testId of ["hidden-list-counted", "hidden-list-hidden"]) {
      const target = await section.getByTestId(testId).boundingBox();
      expect(target?.height ?? 0, testId).toBeGreaterThanOrEqual(44);
    }

    // A change asks; «Anulează» sends nothing and the radio shows the server's state again.
    await hidden.check();
    await cancelDialog(page, "Pui înscrierea pe lista ascunsă?");
    await expect(counted).toBeChecked();
    await expect(page.getByTestId("outside-chip")).toHaveCount(0);

    // «Da»: on the hidden list, the chip with the glyph beside the name, the other radio checked.
    await hidden.check();
    await confirmDialog(page, "Pui înscrierea pe lista ascunsă?");
    await expect(page).toHaveURL(/[?&]saved=outsideMarked/, { timeout: 15_000 });
    await expect(page.getByTestId("toast")).toContainText("Înscrierea e pe lista ascunsă");
    await hydrated(page);
    await expect(page.getByTestId("outside-chip")).toContainText("Lista ascunsă");
    await expect(page.getByTestId("outside-capacity").getByRole("radio", { name: "Pe lista ascunsă" })).toBeChecked();
  });

  test("the event's group: the two settings under «Folosește lista ascunsă» show only while it is ticked, «Arată public numărătoarea» always", async ({ page }) => {
    const tag = `${test.info().project.name}-editor-${Date.now().toString(36)}`;
    const { eventId } = await seed(tag);
    await withDatabase((client) => client.query("UPDATE events SET hidden_list_enabled = false WHERE id = $1", [eventId]));
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    const box = await openEditorBox(page, "Lista publică a participanților");
    const group = box.getByTestId("hidden-list-settings");
    const start = group.getByLabel("Numerele listei ascunse încep de la");
    await expect(group.getByText("Folosește lista ascunsă", { exact: true })).toBeVisible();
    await expect(start).toBeHidden();
    // «Arată public numărătoarea» (§647) acts on every event: shown and ticked with the switch off, outside the group.
    const countTick = box.getByTestId("participant-count-public").getByRole("checkbox", { name: "Arată public numărătoarea" });
    await expect(countTick).toBeVisible();
    await expect(countTick).toBeChecked();
    await expect(group.getByRole("checkbox", { name: "Arată public numărătoarea" })).toHaveCount(0);
    await group.getByRole("checkbox", { name: "Folosește lista ascunsă" }).check();
    await expect(start).toBeVisible();
    await expect(group.getByRole("checkbox", { name: "Numără și lista ascunsă" })).not.toBeChecked();
    // Inside the screen at every width the projects use, 320 pixels included.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await group.getByRole("checkbox", { name: "Folosește lista ascunsă" }).uncheck();
    await expect(start).toBeHidden();
  });
});
