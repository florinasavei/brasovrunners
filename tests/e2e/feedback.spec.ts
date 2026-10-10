import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { computeContentHash } from "../../src/modules/legal-documents/domain/content-hash";
import { confirmDialog } from "./support/confirm";
import { HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-070-04, `DECISIONS.md` §676 — «Spune-ne ceva», the anonymous wizard, through the browser at
 * 320px and on a desktop, against the production build: the door above the newsletter on `/contact` (the newsletter last, §679);
 * step 1's choice, a `GET` that puts the branch in `?tip=`; the safety form's reader line naming the
 * first name the club set; «Cum a fost» preselecting the event a link names (and «Altceva» for one it
 * does not publish); an empty post coming back on `#feedback-errors` with what was typed kept from
 * the sealed draft; the sent page. Then one branch on — the choice skipped, its form at once — and
 * none — no door, and the page a 404.
 *
 * **The setting is one row for the whole database**, and the notice too, so the two projects must
 * not flip them at once: a PostgreSQL advisory lock — the key `public-list-states.spec.ts` holds while
 * it flips the notice, so neither spec flips it under the other — is held for the whole test, and
 * the second project waits for the first. The branches are switched the way the club switches them,
 * on «Pagini» → «Contact» → «Spune-ne ceva», which expires the public pages' cached copy (§333); the
 * test ends with every branch off, as the seed leaves them.
 *
 * **The notice.** The local seed approves the platform's template, which names `{{feedbackForms}}`
 * and `{{feedbackFormsNamed}}` in both languages, and then nothing is written. On a database seeded
 * before the template named them,
 * the notice in force is approved once more with one paragraph naming the marker added to it — the
 * draft written to the table (the setup, not the subject) and approved through `/admin/legal`, which
 * expires the cached notice. That leaves one more approved version behind (§46): run it on a local
 * or CI database only.
 *
 * **The picker's events.** «Evenimentul» becomes the filtering island only over eight rows (§680), and
 * CI seeds four events, so the spec publishes its own — four races and four group runs held some
 * six weeks ago, each title carrying the run's mark — through the backoffice's bulk verb, and
 * deletes them the same way at the end (`publishPickerEvents`, `removePickerEvents`).
 *
 * The messages leave by the capture (`APP_ENV=local`/`test`: `CONTACT_FORM_MODE=capture`), so no
 * socket is opened; each project sends one «Cum a fost», well under the branch's thirty an hour.
 */

const LOCK_KEY = 390_039_001;
/** The forms' marker (§676) and the named mode's (§678): without the second, every form is anonymous only. */
const MARKERS = ["{{feedbackForms}}", "{{feedbackFormsNamed}}"] as const;
const SAFETY_NAME = "Maria";
const ADDED_PARAGRAPH = {
  ro: `Formularele ${MARKERS[0]} de pe pagina de contact sunt anonime, dacă nu alegi ${MARKERS[1]}; platforma nu păstrează nicio copie.`,
  en: `The ${MARKERS[0]} forms on the contact page are anonymous unless you choose ${MARKERS[1]}; the platform keeps no copy.`,
} as const;

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

type Body = { sections: { heading?: string; paragraphs: string[] }[] };
type Translation = { locale: "ro" | "en"; title: string; body: Body };

/** The privacy notice in force, both languages — the conditions the site reads it by. */
async function noticeInForce(client: pg.Client): Promise<Translation[]> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM legal_documents
      WHERE key = 'PRIVACY_NOTICE' AND is_approved AND withdrawn_at IS NULL AND effective_at <= now()
      ORDER BY version DESC LIMIT 1`,
  );
  if (!rows[0]) throw new Error("no privacy notice in force: reset the database (yarn db:reset:local)");
  const { rows: translations } = await client.query<Translation>(
    "SELECT locale, title, body_json AS body FROM legal_document_translations WHERE legal_document_id = $1 ORDER BY locale",
    [rows[0].id],
  );
  return translations;
}

const describes = (translations: Translation[]) =>
  translations.length >= 2 && translations.every((translation) => MARKERS.every((marker) => JSON.stringify(translation.body).includes(marker)));

/** The next PRIVACY_NOTICE version as a draft, written to the table; returns its id. */
async function insertDraft(client: pg.Client, translations: Translation[]): Promise<string> {
  const { rows: last } = await client.query<{ version: number }>("SELECT coalesce(max(version), 0) AS version FROM legal_documents WHERE key = 'PRIVACY_NOTICE'");
  const { rows: retired } = await client.query<{ version: number }>(
    "SELECT coalesce((SELECT highest_retired_version FROM legal_document_numbering WHERE key = 'PRIVACY_NOTICE'), 0) AS version",
  );
  const version = Math.max(Number(last[0].version), Number(retired[0].version)) + 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO legal_documents (key, version, effective_at, is_approved, content_sha256)
     VALUES ('PRIVACY_NOTICE', $1, now(), false, $2) RETURNING id`,
    [version, computeContentHash(translations as never)],
  );
  for (const translation of translations) {
    await client.query("INSERT INTO legal_document_translations (legal_document_id, locale, title, body_json) VALUES ($1, $2, $3, $4)", [
      rows[0].id,
      translation.locale,
      translation.title,
      JSON.stringify(translation.body),
    ]);
  }
  return rows[0].id;
}

