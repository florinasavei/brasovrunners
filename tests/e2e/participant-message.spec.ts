import { existsSync } from "node:fs";
import { confirmDialog } from "./support/confirm";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { EMAIL_SAMPLE } from "../../src/modules/notifications/domain/email-sample";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §364 — "Trimite un mesaj participanților", end to end, on a phone and a desktop:
 * the editor's immediate actions lead to the composer; the groups show their live counts; a
 * message in one language is refused on the empty box with everything else kept; the preview
 * renders the real email for a Romanian and for an English registrant; Send asks "Trimiți mesajul
 * la 2 participanți?"; the banner says what was queued, the history names the send, and the
 * outbox holds exactly one row per recipient, each in its own language, carrying both. A role
 * that may not write to participants (Tehnic) meets a 404.
 *
 * And §945 — «Doar anumiți participanți, pe care îi aleg din listă»: a trial to one person found by
 * name and ticked, whose question counts the tick, after which the words are still in the boxes and
 * go to everybody with one more press — one outbox row for the trial, one per registrant after it.
 * Every send is confirmed by hand at «Scrie la câți trimiți»: the trial's «1» typed again with
 * everybody chosen sends nothing and says how many there are.
 *
 * And §NNN — the preview itself: with «Trimite și numărul de concurs și codul QR» ticked the example runner's QR is a
 * picture that loads, and «Mărește» makes the frame as tall as the email — nothing left to scroll inside it — until
 * «Micșorează» returns the 620-pixel window, the press sending nothing.
 *
 * Each project writes its own event straight into the database — the setup, not the subject, as
 * `support/action-link.ts` argues — so the two never count each other's rows: a confirmed
 * Romanian runner, an English one on the waiting list, and two who must never hear it (a
 * cancelled registration and an address nobody confirmed).
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

type Person = { status: string; locale: "ro" | "en"; name?: string };

/** The four of the first journey: one confirmed, one waiting, and two who must never hear it. */
const FOUR: readonly Person[] = [
  { status: "CONFIRMED", locale: "ro" },
  { status: "WAITLISTED", locale: "en" },
  { status: "CANCELLED", locale: "ro" },
  { status: "PENDING_EMAIL_CONFIRMATION", locale: "ro" },
];

