import { expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01 — «Trimite fiecăruia punctul lui» on «Planul voluntarilor» (the owner,
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

test.describe("§NNN «Trimite fiecăruia punctul lui» on «Planul voluntarilor»", () => {
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
    await expect(page.getByTestId("plan-summary")).toHaveText("La puncte: 3 · Fără punct: 0 · Puncte fără nimeni: 0");
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