/** The notice in force names `{{feedbackForms}}` and `{{feedbackFormsNamed}}` in both languages — approved through `/admin/legal` when it does not yet. */
async function ensureNoticeDescribesTheForms(page: Page): Promise<void> {
  const current = await withDatabase(noticeInForce);
  if (describes(current)) return;
  const withMarker = current.map((translation) => {
    const sections = translation.body.sections.map((section) => ({ ...section, paragraphs: [...section.paragraphs] }));
    // Section 5 («Ce date luăm…») where the template puts it; the last section on a text with fewer.
    const target = sections.find((section) => section.heading?.startsWith("5.")) ?? sections[sections.length - 1];
    target.paragraphs.push(ADDED_PARAGRAPH[translation.locale]);
    return { ...translation, body: { ...translation.body, sections } };
  });
  const id = await withDatabase((client) => insertDraft(client, withMarker));
  await page.goto(`/ro/admin/legal/${id}`);
  await hydrated(page);
  const form = page.getByTestId("approve-version-form");
  await form.getByRole("checkbox").check();
  await expect(form.getByRole("checkbox")).toBeChecked();
  await form.getByRole("button", { name: "Aprobă și publică" }).click();
  await confirmDialog(page);
  await expect(page).toHaveURL(/\/admin\/legal/);
  await expect.poll(async () => describes(await withDatabase(noticeInForce))).toBe(true);
}

type Branches = Partial<Record<"howItWent" | "suggestion" | "complaint" | "safety", boolean>>;

/** The four switches as the Administrator sets them on «Pagini» → «Contact» → «Spune-ne ceva». */
async function setBranches(page: Page, on: Branches): Promise<void> {
  await page.goto("/ro/admin/pages/contact");
  await hydrated(page);
  const panel = page.getByTestId("feedback-forms");
  if ((await panel.getAttribute("open")) === null) await panel.locator(":scope > summary").press("Enter");
  const form = panel.getByTestId("feedback-forms-form");
  for (const branch of ["howItWent", "suggestion", "complaint", "safety"] as const) {
    const box = form.locator(`input[name="${branch}On"]`);
    await box.setChecked(on[branch] === true);
    // A branch on needs its one recipient; an address on example.org, never a real one.
    if (on[branch]) await form.locator(`input[name="${branch}To"]`).fill(`${branch.toLowerCase()}@example.org`);
  }
  if (on.safety) await form.locator('input[name="safetyName"]').fill(SAFETY_NAME);
  await form.getByRole("button", { name: "Salvează formularele" }).click();
  await confirmDialog(page);
  await expect(page).toHaveURL(/saved=feedbackForms/, { timeout: 30_000 });
}

