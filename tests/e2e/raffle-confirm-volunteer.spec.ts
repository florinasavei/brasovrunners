import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN (amending §984 and §1023), BR-REQ-060-01, BR-REQ-071-01, BR-REQ-041-01 — «Confirmă pentru tombolă». The owner, 2026-11-20, the
 * day before the race, of a volunteer of seventeen — «Voluntar · Nu · neconfirmat · Nu · Scoate» on «Ziua cursei» → «Tombolă», «Înscris»,
 * «Acordul părintelui lipsește», «Link trimis părintelui» on her page: «vreau să pot să o confirm și pe [ea] pentru tombolă, chiar și
 * fără acordul părinților». Walked at 320 pixels and on a desktop against the production build:
 *
 * - an Organizer on «Tombolă» finds her row «Nu · neconfirmat», chooses how the parent agreed — «telefonic» — and presses «Confirmă
 *   pentru tombolă», a thumb's 44 pixels; the house's question names her, «Anulează» focused, and its confirm waits for the box
 *   «Părintele sau tutorele a fost de acord să participe la tombolă»; ticked and confirmed, the row takes part — «Da · confirmat doar
 *   pentru tombolă · acordul părintelui: telefonic» — with the next V number, while she stays «Înscris» as a volunteer, her
 *   volunteering agreement and her parent's link untouched;
 * - «Jurnal» names who decided, and how the parent agreed;
 * - a «Voluntar» at the desk reads the same row and is drawn no such button.
 *
 * No page scrolls sideways. The race and its volunteers are written straight into the database — the setup, not the subject — one set
 * per project and test, and removed after. Never a real person.
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

type Seeded = { eventId: string; maria: string; mariaId: string; tokenHash: string };

/**
 * A published race a week away holding a raffle «Din oficiu»: a confirmed volunteer wearing V001, and Maria — seventeen on the race's
 * day, «Înscris», her parent named and a link to them live, no V number.
 */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number, accepts_volunteers, has_raffle)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1, true, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `tombola-confirmare-${tag}`,
      `Crosul confirmării ${tag}`,
      `raffle-confirmation-${tag}`,
      `The confirmation race ${tag}`,
    ]);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const roleId = roles[0].id;
    // Ion, confirmed, wearing V001.
    const ionAddress = `ion-confirmare-${tag}@test.invalid`;
    const { rows: ion } = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, volunteer_number)
       VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', 'CONFIRMED', 'STAFF', 1) RETURNING id`,
      [eventId, roleId, `Ion Confirmat ${tag}`, ionAddress],
    );
    // Maria, seventeen on the race's day, «Înscris»: her parent named, the link to them live — «Acordul părintelui lipsește».
    const maria = `Maria Minoră ${tag}`;
    const mariaAddress = `maria-confirmare-${tag}@test.invalid`;
    const tokenHash = randomBytes(32).toString("hex");
    const { rows: helper } = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, age, date_of_birth,
         guardian_name, guardian_email, guardian_token_hash, guardian_token_expires_at, guardian_requested_at)
       VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', 'REGISTERED', 'STAFF', 17, (now() + interval '7 days' - interval '17 years' + interval '1 month')::date,
         $5, $6, $7, now() + interval '3 days', now()) RETURNING id`,
      [eventId, roleId, maria, mariaAddress, `Elena Minoră ${tag}`, `elena-confirmare-${tag}@test.invalid`, tokenHash],
    );
    for (const volunteerId of [ion[0].id, helper[0].id]) {
      await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [volunteerId, roleId]);
    }
    return { eventId, maria, mariaId: helper[0].id, tokenHash };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
    // The volunteers, their roles and the translations go with the event.
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  });
}

type MariaRow = { state: string; volunteer_number: number | null; raffle_guardian_agreed: boolean | null; raffle_guardian_way: string | null; raffle_confirmed_by_staff_user_id: string | null; guardian_token_hash: string | null; guardian_accepted_at: Date | null; agreement_accepted_at: Date | null };
const mariaRow = (id: string) =>
  withDatabase(
    async (client) =>
      (
        await client.query<MariaRow>(
          `SELECT state, volunteer_number, raffle_guardian_agreed, raffle_guardian_way, raffle_confirmed_by_staff_user_id, guardian_token_hash, guardian_accepted_at, agreement_accepted_at
             FROM event_volunteers WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );
const staffId = (email: string) => withDatabase(async (client) => (await client.query<{ id: string }>("SELECT id FROM staff_users WHERE email = $1", [email])).rows[0]?.id);

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

async function tall(locator: Locator, what: string): Promise<void> {
  expect((await locator.boundingBox())?.height ?? 0, `${what} is a thumb's 44 pixels`).toBeGreaterThanOrEqual(44);
}

/** A person's row on the tab, as the viewport draws it — the wide table's row (its `id`) or the phone's card (its anchor). */
const rowOf = (page: Page, id: string) => page.locator(`#raffle-${id}:visible, [data-row-anchor="raffle-${id}"]:visible`);

