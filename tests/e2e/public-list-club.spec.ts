import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * §753 and §756 (amending §32, §143 and §396; the owner, 2026-10-13: «people type stupid things there, I just
 * want to show Brașov Runners members and ignore the other clubs … but I still want to show the BVR ones») —
 * «Clubul pe lista publică»: under the default everyone who typed the club shows the club's name in «Cine
 * vine», with or without an account on «Echipa» (§756: the club's runners have none); a member who typed
 * nonsense shows nothing. The editor's three radios switch it, and the saved choice reaches the page.
 *
 * The runner with no account types a variant («Brasov Runers»), so the cell is seen turning it into the club's
 * name rather than passing it through; another with no account types another club, which stays blank.
 *
 * The event, the four runners and the two member accounts are written straight into the database — the
 * setup, not the subject (`hidden-list.spec.ts`) — one set per project and run, so the two projects never
 * share a row.
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

const SILLY = "alergam pe tavan";
/** The club's name as a runner without an account mistyped it: the list writes the club's own spelling. */
const VARIANT = "Brasov Runers";
const OTHER_CLUB = "CS Rapid";

type Seeded = { eventId: string; slug: string; names: { nickname: string; silly: string; stranger: string; rival: string } };

/** A published race whose list names its runners, and four confirmed runners with their clubs. */
async function seedRace(tag: string): Promise<Seeded> {
  const compact = tag.replace(/[^a-z0-9]/gi, "");
  const names = {
    nickname: `Membra Bvr ${compact}`,
    silly: `Membru Tavan ${compact}`,
    stranger: `Vizitator Club ${compact}`,
    rival: `Vizitator Rival ${compact}`,
  };
  const slug = `lista-club-${tag}`;
  let eventId = "";
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, participant_list_visibility)
       VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now(), 'NAMES') RETURNING id`,
    );
    eventId = rows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title) VALUES ($1, 'ro', $2, $3), ($1, 'en', $4, $5)`,
      [eventId, slug, `Crosul clubului ${tag}`, `club-column-${tag}`, `The club race ${tag}`],
    );
    const people = [
      { name: names.nickname, club: "BVR", member: true },
      { name: names.silly, club: SILLY, member: true },
      { name: names.stranger, club: VARIANT, member: false },
      { name: names.rival, club: OTHER_CLUB, member: false },
    ];
    for (const [index, person] of people.entries()) {
      const email = `club-col-${index}-${tag}@test.invalid`.toLowerCase();
      const { rows: participantRows } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, person.name],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, club_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, $4, 1, now(), false, 1, false, now() + ($5 || ' seconds')::interval)`,
        [eventId, participantRows[0].id, person.name, person.club, String(index)],
      );
      if (person.member) {
        await client.query(`INSERT INTO staff_users (email, display_name, role) VALUES ($1, $2, 'MEMBER')`, [email, person.name]);
      }
    }
  });
  return { eventId, slug, names };
}

const rowOf = (page: import("@playwright/test").Page, name: string) => page.getByTestId("start-list-named").filter({ hasText: name });

test.describe("§753, §756 «Clubul pe lista publică»: only the club's own name shows by default", () => {
  test.describe.configure({ timeout: 90_000 });

  test("the default names the club for everyone who typed it, account or not, in its own spelling, and for nobody else; the editor's radios switch it", async ({ page }) => {
    const stamp = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seedRace(stamp);

    // The default: the member who typed «BVR» and the runner with no account who mistyped the club's name
    // both show it, in the club's own spelling; the nonsense and the other club are blank and nowhere on the page.
    await page.goto(`/ro/evenimente/${seeded.slug}`);
    await expect(page.getByTestId("start-list")).toHaveCount(1);
    const list = page.getByTestId("start-list");
    await expect(rowOf(page, seeded.names.nickname).locator('td[data-col="club"]')).toHaveText("Brașov Runners");
    await expect(rowOf(page, seeded.names.silly).locator('td[data-col="club"]')).toHaveText("");
    await expect(rowOf(page, seeded.names.stranger).locator('td[data-col="club"]')).toHaveText("Brașov Runners");
    await expect(rowOf(page, seeded.names.rival).locator('td[data-col="club"]')).toHaveText("");
    await expect(list).not.toContainText(SILLY);
    await expect(list).not.toContainText("BVR");
    await expect(list).not.toContainText(VARIANT);
    await expect(list).not.toContainText(OTHER_CLUB);
    await expect(list.locator('th[data-col="club"]')).toHaveCount(1);

    // The editor: three radios, each a 44-pixel row, «Doar …» checked.
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${seeded.eventId}`);
    await hydrated(page);
    const box = await openEditorBox(page, "Lista publică a participanților");
    const choices = box.getByTestId("public-list-club-choices");
    const onlyClub = choices.getByRole("radio", { name: /^Doar / });
    const asTyped = choices.getByRole("radio", { name: "Cum l-au scris" });
    await expect(onlyClub).toBeChecked();
    for (const label of ["Cum l-au scris", "Nu arăta clubul"]) {
      expect((await choices.locator("label").filter({ hasText: label }).boundingBox())?.height ?? 0, label).toBeGreaterThanOrEqual(44);
    }

    const save = async () => {
      // Live (published): saving a change asks for the acknowledgement first.
      await page.getByRole("checkbox", { name: "Am înțeles că modific conținut publicat." }).check();
      await page.getByRole("button", { name: "Salvează", exact: true }).click();
      await page.waitForURL(/saved=event/);
    };

    // «Cum l-au scris»: everything typed shows, as the list always did.
    await asTyped.check();
    await save();
    await page.goto(`/ro/evenimente/${seeded.slug}`);
    await expect(rowOf(page, seeded.names.silly).locator('td[data-col="club"]')).toHaveText(SILLY);
    await expect(rowOf(page, seeded.names.nickname).locator('td[data-col="club"]')).toHaveText("BVR");
    await expect(rowOf(page, seeded.names.stranger).locator('td[data-col="club"]')).toHaveText(VARIANT);
    await expect(rowOf(page, seeded.names.rival).locator('td[data-col="club"]')).toHaveText(OTHER_CLUB);

    // «Nu arăta clubul»: no column at all.
    await page.goto(`/ro/admin/events/${seeded.eventId}`);
    await hydrated(page);
    const again = await openEditorBox(page, "Lista publică a participanților");
    await expect(again.getByTestId("public-list-club-choices").getByRole("radio", { name: "Cum l-au scris" })).toBeChecked();
    await again.getByTestId("public-list-club-choices").getByRole("radio", { name: "Nu arăta clubul" }).check();
    await save();
    await page.goto(`/ro/evenimente/${seeded.slug}`);
    await expect(page.getByTestId("start-list")).toContainText(seeded.names.nickname);
    await expect(page.getByTestId("start-list").locator('th[data-col="club"]')).toHaveCount(0);
    await expect(page.getByTestId("start-list").locator('td[data-col="club"]')).toHaveCount(0);
    await expect(page.getByTestId("start-list")).not.toContainText(SILLY);
    await expect(page.getByTestId("start-list")).not.toContainText(OTHER_CLUB);
  });
});
