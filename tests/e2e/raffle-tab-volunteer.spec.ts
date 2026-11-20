import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §1014, BR-REQ-060-01, BR-REQ-037-08, BR-REQ-041-01 — «Ziua cursei» → «Tombolă» for every desk role (the owner, 2026-11-20:
 * «voluntarii logați nu văd tabul de Tombolă, doar adminii și organizatorii văd acest tab»), walked by the desk Volunteer — the
 * lowest role — at 320 pixels and on a desktop against the production build, with the approved sample texts the database holds
 * (the seed's «Regulamentul tombolei» and a privacy notice naming `{{raffle}}`, both in force in both languages):
 *
 * - from the desk, «Tombolă» is a tab of the volunteer's row — four entries that fit a phone whole —, and opens the event's raffle;
 * - the roster is there by number, with «Participă» and «Prezent», the counts and the four filters, the volunteer's own words above
 *   it — and none of the organizers' presses or files: the file's address answers 403 to the volunteer all the same;
 * - a runner who accepted the rules is signed up from their row: the press asks the tick first, then records a DESK sign-up with the
 *   volunteer as its recorder and comes back to the row, which now says «Da»;
 * - no address, email or telephone of anybody is on the page.
 *
 * Every tap target a thumb hits is 44 pixels, and no page scrolls sideways. The race and its people are written straight into the
 * database — the setup, not the subject — one set per project and run, and removed after. Never a real person.
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

/** The gate's two texts in force in both languages — the sample the seed approves (`yarn db:seed:legal` adds them). */
async function textsInForce(): Promise<void> {
  await withDatabase(async (client) => {
    const inForce = async (key: string) =>
      (
        await client.query<{ body: string }>(
          `SELECT t.body_json::text AS body FROM legal_documents d JOIN legal_document_translations t ON t.legal_document_id = d.id
            WHERE d.id = (SELECT id FROM legal_documents WHERE key = $1 AND is_approved AND withdrawn_at IS NULL AND effective_at <= now() ORDER BY version DESC LIMIT 1)`,
          [key],
        )
      ).rows;
    if ((await inForce("RAFFLE_RULES")).length < 2) throw new Error("no «Regulamentul tombolei» in force in both languages: run yarn db:seed:legal on this database");
    const notice = await inForce("PRIVACY_NOTICE");
    if (notice.length < 2 || notice.some((one) => !one.body.includes("{{raffle}}"))) throw new Error("the privacy notice in force does not name {{raffle}} in both languages: reset the database from the current templates");
  });
}

type Seeded = { eventId: string; ana: string; anaId: string; bogdan: string; volunteer: string; elite: string; participantIds: string[] };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const deskCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const PHONE = "+40712345678";

/**
 * A published race a week away whose raffle asks a sign-up, open, every group ticked: two confirmed runners (Bogdan checked in), a
 * confirmed volunteer with their V number (V001, §NNN), an address and a telephone, and a line of the elite list.
 */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number,
         accepts_volunteers, has_raffle, raffle_sign_up, raffle_sign_up_open)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1, true, true, true, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `tombola-voluntar-${tag}`,
      `Tombola voluntarilor ${tag}`,
      `raffle-volunteer-${tag}`,
      `The volunteers' raffle ${tag}`,
    ]);
    const participantIds: string[] = [];
    const runner = async (first: string, last: string, bib: number, checkedIn: boolean) => {
      const name = `${first} ${last} ${tag}`;
      const email = `${first.toLowerCase()}-tab-${tag}@test.invalid`;
      const { rows: participants } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      participantIds.push(participants[0].id);
      const { rows: registrations } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
           results_name_consent, results_consent_version, confirmed_at, bib_number, checkin_code, checked_in_at, phone)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, $4, $5, 1, now(), false, 1, now(), $6, $7, ${checkedIn ? "now()" : "NULL"}, $8) RETURNING id`,
        [eventId, participants[0].id, name, first, `${last} ${tag}`, bib, deskCode(), PHONE],
      );
      return { id: registrations[0].id, name };
    };
    const ana = await runner("Ana", "Tombola", 1, false);
    const bogdan = await runner("Bogdan", "Prezent", 2, true);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const volunteer = `Vlad Voluntar ${tag}`;
    const address = `vlad-tab-${tag}@test.invalid`;
    const { rows: helpers } = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, volunteer_number)
       VALUES ($1, $2, $3, $4, $4, 1, $5, 'CONFIRMED', 'STAFF', 1) RETURNING id`,
      [eventId, roles[0].id, volunteer, address, PHONE],
    );
    await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [helpers[0].id, roles[0].id]);
    const elite = `Eliud Linie ${tag}`;
    await client.query(`INSERT INTO event_elite_entries (event_id, name, bib_number) VALUES ($1, $2, 900)`, [eventId, elite]);
    return { eventId, ana: ana.name, anaId: ana.id, bogdan: bogdan.name, volunteer, elite, participantIds };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    // The sign-ups go with their registrations; the volunteers, the elite line, the roles and the translations with the event.
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [seeded.participantIds]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
  });
}

