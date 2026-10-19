import { expect, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openEventFold, openFold } from "./support/fold";
import { mintRsvpLink, rememberedBrowsers, rsvpCount, rsvpMessages, rsvpRow, withDatabase } from "./support/rsvp-link";

/**
 * §811 («Vin!» part 1), end to end, on the phone and the desktop: the club ticks «Acceptă răspunsuri „Vin!”» on a group run, a visitor types an
 * address and a name and ticks «Vreau să apar cu numele», the link of the email (the setup, not the subject: `support/rsvp-link.ts`) opens a
 * page that changes nothing, «Da, vin» counts the answer and remembers the browser — and then, on a SECOND ticked event in the same browser,
 * «Vin!» is one tap, counted at once with no email; «Nu mai vin» is one tap; «Nu sunt eu» brings the typed form back.
 *
 * **The card is a closed fold (§812)**, like «Condiții de participare»: its line says «Confirmă prezența (opțional) · N vin», `#vin` and the
 * answer's own redirect open it, and the specs open it first through `openEventFold` (`support/fold.ts`). **Who comes is its own closed fold under
 * it (§825)**, `#cine-vine`, «Cine vine (N)», and the facts say «N vin · vezi cine», a link that opens it. The link of the email counts the person BY ITSELF when a
 * browser opens it — a scanner that fetches without running scripts, and a browser without JavaScript, see the button and count nobody (a context with scripts off stands in for both; a sandbox that runs scripts would count the address — accepted, §819).
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
        await client.query("UPDATE second_texts SET id = gen_random_uuid(), event_id = $1, slug = slug || '-2', title = title || ' bis'", [secondEventId]);
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
    // Closed on arrival, like «Condiții de participare»: the bar says «Confirmă prezența (opțional)» and, with nobody yet, the sentence that asks to be first.
    await expect(box).not.toHaveAttribute("open", /.*/);
    await expect(box.getByRole("heading", { name: "Confirmă prezența (opțional) · Fii primul care confirmă" })).toBeVisible();
    // «Cine vine» is its own closed bar right under it, with no number while nobody has confirmed — and the facts say nothing yet.
    const who = page.getByTestId("rsvp-who");
    await expect(who).toBeVisible();
    await expect(who).not.toHaveAttribute("open", /.*/);
    await expect(who.getByRole("heading", { name: "Cine vine", exact: true })).toBeVisible();
    expect((await who.locator(":scope > summary").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("who-comes-link")).toHaveCount(0);
    // The two bars stand together near the top: the card, then «Cine vine», then «Condiții de participare».
    const tops = await Promise.all([box, who, page.getByTestId("conditions-fold")].map(async (fold) => (await fold.boundingBox())?.y ?? -1));
    expect(tops[0]).toBeGreaterThan(0);
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeLessThan(tops[2]);
    await expect(box.locator('input[name="email"]')).toBeHidden();
    expect((await box.locator(":scope > summary").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
    // …and a link to #vin (the calendar's «Vin! →», the listing's chip) opens it.
    await page.goto(`${eventUrl("ro", slug)}#vin`);
    await expect(box).toHaveAttribute("open", "");
    await expect(box.locator('input[name="email"]')).toBeVisible();

    await openEventFold(page, "rsvp-box");
    await expect(box).toContainText("Nu e o înscriere: ne ajută să știm câți venim.");
    // Nobody has answered: «Cine vine» says so when opened — and the card no longer holds it.
    await expect(box.getByTestId("rsvp-who")).toHaveCount(0);
    await openEventFold(page, "rsvp-who");
    await expect(page.getByTestId("rsvp-who-empty")).toHaveText("Încă nu a confirmat nimeni.");
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
    // The answer's own redirect opens the fold, or its sentence would sit behind a closed bar.
    await expect(box).toHaveAttribute("open", "");
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
    const english = await openEventFold(page, "rsvp-box");
    await expect(english.getByRole("heading", { name: "Confirm you're coming (optional) · Be the first to confirm" })).toBeVisible();
    await expect(page.getByTestId("rsvp-who").getByRole("heading", { name: "Who's coming", exact: true })).toBeVisible();
    await expect(english.getByRole("button", { name: "I'm coming!", exact: true })).toBeVisible();
    await expect(english.getByRole("checkbox", { name: "I want my name to show" })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("the link counts nobody for a scanner — then a browser that opens it counts the person by itself, and «Cine vine (1)» names them, the facts link to it and the browser is remembered", async ({ page, browser }) => {
    const row = await rsvpRow(guest, eventId);
    const secret = await mintRsvpLink(row!.id, "RSVP_CONFIRM");

    // A scanner (it fetches the page and runs no scripts) or a browser without them: the GET names the event and draws ONE button — the
    // no-JavaScript path — and changes nothing, however often it is opened (BR-REQ-036-02).
    const scanner = await browser.newContext({ javaScriptEnabled: false });
    const scanned = await scanner.newPage();
    for (let i = 0; i < 2; i += 1) {
      await scanned.goto(`/ro/vin/${secret}`);
      await expect(scanned.getByTestId("rsvp-confirm-intro")).toHaveText(`Confirmi că vii la ${title}?`);
      await expect(scanned.getByRole("button", { name: "Da, vin" })).toHaveCount(1);
      await expect(scanned.getByRole("button", { name: "Da, vin" })).toBeEnabled();
      await expect(scanned.getByTestId("rsvp-confirm-auto")).toBeVisible();
    }
    await scanner.close();
    expect((await rsvpRow(guest, eventId))?.confirmedAt).toBeNull();
    expect(await rememberedBrowsers(guest)).toBe(0);
    // Before the answer: the event's calendar file exists and says nobody has yet — the file the confirmation below must expire.
    const before = await page.request.get(`/ro/events/${slug}/calendar.ics`);
    expect((await before.text()).replace(/\r\n /g, "").replace(/\\n/g, "\n")).toContain("Fii primul care spune că vine.");

    // A person's browser (§812): opening the link is enough — the page presses its own button once, and lands on the event page's «Confirmă prezența (opțional)»
    // fold, open (the landing is `#vin`), with the tick on its line. No press from the spec.
    await page.goto(`/ro/vin/${secret}`, { waitUntil: "commit" });
    await page.waitForURL(new RegExp(`/ro/evenimente/${slug}#vin$`));
    expect((await rsvpRow(guest, eventId))?.confirmedAt).not.toBeNull();
    expect(await rememberedBrowsers(guest)).toBe(1);
    await hydrated(page);
    const landed = page.getByTestId("rsvp-box");
    await expect(landed).toHaveAttribute("open", "");
    await expect(landed.getByTestId("rsvp-summary-line")).toContainText("Tu vii ✓");
    await expect(landed.getByTestId("rsvp-summary-line")).toContainText("1 vine");

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
    // «Cine vine (1)» is its own fold under the card (§825), closed — the names are in it, never in the card.
    await expect(landed.getByTestId("rsvp-name")).toHaveCount(0);
    const who = page.getByTestId("rsvp-who");
    await expect(who).not.toHaveAttribute("open", /.*/);
    await expect(who.getByRole("heading", { name: "Cine vine (1)" })).toBeVisible();
    // The facts say it too, one tap from the names: «1 vine · vezi cine», 44 pixels, linking the fold, which the press opens.
    const factsLine = page.getByTestId("event-facts").getByTestId("who-comes-link");
    await expect(factsLine).toHaveText("1 vine · vezi cine");
    await expect(factsLine).toHaveAttribute("href", "#cine-vine");
    expect((await factsLine.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await factsLine.click();
    await expect(who).toHaveAttribute("open", "");
    await expect(page.getByTestId("rsvp-name")).toHaveText(NAME);
    // §815: the event's calendar file now carries the door and the count — the confirmation expired the file that was made without them.
    const ics = await page.request.get(`/ro/events/${slug}/calendar.ics`);
    expect((await ics.text()).replace(/\r\n /g, "").replace(/\\n/g, "\n")).toMatch(new RegExp(`Vin! → \\S+/ro/evenimente/${slug}#vin\\n1 vine până acum`));
    // …and the address is nowhere on the page.
    expect(await page.content()).not.toContain(guest);
    await noSidewaysScroll(page);

    // The listing's card for this date (the second date has a title of its own, so this one is not a series' card): «1 vine», a link to the
    // page's «Confirmă prezența (opțional)» card, and the 44 pixels every link on a card has in both directions.
    // The link now counts by itself, so the listing is asked within seconds of the write: the public cache expires a second time three
    // seconds after it (§583) for a render that was already running, so a visit inside that window may be given the page it made before.
    // A person reloads; so does the spec, until the chip is there.
    const chip = page.locator(`[data-testid="coming-chip"][href$="/${slug}#vin"]`);
    await expect(async () => {
      await page.goto("/ro/evenimente");
      await expect(chip).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("1 vine");
    const chipBox = await chip.boundingBox();
    expect(chipBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(chipBox?.width ?? 0).toBeGreaterThanOrEqual(44);

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

    // The second date: the remembered state, not the typed form — inside the closed fold, whose line has no tick for this event yet.
    await page.goto(eventUrl("ro", secondSlug));
    await hydrated(page);
    await expect(page.getByTestId("rsvp-box").getByRole("heading", { name: "Confirmă prezența (opțional) · Fii primul care confirmă" })).toBeVisible();
    await openEventFold(page, "rsvp-box");
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
    // …and the fold's line says so too, with the count once the page has refreshed.
    await expect(page.getByTestId("rsvp-box").getByTestId("rsvp-summary-line")).toContainText("Tu vii ✓");
    // Counted at once: the row is confirmed, no message was queued, and the count under the card says one (the person asked for no name).
    const second = await rsvpRow(guest, secondEventId);
    expect(second?.confirmedAt).not.toBeNull();
    expect(second?.showName).toBe(false);
    expect(await rsvpMessages(guest)).toBe(messagesBefore);
    await openEventFold(page, "rsvp-who");
    await expect(page.getByTestId("rsvp-who-heading")).toContainText("Cine vine (1)");
    await expect(page.getByTestId("rsvp-others")).toHaveText("și încă 1");
    expect(await page.content()).not.toContain(guest);

    // One tap back.
    await page.getByRole("button", { name: "Nu mai vin", exact: true }).click();
    await expect(remembered.getByRole("button", { name: "Vin!", exact: true })).toBeVisible();
    await expect(page.getByTestId("rsvp-box").getByTestId("rsvp-summary-line")).not.toContainText("Tu vii");
    // …and the second event's answer is gone, the first one's is not.
    expect(await rsvpCount(guest)).toBe(1);
    await expect(page.getByTestId("rsvp-who-empty")).toHaveText("Încă nu a confirmat nimeni.");

    // And «Nu sunt eu»: the typed form is back, this browser's row and both its cookies are gone (the previous test's browser, which is
    // another one, stays remembered: one row each).
    const browsersBefore = await rememberedBrowsers(guest);
    expect(browsersBefore).toBe(2);
    await page.getByRole("button", { name: "Nu sunt eu — uită-mă pe acest dispozitiv" }).click();
    await expect(page.getByTestId("rsvp-box").locator('input[name="email"]')).toBeVisible();
    await expect(page.getByTestId("rsvp-remembered")).toHaveCount(0);
    const left = (await context.cookies()).map((cookie) => cookie.name);
    expect(left).not.toContain("br_person");
    expect(left).not.toContain("br_person_hint");
    expect(await rememberedBrowsers(guest)).toBe(browsersBefore - 1);
    // What was answered stays answered on the first event.
    expect(await rsvpCount(guest)).toBe(1);
  });

  test("§827 a remembered browser shows or hides its name on «Cine vine»: one tick saves at once, and a box asks for the name when there is none", async ({ page, context }) => {
    // The first event's answer is counted and named (the typed form's tick); this browser is remembered by pressing a link of it.
    const row = await rsvpRow(guest, eventId);
    const confirm = await mintRsvpLink(row!.id, "RSVP_CONFIRM");
    await page.goto(`/ro/vin/${confirm}`);
    await page.getByRole("button", { name: "Da, vin" }).click();
    await page.waitForURL(new RegExp(`/ro/evenimente/${slug}#vin$`));
    await hydrated(page);
    expect((await context.cookies()).some((cookie) => cookie.name === "br_person")).toBe(true);

    const remembered = page.getByTestId("rsvp-remembered");
    await expect(remembered.getByTestId("rsvp-going")).toContainText("Tu vii");
    const tick = remembered.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" });
    // A real tick box, 44 pixels to the thumb, drawn as the row keeps it: the typed form's tick was on, so it is ticked and the name shows.
    await expect(tick).toBeChecked();
    expect((await tick.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(remembered.getByText(`Cu bifa apari ca „${NAME}”.`, { exact: false })).toBeVisible();
    await expect(page.getByTestId("rsvp-name")).toHaveText(NAME);
    await noSidewaysScroll(page);

    // Unticked: saved at once, no «Salvează» to press; «Cine vine» counts the person and names nobody.
    await tick.uncheck();
    await expect(remembered.getByTestId("rsvp-name-note")).toHaveText("Gata: numele tău nu mai apare; ești doar numărat.");
    await expect(page.getByTestId("rsvp-others")).toHaveText("și încă 1");
    await expect(page.getByTestId("rsvp-name")).toHaveCount(0);
    await expect.poll(async () => (await rsvpRow(guest, eventId))?.showName).toBe(false);
    // The name stays saved: it is the person's, and comes back with the tick.
    expect((await rsvpRow(guest, eventId))?.displayName).toBe(NAME);

    await tick.check();
    await expect(remembered.getByTestId("rsvp-name-note")).toHaveText("Gata: numele tău apare la „Cine vine”.");
    await expect(page.getByTestId("rsvp-name")).toHaveText(NAME);
    await expect.poll(async () => (await rsvpRow(guest, eventId))?.showName).toBe(true);
    expect(await page.content()).not.toContain(guest);

    // An answer with no name: ticking opens one «Numele tău» box and «Salvează»; nothing is written until it is pressed.
    await withDatabase(async (client) => {
      await client.query("UPDATE event_rsvps SET display_name = NULL, show_name = false WHERE event_id = $1 AND canonical_email = lower($2)", [eventId, guest]);
    });
    // A reload, not a goto: the address differs only by its hash, which would keep the page the island already drew.
    await page.reload();
    await hydrated(page);
    const nameless = page.getByTestId("rsvp-remembered").getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" });
    await expect(nameless).not.toBeChecked();
    await expect(page.getByTestId("rsvp-name-box")).toHaveCount(0);
    await nameless.check();
    const box = page.getByTestId("rsvp-name-box");
    await expect(box).toBeVisible();
    expect((await box.getByRole("button", { name: "Salvează" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await rsvpRow(guest, eventId))?.showName).toBe(false);
    await box.getByLabel("Numele tău").fill("Ana Nouă");
    await box.getByRole("button", { name: "Salvează" }).click();
    // The public list is cached and re-made after the save (stale once, then fresh): a cold server may draw the old name on the first refresh, so reload until it is the new one.
    await expect(async () => {
      await page.reload();
      await hydrated(page);
      await expect(page.getByTestId("rsvp-name")).toHaveText("Ana Nouă", { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect.poll(async () => (await rsvpRow(guest, eventId))?.displayName).toBe("Ana Nouă");
    expect((await rsvpRow(guest, eventId))?.showName).toBe(true);
    await noSidewaysScroll(page);
  });

  test("the small fold «Nu mai vin» answers the same sentence for an address that never answered", async ({ page }) => {
    await page.goto(eventUrl("ro", slug));
    await hydrated(page);
    await openEventFold(page, "rsvp-box");
    const fold = page.getByTestId("rsvp-withdraw");
    await fold.locator("summary").click();
    await fold.locator('input[name="withdrawEmail"]').fill(`nimeni.${Date.now().toString(36)}@example.test`);
    await page.waitForTimeout(1_500);
    await fold.getByRole("button", { name: "Trimite linkul" }).click();
    await page.waitForURL(/vin=retras/);
    await expect(page.getByTestId("rsvp-withdraw-sent")).toHaveText("Dacă adresa ta e printre cei care vin, ți-am trimis pe email un link.");
  });

  test("§827 the «Nu mai vin» link's page: the same tick, a POST that does not spend the link — «Nu mai vin» is still there", async ({ page }) => {
    await withDatabase(async (client) => {
      await client.query("UPDATE event_rsvps SET display_name = $3, show_name = false WHERE event_id = $1 AND canonical_email = lower($2)", [eventId, guest, NAME]);
    });
    const row = await rsvpRow(guest, eventId);
    const secret = await mintRsvpLink(row!.id, "RSVP_WITHDRAW");
    await page.goto(`/ro/vin/${secret}`);
    await hydrated(page);
    const tick = page.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" });
    await expect(tick).not.toBeChecked();
    expect((await tick.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The tick sits above «Nu mai vin», in its own small form.
    const tickAt = await page.getByTestId("rsvp-name-switch").boundingBox();
    const leaveAt = await page.getByRole("button", { name: "Nu mai vin" }).boundingBox();
    expect((tickAt?.y ?? 0) + (tickAt?.height ?? 0)).toBeLessThanOrEqual(leaveAt?.y ?? 0);
    await noSidewaysScroll(page);

    await tick.check();
    await page.getByTestId("rsvp-name-switch").getByRole("button", { name: "Salvează" }).click();
    await page.waitForURL(/\?nume=shown$/);
    await expect(page.getByTestId("rsvp-name-note")).toHaveText("Gata: numele tău apare la „Cine vine”.");
    await expect(page.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" })).toBeChecked();
    await expect.poll(async () => (await rsvpRow(guest, eventId))?.showName).toBe(true);

    await page.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" }).uncheck();
    await page.getByTestId("rsvp-name-switch").getByRole("button", { name: "Salvează" }).click();
    await page.waitForURL(/\?nume=hidden$/);
    await expect(page.getByTestId("rsvp-name-note")).toHaveText("Gata: numele tău nu mai apare; ești doar numărat.");
    await expect.poll(async () => (await rsvpRow(guest, eventId))?.showName).toBe(false);
    expect((await rsvpRow(guest, eventId))?.displayName).toBe(NAME);

    // The tick did not spend the link: the page still offers «Nu mai vin», the answer is still there and the link is unused.
    await expect(page.getByTestId("rsvp-withdraw-intro")).toHaveText(`Nu mai vii la ${title}? Răspunsul tău se șterge.`);
    await expect(page.getByRole("button", { name: "Nu mai vin" })).toBeVisible();
    expect(await rsvpCount(guest)).toBe(1);
    const spent = await withDatabase(async (client) => {
      const { rows } = await client.query<{ used: boolean }>("SELECT used_at IS NOT NULL AS used FROM event_rsvp_tokens WHERE rsvp_id = $1 AND purpose = 'RSVP_WITHDRAW'", [row!.id]);
      return rows.map((token) => token.used);
    });
    expect(spent).toContain(false);
    expect(spent).not.toContain(true);
    // The unticked answer is only counted: the event's page says «și încă 1» (no name).
    await page.goto(`${eventUrl("ro", slug)}#vin`);
    await hydrated(page);
    await expect(page.getByTestId("rsvp-others")).toHaveText("și încă 1");
    await expect(page.getByTestId("rsvp-name")).toHaveCount(0);
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

  test("§822 the members' zone: «Vin!» is one press, counted at once and unnamed, the event page counts it, «Nu mai vin» takes it back", async ({ page, browser }) => {
    // The zone lists the five soonest runs, so the run is moved to tomorrow in the database and saved once in the editor, which expires the
    // public cache the zone reads (a write straight to the table would not).
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    await withDatabase(async (client) => {
      await client.query("UPDATE events SET starts_at = $2, ends_at = $2::timestamptz + interval '2 hours' WHERE id = $1", [eventId, tomorrow.toISOString()]);
    });
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    await page.getByRole("checkbox", { name: /Am înțeles că modific conținut publicat/ }).check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    // A member signs in through the development switcher and opens «Alergări».
    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await member.goto("/ro/autentificare?to=members");
    await member.getByRole("button", { name: /Dev Member/ }).click();
    await expect(member).toHaveURL(/\/ro\/zona-membri$/, { timeout: 30_000 });
    await member.goto("/ro/zona-membri/alergari");
    await hydrated(member);
    const row = member.locator(`#vin-${eventId}`);
    await expect(async () => {
      await member.goto("/ro/zona-membri/alergari");
      await expect(row).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 20_000, intervals: [1_000] });
    await expect(row).toHaveAttribute("data-going", "false");
    const press = row.getByRole("button", { name: "Vin!", exact: true });
    expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The name tick is beside the button, off by default.
    await expect(row.getByRole("checkbox", { name: "Vreau să apar cu numele" })).not.toBeChecked();
    await noSidewaysScroll(member);

    await press.click();
    await member.waitForURL(/vin=went/);
    await expect(member.getByTestId("zone-rsvp-outcome")).toHaveText("Am notat că vii.");
    await expect(row).toHaveAttribute("data-going", "true");
    await expect(row.getByTestId("zone-rsvp-going")).toHaveText("Tu vii ✓");
    await expect(row.getByTestId("zone-rsvp-count")).toContainText("1 vine");
    // Counted at once, unnamed and no name kept: the member did not tick the box.
    const written = await withDatabase(async (client) => {
      const { rows } = await client.query<{ confirmed: boolean; showName: boolean; displayName: string | null }>(
        `SELECT confirmed_at IS NOT NULL AS confirmed, show_name AS "showName", display_name AS "displayName" FROM event_rsvps WHERE event_id = $1`,
        [eventId],
      );
      return rows;
    });
    expect(written).toEqual([{ confirmed: true, showName: false, displayName: null }]);
    await noSidewaysScroll(member);

    // §827: the name tick stays on «Tu vii ✓» — unticked, with the account's name used only when ticked, and saved by its own «Salvează».
    const nameTick = row.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" });
    await expect(nameTick).not.toBeChecked();
    expect((await nameTick.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await nameTick.check();
    await row.getByRole("button", { name: "Salvează", exact: true }).click();
    await member.waitForURL(/vin=shown/);
    await expect(member.getByTestId("zone-rsvp-outcome")).toHaveText("Gata: numele tău apare la „Cine vine”.");
    await expect(row.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" })).toBeChecked();
    const shownName = await withDatabase(async (client) => {
      const { rows } = await client.query<{ showName: boolean; displayName: string | null }>(`SELECT show_name AS "showName", display_name AS "displayName" FROM event_rsvps WHERE event_id = $1`, [eventId]);
      return rows[0];
    });
    expect(shownName.showName).toBe(true);
    expect(shownName.displayName).toBeTruthy();
    await row.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" }).uncheck();
    await row.getByRole("button", { name: "Salvează", exact: true }).click();
    await member.waitForURL(/vin=hidden/);
    await expect(member.getByTestId("zone-rsvp-outcome")).toHaveText("Gata: numele tău nu mai apare; ești doar numărat.");
    await expect(row.getByRole("checkbox", { name: "Numele meu apare la „Cine vine”" })).not.toBeChecked();
    await withDatabase(async (client) => {
      const { rows } = await client.query<{ showName: boolean; displayName: string | null }>(`SELECT show_name AS "showName", display_name AS "displayName" FROM event_rsvps WHERE event_id = $1`, [eventId]);
      expect(rows[0]).toEqual({ showName: false, displayName: shownName.displayName });
    });
    await noSidewaysScroll(member);

    // The event's page counts it: the «Confirmă prezența (opțional)» fold's line and the «Cine vine» fold say one, and name nobody.
    await member.goto(eventUrl("ro", slug));
    await hydrated(member);
    const box = await openEventFold(member, "rsvp-box");
    await expect(box.getByTestId("rsvp-summary-line")).toContainText("1 vine");
    await openEventFold(member, "rsvp-who");
    await expect(member.getByTestId("rsvp-who-heading")).toContainText("Cine vine (1)");
    await expect(member.getByTestId("rsvp-others")).toHaveText("și încă 1");

    // One press back.
    await member.goto("/ro/zona-membri/alergari");
    await hydrated(member);
    await member.locator(`#vin-${eventId}`).getByRole("button", { name: "Nu mai vin", exact: true }).click();
    await member.waitForURL(/vin=left/);
    await expect(member.getByTestId("zone-rsvp-outcome")).toHaveText("Am șters răspunsul: nu mai vii.");
    await expect(member.locator(`#vin-${eventId}`)).toHaveAttribute("data-going", "false");
    await expect(member.locator(`#vin-${eventId}`).getByRole("button", { name: "Vin!", exact: true })).toBeVisible();
    await memberContext.close();
    await withDatabase(async (client) => {
      const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM event_rsvps WHERE event_id = $1", [eventId]);
      expect(Number(rows[0].n)).toBe(0);
    });
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
    await expect(visitor.getByTestId("rsvp-who")).toHaveCount(0);
    await expect(visitor.getByTestId("who-comes-link")).toHaveCount(0);
    await expect(visitor.locator("#main")).not.toContainText("Confirmă prezența");
    await expect(visitor.locator("#main")).not.toContainText("Cine vine");
    await stranger.close();
  });
});
