import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { mintActionLink } from "./support/action-link";
import { HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";

/**
 * §984, BR-REQ-050-02, BR-REQ-036-02, BR-REQ-037-08, BR-REQ-071-01 — the raffle with a sign-up of its own (the owner, 2026-11-18:
 * «Dar pentru tombolă trebuie să am o înscriere separată» — «Practic oamenii trebuie să își treacă numărul de concurs și numele» —
 * «vreau să văd în dreptul fiecărei persoane dacă participă la tombolă»), walked at 320 pixels and on a desktop against the
 * production build, with the approved sample texts the database holds (the seed's «Regulamentul tombolei» and a privacy notice
 * naming `{{raffle}}`, both in force in both languages):
 *
 * - the event's page draws one calm link to the raffle's page; there a number and a name typed another way — lower case, no
 *   diacritics, the words swapped — sign the runner up, after one wrong name was answered with the one neutral sentence;
 * - a second runner signs up from the «Tombola» card of their own «Gestionează înscrierea», the link read and never spent;
 * - the desk's volunteer records a third at the desk's view of the person, who accepted the rules on paper;
 * - the Organizer sees all three on «Ziua cursei» → «Tombolă» — the fourth of five tabs, in a row that scrolls inside itself, every
 *   tab one swipe away — with «Participă: Da», the volunteer who did not sign up «Nu», the counts and the filters, and takes the file
 *   — and its present-only twin.
 *
 * Every tap target a thumb hits is 44 pixels, and no page scrolls sideways. The race and its people are written straight into the
 * database — the setup, not the subject — one set per project and test, and removed after. Never a real person.
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

/**
 * The gate's two texts in force in both languages — the sample the seed approves from the current templates. A database seeded
 * before «Regulamentul tombolei» existed has neither: reset it from the current templates (`yarn db:seed:legal` adds the samples).
 */
async function textsInForce(): Promise<void> {
  await withDatabase(async (client) => {
    const inForce = async (key: string) =>
      (
        await client.query<{ locale: string; body: string }>(
          `SELECT t.locale, t.body_json::text AS body FROM legal_documents d JOIN legal_document_translations t ON t.legal_document_id = d.id
            WHERE d.id = (SELECT id FROM legal_documents WHERE key = $1 AND is_approved AND withdrawn_at IS NULL AND effective_at <= now() ORDER BY version DESC LIMIT 1)`,
          [key],
        )
      ).rows;
    const rules = await inForce("RAFFLE_RULES");
    const notice = await inForce("PRIVACY_NOTICE");
    if (rules.length < 2) throw new Error("no «Regulamentul tombolei» in force in both languages: run yarn db:seed:legal on this database");
    if (notice.length < 2 || notice.some((one) => !one.body.includes("{{raffle}}"))) throw new Error("the privacy notice in force does not name {{raffle}} in both languages: reset the database from the current templates");
  });
}

type Person = { id: string; participantId: string; name: string; code: string };
type Seeded = { eventId: string; slug: string; ana: Person; bogdan: Person; cristina: Person; volunteerId: string; volunteer: string };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const deskCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** A published race a week away whose raffle asks a sign-up, open, every group ticked: three confirmed runners and a volunteer. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number, volunteer_bib_start,
         accepts_volunteers, has_raffle, raffle_sign_up, raffle_sign_up_open)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1, 500, true, true, true, true) RETURNING id`,
    );
    const eventId = rows[0].id;
    const slug = `tombola-${tag}`;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      slug,
      `Crosul tombolei ${tag}`,
      `raffle-${tag}`,
      `The raffle race ${tag}`,
    ]);
    const runner = async (first: string, last: string, bib: number, checkedIn = false): Promise<Person> => {
      const name = `${first} ${last} ${tag}`;
      const email = `${first.toLowerCase()}-tombola-${tag}@test.invalid`;
      const { rows: participants } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      const code = deskCode();
      const { rows: registrations } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version, privacy_acknowledged_at,
           results_name_consent, results_consent_version, confirmed_at, bib_number, checkin_code, checked_in_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, $4, $5, 1, now(), false, 1, now(), $6, $7, ${checkedIn ? "now()" : "NULL"}) RETURNING id`,
        [eventId, participants[0].id, name, first, `${last} ${tag}`, bib, code],
      );
      return { id: registrations[0].id, participantId: participants[0].id, name, code };
    };
    const ana = await runner("Ana", "Tombolă", 1);
    const bogdan = await runner("Bogdan", "Linkescu", 2);
    // Checked in at the desk this morning: the present-only file's one.
    const cristina = await runner("Cristina", "Masa", 3, true);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const volunteer = `Vlad Voluntar ${tag}`;
    const address = `vlad-tombola-${tag}@test.invalid`;
    const { rows: helpers } = await client.query<{ id: string }>(
      `INSERT INTO event_volunteers (event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, bib_number)
       VALUES ($1, $2, $3, $4, $4, 1, '+40712345678', 'CONFIRMED', 'STAFF', 500) RETURNING id`,
      [eventId, roles[0].id, volunteer, address],
    );
    await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [helpers[0].id, roles[0].id]);
    return { eventId, slug, ana, bogdan, cristina, volunteerId: helpers[0].id, volunteer };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    // The sign-ups and the links go with their registrations, the volunteers, roles and translations with the event (ON DELETE CASCADE).
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [[seeded.ana.participantId, seeded.bogdan.participantId, seeded.cristina.participantId]]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
  });
}