/** How many races and how many group runs the spec publishes for the picker: eight events and «Altceva», over the island's threshold. */
const PICKER_EACH = 4;

/** The picker's own events, by the mark every title of them carries. */
type PickerFixture = { mark: string; races: string[]; runs: string[] };

/**
 * The picker's own events (§680): four races and four group runs, so «Evenimentul» has nine rows
 * («Altceva» counted) — over the island's eight — and both kinds for the chips, whatever else the
 * database holds; CI seeds four events, too few for the island. Written to the table as drafts (the
 * setup, not the subject), every title carrying `mark` so a rerun or the other project never meets
 * them, then published through the backoffice's «Publică cele bifate» — which expires the public
 * pages' cached copy (§333) as every publication does: rows published behind the server's back
 * would never reach a picker the server had already read (`listing-cards.spec.ts` says the same).
 * Held 41 to 48 days ago: inside the picker's 90 days back, never among the listing's dates to
 * come (a phone folds those after four cards, §78), and older than the past run another spec makes.
 */
async function publishPickerEvents(page: Page, mark: string): Promise<PickerFixture> {
  const fixture: PickerFixture = { mark, races: [], runs: [] };
  await withDatabase(async (client) => {
    for (let index = 0; index < PICKER_EACH * 2; index += 1) {
      const race = index % 2 === 0;
      const number = Math.floor(index / 2) + 1;
      const title = race ? `Cros de probă ${mark} ${number}` : `Tură de grup ${mark} ${number}`;
      const slug = `${race ? "cros" : "tura"}-${mark}-${number}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO events (type, starts_at, location_name)
         VALUES ($1, date_trunc('day', now()) - make_interval(days => $2) + interval '7 hours', 'Parcul Tractorul') RETURNING id`,
        [race ? "RACE" : "GROUP_RUN", 41 + index],
      );
      await client.query(
        `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES
         ($1, 'ro', $2, $3, 'Pentru lista «Evenimentul».'), ($1, 'en', $4, $3, 'For the «Event» list.')`,
        [rows[0].id, `${slug}-ro`, title, `${slug}-en`],
      );
      (race ? fixture.races : fixture.runs).push(title);
    }
  });
  await tickMarkedEvents(page, mark);
  await page.locator("#main").getByRole("button", { name: "Publică cele bifate" }).click();
  await confirmDialog(page, "Publici evenimentele bifate?");
  await expect(page.locator("#admin-alert")).toContainText(`${PICKER_EACH * 2} evenimente publicate`, { timeout: 30_000 });
  return fixture;
}

/** The backoffice's events list, searched for `mark` in every state, with every row it finds ticked. */
async function tickMarkedEvents(page: Page, mark: string): Promise<number> {
  await page.goto(`/ro/admin?state=ALL&q=${mark}`);
  // The row's checkbox is MUI's: a tick before hydration is reverted when React takes over.
  await hydrated(page);
  const main = page.locator("#main");
  const found = await main.getByRole("link", { name: new RegExp(mark) }).filter({ visible: true }).count();
  if (found === 0) return 0;
  await main.getByRole("checkbox", { name: "Toate", exact: true }).check();
  await expect(main.getByText(`Bifate: ${found}`)).toBeVisible();
  return found;
}

/**
 * The picker's events removed the way they were published — through the backoffice, «Șterge cele
 * bifate», so the cached copy expires with them and no picker or calendar after this spec shows an
 * event that is gone. Whatever the backoffice did not remove goes straight from the table.
 */
async function removePickerEvents(page: Page, mark: string): Promise<void> {
  try {
    if (!page.isClosed() && (await tickMarkedEvents(page, mark)) > 0) {
      await page.locator("#main").getByRole("button", { name: "Șterge cele bifate" }).click();
      await confirmDialog(page, "Ștergi evenimentele bifate?");
      await expect(page.locator("#admin-alert")).toContainText("evenimente șterse", { timeout: 30_000 });
    }
  } catch (error) {
    console.error("[feedback.spec] could not delete the picker's events in the backoffice", error);
  }
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ event_id: string }>("SELECT DISTINCT event_id FROM event_translations WHERE slug LIKE $1", [`%-${mark}-%`]);
    const ids = rows.map((row) => row.event_id);
    if (ids.length > 0) await client.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids]);
  });
}