test.describe("§NNN «Confirmă pentru tombolă»: an Organizer confirms a volunteer of seventeen for the raffle, with the parent's agreement", () => {
  test.describe.configure({ timeout: 300_000 });

  test("an Organizer confirms her «telefonic» on «Tombolă»: she takes part with a V number, stays «Înscris», and «Jurnal» names who decided", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await signIn(page, "Dev Moderator");

      await test.step("her row reads «Nu · neconfirmat», with the way to choose and «Confirmă pentru tombolă», 44 pixels each", async () => {
        await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
        await hydrated(page);
        await expect(page.locator('[data-testid="raffle-row-in"]:visible')).toHaveText(["Da", "Nu · neconfirmat"]);
        const form = page.locator('[data-testid="raffle-confirm-form"]:visible');
        await expect(form).toHaveCount(1);
        const way = form.getByLabel("Cum și-a dat acordul părintele");
        await expect(way.locator("option")).toHaveText(["Alege cum", "telefonic", "la fața locului", "în scris"]);
        await tall(way, "the way's select");
        const press = form.getByRole("button", { name: `Confirmă pentru tombolă: ${seeded.maria}` });
        await expect(press).toHaveText("Confirmă pentru tombolă");
        await tall(press, "«Confirmă pentru tombolă»");
        await fitsTheScreen(page);
      });

      await test.step("chosen «telefonic» and pressed, the question names her, «Anulează» focused, its confirm waiting for the parent's box", async () => {
        const form = page.locator('[data-testid="raffle-confirm-form"]:visible');
        await form.getByLabel("Cum și-a dat acordul părintele").selectOption("PHONE");
        await form.getByRole("button", { name: `Confirmă pentru tombolă: ${seeded.maria}` }).click();
        const dialog = page.getByRole("dialog", { name: `Confirmi pe ${seeded.maria} pentru tombolă?` });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(`${seeded.maria} are sub 18 ani: participă doar cu acordul părintelui sau al tutorelui, dat telefonic.`);
        await expect(dialog).toContainText(`Nu pleacă niciun email către ${seeded.maria}.`);
        await expect(dialog.getByRole("button", { name: "Anulează" })).toBeFocused();
        const confirm = dialog.getByRole("button", { name: "Da, confirmă pentru tombolă" });
        await expect(confirm).toBeDisabled();
        const box = dialog.getByRole("checkbox", { name: "Părintele sau tutorele a fost de acord să participe la tombolă" });
        await box.check();
        await expect(confirm).toBeEnabled();
        await tall(confirm, "«Da, confirmă pentru tombolă»");
        await fitsTheScreen(page);
        await confirm.click();
        await expect(page).toHaveURL(new RegExp(`/ro/admin/checkin/tombola\\?eventId=${seeded.eventId}#raffle-${seeded.mariaId}$`), { timeout: 30_000 });
        await hydrated(page);
        await expect(page.getByText("Confirmat pentru tombolă: numărul intră la tragere.").first()).toBeVisible();
      });

      await test.step("the row takes part with the next V number — a raffle's confirmation, not a volunteer's — and she stays «Înscris»", async () => {
        const row = rowOf(page, seeded.mariaId);
        await expect(row).toHaveCount(1);
        await expect(row.getByTestId("raffle-row-number")).toHaveText("V002");
        await expect(row.getByTestId("raffle-row-in")).toHaveText("Da · confirmat doar pentru tombolă · acordul părintelui: telefonic");
        await expect(page.locator('[data-testid="raffle-confirm-form"]:visible')).toHaveCount(0);
        await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 2 · Alergători: 0 · Elite: 0 · Voluntari: 2 · Prezenți dintre ei: 0");
        const after = await mariaRow(seeded.mariaId);
        expect(after).toMatchObject({
          state: "REGISTERED",
          volunteer_number: 2,
          raffle_guardian_agreed: true,
          raffle_guardian_way: "PHONE",
          raffle_confirmed_by_staff_user_id: await staffId("dev-moderator@dev.test"),
          // Her volunteering agreement and her parent's link exactly as they were.
          guardian_token_hash: seeded.tokenHash,
          guardian_accepted_at: null,
          agreement_accepted_at: null,
        });
        await fitsTheScreen(page);
      });

      await test.step("«Jurnal» names who decided, and how the parent agreed", async () => {
        await page.goto(`/ro/admin/checkin/jurnal?eventId=${seeded.eventId}`);
        await hydrated(page);
        const line = page.getByTestId("race-day-journal-line").filter({ hasText: seeded.maria });
        await expect(line).toHaveCount(1);
        await expect(line).toHaveAttribute("data-kind", "raffleConfirmed");
        await expect(line).toContainText(`Dev Moderator a confirmat pentru tombolă ${seeded.maria} (voluntar)`);
        await expect(line.getByTestId("race-day-journal-guardian")).toHaveText("· acordul părintelui: telefonic");
        await expect(page.getByTestId("race-day-journal-account-line").filter({ hasText: "Dev Moderator" })).toContainText("1 confirmat pentru tombolă");
        await fitsTheScreen(page);
      });

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });

  test("a «Voluntar» at the desk reads the same row and is drawn no «Confirmă pentru tombolă»", async ({ page }) => {
    const tag = `${test.info().project.name}-desk-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await signIn(page, "Dev Contributor");
      await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
      await hydrated(page);
      await expect(page.getByTestId("raffle-title")).toHaveText("Tombolă");
      await expect(rowOf(page, seeded.mariaId).getByTestId("raffle-row-in")).toHaveText("Nu · neconfirmat");
      await expect(page.getByTestId("raffle-confirm-form")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Confirmă pentru tombolă/ })).toHaveCount(0);
      await fitsTheScreen(page);
      // Nothing was confirmed by looking.
      expect((await mariaRow(seeded.mariaId)).volunteer_number).toBeNull();
    } finally {
      await cleanup(seeded);
    }
  });
});
