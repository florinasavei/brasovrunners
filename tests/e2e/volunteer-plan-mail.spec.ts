import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §956, BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01 — «Trimite fiecăruia punctul lui» on «Planul voluntarilor» (the owner,
 * 2026-11-16: «…si sa ii pot distribui din aplicatie, sa stie exact unde si cum» — «Email din site, la apăsarea ta»).
 *
 * What only a browser can see, and the unit and PGlite tests cannot: the press is a form behind the one confirmation dialog,
 * and «Trimite din nou tuturor» is a box *in that dialog* (`ConfirmSpec.option`) whose tick has to travel — the dialog's
 * state, the form's hidden `again`, `requestSubmit()`, the Server Action reading `again=on`. So, as the Organizer, on a
 * 320-pixel phone and on a desktop:
 *
 * - the section states the four numbers, its button is a thumb's size and nothing is wider than the screen; the question
 *   states the same numbers one a line and the email that leaves, with no box while nobody knows their point; the press
 *   lands back on the plan at its section, the toast states the count, and one message a placed person is queued;
 * - placing a third person («Pune aici») tells nobody;
 * - pressing again offers the box: ticked, the question reads as the wider press, and confirming queues one message for
 *   everybody — the two already told their second telling, marked a resend;
 * - a tick the reader cancelled does not ride along: asked again the box is unticked, and confirming writes only to the
 *   person placed since; and once everybody knows their point the button itself is «Trimite din nou tuturor», the form
 *   posting `again=on` as the server drew it.
 *
 * The race, its two points and its three volunteers are written straight into the database — the setup, not the subject —
 * one set per project and test, so two runs never share a row. Never a real person: every name and address is made up. What
 * the message says and what is withdrawn at the send are `tests/integration/volunteers/plan-mail.test.ts`.
 *
 * And, on the same page and the same seeded race, «Punctele planului» (§961; the owner, 2026-11-17: «vreau să pot defini
 * punctele de mână, să pun nume punct și la ce km e și coordonate punct» — «Practic voluntarii sunt de 2 tipuri:
 * start-finish și pe traseu»): the Organizer adds a point at the start–finish and a point on the route by hand — a
 * refused press keeping what was typed —, sees each in its group, the route point numbered in the route's order with
 * «Deschide pe hartă», places a person at each, changes one point and deletes the other, whose person is then under
 * «Fără punct». The rules of each press are `tests/integration/volunteers/plan-points.test.ts` and
 * `plan-points-screens.test.ts`.
 *
 * And the two views (§974; the owner, 2026-11-17: «aș vrea să văd punctele ca și tabel, mai ales pe traseu», then of the
 * page's long run of cards: «vreau secțiuni colapsabile aici la plan voluntari că nu mai înțeleg nimic: de fapt tabel sau mai
 * multe views»): «Tabel», the default, is «Punctele, pe scurt» — every point in one table, a row a point on a desktop, a block
 * a point on a 320-pixel phone, the route by kilometre and then the start–finish, the people with their telephones,
 * «niciunul» and the total —; «Pe puncte» is the points in two folds, «Pe traseu» and «La start–finish», each point a fold
 * whose bar is its name in bold, its kilometre and how many stand there, and whose pencil opens «Modifică punctul». The
 * Organizer switches between them by their two links, follows a point's name from the table to that point, open, and prints
 * each view — the table as a table, the points with every fold open. Every press of the journeys above comes back to the
 * view it was pressed in, with what it changed open. What each cell and each fold says in both languages is
 * `tests/integration/volunteers/plan-table-screens.test.ts` and `plan-views-screens.test.ts`.
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

type Person = { id: string; name: string; email: string };

/**
 * A race a month away with two points on its route — the junction at 1.2 km, the water at 5.5 km — and three confirmed
 * volunteers with an address each: Ana at the junction, Dan at the water, Radu at no point yet.
 */
async function seed(tag: string) {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name, accepts_volunteers)
       VALUES ('RACE', now() + interval '30 days', 'NONE', 'Parcul Tractorul', true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `planul-${tag}`,
      `Crosul planului ${tag}`,
      `the-plan-${tag}`,
      `The plan race ${tag}`,
    ]);
    const point = async (position: number, nameRo: string, nameEn: string, km: string, kind: string) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO event_checkpoints (event_id, position, name_ro, name_en, km, kinds) VALUES ($1, $2, $3, $4, $5, ARRAY[$6]::event_checkpoint_kind[]) RETURNING id`,
          [eventId, position, nameRo, nameEn, km, kind],
        )
      ).rows[0].id;
    const junction = await point(0, "Intersecția Stejeriș", "Stejeriș junction", "1.20", "DIRECTION");
    const water = await point(1, "Apă la cabană", "Water at the hut", "5.50", "WATER");
    // The address is its own canonical form (lower case, no tag): the «already told» question compares through the canonicalizer.
    const volunteer = async (first: string, last: string, checkpointId: string | null): Promise<Person> => {
      const name = `${first} ${last} ${tag}`;
      const email = `${first.toLowerCase()}-${tag}@example.test`;
      const { rows: made } = await client.query<{ id: string }>(
        `INSERT INTO event_volunteers (event_id, name, email, canonical_email, canonicalization_version, phone, state, source, checkpoint_id)
         VALUES ($1, $2, $3, $3, 1, '+40712345678', 'CONFIRMED', 'STAFF', $4) RETURNING id`,
        [eventId, name, email, checkpointId],
      );
      return { id: made[0].id, name, email };
    };
    const ana = await volunteer("Ana", "Pop", junction);
    const dan = await volunteer("Dan", "Ene", water);
    const radu = await volunteer("Radu", "Liber", null);
    return { eventId, points: { junction, water }, ana, dan, radu };
  });
}

type PointMail = { volunteerId: string; checkpointId: string; round: number; to: string; resend: boolean; cause: string | null; pressId: string | null; pressedBy: string | null };

/** Every `VOLUNTEER_POINT` row of the event, by address then telling: whom, which point, which telling, and the press that queued it. */
const pointMails = (eventId: string) =>
  withDatabase(
    async (client) =>
      (
        await client.query<PointMail>(
          `SELECT e.payload_json->>'volunteerId' AS "volunteerId", e.payload_json->>'checkpointId' AS "checkpointId", (e.payload_json->>'round')::int AS round,
                  e.recipient_email AS "to", e.is_manual_resend AS resend, e.cause, e.press_id AS "pressId", s.role AS "pressedBy"
             FROM email_outbox e LEFT JOIN staff_users s ON s.id = e.requested_by_staff_user_id
            WHERE e.message_type = 'VOLUNTEER_POINT' AND e.payload_json->>'eventId' = $1
            ORDER BY e.recipient_email, (e.payload_json->>'round')::int`,
          [eventId],
        )
      ).rows,
  );

/** What a row says of its message, without the press: the shape the assertions compare. */
const told = (rows: readonly PointMail[]) => rows.map(({ volunteerId, checkpointId, round, to, resend }) => ({ volunteerId, checkpointId, round, to, resend }));

/** The trail of the presses on one event, oldest first: counts and a tick, never a person. */
const trail = (eventId: string) =>
  withDatabase(
    async (client) =>
      (await client.query<{ metadata: unknown }>(`SELECT metadata_json AS metadata FROM audit_logs WHERE action = 'event.volunteer_points_sent' AND entity_id = $1::uuid ORDER BY created_at`, [eventId])).rows.map(
        (row) => row.metadata,
      ),
  );

/** No page wider than the screen: the 320-pixel rule (BR-REQ-041-01 criterion 1). */
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

/** The toast after a press: its sentence — then closed, so it never sits over the next button pressed. */
async function toastSays(page: Page, sentence: string) {
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText(sentence, { timeout: 30_000 });
  await toast.getByRole("button").click();
  await expect(toast).toBeHidden();
}

/**
 * The question inside the screen, and everything pressed in it inside the question and a thumb's size (44 pixels): in a
 * paper 256 pixels wide the two buttons take a line each, and the box's long label wraps under its tick.
 */
async function questionFits(page: Page, question: Locator, pressed: readonly Locator[]) {
  const viewport = page.viewportSize();
  const paper = await question.boundingBox();
  expect(viewport).not.toBeNull();
  expect(paper).not.toBeNull();
  if (!viewport || !paper) return;
  expect(paper.x).toBeGreaterThanOrEqual(0);
  expect(paper.x + paper.width).toBeLessThanOrEqual(viewport.width);
  for (const control of pressed) {
    await expect(control).toBeInViewport();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (!box) continue;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(paper.x);
    expect(box.x + box.width).toBeLessThanOrEqual(paper.x + paper.width + 0.5);
  }
}

const QUESTION = "Trimiți fiecăruia punctul lui?";
const AGAIN_BOX = "Trimite din nou tuturor, și celor care își știu deja punctul";
const NOT_TOLD = "câte unul către fiecare voluntar care nu-și știe încă punctul.";
const EVERYBODY = "câte unul către fiecare voluntar pus la un punct.";

/** The section's own parts: the four numbers, the button, and the hidden box the question's tick fills. */
const mailSection = (page: Page) => ({
  section: page.getByTestId("plan-mail-section"),
  counts: page.getByTestId("plan-mail-counts"),
  send: page.getByTestId("plan-mail-send"),
  again: page.getByTestId("plan-mail-form").locator('input[name="again"]'),
});

/** The address of the plan's page, and of one of its views (§974). */
const planPath = (eventId: string) => `/ro/admin/events/${eventId}/plan-voluntari`;
/** An address of the plan that a press came back to, as a pattern: the view, what it opened, where it landed. */
const backTo = (eventId: string, query: string, hash: string) => new RegExp(`${planPath(eventId)}\\?${query}#${hash}$`);