/**
 * «Evenimentul» through the filtering island (§680) — over eight rows, which `publishPickerEvents`
 * makes sure of: «Altceva» first, a thumb's row each, the list below the box, «Niciun eveniment
 * găsit» for a word nothing has, the chips narrowing to the spec's own races and group runs, and an
 * event found by part of its title typed without its diacritics — picked with Enter, the first match
 * highlighted and «Altceva» out of the list while something matches, then by a tap. `firstSlug` is
 * the first event the server offers, the row under «Altceva». Returns the title picked.
 */
async function pickEventByTyping(page: Page, firstSlug: string | undefined, fixture: PickerFixture): Promise<string> {
  const island = page.getByTestId("feedback-event-filter");
  await expect(island).toHaveCount(1);
  // The native select is gone from the form; the island's hidden input is the one `event` posted.
  await expect(page.locator('select[name="event"]')).toHaveCount(0);
  await expect(page.locator('[name="event"]')).toHaveCount(1);

  const box = island.getByRole("combobox", { name: "Evenimentul" });
  const listbox = page.getByRole("listbox");
  const options = listbox.getByRole("option");
  const titles = listbox.getByTestId("feedback-event-option-title");

  // Both kinds are among the events, so the chips are there, a thumb's height each; each narrows the
  // list to its kind — the spec's own events, found by their mark — and «Toate» brings every kind back.
  const chips = island.getByRole("group", { name: "Arată" });
  await expect(chips).toHaveCount(1);
  for (const words of ["Toate", "Evenimente speciale", "Alergări de grup"]) {
    const chip = chips.getByRole("button", { name: words });
    expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Each with its glyph (§NNN; the owner: «I want icons on these filters»).
    await expect(chip.locator("svg")).toHaveCount(1);
  }
  // «Evenimente speciale» is every event but the group runs (§NNN): the spec's own are races.
  for (const [words, shown] of [
    ["Evenimente speciale", fixture.races],
    ["Alergări de grup", fixture.runs],
    ["Toate", [...fixture.races, ...fixture.runs]],
  ] as const) {
    await chips.getByRole("button", { name: words }).click();
    await expect(chips.getByRole("button", { name: words })).toHaveAttribute("aria-pressed", "true");
    await box.fill(fixture.mark);
    await expect(titles).toHaveCount(shown.length);
    expect((await titles.allInnerTexts()).map((text) => text.trim()).sort()).toEqual([...shown].sort());
  }
  await box.fill("");
  await box.press("Escape");
  await expect(listbox).toHaveCount(0);

  await box.click();
  await expect(listbox).toBeVisible();
  await expect(options.first()).toHaveText("Altceva / în general");
  // Below the box, and a thumb's row each.
  const boxBottom = ((await box.boundingBox())?.y ?? 0) + ((await box.boundingBox())?.height ?? 0);
  expect((await listbox.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(boxBottom - 1);
  expect((await options.nth(1).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  // The title is the row's first line; its day is the second.
  const title = (await options.nth(1).getByTestId("feedback-event-option-title").innerText()).trim();

  await box.fill("zzz-niciun-eveniment");
  await expect(page.getByTestId("feedback-event-no-match")).toHaveText("Niciun eveniment găsit");
  await expect(options.first()).toHaveText("Altceva / în general");

  // Part of the title, lower case and without its diacritics: the filter finds it all the same.
  const typed = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .slice(0, Math.max(3, Math.min(title.length, 8)))
    .trim();
  // Typed and Enter, with «Altceva» chosen: the first match is the highlighted row, and «Altceva» is out of the list.
  await box.fill(typed);
  await expect(options.first()).toContainText(title);
  await expect(listbox.getByRole("option", { name: "Altceva / în general" })).toHaveCount(0);
  await box.press("Enter");
  if (firstSlug) await expect(page.locator('[name="event"]')).toHaveValue(firstSlug);
  await expect(page.locator('[name="event"]')).not.toHaveValue("");
  await expect(box).toHaveValue(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));

  // Cleared, the box offers «Altceva» first again; then the same event, by a tap on its row.
  // (Enter closed the list; the arrow opens it again.)
  await box.fill("");
  await box.press("ArrowDown");
  await expect(options.first()).toHaveText("Altceva / în general");
  await box.fill(typed);
  const match = listbox.getByRole("option").filter({ hasText: title }).first();
  await expect(match).toBeVisible();
  await match.click();
  await expect(page.locator('[name="event"]')).not.toHaveValue("");
  await expect(box).toHaveValue(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
  await noSidewaysScroll(page);
  return title;
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("BR-REQ-070-04 «Spune-ne ceva», the anonymous wizard (§676)", () => {
  // A click that cannot happen fails in seconds and names itself, rather than at the test's end.
  test.use({ actionTimeout: 20_000, navigationTimeout: 60_000 });

  test("two branches: the door, the choice in ?tip=, the safety form's reader, a refusal that keeps the text, the sent page; one branch skips the choice; none is a 404", async ({ page }) => {
    // Long, because the second project waits on the lock for the first.
    test.setTimeout(420_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    // The picker's events' mark: one word, so the backoffice's search finds them by it and nothing else.
    const mark = `picker${test.info().project.name}${Date.now().toString(36)}`;
    const lock = new pg.Client({ connectionString: databaseUrl() });
    await lock.connect();
    await lock.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await signIn(page, "Dev Superadministrator");
      // Before any page reads the picker: enough events for the filtering island, of both kinds.
      const pickerFixture = await publishPickerEvents(page, mark);
      await ensureNoticeDescribesTheForms(page);
      await setBranches(page, { howItWent: true, safety: true });

      // The door, above the newsletter (§679; the owner: «the newsletter must be all the way to the bottom
      // now»), a thumb's height, leading to the wizard.
      await page.goto("/ro/contact", { waitUntil: "networkidle" });
      const door = page.getByTestId("feedback-door");
      await expect(page.getByTestId("feedback-section")).toBeVisible();
      const newsletterSection = page.getByTestId("newsletter-section");
      if ((await newsletterSection.count()) > 0) {
        const doorBox = await page.getByTestId("feedback-section").boundingBox();
        const newsletterBox = await newsletterSection.boundingBox();
        expect(newsletterBox!.y).toBeGreaterThanOrEqual(doorBox!.y + doorBox!.height);
      }
      expect((await door.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await noSidewaysScroll(page);
      await door.click();
      await expect(page).toHaveURL(/\/ro\/contact\/spune-ne$/);

      // Step 1 (§678): one card per branch on, each a label around a native radio that stays visible,
      // with its glyph, a thumb's height and the warm words for the women's form; «Continuă» puts the
      // branch in the address, and step 2's title carries the same glyph.
      const choose = page.getByTestId("feedback-choose");
      await expect(choose).toBeVisible();
      await expect(choose.locator('input[name="tip"]')).toHaveCount(2);
      const safetyCard = page.getByTestId("feedback-choice-siguranta");
      await expect(page.getByTestId("feedback-choice-cum-a-fost").locator('input[name="tip"]')).toBeChecked();
      await expect(safetyCard).toContainText("Girl Zone");
      await expect(safetyCard).toContainText("provocări în plus");
      for (const [slug, card] of [["cum-a-fost", page.getByTestId("feedback-choice-cum-a-fost")], ["siguranta", safetyCard]] as const) {
        await expect(card.getByTestId(`feedback-glyph-${slug}`)).toBeVisible();
        await expect(card.locator('input[name="tip"]')).toBeVisible();
        expect((await card.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await noSidewaysScroll(page);
      // The keyboard: an arrow moves the choice, and the card it lands on carries the focus ring.
      await page.getByTestId("feedback-choice-cum-a-fost").locator('input[name="tip"]').focus();
      await page.keyboard.press("ArrowDown");
      await expect(safetyCard.locator('input[name="tip"]')).toBeChecked();
      await expect(safetyCard).toHaveCSS("outline-style", "solid");
      await expect(safetyCard).toHaveCSS("outline-width", "2px");
      // The radio is named by the title alone; the hint describes it.
      await expect(safetyCard.locator('input[name="tip"]')).toHaveAccessibleName("Girl Zone");
      // An English name on the Romanian page, said as English (§679).
      await expect(safetyCard.getByText("Girl Zone")).toHaveAttribute("lang", "en");
      // The whole card is the target: a press on its words chooses it.
      await safetyCard.getByText("Girl Zone").click();
      await expect(safetyCard.locator('input[name="tip"]')).toBeChecked();
      await choose.getByRole("button", { name: "Continuă" }).click();
      await expect(page).toHaveURL(/\/ro\/contact\/spune-ne\?tip=siguranta$/);
      await expect(page.getByTestId("feedback-glyph-siguranta")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Girl Zone" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Girl Zone" })).toHaveAttribute("lang", "en");
      // Above the form, in the page's language: who reads it, by the first name the club set.
      // The club may hear a named report too (§678) — the contact form reaches it on this deployment — so the line says the sender chooses then.
      await expect(page.getByTestId("feedback-safety-reader")).toHaveText(
        `Anonim, mesajul ajunge doar la ${SAFETY_NAME}; cu nume și prenume, alegi tu cine află. Site-ul nu păstrează nimic din el.`,
      );
      await expect(page.getByTestId("feedback-form-siguranta")).toBeVisible();
      // The form opens with «Anonim» / «Cu nume și prenume» (§678): anonymous by default, the name and the
      // way back hidden until the name is chosen — CSS alone.
      const safetyForm = page.getByTestId("feedback-form-siguranta");
      const identity = safetyForm.getByTestId("feedback-identity");
      expect(await safetyForm.locator('input:not([type="hidden"]):not([name="honeypot"])').first().getAttribute("name")).toBe("identity");
      await expect(identity.getByRole("radio", { name: "Anonim" })).toBeChecked();
      await expect(safetyForm.locator('[name="name"]')).toBeHidden();
      await expect(safetyForm.locator('[name="contact"]')).toBeHidden();
      await expect(identity).toContainText("Cum vrei să trimiți?");
      await expect(identity).toContainText("Nu ne spui cine ești.");
      // «We love icons» (§679): the incognito hat and glasses before «Anonim», a person before the named
      // mode — decoration, so the radios keep their words as their names (above), and a thumb's row each.
      // MUI writes a glyph's own test id («IncognitoIcon», «PersonOutlinedIcon») outside a production
      // build only, so the unit test reads those and this one the label's own span.
      for (const [value, words] of [["anonymous", "Anonim"], ["named", "Cu nume și prenume"]] as const) {
        const label = identity.getByTestId(`feedback-identity-${value}`);
        await expect(label).toHaveText(words);
        const glyph = label.locator("svg");
        await expect(glyph).toHaveCount(1);
        await expect(glyph).toBeVisible();
        await expect(glyph).toHaveAttribute("aria-hidden", "true");
        const glyphBox = await glyph.boundingBox();
        expect(glyphBox?.width ?? 0).toBeGreaterThanOrEqual(23);
        // Before the words: the glyph starts the label.
        expect(glyphBox!.x).toBeLessThanOrEqual((await label.boundingBox())!.x + 1);
        const row = identity.locator("label", { has: page.getByRole("radio", { name: words }) });
        expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await identity.getByRole("radio", { name: "Cu nume și prenume" }).check();
      await expect(safetyForm.locator('[name="name"]')).toBeVisible();
      await expect(safetyForm.locator('[name="name"]')).toHaveAttribute("maxlength", "80");
      await expect(safetyForm.locator('[name="contact"]')).toBeVisible();
      // «Cine să afle?» (§678): the club or the safety person by her first name — on her own form, she is
      // checked — and never an address on the page.
      const audience = safetyForm.getByTestId("feedback-audience");
      await expect(audience).toBeVisible();
      await expect(audience.getByRole("radio", { name: SAFETY_NAME })).toBeChecked();
      await expect(audience.getByRole("radio", { name: "Clubul" })).toBeVisible();
      expect(await page.content()).not.toContain("@example.org");
      await identity.getByRole("radio", { name: "Anonim" }).check();
      await expect(safetyForm.locator('[name="name"]')).toBeHidden();
      await noSidewaysScroll(page);

      // «Cum a fost»: a slug the club does not publish leaves «Altceva / în general» selected…
      // What is posted is read by its name: the native select before the filtering island runs, the
      // island's hidden input after (§680) — one `event` either way, with the same slug.
      const posted = page.locator('[name="event"]');
      await page.goto(`/ro/contact/spune-ne?tip=cum-a-fost&eveniment=nu-exista-${tag}&data=2026-10-04`);
      await expect(posted).toHaveValue("");
      await expect(page.locator("#f-date")).toHaveValue("2026-10-04");
      // …and one it publishes in the picker's window is preselected, whichever the database holds — the
      // options read from the server's own HTML, where the native select always is.
      const served = await (await page.request.get("/ro/contact/spune-ne?tip=cum-a-fost")).text();
      const nativeSelect = /<select[^>]*name="event"[^>]*>([\s\S]*?)<\/select>/.exec(served);
      expect(nativeSelect, "the server draws the native select, JavaScript or not").not.toBeNull();
      const offered = [...nativeSelect![1].matchAll(/<option[^>]*value="([^"]*)"/g)].map(([, value]) => value).filter(Boolean);
      // The spec's own eight among them, whatever else the database holds.
      expect(offered.filter((slug) => slug.includes(`-${mark}-`))).toHaveLength(PICKER_EACH * 2);
      await page.goto(`/ro/contact/spune-ne?tip=cum-a-fost&eveniment=${offered[0]}`);
      await expect(posted).toHaveValue(offered[0]);
      await hydrated(page);
      await expect(posted).toHaveCount(1);
      await expect(posted).toHaveValue(offered[0]);

      // An empty message: the browser lets spaces through, the server refuses them, and the form comes
      // back on its summary, on the same branch, with what was typed kept from the sealed draft.
      await page.goto("/ro/contact/spune-ne?tip=cum-a-fost");
      await hydrated(page);
      const form = page.getByTestId("feedback-form-cum-a-fost");
      await form.getByRole("radio", { name: "Cu nume și prenume" }).check();
      await form.locator('[name="name"]').fill("Ana Pop");
      // On «Cum a fost» the club is the default reader; the safety person is the other answer.
      await expect(form.getByTestId("feedback-audience").getByRole("radio", { name: "Clubul" })).toBeChecked();
      await form.locator('[name="message"]').fill("   ");
      // «Dacă nu mai vii…» is a fold (§NNN), closed until opened.
      const reasons = form.getByTestId("feedback-reasons");
      await expect(reasons).not.toHaveAttribute("open", /.*/);
      await expect(form.locator('input[name="reasons"][value="time"]')).toBeHidden();
      await reasons.locator("summary").click();
      await form.locator('input[name="reasons"][value="time"]').check();
      await form.locator('[name="reasonOther"]').fill("Seara e greu");
      await form.getByRole("button", { name: "Trimite" }).click();
      await expect(page).toHaveURL(/\/ro\/contact\/spune-ne\?tip=cum-a-fost&error=VALIDATION_ERROR&fields=message&since=[^#]+#feedback-errors$/, { timeout: 30_000 });
      // By id: Next's route announcer is a `role="alert"` too (contact.spec.ts says why).
      const summary = page.locator("#feedback-errors");
      await expect(summary).toBeVisible();
      await expect(summary.getByRole("link", { name: "Mesajul" })).toBeVisible();
      await expect(page.locator('[name="reasonOther"]')).toHaveValue("Seara e greu");
      await expect(page.locator('input[name="reasons"][value="time"]')).toBeChecked();
      // Brought back open, since a refusal kept a tick in it.
      await expect(page.getByTestId("feedback-reasons")).toHaveAttribute("open", /.*/);
      await expect(page.locator('input[name="reasons"][value="time"]')).toBeVisible();
      // The way back and the way to another branch (§NNN): buttons with a glyph, a thumb's height each.
      for (const id of ["feedback-back", "feedback-other-branches"]) {
        const control = page.getByTestId(id);
        await expect(control.locator("svg")).toHaveCount(1);
        expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByTestId("feedback-other-branches")).toHaveText("Schimbă tipul mesajului");
      // The choice and the name come back too, visible.
      await expect(page.getByRole("radio", { name: "Cu nume și prenume" })).toBeChecked();
      await expect(page.locator('[name="name"]')).toHaveValue("Ana Pop");
      await expect(page.locator('[name="name"]')).toBeVisible();
      await expect(page.locator('[name="message"]')).toHaveAttribute("aria-invalid", "true");
      await noSidewaysScroll(page);

      // The event, picked by typing part of its title (§680; the owner: «I need to be able the filter
      // the events here») — through the filtering island, which the picker's own events make sure of.
      await hydrated(page);
      const pickedTitle = await pickEventByTyping(page, offered[0], pickerFixture);

      // Corrected and sent: the sent page, on the branch's slug.
      await page.locator('[name="message"]').fill("Foarte frumos, mulțumim.");
      await page.waitForTimeout(HUMAN_PAUSE_MS);
      await page.getByTestId("feedback-form-cum-a-fost").getByRole("button", { name: "Trimite" }).click();
      await expect(page).toHaveURL(/\/ro\/contact\/spune-ne\?sent=cum-a-fost$/, { timeout: 30_000 });
      await expect(page.getByTestId("feedback-sent")).toContainText("Mesajul a plecat");
      // A way on (§NNN): another message, from step 1.
      await expect(page.getByTestId("feedback-send-another")).toHaveAttribute("href", "/ro/contact/spune-ne");
      // The club's message names the event picked: its subject is «Cum a fost: <title>», as `/devs` shows the capture.
      await expect(async () => {
        await page.goto("/ro/devs?panel=email");
        await expect(page.locator("main")).toContainText(`Cum a fost: ${pickedTitle}`, { timeout: 2_000 });
      }).toPass({ timeout: 45_000 });

      // One branch on: no choice of one — its form at once, on /ro and on /en.
      await setBranches(page, { suggestion: true });
      await page.goto("/ro/contact/spune-ne");
      await expect(page.getByTestId("feedback-choose")).toHaveCount(0);
      await expect(page.getByTestId("feedback-form-sugestie")).toBeVisible();
      // No other branch to go to, so no button for one.
      await expect(page.getByTestId("feedback-other-branches")).toHaveCount(0);
      await page.goto("/en/contact/tell-us");
      await expect(page.getByTestId("feedback-form-sugestie")).toBeVisible();

      // None on: no door on /contact, and the wizard is a 404.
      await setBranches(page, {});
      await page.goto("/ro/contact", { waitUntil: "networkidle" });
      await expect(page.getByTestId("feedback-section")).toHaveCount(0);
      expect((await page.goto("/ro/contact/spune-ne"))?.status()).toBe(404);
    } finally {
      // Every branch off, as the seed leaves them, whatever happened above.
      try {
        if (!page.isClosed()) await setBranches(page, {});
      } catch (error) {
        console.error("[feedback.spec] could not switch the branches off again", error);
      }
      // The picker's events gone again, whether or not the test reached its end.
      try {
        await removePickerEvents(page, mark);
      } catch (error) {
        console.error("[feedback.spec] could not remove the picker's events", error);
      }
      await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      await lock.end();
    }
  });
});
