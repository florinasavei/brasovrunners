import { existsSync } from "node:fs";
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

type Person = { status: string; locale: "ro" | "en" };

async function seedEvent(tag: string): Promise<string> {
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
    const people: Person[] = [
      { status: "CONFIRMED", locale: "ro" },
      { status: "WAITLISTED", locale: "en" },
      { status: "CANCELLED", locale: "ro" },
      { status: "PENDING_EMAIL_CONFIRMATION", locale: "ro" },
    ];
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
         VALUES ($1, $2, $3::registration_status, $4::locale, 'Runner', 'Runner', 1, now(), false, 1, true,
           CASE WHEN $3::text = 'CONFIRMED' THEN now() END,
           CASE WHEN $3::text = 'WAITLISTED' THEN now() END,
           CASE WHEN $3::text = 'CANCELLED' THEN now() END,
           CASE WHEN $3::text = 'CANCELLED' THEN 'PARTICIPANT'::registration_cancellation_source END)`,
        [eventId, participant[0].id, person.status, person.locale],
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

    // Romanian only: the English body holds nothing but spaces, which the browser lets through
    // and the server refuses — on that box, with everything else kept (§315).
    await field("subjectRo").fill("Vreme rea la {eventTitle}");
    await field("subjectEn").fill("Bad weather at {eventTitle}");
    await field("bodyRo").fill("Salut, {participantName}!\n\nStartul se mută la 10:00 din cauza furtunii.");
    await field("bodyEn").fill("   ");
    await page.getByRole("button", { name: "Trimite mesajul" }).click();
    await expect(page.getByRole("dialog")).toContainText("Trimiți mesajul la 2 participanți?");
    await page.getByRole("dialog").getByRole("button", { name: "Trimite", exact: true }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toContainText("Mesajul (English)", { timeout: 30_000 });
    await expect(field("bodyRo")).toHaveValue("Salut, {participantName}!\n\nStartul se mută la 10:00 din cauza furtunii.");
    await expect(field("subjectEn")).toHaveValue("Bad weather at {eventTitle}");

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

    // Send, behind the question that names how many.
    await page.getByRole("button", { name: "Trimite mesajul" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Trimiți mesajul la 2 participanți?");
    await dialog.getByRole("button", { name: "Trimite", exact: true }).click();
    await expect(page.getByTestId("participant-message-sent")).toContainText("Mesaj pus la coadă pentru 2 participanți.", { timeout: 30_000 });
    await expect(page).toHaveURL(/sent=2/);

    // The history names the send: the subject as written, the group, how many, and who.
    const row = page.getByTestId("participant-message-history-row").first();
    await expect(row).toContainText("Vreme rea la {eventTitle}");
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
});