/** «Trimite fiecăruia punctul lui» is a fold (§974): opened the way a person does before anything in it is read or pressed. */
const openMail = (page: Page) => openFold(page.getByTestId("plan-mail-section"));

/** One of the two views' links (§974), «Tabel» or «Pe puncte». */
const viewLink = (page: Page, name: "Tabel" | "Pe puncte") => page.getByTestId("plan-views").getByRole("link", { name, exact: true });

/** «Pe puncte», by its link: a plain address, the whole page drawn again. */
async function toPoints(page: Page, eventId: string) {
  await viewLink(page, "Pe puncte").click();
  await expect(page).toHaveURL(new RegExp(`${planPath(eventId)}\\?view=points$`));
  await hydrated(page);
}

/** One group fold of «Pe puncte» (§974) — «Pe traseu» or «La start–finish» — and the points drawn in it. */
const planGroup = (page: Page, group: "startFinish" | "route") => page.locator(`details[data-testid="plan-group"][data-group="${group}"]`);

/** A point of «Pe puncte» by the name on its bar — its own fold, inside its group's. */
const pointIn = (page: Page, group: "startFinish" | "route", name: string) =>
  planGroup(page, group).locator('details[data-testid="plan-point"]').filter({ has: page.getByTestId("plan-point-name").filter({ hasText: name }) });

/** A point opened the way a person does: its group's fold, then its own; the point, for what follows. */
async function openPoint(page: Page, group: "startFinish" | "route", name: string): Promise<Locator> {
  await openFold(planGroup(page, group));
  const point = pointIn(page, group, name);
  await openFold(point);
  return point;
}

/** A control a thumb can press: at least 44 pixels tall (BR-REQ-041-01 criterion 6). */
async function thumbSized(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (box) expect(box.height).toBeGreaterThanOrEqual(44);
}