async function seedEvent(tag: string, people: readonly Person[] = FOUR): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, editorial_status, published_at, location_name)
       VALUES ('RACE', now() + interval '20 days', 'INTERNAL', 10, 'PUBLISHED', now() - interval '1 day', 'Parcul Tractorul')
       RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'x')`, [
      eventId,
      `mesaj-${tag}`,
      `Cursa furtunii ${tag}`,
    ]);
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'en', $2, $3, 'x')`, [
      eventId,
      `message-${tag}`,
      `Storm race ${tag}`,
    ]);
    for (const [index, person] of people.entries()) {
      const email = `msg-${tag}-${index}@test.invalid`;
      const { rows: participant } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, `Alergător ${index}`],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
           confirmed_at, waitlisted_at, cancelled_at, cancellation_source)
         VALUES ($1, $2, $3::registration_status, $4::locale, $5, $5, 1, now(), false, 1, true,
           CASE WHEN $3::text = 'CONFIRMED' THEN now() END,
           CASE WHEN $3::text = 'WAITLISTED' THEN now() END,
           CASE WHEN $3::text = 'CANCELLED' THEN now() END,
           CASE WHEN $3::text = 'CANCELLED' THEN 'PARTICIPANT'::registration_cancellation_source END)`,
        [eventId, participant[0].id, person.status, person.locale, person.name ?? "Runner"],
      );
    }
    return eventId;
  });
}

/** The participants' own organizer-message rows for the event — never the club's copies. */
async function queuedFor(eventId: string): Promise<Array<{ locale: string; payload: { subject: { ro: string; en: string }; body: { ro: string; en: string } } }>> {
  return withDatabase(async (client) => {
    const { rows } = await client.query(
      `SELECT o.locale, o.payload_json AS payload FROM email_outbox o JOIN registrations r ON r.id = o.registration_id
        WHERE r.event_id = $1 AND o.message_type = 'ORGANIZER_MESSAGE' AND o.participant_id IS NOT NULL
        ORDER BY o.locale::text`,
      [eventId],
    );
    return rows;
  });
}

/** Whose registrations the event's organizer messages were queued for, by name, oldest first — never the club's copies. */
async function namesWrittenTo(eventId: string): Promise<string[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      `SELECT r.registered_name AS name FROM email_outbox o JOIN registrations r ON r.id = o.registration_id
        WHERE r.event_id = $1 AND o.message_type = 'ORGANIZER_MESSAGE' AND o.participant_id IS NOT NULL
        ORDER BY o.created_at, r.registered_name`,
      [eventId],
    );
    return rows.map((row) => row.name);
  });
}

async function removeEvents(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ participant_id: string }>(
      "DELETE FROM registrations WHERE event_id = ANY($1::uuid[]) RETURNING participant_id",
      [ids],
    );
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [rows.map((row) => row.participant_id)]);
    await client.query("DELETE FROM audit_logs WHERE entity_type = 'event' AND entity_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM event_translations WHERE event_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids]);
  });
}

test.describe("§364 the organizer writes to an event's participants", () => {
  const created: string[] = [];
  test.afterAll(async () => removeEvents(created));

  test("compose in both languages, preview, confirm, and see the history and one outbox row per recipient", async ({ page }) => {
    test.setTimeout(150_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedEvent(tag);
    created.push(eventId);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await signIn(page, "Dev Administrator");

    // The editor's immediate actions lead to it.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    const received = await openEditorBox(page, "Înscrierile primite");
    const link = received.getByTestId("participant-message-link");
    await expect(link).toHaveText("Trimite un mesaj participanților");
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/ro/admin/events/${eventId}/mesaje$`), { timeout: 30_000 });
    await hydrated(page);
    await expect(page.getByTestId("participant-message-event")).toContainText(`Cursa furtunii ${tag}`);

    // The groups, each with its live count: nobody cancelled or unconfirmed among them.
    await expect(page.getByTestId("audience-ALL_ACTIVE")).toContainText("· 2");
    await expect(page.getByTestId("audience-CONFIRMED")).toContainText("· 1");
    await expect(page.getByTestId("audience-WAITLIST")).toContainText("· 1");
    await expect(page.getByTestId("audience-PENDING_DECLARATION")).toContainText("· 0");
    const recipients = page.getByTestId("participant-message-recipients");
    await expect(recipients).toContainText("2 destinatari");
    await expect(recipients).toContainText("cota Mailgun");
    // A thumb's target (BR-REQ-041-01 criterion 6): the radio's padded box.
    const radio = page.getByRole("radio", { name: /Doar confirmații/ });
    const box = await radio.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Choosing a group changes the line; choosing back restores it.
    await radio.check();
    await expect(recipients).toContainText("1 destinatar");
    await page.getByRole("radio", { name: /Toți cei înscriși/ }).check();
    await expect(recipients).toContainText("2 destinatari");

    // The counsel's scope line under the body (§419, review finding): what the organizer may
    // write about, and why — visible before anything is typed, not only on a refusal.
    await expect(page.getByTestId("participant-message-scope")).toContainText("Scrie doar despre acest eveniment");

    // Romanian only: the English body holds nothing but spaces, which the browser lets through
    // and the server refuses — on that box, with everything else kept (§315).
    await field("subjectRo").fill("Vreme rea la {eventTitle}");
    await field("subjectEn").fill("Bad weather at {eventTitle}");
    await field("bodyRo").fill("Salut, {participantName}!\n\nStartul se mută la 10:00 din cauza furtunii.");
    await field("bodyEn").fill("   ");
    // «Confirmă trimiterea»: who it goes to, said again beside the button, and the number typed by hand.
    await expect(page.getByTestId("participant-message-confirm-who")).toHaveText("Toți cei înscriși · 2 destinatari");
    await field("confirmCount").fill("2");
    await page.getByRole("button", { name: "Trimite mesajul" }).click();
    await expect(page.getByRole("dialog")).toContainText("Trimiți mesajul la 2 participanți?");
    await confirmDialog(page);
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toContainText("Mesajul (English)", { timeout: 30_000 });
    await expect(field("bodyRo")).toHaveValue("Salut, {participantName}!\n\nStartul se mută la 10:00 din cauza furtunii.");
    await expect(field("subjectEn")).toHaveValue("Bad weather at {eventTitle}");
    // The typed number is the one box that does not come back: it is typed again for the next press.
    await expect(field("confirmCount")).toHaveValue("");

    // Both languages now; the preview is the real email, the Romanian registrant's copy first…
    await field("bodyEn").fill("Hi, {participantName}!\n\nThe start moves to 10:00 because of the storm.");
    const previewSubject = page.getByTestId("participant-message-preview-subject");
    await expect(previewSubject).toContainText(`Vreme rea la Cursa furtunii ${tag} / Bad weather at Storm race ${tag}`, { timeout: 30_000 });
    // Addressed to the sample runner of /admin/emails, and the help line above it names her from the same constant.
    const sample = EMAIL_SAMPLE.ro;
    await expect(page.getByTestId("participant-message-preview")).toContainText(`${sample.participantName}, cu numărul ${sample.bibNumber}`);
    const frame = page.frameLocator('[data-testid="participant-message-preview"] iframe');
    await expect(frame.locator("body")).toContainText(`Salut, ${sample.participantName}!`);
    await expect(frame.locator("body")).toContainText("The start moves to 10:00 because of the storm.");
    // …and the English registrant's, English first.
    await page.getByRole("tab", { name: "Înscris în engleză" }).click();
    await expect(previewSubject).toContainText(`Bad weather at Storm race ${tag} / Vreme rea la Cursa furtunii ${tag}`, { timeout: 30_000 });

    // Send, behind the number typed again and the question that names how many.
    await field("confirmCount").fill("2");
    await page.getByRole("button", { name: "Trimite mesajul" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Trimiți mesajul la 2 participanți?");
    // Who is emailed, from the same count the send queues from (§384).
    await expect(dialog.getByTestId("confirm-email")).toHaveText("Pleacă 2 emailuri „Mesaj de la organizatori”, câte unul către fiecare participant.");
    await confirmDialog(page);
    await expect(page.getByTestId("participant-message-sent")).toContainText("Mesaj pus la coadă pentru 2 participanți.", { timeout: 30_000 });
    await expect(page).toHaveURL(/sent=2/);

    // The history names the send: the subject with the event's own fields filled, the group, how many, and who.
    const row = page.getByTestId("participant-message-history-row").first();
    await expect(row).toContainText(`Vreme rea la Cursa furtunii ${tag}`);
    await expect(row).not.toContainText("{eventTitle}");
    await expect(row).toContainText("Toți cei înscriși");
    await expect(row).toContainText("2 destinatari");
    await expect(row).toContainText("Dev Administrator");
    // The boxes are empty again: the next press is a new message, not this one twice.
    await expect(field("subjectRo")).toHaveValue("");

    // Exactly one row per recipient, each in its own language, each carrying both.
    const rows = await queuedFor(eventId);
    expect(rows.map((entry) => entry.locale)).toEqual(["en", "ro"]);
    for (const entry of rows) {
      expect(entry.payload.subject).toEqual({ ro: "Vreme rea la {eventTitle}", en: "Bad weather at {eventTitle}" });
      expect(entry.payload.body.en).toContain("because of the storm");
      expect(entry.payload.body.ro).toContain("din cauza furtunii");
    }

    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Tehnic may not write to participants: the page is a 404 for it (BR-REQ-060-01). A signed-in
    // session is not offered the switcher again, so the cookies go first (as `neon-plan.spec.ts`).
    await page.context().clearCookies();
    await signIn(page, "Dev Technical");
    const response = await page.goto(`/ro/admin/events/${eventId}/mesaje`);
    expect(response?.status()).toBe(404);
  });

  test("§NNN the preview shows the example runner's QR, and «Mărește» makes the frame as tall as the email", async ({ page }) => {
    test.setTimeout(150_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-qr`;
    const eventId = await seedEvent(tag);
    created.push(eventId);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}/mesaje`);
    await hydrated(page);
    const preview = page.getByTestId("participant-message-preview");
    const frame = preview.locator("iframe");
    const inside = page.frameLocator('[data-testid="participant-message-preview"] iframe');
    const frameHeight = async () => Math.round((await frame.boundingBox())?.height ?? 0);

    // The example runner's QR: the address the preview wrote is a picture, and it loads in the frame.
    await page.getByTestId("participant-message-qr").getByRole("checkbox").check();
    const picture = inside.locator('img[alt^="Cod QR"]');
    await expect(picture).toHaveAttribute("src", new RegExp(`/api/registrations/qr/${EMAIL_SAMPLE.ro.checkinCode}\\.png$`), { timeout: 30_000 });
    const answer = await page.request.get((await picture.getAttribute("src")) ?? "");
    expect(answer.status()).toBe(200);
    expect(answer.headers()["content-type"]).toBe("image/png");
    await expect.poll(async () => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 30_000 }).toBe(true);

    // As drawn: a window onto the email, every restriction on, and more email than window.
    await expect(frame).toHaveAttribute("sandbox", "");
    expect(await frameHeight()).toBe(620);
    const size = page.getByTestId("email-preview-size");
    await expect(size).toHaveText("Mărește");
    expect((await size.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // «Mărește»: the frame is as tall as the email — nothing scrolls inside it — and still runs no script.
    await size.click();
    await expect(size).toHaveText("Micșorează");
    await expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
    await expect
      .poll(
        async () =>
          frame.evaluate((element: HTMLIFrameElement) => {
            const root = element.contentDocument?.documentElement;
            const view = element.contentWindow?.innerHeight ?? 0;
            return root ? root.scrollHeight <= view && Math.ceil(root.getBoundingClientRect().height) === view : false;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    const whole = await frameHeight();
    expect(whole).toBeGreaterThan(620);
    await expect(picture).toBeVisible();

    // It follows the words: more of them and the frame grows, the page never scrolling sideways.
    await page.locator('[name="bodyRo"]').fill("Un rând.\n\n".repeat(8));
    await expect.poll(frameHeight, { timeout: 30_000 }).toBeGreaterThan(whole);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // «Micșorează»: the window again, as it was. Neither press sent the form.
    await size.click();
    await expect(size).toHaveText("Mărește");
    await expect(frame).toHaveAttribute("sandbox", "");
    expect(await frameHeight()).toBe(620);
    await expect(page).toHaveURL(new RegExp(`/admin/events/${eventId}/mesaje$`));
    expect(await queuedFor(eventId)).toEqual([]);
  });

  test("§945 a trial to one person ticked on the list, then the same words to everybody", async ({ page }) => {
    test.setTimeout(150_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-proba`;
    const eventId = await seedEvent(tag, [
      { status: "CONFIRMED", locale: "ro", name: "Ștefan Probă" },
      { status: "CONFIRMED", locale: "ro", name: "Ana Restul" },
      { status: "WAITLISTED", locale: "en", name: "Bogdan Waiting" },
      { status: "CANCELLED", locale: "ro", name: "Gabi Anulat" },
    ]);
    created.push(eventId);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const send = page.getByRole("button", { name: "Trimite mesajul" });

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}/mesaje`);
    await hydrated(page);
    await field("subjectRo").fill("Probă la {eventTitle}");
    await field("subjectEn").fill("Trial at {eventTitle}");
    await field("bodyRo").fill("Salut, {participantName}!\n\nNe vedem la start.");
    await field("bodyEn").fill("Hi, {participantName}!\n\nSee you at the start.");

    // The fifth choice, a thumb's target like the four groups: it opens the list, and «Trimite» waits for a tick.
    const choice = page.getByRole("radio", { name: /Doar anumiți participanți/ });
    const choiceBox = await choice.boundingBox();
    expect(choiceBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(choiceBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await choice.check();
    const list = page.getByTestId("participant-message-chosen");
    const rows = page.getByTestId("participant-message-chosen-row");
    // Everybody who can be written to, by name with a state — never the cancelled one.
    await expect(rows).toHaveText(["Ana Restul · Confirmată", "Bogdan Waiting · Pe lista de așteptare", "Ștefan Probă · Confirmată"]);
    await expect(page.getByTestId("participant-message-recipients")).toHaveText("Bifați: 0 din 3");
    await expect(page.getByTestId("participant-message-chosen-names")).toContainText("Nu ai bifat pe nimeni încă.");
    await expect(send).toBeDisabled();

    // Found without its diacritics; Enter in the search box finds, and never sends the form.
    const search = list.getByRole("searchbox");
    await search.fill("stefan");
    await search.press("Enter");
    await expect(rows).toHaveText(["Ștefan Probă · Confirmată"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const tick = page.getByRole("checkbox", { name: /Ștefan Probă/ });
    const tickBox = await tick.boundingBox();
    expect(tickBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(tickBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await tick.check();
    // The tick outlives the search that found it, and the page says who before the press.
    await search.fill("");
    await expect(page.getByTestId("participant-message-chosen-names")).toHaveText("Primesc mesajul: Ștefan Probă.");
    await expect(page.getByTestId("participant-message-recipients")).toHaveText("Bifați: 1 din 3");

    // «Confirmă trimiterea», beside the button: the choice, its number and who, by name — then the number typed by hand.
    const who = page.getByTestId("participant-message-confirm-who");
    await expect(who).toContainText("Participanți aleși · Bifați: 1 din 3");
    await expect(who).toContainText("Primesc mesajul: Ștefan Probă.");
    await field("confirmCount").fill("1");

    // The question is about the ticked, and its email line counts them at the press.
    await send.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Trimiți mesajul doar participanților bifați?");
    await expect(dialog.getByTestId("confirm-email")).toHaveText("Pleacă 1 email „Mesaj de la organizatori”, câte unul către fiecare participant.");
    await confirmDialog(page);
    const sent = page.getByTestId("participant-message-sent");
    await expect(sent).toContainText("Mesaj pus la coadă pentru 1 participant.", { timeout: 30_000 });
    await expect(sent).toContainText("Textul a rămas în căsuțe");
    await expect(page).toHaveURL(/sent=1&test=0&kept=[0-9a-f-]{36}/);
    expect(await namesWrittenTo(eventId)).toEqual(["Ștefan Probă"]);

    // The trial's words are still in the boxes, the choice is back on everybody, and the history names the trial.
    await hydrated(page);
    await expect(field("subjectRo")).toHaveValue("Probă la {eventTitle}");
    await expect(field("bodyEn")).toHaveValue("Hi, {participantName}!\n\nSee you at the start.");
    await expect(page.getByRole("radio", { name: /Toți cei înscriși/ })).toBeChecked();
    const trial = page.getByTestId("participant-message-history-row").first();
    await expect(trial).toContainText("Participanți aleși");
    await expect(trial).toContainText("1 destinatar");

    // Everybody is chosen now, and the trial's «1» typed again: nothing is sent, the refusal says how many there are, the
    // words stay and the number is asked for again.
    await expect(who).toHaveText("Toți cei înscriși · 3 destinatari");
    await field("confirmCount").fill("1");
    await send.click();
    await confirmDialog(page);
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toContainText("numărul scris la confirmare nu este cel al destinatarilor. Acum sunt 3", { timeout: 30_000 });
    await expect(refusal.getByRole("link", { name: "Scrie la câți trimiți" })).toBeVisible();
    await expect(field("confirmCount")).toHaveValue("");
    await expect(field("subjectRo")).toHaveValue("Probă la {eventTitle}");
    expect(await namesWrittenTo(eventId)).toEqual(["Ștefan Probă"]);

    // The right number sends the same words to everybody — and after a send to a group the boxes are empty again.
    await field("confirmCount").fill("3");
    await send.click();
    await expect(page.getByRole("dialog")).toContainText("Trimiți mesajul la 3 participanți?");
    await confirmDialog(page);
    await expect(sent).toContainText("Mesaj pus la coadă pentru 3 participanți.", { timeout: 30_000 });
    await expect(sent).not.toContainText("Textul a rămas în căsuțe");
    await expect(page).not.toHaveURL(/kept=/);
    await expect(field("subjectRo")).toHaveValue("");
    expect(await namesWrittenTo(eventId)).toEqual(["Ștefan Probă", "Ana Restul", "Bogdan Waiting", "Ștefan Probă"]);

    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
