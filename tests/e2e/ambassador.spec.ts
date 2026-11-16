import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN, BR-REQ-038-01, BR-REQ-050-02, BR-REQ-037-07 — «Ambasador» beside «Elită», and «Șterge» on an invitation that
 * ended unaccepted (the owner, 2026-11-14: «pe lângă Elite, adaugă și categoria de „Ambasadori" ca să putem decide pe cine
 * premiem și pe cine nu», and «am o invitație retrasă, vreau să o pot șterge!»).
 *
 * What only a browser can see here, and the unit and PGlite tests cannot: the mark and its two ticks are items of a row's
 * «⋮» — a client menu submitting hidden forms by their id — so, as the Administrator: «Marchează ca ambasador» is the
 * press itself and comes back to the list with the chip and the toast; the same menu then holds «Nu mai e ambasador» and
 * the pair of ticks, ticked; «Apare în clasament» unticked from there leaves the runner out of the ranking the results
 * page saves — «în afara clasamentului» on their line of «Clasament», the chip «Ambasador» beside the name, and nobody of
 * theirs at «Premii»; ticked again on the registration's own page, they are first and the podium's row wears the chip; and
 * the «Ambasadori» fold's one-press «Nu mai e ambasador» takes the mark off. And an invitation that was withdrawn is
 * deleted from its row of the list, one that ran past its deadline from its line of the «Invitații» panel — each asked
 * first, naming the person — while an open one is offered no «Șterge» anywhere.
 *
 * The races, the runners and the invitations are written straight into the database — the setup, not the subject — one set
 * per project and test, so the two projects never share a row. Never a real person: every name and address is made up.
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

/** A race taking registrations on the site, `startsIn` from now (a Postgres interval, negative for one already run). */
async function seedRace(tag: string, startsIn: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name)
       VALUES ('RACE', now() + $1::interval, 'INTERNAL', 50, 'Parcul Tractorul') RETURNING id`,
      [startsIn],
    );
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      rows[0].id,
      `ambasador-${tag}`,
      `Crosul ambasadorilor ${tag}`,
      `ambassador-${tag}`,
      `The ambassadors' race ${tag}`,
    ]);
    return rows[0].id;
  });
}

async function seedParticipant(client: pg.Client, email: string, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
    [email, name],
  );
  return rows[0].id;
}

/** A confirmed man of the race wearing `bib`, who ticked «Vreau să apar». */
async function seedRunner(eventId: string, tag: string, name: string, bib: number): Promise<string> {
  return withDatabase(async (client) => {
    const participantId = await seedParticipant(client, `ambassador-${bib}-${tag}@test.invalid`, name);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
         email_confirmed_at, confirmed_at, bib_number, sex, birth_date, list_opt_out)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
         now() - interval '5 days', now() - interval '5 days', $4, 'MALE', '1990-01-01', false)
       RETURNING id`,
      [eventId, participantId, name, bib],
    );
    return rows[0].id;
  });
}

/** An invitation of the race in the state asked for: withdrawn by the club, past its deadline and stamped, or still open. */
async function seedInvitation(eventId: string, tag: string, name: string, state: "withdrawn" | "expired" | "sent"): Promise<string> {
  return withDatabase(async (client) => {
    const email = `ambassador-invite-${state}-${tag}@test.invalid`;
    const participantId = await seedParticipant(client, email, name);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO event_invitations (event_id, participant_id, name, email, canonical_email, sent_at, last_sent_at, expires_at, withdrawn_at, expired_at)
       VALUES ($1, $2, $3, $4, $4, now() - interval '9 days', now() - interval '9 days',
         CASE WHEN $5 = 'expired' THEN now() - interval '2 days' ELSE now() + interval '5 days' END,
         CASE WHEN $5 = 'withdrawn' THEN now() - interval '1 day' END,
         CASE WHEN $5 = 'expired' THEN now() - interval '2 days' END)
       RETURNING id`,
      [eventId, participantId, name, email, state],
    );
    return rows[0].id;
  });
}