/** The plan as the Organizer opens it — and the first press: Ana and Dan are told, back on the plan at the section. */
async function openPlanAndTellTheTwo(page: Page, seeded: Awaited<ReturnType<typeof seed>>) {
  const { eventId, points, ana, dan } = seeded;
  await signIn(page, "Dev Moderator");
  await page.goto(planPath(eventId));
  await hydrated(page);
  const { section, counts, send, again } = mailSection(page);

  // ---- The section: a fold, closed, its bar saying how many it would tell (§974); open, the four numbers and one button a
  // thumb can press — inside the screen --------------------------------------------------------------------------------
  await expect(section.getByRole("heading", { level: 3, name: "Trimite fiecăruia punctul lui" })).toBeVisible();
  await expect(section).not.toHaveAttribute("open", "");
  await expect(section.getByTestId("plan-mail-state")).toHaveText("2 voluntari de anunțat");
  await expect(send).toBeHidden();
  await openMail(page);
  await expect(counts).toHaveText("Scriem la: 2 · Își știu deja punctul: 0 · La un punct, dar fără adresă de email: 0 · Încă fără punct: 1");
  await expect(send).toHaveText("Trimite fiecăruia punctul lui");
  await expect(send.locator("svg")).toHaveCount(1);
  // «Din nou tuturor» is posted empty as drawn: only the question's tick fills it.
  await expect(again).toHaveValue("");
  const viewport = page.viewportSize();
  const sectionBox = await section.boundingBox();
  const sendBox = await send.boundingBox();
  expect(viewport).not.toBeNull();
  expect(sectionBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  if (viewport && sectionBox && sendBox) {
    expect(sendBox.height).toBeGreaterThanOrEqual(44);
    expect(sectionBox.x).toBeGreaterThanOrEqual(0);
    expect(sectionBox.x + sectionBox.width).toBeLessThanOrEqual(viewport.width);
    expect(sendBox.x).toBeGreaterThanOrEqual(sectionBox.x);
    expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(sectionBox.x + sectionBox.width + 0.5);
  }
  await fits(page);

  // ---- It asks first: the numbers one a line, the email and to how many — and no box, while nobody knows their point --
  await send.click();
  const question = page.getByRole("dialog", { name: QUESTION });
  await expect(question).toBeVisible();
  await expect(question.getByTestId("confirm-lines").locator("li")).toHaveText(["Scriem la: 2", "Își știu deja punctul: 0", "La un punct, dar fără adresă de email: 0", "Încă fără punct: 1"]);
  await expect(question.getByTestId("confirm-email")).toHaveText(`Pleacă 2 emailuri „Punctul tău de voluntar”, ${NOT_TOLD}`);
  await expect(question.getByTestId("confirm-option")).toHaveCount(0);
  await expect(question.getByTestId("confirm-dialog-confirm")).toHaveText("Trimite");
  await questionFits(page, question, [question.getByTestId("confirm-dialog-cancel"), question.getByTestId("confirm-dialog-confirm")]);
  await confirmDialog(page, QUESTION);

  // ---- Back on the plan, in the view it was pressed in, at its fold — open: the toast states the count, and one message a
  // placed person is queued -----------------------------------------------------------------------------------------
  await expect(page).toHaveURL(backTo(eventId, "view=table&saved=planPointsSent", "plan-mail"), { timeout: 30_000 });
  await toastSays(page, "2 voluntari anunțați.");
  const first = await pointMails(eventId);
  expect(told(first)).toEqual([
    { volunteerId: ana.id, checkpointId: points.junction, round: 1, to: ana.email, resend: false },
    { volunteerId: dan.id, checkpointId: points.water, round: 1, to: dan.email, resend: false },
  ]);
  // One press: its cause, one id for both rows, and the Organizer who pressed.
  expect(first.map((row) => row.cause)).toEqual(["volunteers.sendPoints", "volunteers.sendPoints"]);
  expect(first.map((row) => row.pressedBy)).toEqual(["MODERATOR", "MODERATOR"]);
  expect(first[0].pressId).toMatch(/^[0-9a-f-]{36}$/);
  expect(first[1].pressId).toBe(first[0].pressId);
  expect(await trail(eventId)).toEqual([{ queued: 2, told: 0, noAddress: 0, unplaced: 1, again: false }]);

  // Everybody at a point knows theirs now: the button itself is «Trimite din nou tuturor», and the form posts it.
  await hydrated(page);
  await expect(section).toHaveAttribute("open", "");
  await expect(section.getByTestId("plan-mail-state")).toHaveText("toți își știu deja punctul");
  await expect(counts).toHaveText("Scriem la: 0 · Își știu deja punctul: 2 · La un punct, dar fără adresă de email: 0 · Încă fără punct: 1");
  await expect(send).toHaveText("Trimite din nou tuturor");
  await expect(again).toHaveValue("on");
  await expect(page.getByTestId("plan-mail-all-told")).toBeVisible();
  await fits(page);
  return first[0].pressId;
}

/** The rows a later press queued: everything on the event that the first press did not. */
const queuedSince = async (eventId: string, firstPress: string | null) => (await pointMails(eventId)).filter((row) => row.pressId !== firstPress);

test.describe("§956 «Trimite fiecăruia punctul lui» on «Planul voluntarilor»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer tells the two placed volunteers their points, places a third and — ticking «Trimite din nou tuturor» in the question — writes to all three", async ({
    page,
  }) => {
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}-a`);
    const { eventId, points, ana, dan, radu } = seeded;
    const firstPress = await openPlanAndTellTheTwo(page, seeded);
    const { counts, send, again } = mailSection(page);

    // ---- Placing somebody tells nobody: on «Pe puncte», «Pune aici» puts Radu at the water, and the outbox holds what it held --
    await toPoints(page, eventId);
    const water = await openPoint(page, "route", "Apă la cabană");
    await expect(water.getByTestId("plan-point-name")).toHaveText("2. Apă la cabană");
    await expect(water.getByTestId("plan-point-line")).toHaveText("5,5 km · 1 voluntar");
    await water.getByTestId("plan-place-select").selectOption({ label: radu.name });
    await water.getByTestId("plan-place").click();
    // Back to the point, open, in its open group (§974).
    await expect(page).toHaveURL(backTo(eventId, `view=points&open=${points.water}`, `point-${points.water}`), { timeout: 30_000 });
    await toastSays(page, "Stă la punctul ales: apare în planul voluntarilor.");
    await hydrated(page);
    await expect(water).toHaveAttribute("open", "");
    await expect(planGroup(page, "route")).toHaveAttribute("open", "");
    await expect(water.getByTestId("plan-point-line")).toHaveText("5,5 km · 2 voluntari");
    // The summary's four numbers (§961): nobody at the start–finish — the race has no such point —, all three on the route.
    await expect(page.getByTestId("plan-summary")).toHaveText("0 voluntari la start–finish · 3 voluntari pe traseu · 0 voluntari fără punct · 0 puncte fără nimeni");
    expect(await queuedSince(eventId, firstPress)).toEqual([]);

    // ---- One person still to tell, two who know: the plain button again, its hidden box empty ----------------------
    await openMail(page);
    await expect(counts).toHaveText("Scriem la: 1 · Își știu deja punctul: 2 · La un punct, dar fără adresă de email: 0 · Încă fără punct: 0");
    await expect(send).toHaveText("Trimite fiecăruia punctul lui");
    await expect(again).toHaveValue("");

    // ---- The question offers the box, unticked: as asked, the press writes to Radu alone ---------------------------
    await send.click();
    const question = page.getByRole("dialog", { name: QUESTION });
    await expect(question).toBeVisible();
    const lines = question.getByTestId("confirm-lines").locator("li");
    const email = question.getByTestId("confirm-email");
    const box = question.getByRole("checkbox", { name: AGAIN_BOX });
    await expect(lines).toHaveText(["Scriem la: 1", "Își știu deja punctul: 2", "La un punct, dar fără adresă de email: 0", "Încă fără punct: 0"]);
    await expect(email).toHaveText(`Pleacă 1 email „Punctul tău de voluntar”, ${NOT_TOLD}`);
    await expect(box).not.toBeChecked();
    // The confirm never waits for the box.
    await expect(question.getByTestId("confirm-dialog-confirm")).toBeEnabled();

    // ---- Ticked, the question reads as the wider press: everybody at a point, those who know among them ------------
    await box.check();
    await expect(lines).toHaveText(["Scriem la: 3", "Dintre ei, își știu deja punctul: 2", "La un punct, dar fără adresă de email: 0", "Încă fără punct: 0"]);
    await expect(email).toHaveText(`Pleacă 3 emailuri „Punctul tău de voluntar”, ${EVERYBODY}`);
    await questionFits(page, question, [question.getByTestId("confirm-option"), question.getByTestId("confirm-dialog-cancel"), question.getByTestId("confirm-dialog-confirm")]);
    await confirmDialog(page, QUESTION);

    // ---- The tick reached the server: three more messages — Ana's and Dan's second telling, Radu's first — and the press
    // came back to «Pe puncte», where it was pressed -----------------------------------------------------------------
    await expect(page).toHaveURL(backTo(eventId, "view=points&saved=planPointsSent", "plan-mail"), { timeout: 30_000 });
    await toastSays(page, "3 voluntari anunțați.");
    const second = await queuedSince(eventId, firstPress);
    expect(told(second)).toEqual([
      { volunteerId: ana.id, checkpointId: points.junction, round: 2, to: ana.email, resend: true },
      { volunteerId: dan.id, checkpointId: points.water, round: 2, to: dan.email, resend: true },
      { volunteerId: radu.id, checkpointId: points.water, round: 1, to: radu.email, resend: false },
    ]);
    expect(new Set(second.map((row) => row.pressId)).size).toBe(1);
    expect(await trail(eventId)).toEqual([
      { queued: 2, told: 0, noAddress: 0, unplaced: 1, again: false },
      { queued: 3, told: 2, noAddress: 0, unplaced: 0, again: true },
    ]);

    // ---- Everybody knows their point: only «Trimite din nou tuturor» is left to press -------------------------------
    await hydrated(page);
    await expect(counts).toHaveText("Scriem la: 0 · Își știu deja punctul: 3 · La un punct, dar fără adresă de email: 0 · Încă fără punct: 0");
    await expect(send).toHaveText("Trimite din nou tuturor");
    await expect(again).toHaveValue("on");
    await fits(page);
  });

  test("a tick the reader cancelled does not ride along: asked again the box is unticked and the press writes to the one placed since — then the button itself writes to everybody", async ({
    page,
  }) => {
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}-b`);
    const { eventId, points, ana, dan, radu } = seeded;
    const firstPress = await openPlanAndTellTheTwo(page, seeded);
    const { counts, send, again } = mailSection(page);

    // Radu placed at the junction, in the database — the setup here; «Pune aici» is the first test's.
    await withDatabase((client) => client.query(`UPDATE event_volunteers SET checkpoint_id = $2 WHERE id = $1`, [radu.id, points.junction]));
    await page.reload();
    await hydrated(page);
    // The address still names the fold the last press saved in: it comes back open.
    await expect(mailSection(page).section).toHaveAttribute("open", "");
    await expect(counts).toHaveText("Scriem la: 1 · Își știu deja punctul: 2 · La un punct, dar fără adresă de email: 0 · Încă fără punct: 0");

    // ---- Ticked, then «Renunță»: nothing is sent --------------------------------------------------------------------
    await send.click();
    const question = page.getByRole("dialog", { name: QUESTION });
    await expect(question).toBeVisible();
    await question.getByRole("checkbox", { name: AGAIN_BOX }).check();
    await expect(question.getByTestId("confirm-email")).toHaveText(`Pleacă 3 emailuri „Punctul tău de voluntar”, ${EVERYBODY}`);
    await cancelDialog(page, QUESTION);
    await expect(again).toHaveValue("");
    expect(await queuedSince(eventId, firstPress)).toEqual([]);

    // ---- Asked again: the box unticked, the narrower press's words — and confirming writes to Radu alone -----------
    await send.click();
    await expect(question).toBeVisible();
    await expect(question.getByRole("checkbox", { name: AGAIN_BOX })).not.toBeChecked();
    await expect(question.getByTestId("confirm-lines").locator("li")).toHaveText(["Scriem la: 1", "Își știu deja punctul: 2", "La un punct, dar fără adresă de email: 0", "Încă fără punct: 0"]);
    await expect(question.getByTestId("confirm-email")).toHaveText(`Pleacă 1 email „Punctul tău de voluntar”, ${NOT_TOLD}`);
    await confirmDialog(page, QUESTION);
    await expect(page).toHaveURL(backTo(eventId, "view=table&saved=planPointsSent", "plan-mail"), { timeout: 30_000 });
    await toastSays(page, "1 voluntar anunțat.");
    const second = await queuedSince(eventId, firstPress);
    expect(told(second)).toEqual([{ volunteerId: radu.id, checkpointId: points.junction, round: 1, to: radu.email, resend: false }]);
    expect((await trail(eventId))[1]).toEqual({ queued: 1, told: 2, noAddress: 0, unplaced: 0, again: false });

    // ---- Everybody knows their point: the button itself asks «Le scrii din nou tuturor?» and posts `again=on` -------
    await hydrated(page);
    await expect(counts).toHaveText("Scriem la: 0 · Își știu deja punctul: 3 · La un punct, dar fără adresă de email: 0 · Încă fără punct: 0");
    await expect(send).toHaveText("Trimite din nou tuturor");
    await expect(again).toHaveValue("on");
    await send.click();
    const everybody = page.getByRole("dialog", { name: "Le scrii din nou tuturor?" });
    await expect(everybody).toBeVisible();
    await expect(everybody.getByTestId("confirm-lines").locator("li")).toHaveText(["Scriem la: 3", "Dintre ei, își știu deja punctul: 3", "La un punct, dar fără adresă de email: 0", "Încă fără punct: 0"]);
    await expect(everybody.getByTestId("confirm-email")).toHaveText(`Pleacă 3 emailuri „Punctul tău de voluntar”, ${EVERYBODY}`);
    // Nothing to tick: everybody is whom this press writes to.
    await expect(everybody.getByTestId("confirm-option")).toHaveCount(0);
    await expect(everybody.getByTestId("confirm-dialog-confirm")).toHaveText("Trimite din nou tuturor");
    await questionFits(page, everybody, [everybody.getByTestId("confirm-dialog-cancel"), everybody.getByTestId("confirm-dialog-confirm")]);
    await confirmDialog(page, "Le scrii din nou tuturor?");
    await expect(page).toHaveURL(backTo(eventId, "view=table&saved=planPointsSent", "plan-mail"), { timeout: 30_000 });
    await toastSays(page, "3 voluntari anunțați.");
    const third = (await queuedSince(eventId, firstPress)).filter((row) => row.pressId !== second[0].pressId);
    expect(told(third)).toEqual([
      { volunteerId: ana.id, checkpointId: points.junction, round: 2, to: ana.email, resend: true },
      { volunteerId: dan.id, checkpointId: points.water, round: 2, to: dan.email, resend: true },
      { volunteerId: radu.id, checkpointId: points.junction, round: 2, to: radu.email, resend: true },
    ]);
    expect((await trail(eventId))[2]).toEqual({ queued: 3, told: 3, noAddress: 0, unplaced: 0, again: true });
    await fits(page);
  });
});

