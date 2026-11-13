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
 * One press counts: the email's «Vin» opens the person's own manage page at `#reconfirm`, and in a browser the page
 * presses «Da, vin la cursă» by itself once and shows the noted answer; opening the link again keeps the first moment;
 * `#cancel` and a bare link record nothing; a browser without scripts sees «Vii la …?» with the button, a 44-pixel target,
 * records nothing on the GET and records on the press, the cancel still there; after the automatic press, Back leaves the
 * page and presses nothing again. Each project seeds its own made-up event
 * and people straight into the database — the setup, not the subject, as `support/action-link.ts` argues.
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
    await expect(field("bodyRo")).toHaveValue(/„Vin” e opțional: dacă nu-l apeși, nu se schimbă nimic la înscrierea ta\.\n\nDacă mai ai de semnat declarația/);
    await expect(field("bodyEn")).toHaveValue(/“I'm coming” is optional: if you don't press it, nothing about your registration changes\.\n\nIf you still have to sign/);
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

    // «Scrie la câți trimiți»: the number of recipients, typed — the send insists on it.
    await page.locator('[name="confirmCount"]').fill("2");
    // The question before «Trimite» says how long it takes, from the server.
    await page.getByRole("button", { name: "Trimite mesajul" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Pleacă treptat");
    await confirmDialog(page);
    await expect(page).toHaveURL(/sent=2/, { timeout: 30_000 });
    expect(await asksOf(eventId)).toHaveLength(2);
    await expect(page.getByTestId("participant-message-history-answers").first()).toHaveText("Au reconfirmat 0 · Au anulat 0 · N-au răspuns 2");
  });

  /** The ask a send would have written: the setup, not the subject. */
  async function ask(eventId: string, registrationId: string): Promise<void> {
    await withDatabase((client) =>
      client.query("INSERT INTO registration_reconfirmations (registration_id, event_id, send_id, asked_at) VALUES ($1, $2, gen_random_uuid(), now())", [registrationId, eventId]),
    );
  }
  const answeredAt = async (eventId: string, registrationId: string) => (await asksOf(eventId)).find((row) => row.registration_id === registrationId)?.reconfirmed_at ?? null;

  test("one press counts: «Vin» opens the page and records once, a second opening keeps the first moment, #cancel and a bare link record nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = `${test.info().project.name}-page-${Date.now().toString(36)}`;
    const { eventId, people } = await seedEvent(tag);
    created.push(eventId);
    const [ana] = people;
    await ask(eventId, ana.id);
    const secret = await mintActionLink(ana, "MANAGE_REGISTRATION");
    const link = `/ro/inregistrari/gestionare/${secret}`;

    // «Nu mai pot ajunge» and a bare manage link: the question is there, and nothing presses it.
    for (const opened of [`${link}#cancel`, link]) {
      await page.goto(opened);
      await hydrated(page);
      await expect(page.getByTestId("manage-reconfirm")).toContainText(`Vii la Crosul reconfirmării ${tag}?`);
      await expect(page.getByTestId("manage-reconfirm-yes")).toBeVisible();
      await expect(page).not.toHaveURL(/reconfirm=/);
      expect(await answeredAt(eventId, ana.id), opened).toBeNull();
    }

    // The email's «Vin», opened as a mail client opens it — a new tab, a fresh load (the same document with only a new hash
    // would be no load at all): opening it is the press — no click from the spec — and the page says the answer is noted.
    const fromEmail = await page.context().newPage();
    // A page before it in the tab's history, so Back has somewhere to go (a mail client's own page, here the site's).
    await fromEmail.goto("/ro");
    const before = fromEmail.url();
    await fromEmail.goto(`${link}#reconfirm`, { waitUntil: "commit" });
    // The form names its person, so the answer's address carries it: `?reconfirm=1&person=<id>#reconfirm`.
    await fromEmail.waitForURL(new RegExp(`\\?reconfirm=1&person=${ana.id}#reconfirm$`), { timeout: 30_000 });
    await expect(fromEmail.getByTestId("manage-reconfirm-done")).toContainText("Am notat că vii — ne-ai răspuns");
    await expect(fromEmail.getByTestId("manage-reconfirm-yes")).toHaveCount(0);
    const first = await answeredAt(eventId, ana.id);
    expect(first).not.toBeNull();
    // The link was read, never spent: the cancel is still on the page.
    await expect(fromEmail.getByTestId("manage-person-cancel")).toBeVisible();

    // Back does not press again: the answer replaced the page that pressed, so Back leaves the manage page and stays left.
    await fromEmail.goBack();
    await expect(fromEmail).toHaveURL(before);
    await fromEmail.waitForTimeout(2_000);
    await expect(fromEmail).toHaveURL(before);
    expect((await answeredAt(eventId, ana.id))?.getTime()).toBe(first?.getTime());

    // Opened again from the email: the noted answer, no second press, the first moment kept.
    const again = await page.context().newPage();
    await again.goto(`${link}#reconfirm`);
    await hydrated(again);
    await expect(again.getByTestId("manage-reconfirm-done")).toBeVisible();
    await expect(again.getByTestId("manage-reconfirm-auto")).toHaveCount(0);
    expect((await answeredAt(eventId, ana.id))?.getTime()).toBe(first?.getTime());
  });

  test("without scripts the question keeps its button: the GET records nothing, and the press records the answer", async ({ browser }) => {
    test.setTimeout(120_000);
    const tag = `${test.info().project.name}-noscript-${Date.now().toString(36)}`;
    const { eventId, people } = await seedEvent(tag);
    created.push(eventId);
    const [, bob] = people;
    await ask(eventId, bob.id);
    const secret = await mintActionLink(bob, "MANAGE_REGISTRATION");

    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      // A scanner, or a browser without JavaScript: opened twice, the button stays and nobody is counted.
      for (let i = 0; i < 2; i += 1) {
        await page.goto(`/en/registrations/manage/${secret}#reconfirm`);
        await expect(page.getByTestId("manage-reconfirm")).toContainText(`Are you coming to The reconfirm cross ${tag}?`);
        await expect(page.getByTestId("manage-reconfirm")).toContainText("Answering is optional");
        const yes = page.getByTestId("manage-reconfirm-yes");
        await expect(yes).toHaveText("Yes, I'm coming to the race");
        expect((await yes.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      expect(await answeredAt(eventId, bob.id)).toBeNull();

      await page.getByTestId("manage-reconfirm-yes").click();
      await expect(page).toHaveURL(/reconfirm=1/, { timeout: 30_000 });
      await expect(page.getByTestId("manage-reconfirm-done")).toContainText("We have noted that you are coming — you told us on");
      expect(await answeredAt(eventId, bob.id)).not.toBeNull();
      await expect(page.getByTestId("manage-person-cancel")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
