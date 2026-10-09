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

/**
 * «Evenimentul» through the filtering island (§NNN), when the picker has it — over eight rows: «Altceva»
 * first, a thumb's row each, the list below the box, «Niciun eveniment găsit» for a word nothing has,
 * the chips when both kinds are there, and an event found by part of its title typed without its
 * diacritics. Returns the title picked — or null when the list is short and the native select is all
 * there is, which the form posts as before.
 */
async function pickEventByTyping(page: Page): Promise<string | null> {
  const island = page.getByTestId("feedback-event-filter");
  if ((await island.count()) === 0) {
    await expect(page.locator('select[name="event"]')).toHaveCount(1);
    return null;
  }
  // The native select is gone from the form; the island's hidden input is the one `event` posted.
  await expect(page.locator('select[name="event"]')).toHaveCount(0);
  await expect(page.locator('[name="event"]')).toHaveCount(1);

  const chips = island.getByRole("group", { name: "Arată" });
  if ((await chips.count()) > 0) {
    for (const words of ["Toate", "Curse", "Alergări de grup"]) {
      const chip = chips.getByRole("button", { name: words });
      expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await chips.getByRole("button", { name: "Curse" }).click();
    await expect(chips.getByRole("button", { name: "Curse" })).toHaveAttribute("aria-pressed", "true");
    await chips.getByRole("button", { name: "Toate" }).click();
    await expect(chips.getByRole("button", { name: "Toate" })).toHaveAttribute("aria-pressed", "true");
  }

  const box = island.getByRole("combobox", { name: "Evenimentul" });
  await box.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const options = listbox.getByRole("option");
  await expect(options.first()).toHaveText("Altceva / în general");
  // Below the box, and a thumb's row each.
  const boxBottom = ((await box.boundingBox())?.y ?? 0) + ((await box.boundingBox())?.height ?? 0);
  expect((await listbox.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(boxBottom - 1);
  expect((await options.nth(1).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  // The title is the row's first line; its day is the second.
  const title = (await options.nth(1).locator("span > span").first().innerText()).trim();

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
    const lock = new pg.Client({ connectionString: databaseUrl() });
    await lock.connect();
    await lock.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await signIn(page, "Dev Superadministrator");
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
      // island's hidden input after (§NNN) — one `event` either way, with the same slug.
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
      if (offered.length > 0) {
        await page.goto(`/ro/contact/spune-ne?tip=cum-a-fost&eveniment=${offered[0]}`);
        await expect(posted).toHaveValue(offered[0]);
        await hydrated(page);
        await expect(posted).toHaveCount(1);
        await expect(posted).toHaveValue(offered[0]);
      }

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
      // The choice and the name come back too, visible.
      await expect(page.getByRole("radio", { name: "Cu nume și prenume" })).toBeChecked();
      await expect(page.locator('[name="name"]')).toHaveValue("Ana Pop");
      await expect(page.locator('[name="name"]')).toBeVisible();
      await expect(page.locator('[name="message"]')).toHaveAttribute("aria-invalid", "true");
      await noSidewaysScroll(page);

      // The event, picked by typing part of its title (§NNN; the owner: «I need to be able the filter
      // the events here») — when the picker is long enough for the filtering island, over eight rows.
      await hydrated(page);
      const pickedTitle = await pickEventByTyping(page);

      // Corrected and sent: the sent page, on the branch's slug.
      await page.locator('[name="message"]').fill("Foarte frumos, mulțumim.");
      await page.waitForTimeout(HUMAN_PAUSE_MS);
      await page.getByTestId("feedback-form-cum-a-fost").getByRole("button", { name: "Trimite" }).click();
      await expect(page).toHaveURL(/\/ro\/contact\/spune-ne\?sent=cum-a-fost$/, { timeout: 30_000 });
      await expect(page.getByTestId("feedback-sent")).toContainText("Mesajul a plecat");
      // The club's message names the event picked: its subject is «Cum a fost: <title>», as `/devs` shows the capture.
      if (pickedTitle) {
        await expect(async () => {
          await page.goto("/ro/devs?panel=email");
          await expect(page.locator("main")).toContainText(`Cum a fost: ${pickedTitle}`, { timeout: 2_000 });
        }).toPass({ timeout: 45_000 });
      }

      // One branch on: no choice of one — its form at once, on /ro and on /en.
      await setBranches(page, { suggestion: true });
      await page.goto("/ro/contact/spune-ne");
      await expect(page.getByTestId("feedback-choose")).toHaveCount(0);
      await expect(page.getByTestId("feedback-form-sugestie")).toBeVisible();
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
      await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      await lock.end();
    }
  });
});