test.describe("§961 «Punctele planului» on «Planul voluntarilor»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer adds a start–finish point and a point on the route by hand, places a person at each, changes one and deletes the other", async ({ page }) => {
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}-c`);
    const { eventId, points, ana, radu } = seeded;
    const plan = planPath(eventId);
    const MAP = "https://www.google.com/maps/search/?api=1&query=45.64271%2C25.58871";
    await signIn(page, "Dev Moderator");
    await page.goto(`${plan}?view=points`);
    await hydrated(page);

    // ---- The plan as seeded, on «Pe puncte»: two points on the route, none at the start–finish, Radu at no point — each
    // group a closed fold saying how many points and people it holds (§974) --------------------------------------------
    const summary = page.getByTestId("plan-summary");
    const startFinish = planGroup(page, "startFinish");
    const route = planGroup(page, "route");
    await expect(summary).toHaveText("0 voluntari la start–finish · 2 voluntari pe traseu · 1 voluntar fără punct · 0 puncte fără nimeni");
    await expect(route.getByRole("heading", { level: 3, name: "Pe traseu" })).toBeVisible();
    await expect(route.getByTestId("plan-group-count")).toHaveText("2 puncte · 2 voluntari");
    await expect(startFinish.getByRole("heading", { level: 3, name: "La start–finish" })).toBeVisible();
    await expect(startFinish.getByTestId("plan-group-count")).toHaveText("0 puncte · niciun voluntar");
    for (const group of [route, startFinish]) await expect(group).not.toHaveAttribute("open", "");
    // The route first: the owner's «mai ales pe traseu».
    expect((await route.boundingBox())!.y).toBeLessThan((await startFinish.boundingBox())!.y);
    await openFold(startFinish);
    await expect(startFinish.getByTestId("plan-group-none")).toHaveText("Niciun punct la start–finish. Adaugă unul la „Adaugă un punct”, alegând „La start–finish”.");
    await openFold(route);
    await expect(route.getByTestId("plan-point-name")).toHaveText(["1. Intersecția Stejeriș", "2. Apă la cabană"]);
    await expect(route.getByTestId("plan-point-line")).toHaveText(["1,2 km · 1 voluntar", "5,5 km · 1 voluntar"]);

    // ---- «Adaugă un punct»: a fold under the plan's, closed; open, the builder ---------------------------------------
    const builder = page.getByTestId("plan-points-section");
    await expect(builder.getByRole("heading", { level: 3, name: "Adaugă un punct" })).toBeVisible();
    await expect(builder).not.toHaveAttribute("open", "");
    await thumbSized(builder.locator(":scope > summary"));
    await openFold(builder);
    const addForm = page.getByTestId("plan-point-add-form");
    const name = addForm.getByTestId("plan-point-add-name");
    const km = addForm.getByTestId("plan-point-add-km");
    const coordinates = addForm.getByTestId("plan-point-add-coordinates");
    const onRoute = addForm.getByRole("radio", { name: "Pe traseu" });
    const atStartFinish = addForm.getByRole("radio", { name: "La start–finish" });
    const add = addForm.getByTestId("plan-point-add");
    // «Pe traseu» is chosen as drawn; the button and both choices are a thumb's size, and nothing is wider than the screen.
    await expect(onRoute).toBeChecked();
    await expect(add).toHaveText("Adaugă punctul");
    await thumbSized(add);
    await thumbSized(addForm.locator("label").filter({ hasText: "Pe traseu" }));
    await thumbSized(addForm.locator("label").filter({ hasText: "La start–finish" }));
    await fits(page);

    // ---- A point at the start–finish. Coordinates in no shape the page knows are refused — and nothing typed is lost -
    await atStartFinish.check();
    await name.fill("Kituri și numere");
    await coordinates.fill("pe la intrarea în parc");
    await add.click();
    await expect(addForm.getByTestId("form-refusal")).toContainText("Nu am înțeles coordonatele. Scrie-le ca în Google Maps, de exemplu 45.64271, 25.58871.");
    await expect(name).toHaveValue("Kituri și numere");
    await expect(coordinates).toHaveValue("pe la intrarea în parc");
    await expect(atStartFinish).toBeChecked();
    await expect(startFinish.getByTestId("plan-point")).toHaveCount(0);
    // Written as Google Maps copies them, the point is added: back to the fold, open, the form empty for the next one — and
    // the new point drawn open, in its open group (§974).
    await coordinates.fill("45.64271, 25.58871");
    await add.click();
    await expect(page).toHaveURL(new RegExp(`${plan}\\?view=points&open=[0-9a-f-]{36}&saved=planPointAdded#plan-points$`), { timeout: 30_000 });
    await toastSays(page, "Punct adăugat.");
    await hydrated(page);
    await expect(builder).toHaveAttribute("open", "");
    await expect(name).toHaveValue("");
    await expect(coordinates).toHaveValue("");
    await expect(onRoute).toBeChecked();

    // In its group: by its name alone — no number, no kilometre — with where it is and the link to the map.
    const kits = pointIn(page, "startFinish", "Kituri și numere");
    await expect(startFinish).toHaveAttribute("open", "");
    await expect(kits).toHaveAttribute("open", "");
    await expect(startFinish.getByTestId("plan-point-name")).toHaveText(["Kituri și numere"]);
    await expect(kits.getByTestId("plan-point-line")).toHaveText("start–finish · niciun voluntar");
    await expect(startFinish.getByTestId("plan-group-none")).toHaveCount(0);
    await expect(kits.getByTestId("plan-point-coordinates")).toHaveText("45.64271, 25.58871");
    await expect(kits.getByTestId("plan-point-map")).toHaveAttribute("href", MAP);

    // ---- A point on the route: a name, its kilometre, its coordinates — numbered where the route meets it -----------
    await name.fill("Izvorul rece");
    await km.fill("3,4");
    await coordinates.fill("45.64271, 25.58871");
    await add.click();
    await expect(page).toHaveURL(new RegExp(`${plan}\\?view=points&open=[0-9a-f-]{36}&saved=planPointAdded#plan-points$`), { timeout: 30_000 });
    await toastSays(page, "Punct adăugat.");
    await hydrated(page);
    await openFold(route);
    await expect(route.getByTestId("plan-point-name")).toHaveText(["1. Intersecția Stejeriș", "2. Izvorul rece", "3. Apă la cabană"]);
    const spring = await openPoint(page, "route", "Izvorul rece");
    await expect(spring.getByTestId("plan-point-line")).toHaveText("3,4 km · niciun voluntar");
    // Only the plan has it: said so, quietly; the editor's points beside it are not.
    await expect(spring.getByTestId("plan-point-own")).toHaveText("doar pe plan");
    await expect(route.getByTestId("plan-point-own")).toHaveCount(1);
    // «Deschide pe hartă»: Google Maps' own address for the two numbers, in a new tab, a thumb's size.
    const map = spring.getByTestId("plan-point-map");
    await expect(spring.getByTestId("plan-point-coordinates")).toHaveText("45.64271, 25.58871");
    await expect(map).toHaveText("Deschide pe hartă");
    await expect(map).toHaveAttribute("href", MAP);
    await expect(map).toHaveAttribute("target", "_blank");
    await expect(map).toHaveAttribute("rel", "noopener noreferrer");
    await thumbSized(map);
    await expect(summary).toHaveText("0 voluntari la start–finish · 2 voluntari pe traseu · 1 voluntar fără punct · 2 puncte fără nimeni");
    await fits(page);

    // ---- A person at each: Radu at the start–finish, Ana taken off the junction and put at the new point -----------
    const kitsId = (await kits.getAttribute("id")) ?? "";
    const springId = (await spring.getAttribute("id")) ?? "";
    expect(kitsId).toMatch(/^point-[0-9a-f-]{36}$/);
    expect(springId).toMatch(/^point-[0-9a-f-]{36}$/);
    const idOf = (anchor: string) => anchor.slice("point-".length);
    await openPoint(page, "startFinish", "Kituri și numere");
    await kits.getByTestId("plan-place-select").selectOption({ label: radu.name });
    await kits.getByTestId("plan-place").click();
    await expect(page).toHaveURL(backTo(eventId, `view=points&open=${idOf(kitsId)}`, kitsId), { timeout: 30_000 });
    await toastSays(page, "Stă la punctul ales: apare în planul voluntarilor.");
    await hydrated(page);
    await expect(kits).toHaveAttribute("open", "");
    await expect(kits.getByTestId("plan-person-name")).toHaveText([radu.name]);

    const junction = await openPoint(page, "route", "Intersecția Stejeriș");
    await junction.getByTestId("plan-take-off").click();
    await expect(page).toHaveURL(backTo(eventId, `view=points&open=${points.junction}`, `point-${points.junction}`), { timeout: 30_000 });
    await toastSays(page, "Nu mai stă la niciun punct: e din nou la „Fără punct”.");
    await hydrated(page);
    await expect(junction).toHaveAttribute("open", "");
    await expect(junction.getByTestId("plan-point-empty")).toBeVisible();
    await openPoint(page, "route", "Izvorul rece");
    await spring.getByTestId("plan-place-select").selectOption({ label: ana.name });
    await spring.getByTestId("plan-place").click();
    await expect(page).toHaveURL(backTo(eventId, `view=points&open=${idOf(springId)}`, springId), { timeout: 30_000 });
    await toastSays(page, "Stă la punctul ales: apare în planul voluntarilor.");
    await hydrated(page);
    await expect(spring.getByTestId("plan-person-name")).toHaveText([ana.name]);
    await expect(summary).toHaveText("1 voluntar la start–finish · 2 voluntari pe traseu · 0 voluntari fără punct · 1 punct fără nimeni");

    // ---- «Modifică punctul»: the pencil (§974) — the route point renamed and moved along the route; its person stays ---
    const springFold = spring.getByTestId("plan-point-edit");
    const pencil = springFold.locator(":scope > summary");
    // A thumb's square, the glyph alone, named and with its tooltip in the same words.
    await expect(pencil).toHaveAttribute("aria-label", "Modifică punctul: Izvorul rece");
    await expect(pencil).toHaveAttribute("title", "Modifică punctul: Izvorul rece");
    await expect(pencil).toHaveText("");
    const square = await pencil.boundingBox();
    expect(square).not.toBeNull();
    if (square) {
      expect(square.width).toBeGreaterThanOrEqual(44);
      expect(square.height).toBeGreaterThanOrEqual(44);
    }
    await expect(springFold.getByTestId("plan-point-edit-form")).toBeHidden();
    await openFold(springFold);
    await expect(springFold.getByRole("radio", { name: "Pe traseu" })).toBeChecked();
    await expect(springFold.getByTestId("plan-point-edit-name")).toHaveValue("Izvorul rece");
    await expect(springFold.getByTestId("plan-point-edit-km")).toHaveValue("3,4");
    await expect(springFold.getByTestId("plan-point-edit-coordinates")).toHaveValue("45.64271, 25.58871");
    await thumbSized(springFold.getByTestId("plan-point-save"));
    await fits(page);
    await springFold.getByTestId("plan-point-edit-name").fill("Izvorul cald");
    await springFold.getByTestId("plan-point-edit-km").fill("6,1");
    await springFold.getByTestId("plan-point-save").click();
    await expect(page).toHaveURL(backTo(eventId, `view=points&open=${idOf(springId)}`, springId), { timeout: 30_000 });
    await toastSays(page, "Punct salvat.");
    await hydrated(page);
    // Past the water now: the route's third point, under the same id, open, with Ana still at it.
    await expect(route.getByTestId("plan-point-name")).toHaveText(["1. Intersecția Stejeriș", "2. Apă la cabană", "3. Izvorul cald"]);
    const moved = pointIn(page, "route", "Izvorul cald");
    await expect(moved).toHaveAttribute("id", springId);
    await expect(moved).toHaveAttribute("open", "");
    await expect(moved.getByTestId("plan-person-name")).toHaveText([ana.name]);
    // An editor's point's pencil opens onto its coordinates alone: its name and kilometre are the editor's.
    const water = await openPoint(page, "route", "Apă la cabană");
    const waterFold = water.getByTestId("plan-point-edit");
    await expect(waterFold.locator(":scope > summary")).toHaveAttribute("aria-label", "Modifică punctul: Apă la cabană");
    await openFold(waterFold);
    await expect(waterFold.getByTestId("plan-point-edit-coordinates")).toBeVisible();
    await expect(waterFold.getByTestId("plan-point-edit-name")).toHaveCount(0);
    await expect(waterFold.getByTestId("plan-point-remove-form")).toHaveCount(0);
    await expect(waterFold.getByTestId("plan-point-editors")).toContainText("Numele și kilometrul acestui punct se schimbă în editorul evenimentului:");
    // The link names the editor's card by its own title: the sentence has already said where.
    await expect(waterFold.getByTestId("plan-point-editors").getByRole("link")).toHaveText("Puncte pe traseu");

    // ---- «Șterge punctul», inside the pencil: it asks first, with the point's name and who stands there — and Radu is under
    // «Fără punct» ----------------------------------------------------------------------------------------------------
    await openPoint(page, "startFinish", "Kituri și numere");
    const kitsFold = kits.getByTestId("plan-point-edit");
    await openFold(kitsFold);
    const remove = kitsFold.getByRole("button", { name: "Șterge punctul: Kituri și numere" });
    await thumbSized(remove);
    // Two pencils open at once — an editor's point and one of the plan's own — and still nothing wider than the screen.
    await fits(page);
    await remove.click();
    const question = page.getByRole("dialog", { name: "Ștergi punctul „Kituri și numere”?" });
    await expect(question).toBeVisible();
    await expect(question).toContainText("La acest punct stă 1 voluntar: rămâne în plan, fără punct.");
    await expect(question.getByTestId("confirm-dialog-confirm")).toHaveText("Șterge punctul");
    await questionFits(page, question, [question.getByTestId("confirm-dialog-cancel"), question.getByTestId("confirm-dialog-confirm")]);
    await confirmDialog(page, "Ștergi punctul „Kituri și numere”?");
    await expect(page).toHaveURL(backTo(eventId, "view=points", "plan-list"), { timeout: 30_000 });
    await toastSays(page, "Punct șters.");
    await hydrated(page);
    await openFold(startFinish);
    await expect(startFinish.getByTestId("plan-point")).toHaveCount(0);
    await expect(startFinish.getByTestId("plan-group-none")).toBeVisible();
    await expect(startFinish.getByTestId("plan-group-count")).toHaveText("0 puncte · niciun voluntar");
    const unplaced = page.getByTestId("plan-unplaced");
    await expect(unplaced.getByRole("heading", { level: 3, name: "Fără punct" })).toBeVisible();
    await expect(unplaced.getByTestId("plan-person-name")).toHaveText([radu.name]);
    await expect(summary).toHaveText("0 voluntari la start–finish · 2 voluntari pe traseu · 1 voluntar fără punct · 1 punct fără nimeni");
    await fits(page);

    // ---- Nothing of it told anybody: no message was queued by adding, placing, changing or deleting ----------------
    expect(await pointMails(eventId)).toEqual([]);
    // …and the database holds what the page says: one point of the plan's own left, on the route, with its people's rows as they stand.
    const own = await withDatabase(
      async (client) =>
        (await client.query<{ name: string; km: string; start_finish: boolean; latitude: string | null }>(`SELECT name_ro AS name, km::text AS km, start_finish, latitude::text AS latitude FROM event_checkpoints WHERE event_id = $1 AND plan_only ORDER BY position`, [eventId])).rows,
    );
    expect(own).toEqual([{ name: "Izvorul cald", km: "6.10", start_finish: false, latitude: "45.642710" }]);
  });
});