const entriesOf = (eventId: string) =>
  withDatabase(
    async (client) =>
      (
        await client.query<{ registrationId: string | null; method: string; recordedBy: string | null; ip: string | null }>(
          `SELECT registration_id AS "registrationId", method, recorded_by_staff_user_id AS "recordedBy", ip FROM event_raffle_entries WHERE event_id = $1 ORDER BY created_at`,
          [eventId],
        )
      ).rows,
  );

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

async function tall(locator: Locator, what: string): Promise<void> {
  expect((await locator.boundingBox())?.height ?? 0, `${what} is a thumb's 44 pixels`).toBeGreaterThanOrEqual(44);
}

test.describe("§1014 «Tombolă» for the desk's volunteer: the roster, the filters and the desk's sign-up — never the organizers' presses or files", () => {
  test.describe.configure({ timeout: 300_000 });

  test("the desk Volunteer opens «Ziua cursei» → «Tombolă», reads the roster and signs a runner up who accepted the rules", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    await textsInForce();
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await test.step("from the desk, «Tombolă» is one of the volunteer's four tabs, which fit the phone whole", async () => {
        await signIn(page, "Dev Contributor");
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}`);
        await hydrated(page);
        const tabs = page.getByTestId("race-day-tabs");
        await expect(tabs.getByRole("link")).toHaveText([/Prezența/, /Cronometrare|Sosiri/, /Tombolă/, /Lucruri/], { useInnerText: true });
        // Four short words, no glyph below `sm`: the row holds them whole, nothing past its edge.
        expect(await tabs.locator("nav").evaluate((nav) => nav.scrollWidth <= nav.clientWidth + 1)).toBe(true);
        const raffle = tabs.getByRole("link", { name: "Tombolă" });
        await tall(raffle, "the «Tombolă» tab");
        await fitsTheScreen(page);
        await raffle.click();
        await expect(page).toHaveURL(new RegExp(`/ro/admin/checkin/tombola\\?eventId=${seeded.eventId}$`), { timeout: 30_000 });
        await hydrated(page);
        await expect(tabs.getByRole("link", { name: "Tombolă" })).toHaveAttribute("aria-current", "page");
        await expect(page.getByTestId("raffle-title")).toHaveText("Tombolă");
      });

      await test.step("the roster by number, the counts and the filters, the volunteer's own words — and none of the organizers' presses or files", async () => {
        await expect(page.getByTestId("raffle-intro")).toHaveText(
          "Toți alergătorii, elitele și voluntarii evenimentului: cine participă la tombolă și cine e prezent. Cu înscriere separată, înscrie aici un alergător după ce a acceptat regulamentul.",
        );
        await expect(page.getByTestId("raffle-settings-line")).toHaveText("Participă: alergătorii, elitele, voluntarii · cu înscriere separată · înscrieri deschise");
        await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 0 · Alergători: 0 · Elite: 0 · Voluntari: 0 · Prezenți dintre ei: 0");
        await expect(page.locator('[data-testid="raffle-row-name"]:visible')).toHaveText([seeded.ana, seeded.bogdan, seeded.elite, seeded.volunteer]);
        await expect(page.locator('[data-testid="raffle-row-in"]:visible')).toHaveText(["Nu · nu s-a înscris", "Nu · nu s-a înscris", "Nu · nu s-a înscris", "Nu · nu s-a înscris"]);
        // The organizers' presses, ticks, way to the editor and files are not drawn for a volunteer.
        for (const id of ["raffle-download", "raffle-download-present", "raffle-download-random-org", "raffle-download-random-org-present", "raffle-random-org-help", "raffle-exclusion", "raffle-delete-form", "raffle-elite-present", "raffle-settings-edit", "raffle-sign-up"]) {
          await expect(page.getByTestId(id), id).toHaveCount(0);
        }
        // The desk's «Înscrie» on the two runners alone — never on the volunteer or the elite line, which are the organizers' to sign up.
        await expect(page.locator('[data-testid="raffle-desk-sign-up"]:visible')).toHaveCount(2);
        // Never an address, an email or a telephone of anybody of the race: not on the page — whose bar names the signed-in
        // colleague's own account, nobody else's — and nothing of the kind in the table.
        const text = await page.locator("main").innerText();
        for (const secret of ["test.invalid", PHONE, PHONE.slice(2)]) expect(text, secret).not.toContain(secret);
        expect(await page.locator("#raffle-rows").innerText()).not.toContain("@");
        const markup = await page.content();
        for (const secret of ["test.invalid", PHONE]) expect(markup, secret).not.toContain(secret);
        await fitsTheScreen(page);
        // «Nu participă»: nobody signed up yet, so all four — the filter keeps the tab's own address and the volunteer's view.
        const out = page.getByTestId("raffle-filter-out").getByRole("link");
        await tall(out, "the «Nu participă» pill");
        await out.click();
        await expect(page).toHaveURL(/[?&]filter=out(&|#|$)/, { timeout: 30_000 });
        await hydrated(page);
        await expect(page.locator('[data-testid="raffle-row-name"]:visible')).toHaveText([seeded.ana, seeded.bogdan, seeded.elite, seeded.volunteer]);
        await fitsTheScreen(page);
      });

      await test.step("the files' addresses answer 403 to the volunteer, as before — the random.org ones too (§NNN)", async () => {
        for (const query of ["?lang=ro", "?present=1&lang=ro", "?format=random-org&lang=ro", "?format=random-org&present=1&lang=ro"]) {
          const response = await page.request.get(`/api/admin/events/${seeded.eventId}/raffle${query}`);
          expect(response.status(), query).toBe(403);
          expect(await response.text(), query).not.toContain(seeded.ana);
        }
      });

      await test.step("Ana is signed up from her row once she accepted the rules: the tick first, then a DESK sign-up back at her row", async () => {
        const form = page.locator('[data-testid="raffle-desk-sign-up-form"]:visible').filter({ has: page.getByRole("button", { name: `Înscrie la tombolă: ${seeded.ana}` }) });
        await expect(form).toHaveCount(1);
        const press = form.getByRole("button", { name: `Înscrie la tombolă: ${seeded.ana}` });
        await tall(press, "the row's «Înscrie»");
        // Without the tick the browser holds the press and says why; nothing is written.
        await press.click();
        await expect(form.getByText("Bifează întâi că persoana a acceptat Regulamentul tombolei. Nu s-a scris nimic.")).toBeVisible({ timeout: 10_000 });
        expect(await entriesOf(seeded.eventId)).toEqual([]);
        const tick = form.getByRole("checkbox", { name: /A acceptat regulamentul/ });
        await tall(tick.locator("xpath=.."), "the tick «A acceptat regulamentul»");
        await tick.check();
        await press.click();
        await expect(page.getByText("Gata: persoana e înscrisă la tombolă.").first()).toBeVisible({ timeout: 30_000 });
        // Back on the tab, the filter kept, at Ana's row.
        await expect(page).toHaveURL(new RegExp(`/ro/admin/checkin/tombola\\?eventId=${seeded.eventId}&filter=out(#raffle-${seeded.anaId})?$`));
        await hydrated(page);
        const entries = await entriesOf(seeded.eventId);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ registrationId: seeded.anaId, method: "DESK", ip: null });
        const recorder = await withDatabase(async (client) => (await client.query<{ name: string }>("SELECT display_name AS name FROM staff_users WHERE id = $1", [entries[0].recordedBy])).rows[0]?.name);
        expect(recorder).toBe("Dev Contributor");
        await fitsTheScreen(page);
        // «Toți»: Ana now «Da», and no «Înscrie» left on her row.
        await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
        await hydrated(page);
        await expect(page.locator('[data-testid="raffle-row-in"]:visible')).toHaveText(["Da", "Nu · nu s-a înscris", "Nu · nu s-a înscris", "Nu · nu s-a înscris"]);
        await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 1 · Alergători: 1 · Elite: 0 · Voluntari: 0 · Prezenți dintre ei: 0");
        await expect(page.getByRole("button", { name: `Înscrie la tombolă: ${seeded.ana}` })).toHaveCount(0);
        await fitsTheScreen(page);
      });

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
