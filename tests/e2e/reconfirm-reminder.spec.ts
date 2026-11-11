import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { mintActionLink } from "./support/action-link";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * «Cere reconfirmarea» (the decision «Cere reconfirmarea»), end to end, on a phone and a desktop: on «Trimite un mesaj
 * participanților» the button «Completează cu textul de reminder» writes the four boxes in both languages and ticks
 * «Cere reconfirmarea» — asking first when a box already holds words — and the preview then shows «Vin» above «Nu mai pot
 * ajunge»; the question before «Trimite» says how long the send takes; the send writes one ask per registration it asks.
 * On the person's own manage page «Vii la …?» asks with «Da, vin la cursă», a 44-pixel target, and the press records the
 * answer once, the cancel still there. Each project seeds its own made-up event and people straight into the database —
 * the setup, not the subject, as `support/action-link.ts` argues.
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

/** A race twenty days ahead in both languages, with a confirmed Romanian runner and an English one on the waiting list. */
async function seedEvent(tag: string): Promise<{ eventId: string; people: Array<{ id: string; participantId: string }> }> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, editorial_status, published_at, location_name)
       VALUES ('RACE', now() + interval '20 days', 'INTERNAL', 10, 'PUBLISHED', now() - interval '1 day', 'Parcul Exemplu')
       RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'x')`, [eventId, `reconfirmare-${tag}`, `Crosul reconfirmării ${tag}`]);
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'en', $2, $3, 'x')`, [eventId, `reconfirm-${tag}`, `The reconfirm cross ${tag}`]);
    const people: Array<{ id: string; participantId: string }> = [];
    for (const [index, person] of [
      { status: "CONFIRMED", locale: "ro" },
      { status: "WAITLISTED", locale: "en" },
    ].entries()) {
      const email = `vin-${tag}-${index}@test.invalid`;
      const { rows: participant } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, `Alergător ${index}`],
      );
      const { rows: registration } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
           confirmed_at, waitlisted_at)
         VALUES ($1, $2, $3::registration_status, $4::locale, $5, $5, 1, now(), false, 1, true,
           CASE WHEN $3::text = 'CONFIRMED' THEN now() END,
           CASE WHEN $3::text = 'WAITLISTED' THEN now() END)
         RETURNING id`,
        [eventId, participant[0].id, person.status, person.locale, `Alergător ${index}`],
      );
      people.push({ id: registration[0].id, participantId: participant[0].id });
    }
    return { eventId, people };
  });
}

async function asksOf(eventId: string): Promise<Array<{ registration_id: string; reconfirmed_at: Date | null }>> {
  return withDatabase(async (client) => (await client.query("SELECT registration_id, reconfirmed_at FROM registration_reconfirmations WHERE event_id = $1", [eventId])).rows);
}

async function removeEvents(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ participant_id: string }>("DELETE FROM registrations WHERE event_id = ANY($1::uuid[]) RETURNING participant_id", [ids]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [rows.map((row) => row.participant_id)]);
    await client.query("DELETE FROM audit_logs WHERE entity_type = 'event' AND entity_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM event_translations WHERE event_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids]);
  });
}

/** The preview's email, as the sandboxed frame holds it. */
async function previewHtml(page: Page): Promise<string> {
  return (await page.getByTestId("participant-message-preview").locator("iframe").getAttribute("srcdoc")) ?? "";
}

test.describe("«Cere reconfirmarea»: the ready reminder, «Vin» and the answer", () => {
  const created: string[] = [];
  test.afterAll(async () => removeEvents(created));

  test("the fill button writes both languages and ticks the box, the preview shows «Vin», the send asks", async ({ page }) => {
    test.setTimeout(150_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const { eventId } = await seedEvent(tag);
    created.push(eventId);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}/mesaje`);
    await hydrated(page);

    const tick = page.getByTestId("participant-message-reconfirm").getByRole("checkbox", { name: "Cere reconfirmarea" });
    await expect(tick).not.toBeChecked();
    await expect(page.getByTestId("participant-message-reconfirm")).toContainText("Nu se anulează nimeni automat");

    const fill = page.getByRole("button", { name: "Completează cu textul de reminder" });
    expect((await fill.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await fill.click();
    await expect(field("subjectRo")).toHaveValue("Ne vedem la {eventTitle}? Spune-ne dacă vii");
    await expect(field("subjectEn")).toHaveValue("See you at {eventTitle}? Tell us if you're coming");
    await expect(field("bodyRo")).toHaveValue(/Dacă nu apeși nimic, înscrierea ta rămâne exact cum e\./);
    await expect(field("bodyEn")).toHaveValue(/If you press nothing, your registration stays exactly as it is\./);
    await expect(tick).toBeChecked();
    // The preview, rendered by the server: «Vin» above «Nu mai pot ajunge», on example links.
    await expect.poll(async () => (await previewHtml(page)).includes('data-email-part="reconfirm"'), { timeout: 15_000 }).toBe(true);
    const html = await previewHtml(page);
    expect(html.indexOf('data-email-part="reconfirm"')).toBeLessThan(html.indexOf('data-email-part="cannot-come"'));
    expect(html).toContain("EXAMPLE#reconfirm");

    // A box with words in it: the press asks before it replaces them.
    await field("subjectRo").fill("Un subiect scris de mână");
    await fill.click();
    await confirmDialog(page, "Înlocuiești textul scris?");
    await expect(field("subjectRo")).toHaveValue("Ne vedem la {eventTitle}? Spune-ne dacă vii");

    // Unticked, the preview drops «Vin»; ticked again, it comes back. The tick is a thumb's target.
    const tickBox = await page.getByTestId("participant-message-reconfirm").locator(".MuiCheckbox-root").boundingBox();
    expect(tickBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await tick.uncheck();
    await expect.poll(async () => (await previewHtml(page)).includes('data-email-part="reconfirm"'), { timeout: 15_000 }).toBe(false);
    await tick.check();
    await expect.poll(async () => (await previewHtml(page)).includes('data-email-part="reconfirm"'), { timeout: 15_000 }).toBe(true);

    // The question before «Trimite» says how long it takes, from the server.
    await page.getByRole("button", { name: "Trimite mesajul" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Pleacă treptat");
    await confirmDialog(page);
    await expect(page).toHaveURL(/sent=2/, { timeout: 30_000 });
    expect(await asksOf(eventId)).toHaveLength(2);
    await expect(page.getByTestId("participant-message-history-answers").first()).toHaveText("Au reconfirmat 0 · Au anulat 0 · N-au răspuns 2");
  });

  test("the manage page asks «Vii la …?», and «Da, vin la cursă» records the answer once, the cancel still there", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = `${test.info().project.name}-page-${Date.now().toString(36)}`;
    const { eventId, people } = await seedEvent(tag);
    created.push(eventId);
    const [ana] = people;
    // The ask a send would have written: the setup, not the subject.
    await withDatabase((client) =>
      client.query("INSERT INTO registration_reconfirmations (registration_id, event_id, send_id, asked_at) VALUES ($1, $2, gen_random_uuid(), now())", [ana.id, eventId]),
    );
    const secret = await mintActionLink(ana, "MANAGE_REGISTRATION");

    await page.goto(`/ro/inregistrari/gestionare/${secret}#reconfirm`);
    await hydrated(page);
    const section = page.getByTestId("manage-reconfirm");
    await expect(section).toContainText(`Vii la Crosul reconfirmării ${tag}?`);
    await expect(section).toContainText("Răspunsul e opțional");
    const yes = page.getByTestId("manage-reconfirm-yes");
    await expect(yes).toHaveText("Da, vin la cursă");
    expect((await yes.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The GET wrote nothing.
    expect((await asksOf(eventId))[0].reconfirmed_at).toBeNull();

    await yes.click();
    await expect(page).toHaveURL(/reconfirm=1/, { timeout: 30_000 });
    await expect(page.getByTestId("manage-reconfirm-done")).toContainText("Ne-ai spus că vii");
    await expect(page.getByTestId("manage-reconfirm-yes")).toHaveCount(0);
    // The link was read, never spent: the cancel is still on the page.
    await expect(page.getByTestId("manage-person-cancel")).toBeVisible();
    const answered = (await asksOf(eventId))[0].reconfirmed_at;
    expect(answered).not.toBeNull();
  });
});
