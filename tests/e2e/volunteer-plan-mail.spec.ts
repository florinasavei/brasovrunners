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

/** The plan as the Organizer opens it — and the first press: Ana and Dan are told, back on the plan at the section. */
async function openPlanAndTellTheTwo(page: Page, seeded: Awaited<ReturnType<typeof seed>>) {
  const { eventId, points, ana, dan } = seeded;
  await signIn(page, "Dev Moderator");
  await page.goto(`/ro/admin/events/${eventId}/plan-voluntari`);
  await hydrated(page);
  const { section, counts, send, again } = mailSection(page);

  // ---- The section: its heading, the four numbers, one button a thumb can press — inside the screen ----------------
  await expect(section.getByRole("heading", { level: 3, name: "Trimite fiecăruia punctul lui" })).toBeVisible();
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

  // ---- Back on the plan, at its section: the toast states the count, and one message a placed person is queued -----
  await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/plan-voluntari#plan-mail$`), { timeout: 30_000 });
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

    // ---- Placing somebody tells nobody: «Pune aici» puts Radu at the water, and the outbox holds what it held --------
    const water = page.getByTestId("plan-point").filter({ hasText: "Apă la cabană" });
    await expect(water.getByTestId("plan-point-title")).toHaveText("2. 5,5 km — Apă la cabană");
    await water.getByTestId("plan-place-select").selectOption({ label: radu.name });
    await water.getByTestId("plan-place").click();
    await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/plan-voluntari#point-${points.water}$`), { timeout: 30_000 });
    await toastSays(page, "Stă la punctul ales: apare în planul voluntarilor.");
    await hydrated(page);
    // The summary's four numbers (§961): nobody at the start–finish — the race has no such point —, all three on the route.
    await expect(page.getByTestId("plan-summary")).toHaveText("0 voluntari la start–finish · 3 voluntari pe traseu · 0 voluntari fără punct · 0 puncte fără nimeni");
    expect(await queuedSince(eventId, firstPress)).toEqual([]);

    // ---- One person still to tell, two who know: the plain button again, its hidden box empty ----------------------
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

    // ---- The tick reached the server: three more messages — Ana's and Dan's second telling, Radu's first ------------
    await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/plan-voluntari#plan-mail$`), { timeout: 30_000 });
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
    await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/plan-voluntari#plan-mail$`), { timeout: 30_000 });
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
    await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/plan-voluntari#plan-mail$`), { timeout: 30_000 });
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

/** One group of the plan — «Start–finish» or «Pe traseu» — and the points drawn in it. */
const planGroup = (page: Page, group: "startFinish" | "route") => page.locator(`[data-testid="plan-group"][data-group="${group}"]`);

/** A control a thumb can press: at least 44 pixels tall (BR-REQ-041-01 criterion 6). */
async function thumbSized(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (box) expect(box.height).toBeGreaterThanOrEqual(44);
}

test.describe("§961 «Punctele planului» on «Planul voluntarilor»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer adds a start–finish point and a point on the route by hand, places a person at each, changes one and deletes the other", async ({ page }) => {
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}-c`);
    const { eventId, points, ana, radu } = seeded;
    const plan = `/ro/admin/events/${eventId}/plan-voluntari`;
    const MAP = "https://www.google.com/maps/search/?api=1&query=45.64271%2C25.58871";
    await signIn(page, "Dev Moderator");
    await page.goto(plan);
    await hydrated(page);

    // ---- The plan as seeded: two points on the route, none at the start–finish, Radu at no point --------------------
    const summary = page.getByTestId("plan-summary");
    const startFinish = planGroup(page, "startFinish");
    const route = planGroup(page, "route");
    await expect(summary).toHaveText("0 voluntari la start–finish · 2 voluntari pe traseu · 1 voluntar fără punct · 0 puncte fără nimeni");
    await expect(startFinish.getByRole("heading", { level: 3, name: "Start–finish" })).toBeVisible();
    await expect(startFinish.getByTestId("plan-group-none")).toHaveText("Niciun punct la start–finish. Adaugă unul mai sus, alegând „La start–finish”.");
    await expect(route.getByRole("heading", { level: 3, name: "Pe traseu" })).toBeVisible();
    await expect(route.getByTestId("plan-point-title")).toHaveText(["1. 1,2 km — Intersecția Stejeriș", "2. 5,5 km — Apă la cabană"]);

    // ---- «Punctele planului»: the builder, under the picture and above «Trimite fiecăruia punctul lui» --------------
    const builder = page.getByTestId("plan-points-section");
    await expect(builder.getByRole("heading", { level: 3, name: "Punctele planului" })).toBeVisible();
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
    // Written as Google Maps copies them, the point is added: back at the section, the form empty for the next one.
    await coordinates.fill("45.64271, 25.58871");
    await add.click();
    await expect(page).toHaveURL(new RegExp(`${plan}#plan-points$`), { timeout: 30_000 });
    await toastSays(page, "Punct adăugat.");
    await hydrated(page);
    await expect(name).toHaveValue("");
    await expect(coordinates).toHaveValue("");
    await expect(onRoute).toBeChecked();

    // In its group: by its name alone — no number, no kilometre — with where it is and the link to the map.
    const kits = startFinish.getByTestId("plan-point").filter({ hasText: "Kituri și numere" });
    await expect(startFinish.getByTestId("plan-point-title")).toHaveText(["Kituri și numere"]);
    await expect(startFinish.getByTestId("plan-group-none")).toHaveCount(0);
    await expect(kits.getByTestId("plan-point-coordinates")).toHaveText("45.64271, 25.58871");
    await expect(kits.getByTestId("plan-point-map")).toHaveAttribute("href", MAP);

    // ---- A point on the route: a name, its kilometre, its coordinates — numbered where the route meets it -----------
    await name.fill("Izvorul rece");
    await km.fill("3,4");
    await coordinates.fill("45.64271, 25.58871");
    await add.click();
    await expect(page).toHaveURL(new RegExp(`${plan}#plan-points$`), { timeout: 30_000 });
    await toastSays(page, "Punct adăugat.");
    await hydrated(page);
    await expect(route.getByTestId("plan-point-title")).toHaveText(["1. 1,2 km — Intersecția Stejeriș", "2. 3,4 km — Izvorul rece", "3. 5,5 km — Apă la cabană"]);
    const spring = route.getByTestId("plan-point").filter({ hasText: "Izvorul rece" });
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
    await kits.getByTestId("plan-place-select").selectOption({ label: radu.name });
    await kits.getByTestId("plan-place").click();
    await expect(page).toHaveURL(new RegExp(`${plan}#${kitsId}$`), { timeout: 30_000 });
    await toastSays(page, "Stă la punctul ales: apare în planul voluntarilor.");
    await hydrated(page);
    await expect(kits.getByTestId("plan-person-name")).toHaveText([radu.name]);

    const junction = route.getByTestId("plan-point").filter({ hasText: "Intersecția Stejeriș" });
    await junction.getByTestId("plan-take-off").click();
    await expect(page).toHaveURL(new RegExp(`${plan}#point-${points.junction}$`), { timeout: 30_000 });
    await toastSays(page, "Nu mai stă la niciun punct: e din nou la „Fără punct”.");
    await hydrated(page);
    await spring.getByTestId("plan-place-select").selectOption({ label: ana.name });
    await spring.getByTestId("plan-place").click();
    await expect(page).toHaveURL(new RegExp(`${plan}#${springId}$`), { timeout: 30_000 });
    await toastSays(page, "Stă la punctul ales: apare în planul voluntarilor.");
    await hydrated(page);
    await expect(spring.getByTestId("plan-person-name")).toHaveText([ana.name]);
    await expect(summary).toHaveText("1 voluntar la start–finish · 2 voluntari pe traseu · 0 voluntari fără punct · 1 punct fără nimeni");

    // ---- «Modifică punctul»: the route point renamed and moved along the route — its person stays ------------------
    const springFold = spring.getByTestId("plan-point-edit");
    // The fold's bar is a thumb's size too.
    await thumbSized(springFold.locator(":scope > summary"));
    await openFold(springFold);
    await expect(springFold.getByRole("radio", { name: "Pe traseu" })).toBeChecked();
    await expect(springFold.getByTestId("plan-point-edit-name")).toHaveValue("Izvorul rece");
    await expect(springFold.getByTestId("plan-point-edit-km")).toHaveValue("3,4");
    await expect(springFold.getByTestId("plan-point-edit-coordinates")).toHaveValue("45.64271, 25.58871");
    await thumbSized(springFold.getByTestId("plan-point-save"));
    await springFold.getByTestId("plan-point-edit-name").fill("Izvorul cald");
    await springFold.getByTestId("plan-point-edit-km").fill("6,1");
    await springFold.getByTestId("plan-point-save").click();
    await expect(page).toHaveURL(new RegExp(`${plan}#${springId}$`), { timeout: 30_000 });
    await toastSays(page, "Punct salvat.");
    await hydrated(page);
    // Past the water now: the route's third point, under the same id, with Ana still at it.
    await expect(route.getByTestId("plan-point-title")).toHaveText(["1. 1,2 km — Intersecția Stejeriș", "2. 5,5 km — Apă la cabană", "3. 6,1 km — Izvorul cald"]);
    const moved = route.getByTestId("plan-point").filter({ hasText: "Izvorul cald" });
    await expect(moved).toHaveAttribute("id", springId);
    await expect(moved.getByTestId("plan-person-name")).toHaveText([ana.name]);
    // An editor's point folds open onto its coordinates alone: its name and kilometre are the editor's.
    const waterFold = route.getByTestId("plan-point").filter({ hasText: "Apă la cabană" }).getByTestId("plan-point-edit");
    await openFold(waterFold);
    await expect(waterFold.getByTestId("plan-point-edit-coordinates")).toBeVisible();
    await expect(waterFold.getByTestId("plan-point-edit-name")).toHaveCount(0);
    await expect(waterFold.getByTestId("plan-point-remove-form")).toHaveCount(0);
    await expect(waterFold.getByTestId("plan-point-editors")).toContainText("Numele și kilometrul acestui punct se schimbă în editorul evenimentului:");
    // The link names the editor's card by its own title: the sentence has already said where.
    await expect(waterFold.getByTestId("plan-point-editors").getByRole("link")).toHaveText("Puncte pe traseu");

    // ---- «Șterge punctul»: it asks first, with the point's name and who stands there — and Radu is under «Fără punct» -
    const kitsFold = kits.getByTestId("plan-point-edit");
    await openFold(kitsFold);
    const remove = kitsFold.getByRole("button", { name: "Șterge punctul: Kituri și numere" });
    await thumbSized(remove);
    // Two folds open at once — an editor's point and one of the plan's own — and still nothing wider than the screen.
    await fits(page);
    await remove.click();
    const question = page.getByRole("dialog", { name: "Ștergi punctul „Kituri și numere”?" });
    await expect(question).toBeVisible();
    await expect(question).toContainText("La acest punct stă 1 voluntar: rămâne în plan, fără punct.");
    await expect(question.getByTestId("confirm-dialog-confirm")).toHaveText("Șterge punctul");
    await questionFits(page, question, [question.getByTestId("confirm-dialog-cancel"), question.getByTestId("confirm-dialog-confirm")]);
    await confirmDialog(page, "Ștergi punctul „Kituri și numere”?");
    await expect(page).toHaveURL(new RegExp(`${plan}#plan-list$`), { timeout: 30_000 });
    await toastSays(page, "Punct șters.");
    await hydrated(page);
    await expect(startFinish.getByTestId("plan-point")).toHaveCount(0);
    await expect(startFinish.getByTestId("plan-group-none")).toBeVisible();
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