test.describe("§974 «Tabel» and «Pe puncte» on «Planul voluntarilor»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer reads every point in one table — a row a point on a desktop, a block a point on a phone —, prints it as the table, follows a name to that point on «Pe puncte», open, and prints that view with every fold open", async ({
    page,
  }) => {
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}-d`);
    const { eventId, points, ana, dan, radu } = seeded;
    // Two points of the plan's own, as «Adaugă punctul» writes them — the setup here; adding them is the test above: a route
    // point at 3.4 km with its coordinates, between the editor's two, and the kits at the start–finish, with Radu at them.
    await withDatabase(async (client) => {
      const add = async (position: number, name: string, km: string, startFinish: boolean, latitude: string | null, longitude: string | null) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO event_checkpoints (event_id, position, name_ro, name_en, km, plan_only, start_finish, on_profile, latitude, longitude)
             VALUES ($1, $2, $3, $3, $4, true, $5, false, $6, $7) RETURNING id`,
            [eventId, position, name, km, startFinish, latitude, longitude],
          )
        ).rows[0].id;
      await add(0, "Izvorul rece", "3.40", false, "45.642710", "25.588710");
      const kits = await add(1, "Kituri și numere", "0.00", true, null, null);
      await client.query(`UPDATE event_volunteers SET checkpoint_id = $2 WHERE id = $1`, [radu.id, kits]);
    });
    const MAP = "https://www.google.com/maps/search/?api=1&query=45.64271%2C25.58871";
    await signIn(page, "Dev Moderator");
    await page.goto(planPath(eventId));
    await hydrated(page);

    // ---- The two views, by a link each under the intro: «Tabel», the default, marked; «Pe puncte» — each a thumb's -------
    const table = viewLink(page, "Tabel");
    const byPoint = viewLink(page, "Pe puncte");
    await expect(table).toHaveAttribute("aria-current", "page");
    await expect(byPoint).not.toHaveAttribute("aria-current", /./);
    await expect(table).toHaveAttribute("href", `${planPath(eventId)}?view=table`);
    await expect(byPoint).toHaveAttribute("href", `${planPath(eventId)}?view=points`);
    await thumbSized(table);
    await thumbSized(byPoint);

    // ---- «Tabel»: the table under its heading, above the picture, the builder and the email — and none of the points ----
    const section = page.getByTestId("plan-table-section");
    await expect(section.getByRole("heading", { level: 3, name: "Punctele, pe scurt" })).toBeVisible();
    const topOf = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;
    for (const below of [page.getByTestId("plan-picture-section"), page.getByTestId("plan-points-section"), page.getByTestId("plan-mail-section")]) {
      expect(await topOf(section)).toBeLessThan(await topOf(below));
    }
    await expect(page.getByTestId("plan-point")).toHaveCount(0);
    await expect(page.getByTestId("plan-group")).toHaveCount(0);

    // ---- What a person reads, on either screen: the route by kilometre — the plan's own spring between the editor's two —
    // then the start–finish; each point's people with the telephone to ring, «niciunul» where nobody stands; the total ----
    const shown = (testid: string) => section.getByTestId(testid).filter({ visible: true });
    await expect(shown("plan-table-point")).toHaveText(["Intersecția Stejeriș", "Izvorul rece", "Apă la cabană", "Kituri și numere"]);
    // Every name in bold (§974).
    for (let index = 0; index < 4; index++) await expect(shown("plan-table-point").nth(index)).toHaveCSS("font-weight", "700");
    await expect(shown("plan-table-number")).toHaveText(["1", "2", "3"]);
    await expect(shown("plan-table-km")).toHaveText(["1,2", "3,4", "5,5", "start–finish"]);
    await expect(shown("plan-table-coordinates")).toHaveText(["—", "45.64271, 25.58871", "—", "—"]);
    await expect(shown("plan-table-person-name")).toHaveText([ana.name, dan.name, radu.name]);
    await expect(shown("plan-table-nobody")).toHaveText(["niciunul"]);
    await expect(shown("plan-table-count")).toHaveText(["1", "0", "1", "1"]);
    await expect(section.getByText("3 voluntari puși, 1 punct fără nimeni")).toBeVisible();
    // Every link a thumb's: a name, a telephone — the digits the point dials — and the map, in a new tab.
    const phones = shown("plan-table-phone");
    await expect(phones).toHaveText(["+40 712 345 678", "+40 712 345 678", "+40 712 345 678"]);
    for (let index = 0; index < 3; index++) {
      await expect(phones.nth(index)).toHaveAttribute("href", "tel:+40712345678");
      await thumbSized(phones.nth(index));
    }
    const map = shown("plan-table-map");
    await expect(map).toHaveCount(1);
    await expect(map).toHaveAttribute("href", MAP);
    await expect(map).toHaveAttribute("target", "_blank");
    await thumbSized(map);
    for (let index = 0; index < 4; index++) await thumbSized(shown("plan-table-point").nth(index));

    const blocks = section.locator("li").filter({ has: page.getByTestId("plan-table-point") }).filter({ visible: true });
    if ((page.viewportSize()?.width ?? 0) >= 900) {
      // ---- A desktop: the house's table, its six columns, a row a point -------------------------------------------------
      const wide = section.locator('table[data-table-id="volunteer-plan"]');
      await expect(wide).toBeVisible();
      await expect(blocks).toHaveCount(0);
      await expect(wide.locator("thead th")).toHaveText(["Nr.", "Punct", "Km", "Coordonate", "Voluntari", "Câți"]);
      const rows = wide.locator("tbody tr");
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0).locator("td")).toHaveText(["1", "Intersecția Stejeriș", "1,2", "—", `${ana.name} +40 712 345 678`, "1"]);
      await expect(rows.nth(1).locator("td")).toHaveText(["2", "Izvorul rece", "3,4", "45.64271, 25.58871 Deschide pe hartă", "niciunul", "0"]);
      await expect(rows.nth(2).locator("td")).toHaveText(["3", "Apă la cabană", "5,5", "—", `${dan.name} +40 712 345 678`, "1"]);
      await expect(rows.nth(3).locator("td")).toHaveText(["", "Kituri și numere", "start–finish", "—", `${radu.name} +40 712 345 678`, "1"]);
    } else {
      // ---- A phone: no table, a block a point headed by its name — and no «Nr.» line at the start–finish ----------------
      await expect(section.locator("table")).toBeHidden();
      await expect(blocks).toHaveCount(4);
      await expect(blocks.nth(0).getByTestId("plan-table-number")).toHaveText("1");
      await expect(blocks.nth(3).getByTestId("plan-table-number")).toHaveCount(0);
      await expect(blocks.nth(3)).toContainText("Câți");
      await expect(blocks.nth(3).getByTestId("plan-table-person-name")).toHaveText(radu.name);
    }
    await fits(page);

    // ---- On paper, on either screen: the table itself, whole — never the blocks, never the map's link or a control -----
    await page.emulateMedia({ media: "print" });
    await expect(section.getByRole("heading", { level: 3, name: "Punctele, pe scurt" })).toBeVisible();
    await expect(section.locator('table[data-table-id="volunteer-plan"]')).toBeVisible();
    await expect(section.locator('table[data-table-id="volunteer-plan"] tbody tr')).toHaveCount(4);
    await expect(blocks).toHaveCount(0);
    await expect(shown("plan-table-map")).toHaveCount(0);
    await expect(shown("plan-table-coordinates")).toHaveText(["—", "45.64271, 25.58871", "—", "—"]);
    await expect(section.getByText("3 voluntari puși, 1 punct fără nimeni")).toBeVisible();
    await expect(section.getByTestId("admin-table-columns")).toBeHidden();
    await expect(section.locator("[data-column-resize]").filter({ visible: true })).toHaveCount(0);
    // Nor the views' links, the builder or the email: the sheet is the plan.
    for (const offPaper of ["plan-views", "plan-points-section", "plan-mail-section"]) await expect(page.getByTestId(offPaper)).toBeHidden();
    await page.emulateMedia({ media: "screen" });

    // ---- A name leads to that point on «Pe puncte», open in its open group, and on the screen ----------------------------
    await shown("plan-table-point").filter({ hasText: "Apă la cabană" }).click();
    await expect(page).toHaveURL(backTo(eventId, `view=points&open=${points.water}`, `point-${points.water}`));
    await hydrated(page);
    const water = page.locator(`#point-${points.water}`);
    await expect(water).toHaveAttribute("open", "");
    await expect(water).toBeInViewport();
    await expect(planGroup(page, "route")).toHaveAttribute("open", "");
    await expect(planGroup(page, "startFinish")).not.toHaveAttribute("open", "");
    await expect(viewLink(page, "Pe puncte")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("plan-table-section")).toHaveCount(0);
    // Its bar: the name in bold at a level-3 heading's size, its kilometre and how many stand there; every other point closed.
    await expect(water.getByTestId("plan-point-name")).toHaveText("3. Apă la cabană");
    await expect(water.getByTestId("plan-point-name")).toHaveCSS("font-weight", "700");
    // The size of a level-3 heading: the group's own heading beside it is one.
    const groupSize = await planGroup(page, "route").locator(":scope > summary h3").evaluate((heading) => getComputedStyle(heading).fontSize);
    await expect(water.getByTestId("plan-point-title")).toHaveCSS("font-size", groupSize);
    await expect(water.getByTestId("plan-point-line")).toHaveText("5,5 km · 1 voluntar");
    await thumbSized(water.locator(":scope > summary"));
    await expect(planGroup(page, "route").locator('details[data-testid="plan-point"][open]')).toHaveCount(1);
    // The pencil: the glyph alone, a thumb's square.
    const pencil = water.getByTestId("plan-point-edit").locator(":scope > summary");
    await expect(pencil).toHaveAttribute("aria-label", "Modifică punctul: Apă la cabană");
    const square = await pencil.boundingBox();
    expect(square).not.toBeNull();
    if (square) {
      expect(square.width).toBeGreaterThanOrEqual(44);
      expect(square.height).toBeGreaterThanOrEqual(44);
    }
    await fits(page);

    // ---- On paper, «Pe puncte» prints every group and every point open — the closed ones too —, the people with their
    // telephones as text, and nothing that builds the plan -------------------------------------------------------------
    await page.emulateMedia({ media: "print" });
    const junction = page.locator(`#point-${points.junction}`);
    await expect(junction).not.toHaveAttribute("open", "");
    await expect(junction.getByTestId("plan-person-name")).toHaveText([ana.name]);
    await expect(junction.getByTestId("plan-person-name")).toBeVisible();
    await expect(junction.getByTestId("plan-person-phone")).toBeVisible();
    const kits = pointIn(page, "startFinish", "Kituri și numere");
    await expect(kits.getByTestId("plan-person-name")).toBeVisible();
    await expect(page.getByTestId("plan-summary")).toBeVisible();
    for (const offPaper of ["plan-point-edit", "plan-place-form", "plan-take-off"]) await expect(page.getByTestId(offPaper).filter({ visible: true })).toHaveCount(0);
    await page.emulateMedia({ media: "screen" });

    // ---- And back: «Tabel» by its link ------------------------------------------------------------------------------------
    await viewLink(page, "Tabel").click();
    await expect(page).toHaveURL(new RegExp(`${planPath(eventId)}\\?view=table$`));
    await expect(page.getByTestId("plan-table-section")).toBeVisible();
    await expect(viewLink(page, "Tabel")).toHaveAttribute("aria-current", "page");
  });
});