type EntryRow = { registrationId: string | null; method: string; typedName: string | null; ip: string | null; recordedBy: string | null; noticeVersion: number; hash: string };
const entriesOf = (eventId: string) =>
  withDatabase(
    async (client) =>
      (
        await client.query<EntryRow>(
          `SELECT registration_id AS "registrationId", method, typed_name AS "typedName", ip, recorded_by_staff_user_id AS "recordedBy",
                  privacy_notice_version AS "noticeVersion", rules_text_hash AS hash
             FROM event_raffle_entries WHERE event_id = $1 ORDER BY created_at`,
          [eventId],
        )
      ).rows,
  );

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

async function tall(locator: ReturnType<Page["locator"]>, what: string): Promise<void> {
  expect((await locator.boundingBox())?.height ?? 0, `${what} is a thumb's 44 pixels`).toBeGreaterThanOrEqual(44);
}

const csvLines = async (page: Page, href: string) => {
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  return { disposition: response.headers()["content-disposition"] ?? "", lines: (await response.text()).replace(/^﻿/, "").split("\r\n") };
};

test.describe("§984 the raffle with a sign-up of its own: the form, the link, the desk, the tab and the file", () => {
  test.describe.configure({ timeout: 300_000 });

  test("three people sign up by three doors, and the Organizer sees them on «Tombolă» with «Participă: Da» and takes the file", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    await textsInForce();
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      await test.step("the event's page draws one calm link to the raffle's own page", async () => {
        await page.goto(`/ro/evenimente/${seeded.slug}`);
        await hydrated(page);
        const callout = page.getByTestId("raffle-callout");
        await expect(callout).toContainText("Avem tombolă! Înscrie-te cu numărul tău de concurs.");
        const button = page.getByTestId("raffle-callout-button");
        await tall(button, "«Înscrie-te la tombolă»");
        await fitsTheScreen(page);
        await button.click();
        await expect(page).toHaveURL(new RegExp(`/ro/evenimente/${seeded.slug}/tombola$`), { timeout: 30_000 });
        await hydrated(page);
        await expect(page.getByTestId("raffle-title")).toHaveText("Înscrie-te la tombolă");
        await fitsTheScreen(page);
      });

      const submit = page.getByRole("button", { name: "Particip la tombolă" });
      const accept = page.getByRole("checkbox", { name: /Am citit și accept Regulamentul tombolei/ });

      await test.step("a name that is not the number's: the one neutral sentence, what was typed back in its boxes, nothing kept", async () => {
        // The rules read in their fold, the event's facts filled.
        const rules = page.getByTestId("raffle-rules");
        await rules.locator("summary").click();
        await expect(rules).toContainText(`Tombola se ține la evenimentul Crosul tombolei ${tag}`);
        await page.getByTestId("raffle-number").fill("1");
        await page.getByTestId("raffle-name").fill("Ion Altcineva");
        await accept.check();
        await tall(submit, "«Particip la tombolă»");
        // A person reads before pressing: a press faster than the timing check allows is kept as nothing (§97).
        await page.waitForTimeout(HUMAN_PAUSE_MS);
        await submit.click();
        await expect(page.getByTestId("raffle-no-match")).toContainText("Nu am găsit o înscriere confirmată cu acest număr și acest nume.", { timeout: 30_000 });
        await hydrated(page);
        await expect(page.getByTestId("raffle-number")).toHaveValue("1");
        await expect(page.getByTestId("raffle-name")).toHaveValue("Ion Altcineva");
        expect(await entriesOf(seeded.eventId)).toEqual([]);
        await fitsTheScreen(page);
      });

      await test.step("the number and the name typed another way — lower case, no diacritics, the words swapped — sign the runner up", async () => {
        const typed = `tombola ana ${tag}`;
        await page.getByTestId("raffle-name").fill(typed);
        // The acceptance is the person's own act each time: never kept from the refused press.
        await expect(accept).not.toBeChecked();
        await accept.check();
        await page.waitForTimeout(HUMAN_PAUSE_MS);
        await submit.click();
        await expect(page.getByTestId("raffle-done")).toContainText("Gata: ești înscris la tombolă.", { timeout: 30_000 });
        await expect(page).toHaveURL(/[?&]tombola=done/);
        const entries = await entriesOf(seeded.eventId);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ registrationId: seeded.ana.id, method: "FORM", typedName: typed, recordedBy: null });
        expect(entries[0].ip).not.toBeNull();
        expect(entries[0].hash).toMatch(/^[0-9a-f]{64}$/);
        await fitsTheScreen(page);
      });

      await test.step("a second runner signs up from the «Tombola» card of their own link — read, never spent", async () => {
        const secret = await mintActionLink({ id: seeded.bogdan.id, participantId: seeded.bogdan.participantId }, "MANAGE_REGISTRATION");
        await page.goto(`/ro/inregistrari/gestionare/${secret}`);
        await hydrated(page);
        const card = page.getByTestId("manage-raffle");
        await expect(card).toContainText("La eveniment avem tombolă, cu înscriere separată: participi doar dacă te înscrii.");
        await card.getByRole("checkbox", { name: /Am citit și accept Regulamentul tombolei/ }).check();
        const press = card.getByRole("button", { name: "Particip la tombolă" });
        await tall(press, "the card's «Particip la tombolă»");
        await press.click();
        await expect(page.getByTestId("manage-raffle-done")).toContainText("Gata: te-am înscris la tombolă.", { timeout: 30_000 });
        await expect(page.getByTestId("manage-raffle-state")).toHaveText("Ești înscris la tombolă.");
        await expect(page.getByTestId("manage-raffle-withdraw").getByRole("button", { name: "Nu mai particip" })).toBeVisible();
        await fitsTheScreen(page);
        const entries = await entriesOf(seeded.eventId);
        expect(entries.map((entry) => [entry.registrationId, entry.method])).toEqual([
          [seeded.ana.id, "FORM"],
          [seeded.bogdan.id, "LINK"],
        ]);
        expect(entries[1].ip).not.toBeNull();
        const spent = await withDatabase(async (client) => (await client.query<{ used: Date | null }>("SELECT used_at AS used FROM email_action_tokens WHERE registration_id = $1 AND purpose = 'MANAGE_REGISTRATION' AND invalidated_at IS NULL", [seeded.bogdan.id])).rows);
        expect(spent).toEqual([{ used: null }]);
      });

      await test.step("the desk's volunteer records a third at the desk's view of the person, who accepted on paper; the desk's list says it too", async () => {
        await signIn(page, "Dev Contributor");
        await page.goto(`/ro/admin/checkin/${seeded.cristina.code}`);
        await hydrated(page);
        const desk = page.getByTestId("desk-raffle");
        await expect(desk.getByTestId("desk-raffle-line")).toContainText("Tombolă: nu participă");
        await expect(desk.getByTestId("desk-raffle-line")).toContainText("De ce: nu s-a înscris");
        await desk.getByRole("checkbox", { name: /A acceptat regulamentul/ }).check();
        const press = desk.getByRole("button", { name: `Înscrie la tombolă: ${seeded.cristina.name}` });
        await tall(press, "the desk's «Înscrie la tombolă»");
        await press.click();
        await expect(page.getByText("Gata: persoana e înscrisă la tombolă.").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("desk-raffle-line")).toContainText("Tombolă: participă");
        await fitsTheScreen(page);
        const entries = await entriesOf(seeded.eventId);
        expect(entries.at(-1)).toMatchObject({ registrationId: seeded.cristina.id, method: "DESK", ip: null });
        expect(entries.at(-1)?.recordedBy).not.toBeNull();
        // The desk's list says it too, inside each row a search finds (§984): Ana, in by the form a moment ago.
        await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.ana.name)}`);
        await hydrated(page);
        const row = page.getByTestId("desk-row").filter({ hasText: seeded.ana.name });
        await expect(row.getByTestId("desk-raffle-line")).toContainText("Tombolă: participă");
        await fitsTheScreen(page);
      });

      await test.step("the Organizer sees everybody on «Ziua cursei» → «Tombolă», the three with «Participă: Da»", async () => {
        // Out first: the sign-in page sends a signed-in colleague to their own landing, and the switcher's buttons never show.
        await page.getByRole("button", { name: "Ieși din cont" }).click();
        await expect(page).not.toHaveURL(/\/admin/, { timeout: 30_000 });
        await signIn(page, "Dev Moderator");
        await page.goto(`/ro/admin/checkin/tombola?eventId=${seeded.eventId}`);
        await hydrated(page);
        const tabs = page.getByTestId("race-day-tabs");
        await expect(tabs.getByRole("link", { name: "Tombolă" })).toHaveAttribute("aria-current", "page");
        // The organizers' seven (§984, §986, §996, §1018): «Prezența», «Clasament», «Cronometrare» («Sosiri» on a phone), «Tombolă», «Lucruri de adus», «Jurnal», «Declarații».
        await expect(tabs.getByRole("link")).toHaveText([/Prezența/, /Clasament/, /Cronometrare|Sosiri/, /Tombolă/, /Lucruri/, /Jurnal/, /Declarații/], { useInnerText: true });
        // Seven entries are wider than a phone's row, so the row is no `fits` row: its current entry is brought into view —
        // «Tombolă», wholly inside the row, on the phone and on the desktop alike (`SubNavCurrent`, §731).
        await expect
          .poll(async () =>
            tabs.locator("nav").evaluate((nav) => {
              const entry = nav.querySelector('[aria-current="page"]');
              if (!entry) return "no current entry";
              const bar = nav.getBoundingClientRect();
              const box = entry.getBoundingClientRect();
              return box.left >= bar.left - 1 && box.right <= bar.right + 1 ? "in view" : `${Math.round(box.left - bar.left)}–${Math.round(box.right - bar.left)} px of a ${Math.round(bar.width)} px row`;
            }),
          )
          .toBe("in view");
        // …and every other entry is one sideways swipe away: scrolled to, it lies wholly inside the row, which scrolls inside itself.
        const reach = await tabs.locator("nav").evaluate((nav) => {
          const scrolls = ["auto", "scroll"].includes(getComputedStyle(nav).overflowX);
          const start = nav.scrollLeft;
          const missed: string[] = [];
          for (const link of Array.from(nav.querySelectorAll("a"))) {
            link.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
            const bar = nav.getBoundingClientRect();
            const box = link.getBoundingClientRect();
            if (box.left < bar.left - 1 || box.right > bar.right + 1) missed.push(link.textContent ?? "");
          }
          nav.scrollLeft = start;
          return { scrolls, missed };
        });
        expect(reach).toEqual({ scrolls: true, missed: [] });
        await expect(page.getByTestId("raffle-settings-line")).toHaveText("Participă: alergătorii, elitele, voluntarii · cu înscriere separată · înscrieri deschise");
        await expect(page.getByTestId("raffle-counts")).toHaveText("Participă: 3 · Alergători: 3 · Elite: 0 · Voluntari: 0 · Prezenți dintre ei: 1");
        const names = page.locator('[data-testid="raffle-row-name"]:visible');
        await expect(names).toHaveText([seeded.ana.name, seeded.bogdan.name, seeded.cristina.name, seeded.volunteer]);
        const answers = page.locator('[data-testid="raffle-row-in"]:visible');
        await expect(answers).toHaveText(["Da", "Da", "Da", "Nu · nu s-a înscris"]);
        await fitsTheScreen(page);
        // «Participă»: the three alone.
        const taking = page.getByTestId("raffle-filter-in").getByRole("link");
        await tall(taking, "the «Participă» pill");
        await taking.click();
        await expect(page).toHaveURL(/[?&]filter=in(&|#|$)/, { timeout: 30_000 });
        await hydrated(page);
        await expect(page.locator('[data-testid="raffle-row-name"]:visible')).toHaveText([seeded.ana.name, seeded.bogdan.name, seeded.cristina.name]);
        await fitsTheScreen(page);
      });

      await test.step("the file holds the three by their numbers, and its present-only twin the one the desk checked in", async () => {
        const whole = page.getByTestId("raffle-download");
        await tall(whole, "the file's button");
        const file = await csvLines(page, (await whole.getAttribute("href")) as string);
        expect(file.disposition).toMatch(/^attachment; filename="tombola-\d{4}-\d{2}-\d{2}\.csv"/);
        expect(file.lines).toEqual(["Număr,Nume,Categorie,Prezent", `1,${seeded.ana.name},Alergător,Nu`, `2,${seeded.bogdan.name},Alergător,Nu`, `3,${seeded.cristina.name},Alergător,Da`, ""]);
        const present = await csvLines(page, (await page.getByTestId("raffle-download-present").getAttribute("href")) as string);
        expect(present.lines).toEqual(["Număr,Nume,Categorie,Prezent", `3,${seeded.cristina.name},Alergător,Da`, ""]);
      });

      expect(hydrationWarnings, "hydration warnings").toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });
});
