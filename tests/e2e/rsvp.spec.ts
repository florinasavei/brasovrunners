import { expect, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";
import { mintRsvpLink, rememberedBrowsers, rsvpCount, rsvpMessages, rsvpRow, withDatabase } from "./support/rsvp-link";

/**
 * §811 («Vin!» part 1), end to end, on the phone and the desktop: the club ticks «Acceptă răspunsuri „Vin!”» on a group run, a visitor types an
 * address and a name and ticks «Vreau să apar cu numele», the link of the email (the setup, not the subject: `support/rsvp-link.ts`) opens a
 * page that changes nothing, «Da, vin» counts the answer and remembers the browser — and then, on a SECOND ticked event in the same browser,
 * «Vin!» is one tap, counted at once with no email; «Nu mai vin» is one tap; «Nu sunt eu» brings the typed form back.
 *
 * The local seed approves every platform template as a sample version (§29), so the notice in force already names `{{rsvp}}` and the box is
 * live. The spec creates its own group run and its second date (as `group-run-declaration.spec.ts` does), so the two projects, which run side
 * by side, never share an event or an address.
 */
const DATE = "2027-05-12";
let title = "";
let slug = "";
let englishTitle = "";
let englishSlug = "";
let secondSlug = "";
let eventId = "";
let secondEventId = "";
let guest = "";
const NAME = "Ana Rsvp";

/** Nothing sideways on a phone (BR-REQ-041-01). */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const eventUrl = (locale: "ro" | "en", which: string) => (locale === "ro" ? `/ro/evenimente/${which}` : `/en/events/${which}`);

test.describe.serial("§811 «Vin!» on a turn-up event", () => {
  test.afterAll(async () => {
    // Give the shared database back: the spec's events (and, with them, its answers) and the browsers it remembered.
    await withDatabase(async (client) => {
      await client.query("DELETE FROM person_sessions WHERE canonical_email = lower($1)", [guest]);
      await client.query("DELETE FROM event_translations WHERE event_id = ANY($1::uuid[])", [[eventId, secondEventId].filter(Boolean)]);
      await client.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [[eventId, secondEventId].filter(Boolean)]);
    });
  });

  test("the club ticks «Acceptă răspunsuri „Vin!”» on a group run and publishes it", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    title = `Alergarea cu Vin ${suffix}`;
    slug = `alergarea-cu-vin-${suffix}`;
    englishTitle = `The run with Coming ${suffix}`;
    englishSlug = `run-with-coming-${suffix}`;
    secondSlug = `${slug}-2`;
    guest = `ana.vin.${suffix}@example.test`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await fillDateField(page, "Începutul evenimentului", DATE);
    await fillTimeField(page, "Ora", "18:30");
    await field("event.locationName").fill("Stația de telecabină");
    await field("event.locationNameEn").fill("The cable car station");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(englishTitle);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    const editorUrl = page.url().split("?")[0];
    eventId = editorUrl.split("/").at(-1) ?? "";
    await hydrated(page);

    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Alergăm împreună.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "We run together.");

    // The club's tick, in the registration card, for a type one simply turns up to: a real tick box, unticked, with its one help line.
    await openEditorBox(page, "Participare, înscrieri și regulament");
    const tick = page.getByRole("checkbox", { name: "Acceptă răspunsuri „Vin!” din pagină, calendar și email" });
    await expect(tick).toBeVisible();
    await expect(tick).not.toBeChecked();
    await expect(page.getByText("Nota de confidențialitate trebuie să descrie răspunsurile „Vin!” — vezi Sarcini.")).toBeVisible();
    expect((await tick.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await tick.check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);
    await openEditorBox(page, "Participare, înscrieri și regulament");
    await expect(page.getByRole("checkbox", { name: "Acceptă răspunsuri „Vin!” din pagină, calendar și email" })).toBeChecked();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the run gets a second ticked date, a week later", async () => {
    await withDatabase(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("CREATE TEMP TABLE second_date ON COMMIT DROP AS SELECT * FROM events WHERE id = $1", [eventId]);
        const { rows } = await client.query<{ id: string }>(
          `UPDATE second_date SET id = gen_random_uuid(), featured = false, starts_at = starts_at + interval '7 days',
             ends_at = ends_at + interval '7 days' RETURNING id`,
        );
        secondEventId = rows[0].id;
        await client.query("INSERT INTO events SELECT * FROM second_date");
        await client.query("CREATE TEMP TABLE second_texts ON COMMIT DROP AS SELECT * FROM event_translations WHERE event_id = $1", [eventId]);
        await client.query("UPDATE second_texts SET id = gen_random_uuid(), event_id = $1, slug = slug || '-2'", [secondEventId]);
        await client.query("INSERT INTO event_translations SELECT * FROM second_texts");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      const { rows } = await client.query<{ rsvp_enabled: boolean }>("SELECT rsvp_enabled FROM events WHERE id = $1", [secondEventId]);
      expect(rows[0].rsvp_enabled).toBe(true);
    });
  });

  test("a visitor types an address and a name, ticks to be seen, and is told to press «Da, vin» — in Română, and the box reads in English too", async ({ page }) => {
    await page.goto(eventUrl("ro", slug));
    await hydrated(page);
    const box = page.getByTestId("rsvp-box");
    await expect(box).toBeVisible();
    await expect(box.getByRole("heading", { name: "Vii?" })).toBeVisible();
    await expect(box).toContainText("Spune-ne că vii și vezi cine mai vine.");
    // Nobody has answered: only the sentence that asks to be first.
    await expect(page.getByTestId("rsvp-count-empty")).toHaveText("Fii primul care spune că vine.");
    await noSidewaysScroll(page);

    const email = box.locator('input[name="email"]');
    const button = box.getByRole("button", { name: "Vin!", exact: true });
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await email.fill(guest);
    await box.locator('input[name="name"]').fill(NAME);
    const showName = box.getByRole("checkbox", { name: "Vreau să apar cu numele" });
    await expect(showName).not.toBeChecked();
    expect((await showName.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await showName.check();
    // A person reads before pressing: the timing check (§19.4) refuses a press under a second.
    await page.waitForTimeout(1_500);
    await button.click();
    await page.waitForURL(/vin=1/);
    await expect(page.getByTestId("rsvp-sent")).toHaveText("Ți-am trimis un email: apasă „Da, vin” ca să te numărăm.");
    await expect(page.getByTestId("spam-hint")).toBeVisible();
    await noSidewaysScroll(page);

    // The answer waits: a row that is not confirmed, one message queued, the count still empty.
    const row = await rsvpRow(guest, eventId);
    expect(row).toMatchObject({ confirmedAt: null, displayName: NAME, showName: true });
    expect(await rsvpMessages(guest)).toBe(1);

    // English: the same card, in its own words.
    await page.goto(eventUrl("en", englishSlug));
    await hydrated(page);
    const english = page.getByTestId("rsvp-box");
    await expect(english.getByRole("heading", { name: "Coming?" })).toBeVisible();
    await expect(english.getByRole("button", { name: "I'm coming!", exact: true })).toBeVisible();
    await expect(english.getByRole("checkbox", { name: "I want my name to show" })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("the link opens a page that counts nobody until its button is pressed — then «Vin (1)» names the person and the browser is remembered", async ({ page }) => {
    const row = await rsvpRow(guest, eventId);
    const secret = await mintRsvpLink(row!.id, "RSVP_CONFIRM");

    // A scanner or a curious click: the GET names the event and draws ONE button, and changes nothing.
    for (let i = 0; i < 2; i += 1) {
      await page.goto(`/ro/vin/${secret}`);
      await hydrated(page);
      await expect(page.getByTestId("rsvp-confirm-intro")).toHaveText(`Confirmi că vii la ${title}?`);
      await expect(page.getByRole("button", { name: "Da, vin" })).toHaveCount(1);
      await noSidewaysScroll(page);
    }
    expect((await rsvpRow(guest, eventId))?.confirmedAt).toBeNull();
    expect(await rememberedBrowsers(guest)).toBe(0);

    const press = page.getByRole("button", { name: "Da, vin" });
    expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await press.click();
    await page.waitForURL(new RegExp(`/ro/evenimente/${slug}#vin$`));
    expect((await rsvpRow(guest, eventId))?.confirmedAt).not.toBeNull();
    expect(await rememberedBrowsers(guest)).toBe(1);

    // The browser carries the secret where scripts cannot read it, and a hint with no secret where they can.
    const cookies = await page.context().cookies();
    const secretCookie = cookies.find((cookie) => cookie.name === "br_person");
    const hintCookie = cookies.find((cookie) => cookie.name === "br_person_hint");
    expect(secretCookie?.httpOnly).toBe(true);
    expect(secretCookie?.sameSite).toBe("Lax");
    expect(hintCookie?.httpOnly).toBe(false);
    expect(decodeURIComponent(hintCookie?.value ?? "")).not.toContain(secretCookie?.value ?? "no-secret");
    expect(decodeURIComponent(hintCookie?.value ?? "")).not.toContain(guest);

    // The island: the one-tap state, and the count under it, with the name that was ticked.
    await expect(page.getByTestId("rsvp-remembered")).toBeVisible();
    await expect(page.getByTestId("rsvp-going")).toContainText("Tu vii");
    await expect(page.getByTestId("rsvp-remembered-as")).toContainText("an…@example.test");
    await expect(page.getByTestId("rsvp-count-heading")).toContainText("Vin (1)");
    await expect(page.getByTestId("rsvp-name")).toHaveText(NAME);
    // §812: the event's calendar file now carries the door and the count — the confirmation expired the file that was made without them.
    const ics = await page.request.get(`/ro/events/${slug}/calendar.ics`);
    expect((await ics.text()).replace(/\r\n /g, "").replace(/\\n/g, "\n")).toMatch(new RegExp(`Vin! → \\S+/ro/evenimente/${slug}#vin\\n1 vine până acum`));
    // …and the address is nowhere on the page.
    expect(await page.content()).not.toContain(guest);
    await noSidewaysScroll(page);

    // The same link, spent: one sentence, and the event's page.
    await page.goto(`/ro/vin/${secret}`);
    await expect(page.getByTestId("rsvp-link-invalid")).toContainText("Linkul nu mai merge");
    await expect(page.getByRole("link", { name: "Pagina evenimentului" })).toHaveAttribute("href", new RegExp(`/ro/evenimente/${slug}$`));
  });

  test("a second ticked event, in the same browser: «Vin!» is one tap, counted at once, no email; «Nu mai vin» one tap; «Nu sunt eu» brings the typed form back", async ({ page, context }) => {
    // Each test has a browser of its own, so this one is remembered the way a person's is: by pressing a link of their answer.
    const row = await rsvpRow(guest, eventId);
    const confirm = await mintRsvpLink(row!.id, "RSVP_CONFIRM");
    await page.goto(`/ro/vin/${confirm}`);
    // The answer is already counted, the link says so, and its press remembers this browser.
    await expect(page.getByTestId("rsvp-confirm-intro")).toContainText("Ești deja numărat");
    await page.getByRole("button", { name: "Da, vin" }).click();
    await page.waitForURL(new RegExp(`/ro/evenimente/${slug}#vin$`));
    expect((await context.cookies()).some((cookie) => cookie.name === "br_person")).toBe(true);
    const messagesBefore = await rsvpMessages(guest);

    // The second date: the remembered state, not the typed form.
    await page.goto(eventUrl("ro", secondSlug));
    await hydrated(page);
    const remembered = page.getByTestId("rsvp-remembered");
    await expect(remembered).toBeVisible();
    await expect(remembered).toContainText("Răspunzi ca");
    await expect(remembered).toContainText("an…@example.test");
    await expect(remembered.locator('input[name="email"]')).toHaveCount(0);
    await expect(remembered).toContainText("Browserul tău rămâne recunoscut un an după „Da, vin” sau „Nu mai vin”; „Nu sunt eu” îl uită.");
    const go = remembered.getByRole("button", { name: "Vin!", exact: true });
    expect((await go.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);

    await go.click();
    await expect(page.getByTestId("rsvp-going")).toContainText("Tu vii");
    // Counted at once: the row is confirmed, no message was queued, and the count under the card says one (the person asked for no name).
    const second = await rsvpRow(guest, secondEventId);
    expect(second?.confirmedAt).not.toBeNull();
    expect(second?.showName).toBe(false);
    expect(await rsvpMessages(guest)).toBe(messagesBefore);
    await expect(page.getByTestId("rsvp-count-heading")).toContainText("Vin (1)");
    await expect(page.getByTestId("rsvp-others")).toHaveText("și încă 1");
    expect(await page.content()).not.toContain(guest);

    // One tap back.
    await page.getByRole("button", { name: "Nu mai vin", exact: true }).click();
    await expect(remembered.getByRole("button", { name: "Vin!", exact: true })).toBeVisible();
    // …and the second event's answer is gone, the first one's is not.
    expect(await rsvpCount(guest)).toBe(1);
    await expect(page.getByTestId("rsvp-count-empty")).toHaveText("Fii primul care spune că vine.");

    // And «Nu sunt eu»: the typed form is back, this browser's row and both its cookies are gone (the previous test's browser, which is
    // another one, stays remembered: one row each).
    const browsersBefore = await rememberedBrowsers(guest);
    expect(browsersBefore).toBe(2);
    await page.getByRole("button", { name: "Nu sunt eu" }).click();
    await expect(page.getByTestId("rsvp-box").locator('input[name="email"]')).toBeVisible();
    await expect(page.getByTestId("rsvp-remembered")).toHaveCount(0);
    const left = (await context.cookies()).map((cookie) => cookie.name);
    expect(left).not.toContain("br_person");
    expect(left).not.toContain("br_person_hint");
    expect(await rememberedBrowsers(guest)).toBe(browsersBefore - 1);
    // What was answered stays answered on the first event.
    expect(await rsvpCount(guest)).toBe(1);
  });

  test("the small fold «Nu mai vin» answers the same sentence for an address that never answered", async ({ page }) => {
    await page.goto(eventUrl("ro", slug));
    await hydrated(page);
    const fold = page.getByTestId("rsvp-withdraw");
    await fold.locator("summary").click();
    await fold.locator('input[name="withdrawEmail"]').fill(`nimeni.${Date.now().toString(36)}@example.test`);
    await page.waitForTimeout(1_500);
    await fold.getByRole("button", { name: "Trimite linkul" }).click();
    await page.waitForURL(/vin=retras/);
    await expect(page.getByTestId("rsvp-withdraw-sent")).toHaveText("Dacă adresa ta e printre cei care vin, ți-am trimis pe email un link.");
  });

  test("the «Nu mai vin» link deletes the answer, and says so", async ({ page }) => {
    const row = await rsvpRow(guest, eventId);
    const secret = await mintRsvpLink(row!.id, "RSVP_WITHDRAW");
    await page.goto(`/ro/vin/${secret}`);
    await hydrated(page);
    await expect(page.getByTestId("rsvp-withdraw-intro")).toHaveText(`Nu mai vii la ${title}? Răspunsul tău se șterge.`);
    expect(await rsvpRow(guest, eventId)).not.toBeNull();
    await page.getByRole("button", { name: "Nu mai vin" }).click();
    await expect(page.getByTestId("rsvp-withdrawn")).toContainText(`ți-am șters răspunsul de la ${title}`);
    expect(await rsvpCount(guest)).toBe(0);
    await noSidewaysScroll(page);
  });

  test("with the club's tick off, the page shows nothing of it — no box, no count, no sentence", async ({ page, browser }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await openEditorBox(page, "Participare, înscrieri și regulament");
    await page.getByRole("checkbox", { name: "Acceptă răspunsuri „Vin!” din pagină, calendar și email" }).uncheck();
    // A published event is saved only once its editor says they understand it is live (§384).
    await page.getByRole("checkbox", { name: /Am înțeles că modific conținut publicat/ }).check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    // A stranger's page, after the editor's own save expired it: nothing at all — and the tick, off, is what the editor says.
    const stranger = await browser.newContext();
    const visitor = await stranger.newPage();
    await visitor.goto(eventUrl("ro", slug));
    await hydrated(visitor);
    await expect(visitor.getByTestId("rsvp-box")).toHaveCount(0);
    await expect(visitor.getByTestId("rsvp-count")).toHaveCount(0);
    await expect(visitor.locator("#main")).not.toContainText("Vii?");
    await stranger.close();
  });
});