async function marksOf(registrationId: string): Promise<{ ambassador: boolean; elite: boolean; outOfResults: boolean; offSite: boolean }> {
  return withDatabase(
    async (client) =>
      (
        await client.query<{ ambassador: boolean; elite: boolean; outOfResults: boolean; offSite: boolean }>(
          `SELECT ambassador, elite, elite_hidden_from_results AS "outOfResults", elite_hidden_from_site AS "offSite" FROM registrations WHERE id = $1`,
          [registrationId],
        )
      ).rows[0],
  );
}

async function invitationsLeft(eventId: string): Promise<string[]> {
  return withDatabase(async (client) => (await client.query<{ name: string }>(`SELECT name FROM event_invitations WHERE event_id = $1 ORDER BY name`, [eventId])).rows.map((row) => row.name));
}

const listUrl = (eventId: string) => `/ro/admin/registrations?eventId=${eventId}`;
const resultsUrl = (eventId: string) => `/ro/admin/events/${eventId}/results`;
const resultLine = (page: Page, bib: number): Locator => page.locator(`[data-testid="result-line"][data-bib="${bib}"]`);

/** A row's «⋮», opened: the list streams, so it is read inside `#main`. */
async function openRowMenu(page: Page, name: string) {
  await page.locator("#main").getByRole("button", { name: `Acțiuni pentru ${name}` }).first().click();
}

test.describe("§NNN «Ambasador» beside «Elită»", () => {
  test.describe.configure({ timeout: 240_000 });

  test("the Administrator marks a runner, takes them out of the ranking by the tick, reads it on «Clasament» and «Premii», and unmarks", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    // A race run two days ago: its results can be typed.
    const eventId = await seedRace(tag, "-2 days");
    const ana = `Andrei Pop ${tag}`;
    const ben = `Ben Marin ${tag}`;
    const dan = `Dan Ionescu ${tag}`;
    await seedRunner(eventId, tag, ana, 301);
    await seedRunner(eventId, tag, ben, 302);
    const danId = await seedRunner(eventId, tag, dan, 303);

    await signIn(page, "Dev Administrator");
    await page.goto(listUrl(eventId));
    await hydrated(page);
    const main = page.locator("#main");
    await expect(main.getByTestId("ambassador-chip")).toHaveCount(0);
    // No ambassador yet: the fold says so in its line.
    await expect(page.getByTestId("registrations-ambassadors").locator(":scope > summary")).toContainText("0 ambasadori");

    // ---- The mark, from the row's «⋮»: the press is the mark, and a row with neither mark has no tick to offer ----------
    await openRowMenu(page, dan);
    const mark = page.getByRole("menuitem", { name: "Marchează ca ambasador" });
    // A thumb's target with its glyph (BR-REQ-041-01 criterion 6, §521); polled, the menu grows in.
    await expect.poll(async () => (await mark.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(mark.locator("svg")).toHaveCount(1);
    await expect(page.getByRole("menuitem", { name: "Nu mai e ambasador" })).toHaveCount(0);
    await expect(page.getByRole("menuitemcheckbox", { name: /Apare în clasament/ })).toHaveCount(0);
    await mark.click();
    await expect(page).toHaveURL(/[?&]saved=ambassadorMarked/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Marcat ca ambasador", { timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`eventId=${eventId}`));
    await hydrated(page);
    // The row is drawn twice (table and phone list), each with its chip.
    await expect(main.getByTestId("ambassador-chip").first()).toContainText("Ambasador");
    // The bib stays the ordinary one: the elite's chip is nowhere.
    await expect(main.getByTestId("elite-chip")).toHaveCount(0);
    expect(await marksOf(danId)).toEqual({ ambassador: true, elite: false, outOfResults: false, offSite: false });

    // ---- The fold beside «Elite» lists them, with the number -------------------------------------------------------------
    const fold = page.getByTestId("registrations-ambassadors");
    await expect(fold.locator(":scope > summary")).toContainText("1 ambasador");
    await openFold(fold);
    await expect(fold.getByTestId("registrations-ambassador")).toHaveCount(1);
    await expect(fold.getByTestId("registrations-ambassador")).toContainText(dan);
    await expect(fold.getByTestId("registrations-ambassador-number")).toContainText("303");
    await expect(fold.getByTestId("registrations-ambassador-out")).toHaveCount(0);

    // ---- The pair of ticks, in the same menu: «Apare în clasament» unticked ---------------------------------------------
    await openRowMenu(page, dan);
    await expect(page.getByRole("menuitem", { name: "Marchează ca ambasador" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Nu mai e ambasador" })).toHaveCount(1);
    await expect(page.getByRole("menuitemcheckbox", { name: /Apare pe site/ })).toHaveAttribute("aria-checked", "true");
    const inResults = page.getByRole("menuitemcheckbox", { name: /Apare în clasament/ });
    await expect(inResults).toHaveAttribute("aria-checked", "true");
    await inResults.click();
    await expect(page).toHaveURL(/[?&]saved=eliteTicked/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Bifa a fost salvată", { timeout: 30_000 });
    await hydrated(page);
    expect(await marksOf(danId)).toEqual({ ambassador: true, elite: false, outOfResults: true, offSite: false });
    // The fold says what the tick hides of them, so «Premii» holds no surprise.
    await openFold(page.getByTestId("registrations-ambassadors"));
    await expect(page.getByTestId("registrations-ambassadors").getByTestId("registrations-ambassador-out")).toContainText("în afara clasamentului");

    // ---- «Clasament»: the fastest of the three is the ambassador, and is not ranked -------------------------------------
    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await page.locator('[name="r[301].time"]').fill("0:40:00");
    await page.locator('[name="r[302].time"]').fill("0:41:00");
    await page.locator('[name="r[303].time"]').fill("0:38:00");
    await page.getByRole("button", { name: "Salvează tot clasamentul" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Am salvat 3 rezultate", { timeout: 30_000 });
    await hydrated(page);
    // Whose result it is, beside the name; no place, «în afara clasamentului» in its stead.
    await expect(resultLine(page, 303).getByTestId("result-mark-ambassador")).toContainText("Ambasador");
    await expect(resultLine(page, 303).getByTestId("result-out-of-ranking")).toContainText("în afara clasamentului");
    await expect(resultLine(page, 301).getByTestId("result-mark-ambassador")).toHaveCount(0);
    await expect(resultLine(page, 301).getByTestId("result-place")).toContainText("1");
    await expect(resultLine(page, 302).getByTestId("result-place")).toContainText("2");
    // «Premii»: the podium is the others'.
    const awards = page.getByTestId("results-awards");
    await openFold(awards);
    await expect(awards.getByTestId("results-award-row").first()).toContainText("#301");
    await expect(awards.getByTestId("results-award-row").filter({ hasText: "#303" })).toHaveCount(0);
    await expect(awards.getByTestId("results-award-mark-ambassador")).toHaveCount(0);

    // ---- Ticked again on the registration's own page: the card is the ambassador's, under its own name ------------------
    await page.goto(`/ro/admin/registrations/${danId}`);
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("ambassador-chip").first()).toContainText("Ambasador");
    const card = page.getByTestId("elite-ticks");
    await expect(card).toContainText("Ambasador: clasament și site");
    const tick = card.getByTestId("elite-tick-inResults");
    await expect(tick).toHaveAttribute("aria-checked", "false");
    await tick.click();
    await expect(page.getByTestId("toast-live")).toContainText("Bifa a fost salvată", { timeout: 30_000 });
    await hydrated(page);
    expect(await marksOf(danId)).toEqual({ ambassador: true, elite: false, outOfResults: false, offSite: false });

    // …and they are first again, the podium's row saying whose result it is.
    await page.goto(resultsUrl(eventId));
    await hydrated(page);
    await expect(resultLine(page, 303).getByTestId("result-out-of-ranking")).toHaveCount(0);
    await expect(resultLine(page, 303).getByTestId("result-place")).toContainText("1");
    await expect(resultLine(page, 301).getByTestId("result-place")).toContainText("2");
    const podium = page.getByTestId("results-awards");
    await openFold(podium);
    const first = podium.getByTestId("results-award-row").filter({ hasText: "#303" }).first();
    await expect(first).toContainText(dan);
    await expect(first.getByTestId("results-award-mark-ambassador")).toContainText("Ambasador");

    // ---- Off again, by the fold's one press ------------------------------------------------------------------------------
    await page.goto(listUrl(eventId));
    await hydrated(page);
    const again = page.getByTestId("registrations-ambassadors");
    await openFold(again);
    const unmark = again.getByRole("button", { name: `Nu mai e ambasador: ${dan}` });
    expect((await unmark.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await unmark.click();
    await expect(page).toHaveURL(/[?&]saved=ambassadorUnmarked/, { timeout: 30_000 });
    await expect(page.getByTestId("toast-live")).toContainText("Nu mai e ambasador", { timeout: 30_000 });
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("ambassador-chip")).toHaveCount(0);
    await expect(page.getByTestId("registrations-ambassadors").locator(":scope > summary")).toContainText("0 ambasadori");
    expect((await marksOf(danId)).ambassador).toBe(false);
    // The page fits its width, phone and desk.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("«Șterge» on an invitation that ended unaccepted: from its row of the list and from the panel, asked first; an open one has none", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag, "60 days");
    const withdrawn = `Paula Retrasă ${tag}`;
    const expired = `Emil Expirat ${tag}`;
    const open = `Oana Deschisă ${tag}`;
    await seedInvitation(eventId, tag, withdrawn, "withdrawn");
    await seedInvitation(eventId, tag, expired, "expired");
    await seedInvitation(eventId, tag, open, "sent");

    await signIn(page, "Dev Administrator");
    await page.goto(listUrl(eventId));
    await hydrated(page);
    const main = page.locator("#main");
    // The list is drawn twice — a table on a desk, cards on a phone — and only one is shown: the row a person sees.
    const rowOf = (name: string) => main.locator('[data-testid="registrations-invitation-row"]:visible').filter({ hasText: name });

    // ---- On the list: the withdrawn invitation's own row holds «Șterge»; the open one's does not -----------------------
    await expect(rowOf(withdrawn)).toContainText("Invitație retrasă");
    await expect(rowOf(open).getByTestId("registrations-invitation-delete-form")).toHaveCount(0);
    const press = rowOf(withdrawn).getByTestId("registrations-invitation-delete-form").getByRole("button", { name: "Șterge" });
    expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(press.locator("svg")).toHaveCount(1);
    await press.click();
    // It asks first, naming the person and saying nobody is written to.
    const dialog = page.getByRole("dialog", { name: "Ștergi invitația?" });
    await expect(dialog).toContainText(withdrawn);
    await expect(dialog).toContainText("Nu se poate reveni");
    await confirmDialog(page, "Ștergi invitația?");
    await expect(page.getByTestId("toast-live")).toContainText("Invitație ștearsă.", { timeout: 30_000 });
    await expect.poll(() => invitationsLeft(eventId), { timeout: 30_000 }).toEqual([expired, open].sort());
    await hydrated(page);
    await expect(main.getByTestId("registrations-invitation-row").filter({ hasText: withdrawn })).toHaveCount(0);

    // ---- In «Invitații»: the expired one's line holds it too; the open one's holds «Retrage» and no «Șterge» ------------
    const panel = page.getByTestId("registrations-invitations");
    await openFold(panel);
    const lineOf = (name: string) => panel.getByTestId("invitation-row").filter({ hasText: name });
    await expect(lineOf(open).getByTestId("invitation-delete-form")).toHaveCount(0);
    await expect(lineOf(open).getByTestId("invitation-withdraw-form")).toHaveCount(1);
    await lineOf(expired).getByTestId("invitation-delete-form").getByRole("button", { name: "Șterge" }).click();
    await expect(page.getByRole("dialog", { name: "Ștergi invitația?" })).toContainText(expired);
    await confirmDialog(page, "Ștergi invitația?");
    // The first press's toast may still stand: the row gone from the database is what says this press landed.
    await expect.poll(() => invitationsLeft(eventId), { timeout: 30_000 }).toEqual([open]);
    await expect(page.getByTestId("toast-live")).toContainText("Invitație ștearsă.", { timeout: 30_000 });
    await hydrated(page);
    await expect(page.getByTestId("registrations-invitations").getByTestId("invitation-row").filter({ hasText: expired })).toHaveCount(0);
    // The open invitation is untouched, on the list and in the panel.
    await expect(rowOf(open)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
