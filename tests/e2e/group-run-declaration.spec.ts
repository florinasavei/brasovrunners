import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * §393 — a group run's optional self-declaration, end to end, on the phone and the desktop.
 *
 * The owner, 2026-09-25: "I might need a 'declarație pe propria răspundere' for group runs as well,
 * especially for the trail one; this is optional but people should be able to sign and email it to
 * us" — and: "for these group runs I should just have an optional 'semnează declarația pe propria
 * răspundere' button that just opens the signing flow."
 *
 * The trail template is approved by the local seed (`yarn db:reset:local` seeds every platform
 * template as a sample version, §29), so the editor's box is live. The spec creates its own trail
 * group run, sees the box tick itself when the surface becomes Trail, publishes, signs on `/ro` and
 * on `/en`, reads the two rows the outbox got, finds both messages on `/admin/emails`, and erases one
 * signature as the Administrator — then checks the Tehnic role is refused the PDF.
 */

const DATE = "2027-04-14";

/** The consent box's words while a minor may sign (§769): the minor's tick is above it, and it says the adult's age too. */
const ACCEPT_ANY_RO = "Am citit declarația de mai sus și o semnez pe propria răspundere: pentru mine, având cel puțin 18 ani împliniți, sau pentru minorul bifat mai sus";
const ACCEPT_ANY_EN = "I have read the declaration above and sign it on my own responsibility: for myself, being at least 18 years, or for the minor ticked above";

let title = "";
let englishTitle = "";
let slug = "";
let englishSlug = "";
let editorUrl = "";
let eventId = "";
/** A second date of the same run (§113, §523): the same titles a week later, another slug. */
let secondSlug = "";
const signers = { ro: "", en: "", parent: "", parentNoScript: "", unticked: "", tooOldNoScript: "" };

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

/** Nothing sideways on a phone (BR-REQ-041-01). */
async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function sign(page: Page, locale: "ro" | "en", name: string, email: string) {
  const words =
    locale === "ro"
      ? { document: "Act de identitate (seria și numărul)", email: "Adresa de email", accept: ACCEPT_ANY_RO, signature: "Semnătura: numele tău complet", action: "Semnează declarația", adults: "Declar că am cel puțin 18 ani împliniți la data fiecărei alergări la care particip." }
      : { document: "Identity document (series and number)", email: "Email address", accept: ACCEPT_ANY_EN, signature: "Signature: your full name", action: "Sign the declaration", adults: "I declare that I am at least 18 years old on the day of each run I take part in." };
  await hydrated(page);
  // The approved text, before anything is asked (§57): the sample's banner says what it is, and the
  // text states the run's age through {{minimumAge}} — never under eighteen, the declaration covers
  // no minor (§515).
  await expect(page.locator("#main")).toContainText(locale === "ro" ? "TEXT DE EXEMPLU" : "SAMPLE TEXT");
  await expect(page.locator("#main")).toContainText(words.adults);
  await expect(page.getByTestId("group-run-declaration-adults")).toBeVisible();
  // The text's version and the whole date it took effect, the month in words, no weekday (§534), over it, as the PDF says it (§499).
  await expect(page.getByTestId("declaration-version")).toHaveText(
    locale === "ro" ? /^Versiunea \d+, în vigoare din \d{1,2} \p{L}+ \d{4}$/u : /^Version \d+, in force since \d{1,2} \p{L}+ \d{4}$/u,
  );
  // No language select: the text signed is the one on the page, in the page's language (§57).
  await expect(page.locator('[name="preferredLocale"]')).toHaveCount(0);
  // The platform's texts ask for no identity document since the counsel review (§418), and a
  // regression that asks for one under these texts would go unnoticed by a lenient check —
  // the field is asked exactly when the text names it, never otherwise.
  await expect(page.getByLabel(words.document, { exact: false })).toHaveCount(0);
  // The run's own minimum age (§440, §515): a run saved with the default fourteen reads as eighteen,
  // which the text states once; no birth date is asked at eighteen.
  await expect(page.locator("#main")).not.toContainText(locale === "ro" ? "am împlinit 18 ani" : "I am 18 or older");
  // The minor's box (§769) is on the page, closed: an adult is asked no date, and its box is not posted.
  await expect(page.locator('input[name="birthDate"]')).toBeHidden();
  await expect(page.getByTestId("group-run-minor-fields")).toBeHidden();
  await page.getByRole("textbox", { name: words.email }).fill(email);
  await page.getByRole("checkbox", { name: words.accept }).check();
  await page.getByRole("textbox", { name: words.signature }).fill(name);
  await noSidewaysScroll(page);
  // A person reads before pressing: the timing check (§19.4) refuses a press under a second.
  await page.waitForTimeout(1_500);
  const button = page.getByTestId("group-run-declaration-submit");
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await button.click();
  await page.waitForURL(/done=1/);
  await expect(page.getByTestId("group-run-declaration-done")).toBeVisible();
}

async function outboxFor(email: string): Promise<{ type: string; to: string }[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ message_type: string; recipient_email: string }>(
      `SELECT o.message_type, o.recipient_email FROM email_outbox o JOIN group_run_declarations d ON d.id::text = o.payload_json->>'groupRunDeclarationId'
        WHERE d.email = $1`,
      [email],
    );
    // Sorted by name here: `ORDER BY` on an enum sorts by the enum's own order.
    return rows.map((row) => ({ type: row.message_type, to: row.recipient_email })).sort((a, b) => a.type.localeCompare(b.type));
  });
}

/** Where the club's archive copy goes on this database: the mailbox named on /admin/emails. */
const ARCHIVE_FALLBACK = "arhiva-declaratii@example.test";
let archive = "";

/**
 * A key of this spec's own for PostgreSQL's advisory locks: every run of the spec holds it shared
 * while the fixture below is in place, and the last one out takes it exclusively to put the
 * setting back.
 */
const FIXTURE_LOCK = 4_783_375;

/** The connection that holds this run's shared lock, from `beforeAll` to `afterAll`. */
let lockHolder: pg.Client | null = null;

/**
 * The club's declarations mailbox, named if the database has none — so the archive copy is always
 * queued and the spec can count it, whatever the local `.env` says about `DECLARATIONS_ARCHIVE_TO`.
 * A mailbox already named is kept (it wins over the environment, as `resolveDeclarationCopies`
 * reads it); both projects write the same value, so running them side by side is safe.
 *
 * **Scoped to the spec.** The shared lock is taken first, so a run that is finishing and putting
 * the setting back (`restoreArchiveMailbox`, exclusive) is waited for rather than raced.
 */
async function ensureArchiveMailbox(): Promise<string> {
  lockHolder = new pg.Client({ connectionString: databaseUrl() });
  await lockHolder.connect();
  await lockHolder.query("SELECT pg_advisory_lock_shared($1)", [FIXTURE_LOCK]);
  return withDatabase(async (client) => {
    await client.query(
      `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('clubNotices', jsonb_build_object('declarations', jsonb_build_object('to', $1::text, 'cc', '[]'::jsonb, 'bcc', '[]'::jsonb), 'confirmations', jsonb_build_object('to', '[]'::jsonb), 'participants', jsonb_build_object('bcc', '[]'::jsonb)), now())
       ON CONFLICT (key) DO UPDATE SET
         value = platform_settings.value || jsonb_build_object('declarations',
           coalesce(platform_settings.value->'declarations', '{"cc": [], "bcc": []}'::jsonb) || jsonb_build_object('to', $1::text)),
         updated_at = now()
       WHERE coalesce(platform_settings.value->'declarations'->>'to', '') = ''`,
      [ARCHIVE_FALLBACK],
    );
    const { rows } = await client.query<{ to: string }>("SELECT value->'declarations'->>'to' AS to FROM platform_settings WHERE key = 'clubNotices'");
    return rows[0].to;
  });
}

/**
 * Put the setting back once no run of this spec needs it: the fallback mailbox, if it is still the
 * one named, is unnamed again — "nobody named", as the database had it — so a later race
 * declaration on this database queues no archive copy to a test address. A mailbox somebody named
 * is never touched. Only the last run out does it: the exclusive lock is granted only when no other
 * run still holds the shared one.
 */
async function restoreArchiveMailbox(): Promise<void> {
  const client = lockHolder;
  lockHolder = null;
  if (!client) return;
  try {
    await client.query("SELECT pg_advisory_unlock_shared($1)", [FIXTURE_LOCK]);
    const { rows } = await client.query<{ last: boolean }>("SELECT pg_try_advisory_lock($1) AS last", [FIXTURE_LOCK]);
    if (!rows[0]?.last) return;
    await client.query(
      `UPDATE platform_settings
          SET value = jsonb_set(value, '{declarations,to}', '""'::jsonb), updated_at = now()
        WHERE key = 'clubNotices' AND value->'declarations'->>'to' = $1`,
      [ARCHIVE_FALLBACK],
    );
    await client.query("SELECT pg_advisory_unlock($1)", [FIXTURE_LOCK]);
  } finally {
    await client.end();
  }
}

test.describe.serial("§393 a group run's optional self-declaration", () => {
  test.beforeAll(async () => {
    archive = await ensureArchiveMailbox();
  });
  test.afterAll(async () => {
    await restoreArchiveMailbox();
  });

  test("the editor ticks it by itself for a trail group run, and the run is published", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    title = `Tura de trail ${suffix}`;
    slug = `tura-de-trail-${suffix}`;
    englishTitle = `Trail loop ${suffix}`;
    englishSlug = `trail-loop-${suffix}`;
    signers.ro = `ana.${suffix}@example.test`;
    signers.en = `ion.${suffix}@example.test`;
    signers.parent = `parinte.${suffix}@example.test`;
    signers.parentNoScript = `tutore.${suffix}@example.test`;
    signers.unticked = `schimbat.${suffix}@example.test`;
    signers.tooOldNoScript = `major.${suffix}@example.test`;

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
    editorUrl = page.url().split("?")[0];
    eventId = editorUrl.split("/").at(-1) ?? "";
    await hydrated(page);

    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Urcăm pe munte.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "Up the mountain.");

    // «Regulamentul» › «Declarația pe propria răspundere» (§448): the declaration box follows the
    // surface chosen in «Traseul» — unticked while none is chosen.
    await openEditorBox(page, "Declarația pe propria răspundere");
    const box = page.getByRole("checkbox", { name: "Declarație opțională pe propria răspundere" });
    await expect(box).toBeDisabled();
    await expect(page.getByTestId("group-run-declaration-field")).toContainText("Doar pentru o alergare de grup pe asfalt sau pe teren accidentat");
    await openEditorBox(page, "Traseul");
    await page.getByRole("combobox", { name: "Suprafață" }).click();
    await page.getByRole("option", { name: "Trail" }).click();
    // On by default for a trail run (the mountain rescue asks for it), and a thumb's target; the
    // card names the surface and the approved text in force for it.
    await expect(box).toBeEnabled();
    await expect(box).toBeChecked();
    await expect(page.getByTestId("group-run-declaration-surface")).toContainText("Trail");
    await expect(page.getByTestId("group-run-declaration-in-force")).toContainText("Textul în vigoare pentru Trail");
    expect((await box.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    await hydrated(page);
    await openEditorBox(page, "Declarația pe propria răspundere");
    await expect(page.getByRole("checkbox", { name: "Declarație opțională pe propria răspundere" })).toBeChecked();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  /*
    §523 — a declaration covers the run's series: a second date of the same run, the same titles a
    week later, published, so the signature below is a series' and reads on either date.
  */
  test("the run gets a second date, a week later", async () => {
    secondSlug = `${slug}-2`;
    await withDatabase(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("CREATE TEMP TABLE second_date ON COMMIT DROP AS SELECT * FROM events WHERE id = $1", [eventId]);
        const { rows } = await client.query<{ id: string }>(
          `UPDATE second_date SET id = gen_random_uuid(), featured = false, starts_at = starts_at + interval '7 days',
             ends_at = ends_at + interval '7 days' RETURNING id`,
        );
        await client.query("INSERT INTO events SELECT * FROM second_date");
        await client.query("CREATE TEMP TABLE second_texts ON COMMIT DROP AS SELECT * FROM event_translations WHERE event_id = $1", [eventId]);
        await client.query("UPDATE second_texts SET id = gen_random_uuid(), event_id = $1, slug = slug || '-2'", [rows[0].id]);
        await client.query("INSERT INTO event_translations SELECT * FROM second_texts");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  });

  /*
    §573 (applying §561 to §440's box) — above eighteen the page asks a birth date, and it is the
    registration form's typed box: day first in both languages, never the browser's date box that
    an English phone drew month first. The second date gets a minimum of twenty before anything
    reads it (so no cached copy says otherwise); the signatures below are the first date's.
  */
  test("above eighteen the birth date is typed day first, in English too, and an under-age date is refused under the box", async ({ page }) => {
    await withDatabase(async (client) => {
      const { rowCount } = await client.query(
        "UPDATE events SET min_age = 20 WHERE id = (SELECT event_id FROM event_translations WHERE slug = $1)",
        [secondSlug],
      );
      expect(rowCount).toBe(1);
    });
    for (const locale of ["en", "ro"] as const) {
      await page.goto(locale === "en" ? `/en/events/${englishSlug}-2/declaration` : `/ro/evenimente/${secondSlug}/declaratie`);
      await hydrated(page);
      const box = page.getByRole("textbox", { name: locale === "en" ? "Date of birth" : "Data nașterii" });
      await expect(box).toHaveAttribute("type", "text");
      await expect(box).toHaveAttribute("placeholder", locale === "en" ? "DD.MM.YYYY" : "ZZ.LL.AAAA");
      // A phone's numeric keypad has no dot: eight digits are 11 May, shown day first on leaving the box.
      await box.fill("11051990");
      await box.blur();
      await expect(box).toHaveValue("11.05.1990");
      const field = page.locator(".MuiFormControl-root", { has: box });
      // The second date is 21 April 2027: thirty-six on the run's day.
      await expect(field).toContainText(locale === "en" ? "Friday, 11 May 1990 · 36 years on the event day" : "Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului");
      // Nineteen on the run's day: the rule's sentence, under the box, before any press.
      await box.fill("22.04.2007");
      await expect(field).toContainText(locale === "en" ? "The minimum age for this run is 20 years" : "Vârsta minimă pentru această alergare este 20 de ani");
      await expect(box).toHaveAttribute("aria-invalid", "true");
      await noSidewaysScroll(page);
    }
  });

  /*
    A run for adults only (its own minimum is eighteen) draws no minor's tick and none of its boxes, whatever the text
    in force says (§769, `groupRunTakesMinors`): the page says it is signed for oneself alone.
  */
  test("a run whose minimum is eighteen draws no minor's tick, and says it is for adults", async ({ page }) => {
    await withDatabase(async (client) => {
      const { rowCount } = await client.query(
        "UPDATE events SET min_age = 18 WHERE id = (SELECT event_id FROM event_translations WHERE slug = $1)",
        [secondSlug],
      );
      expect(rowCount).toBe(1);
    });
    for (const locale of ["ro", "en"] as const) {
      await page.goto(locale === "en" ? `/en/events/${englishSlug}-2/declaration` : `/ro/evenimente/${secondSlug}/declaratie`);
      await hydrated(page);
      await expect(page.getByRole("checkbox", { name: /Semnez pentru un minor|I am signing for a minor/ })).toHaveCount(0);
      await expect(page.getByTestId("group-run-minor")).toHaveCount(0);
      await expect(page.getByTestId("group-run-minor-fields")).toHaveCount(0);
      await expect(page.getByTestId("group-run-declaration-adults")).toContainText(locale === "en" ? "Sign it only for yourself" : "O semnezi doar pentru tine");
      // Without a minor in the picture the consent box is the adult's own: nothing points at a tick.
      await expect(page.getByRole("checkbox", { name: locale === "en" ? ACCEPT_ANY_EN : ACCEPT_ANY_RO })).toHaveCount(0);
    }
  });

  test("the run's page offers it under the route, and a runner signs it in Romanian", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    const offer = page.getByTestId("group-run-declaration-offer");
    // Inside «Condiții de participare», closed on arrival (§498): attached, not shown, until opened.
    const conditions = page.getByTestId("conditions-fold");
    await expect(conditions).not.toHaveAttribute("open", "");
    await expect(conditions.getByRole("heading", { level: 2, name: "Condiții de participare" })).toBeVisible();
    await expect(offer).toBeHidden();
    await openFold(conditions);
    await expect(offer).toBeVisible();
    // A named section: its heading is its accessible name — without «(opțional)» since §498.
    await expect(page.getByRole("region", { name: "Declarație pe propria răspundere", exact: true })).toBeVisible();
    await expect(offer.getByRole("heading", { level: 3, name: "Declarație pe propria răspundere", exact: true })).toBeVisible();
    // Once for the whole series of a run that repeats (§523).
    await expect(offer).toContainText(
      `Semnează declarația pe propria răspundere: o primești pe email. La o alergare care se repetă o semnezi o singură dată, pentru toată seria ${title}; clubul o păstrează cât timp este necesară pentru alergările la care se aplică și nu o mai folosește dacă ceri retragerea ei`,
    );
    await expect(offer).not.toContainText("Dacă vrei");
    // The photographs notice comes before it in the fold, the declaration last (§498).
    expect(
      await conditions.evaluate((fold) => {
        const notice = fold.querySelector("p a[href$='/contact']");
        const declaration = fold.querySelector("[data-testid='group-run-declaration-offer']");
        return Boolean(notice && declaration && notice.compareDocumentPosition(declaration) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    // The run's safety rules (§556) come before the optional declaration, for everybody who reads the fold.
    expect(
      await conditions.evaluate((fold) => {
        const rules = fold.querySelector("[data-testid='group-run-safety-rules']");
        const declaration = fold.querySelector("[data-testid='group-run-declaration-offer']");
        return Boolean(rules && declaration && rules.compareDocumentPosition(declaration) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    // Small, with a pen before the words, and still a thumb's 44 pixels.
    const button = offer.getByRole("link", { name: "Semnează declarația", exact: true });
    await expect(button.getByTestId("declaration-offer-glyph")).toBeVisible();
    await expect(button).toHaveClass(/MuiButton-sizeSmall/);
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
    await button.click();
    await expect(page).toHaveURL(new RegExp(`/ro/evenimente/${slug}/declaratie$`));
    await sign(page, "ro", "Ana Popescu", signers.ro);

    // One row, never a registration, and two messages: the signer's and the club's archive copy.
    expect(await outboxFor(signers.ro)).toEqual([
      { type: "GROUP_RUN_DECLARATION_ARCHIVE", to: archive },
      { type: "GROUP_RUN_DECLARATION_SIGNED", to: signers.ro },
    ]);
    const registrations = await withDatabase(async (client) => (await client.query("SELECT count(*)::int AS n FROM registrations WHERE event_id = $1", [eventId])).rows[0].n);
    expect(registrations).toBe(0);
  });

  test("and in English, from the English page", async ({ page }) => {
    await page.goto(`/en/events/${englishSlug}`);
    const offer = page.getByTestId("group-run-declaration-offer");
    await openFold(page.getByTestId("conditions-fold"));
    await expect(offer.getByRole("heading", { level: 3, name: "Self-declaration", exact: true })).toBeVisible();
    await expect(offer).toContainText(
      `Sign the self-declaration: you get it by email. For a run that repeats you sign it once, for the whole ${englishTitle} series; the club keeps it as long as it is needed for the runs it applies to and stops using it when you ask for its withdrawal`,
    );
    await expect(offer).not.toContainText("If you wish");
    await offer.getByRole("link", { name: "Sign the declaration", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/en/events/${englishSlug}/declaration$`));
    await sign(page, "en", "Ion Ionescu", signers.en);
    const locale = await withDatabase(async (client) => (await client.query("SELECT locale::text AS locale FROM group_run_declarations WHERE email = $1", [signers.en])).rows[0].locale);
    expect(locale).toBe("en");
  });

  /*
    §523 — the signer's own link: their copy carries `?declaratie=<secret>` to the run's page, the row
    its SHA-256. The mail is captured locally, so the spec writes a known secret's hash on the row —
    what the renderer does at send time — and opens the run's OTHER date from that link.
  */
  test("the signer's own link opens another date of the run with «Ai semnat deja…» and no button", async ({ page }) => {
    const secret = `e2e${Date.now().toString(36)}`.padEnd(43, "x").slice(0, 43);
    await withDatabase(async (client) => {
      const { rowCount } = await client.query("UPDATE group_run_declarations SET view_token_hash = $1 WHERE email = $2 AND series_key IS NOT NULL", [
        createHash("sha256").update(secret, "utf8").digest("hex"),
        signers.ro,
      ]);
      expect(rowCount).toBe(1);
    });
    await page.goto(`/ro/evenimente/${secondSlug}?declaratie=${secret}#declaratie`);
    const offer = page.getByTestId("group-run-declaration-offer");
    await expect(offer).toBeVisible();
    await expect(offer.getByTestId("group-run-declaration-signed")).toContainText("Ai semnat deja declarația pentru aceste alergări (v. ");
    await expect(offer.getByRole("link", { name: "Semnează declarația", exact: true })).toHaveCount(0);
    // Without the link, the same date's page is every visitor's: the button, and no word of anybody.
    await page.goto(`/ro/evenimente/${secondSlug}#declaratie`);
    await expect(page.getByTestId("group-run-declaration-offer").getByRole("link", { name: "Semnează declarația", exact: true })).toBeVisible();
    await expect(page.getByTestId("group-run-declaration-signed")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("an address naming #declaratie arrives with «Condiții de participare» open (§498)", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}#declaratie`);
    await expect(page.getByTestId("conditions-fold")).toHaveAttribute("open", "");
    await expect(page.getByTestId("group-run-declaration-offer")).toBeVisible();
  });

  test("the outbox holds both messages per signature, and /admin/emails shows what each one says", async ({ page }) => {
    // Exactly one of each per signature: the signer's, to them, and the club's, to the archive.
    for (const email of [signers.ro, signers.en]) {
      expect(await outboxFor(email), email).toEqual([
        { type: "GROUP_RUN_DECLARATION_ARCHIVE", to: archive },
        { type: "GROUP_RUN_DECLARATION_SIGNED", to: email },
      ]);
    }

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/settings/emails");
    await expect(page.locator("#main")).toContainText("Declarația semnată la o alergare de grup (PDF atașat)");
    await expect(page.locator("#main")).toContainText("Copia clubului: declarație la o alergare de grup (PDF atașat)");
  });

  test("the backoffice lists who signed; the Administrator reads the PDF and erases one", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    const fold = await openEditorBox(page, "Declarații semnate (alergare de grup)");
    const rows = fold.getByTestId("group-run-declaration-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Ana Popescu");
    // Signed for the whole series (§523): the row says so.
    await expect(rows.first().getByTestId("group-run-declaration-series")).toHaveText("serie");
    // No address and no identity document on the list: they are in the PDF.
    await expect(fold).not.toContainText(signers.ro);
    await expect(fold).not.toContainText("123456");

    const href = await rows.first().getByRole("link", { name: "PDF" }).getAttribute("href");
    const pdf = await page.request.get(href ?? "");
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

    // The proof of signing (§556): the signed text's fingerprint, twelve characters, the whole in its name.
    const hash = rows.first().getByTestId("declaration-text-hash");
    await expect(hash).toHaveText(/^Amprenta: [0-9a-f]{12}…$/);
    await expect(hash).toHaveAttribute("aria-label", /^Amprenta: [0-9a-f]{64}$/);

    // «Păstrează: reclamație / litigiu în curs» (§556): set, which the erase then meets as a refusal, and cleared.
    const hold = rows.first().getByTestId("declaration-hold-form");
    await hold.locator("summary").click();
    await hold.getByRole("textbox", { name: "Motivul", exact: true }).fill("Reclamație deschisă");
    await hold.getByRole("button", { name: "Păstrează: reclamație / litigiu în curs" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=declarationHeld/);
    const heldFold = await openEditorBox(page, "Declarații semnate (alergare de grup)");
    const heldRow = heldFold.getByTestId("group-run-declaration-row").first();
    await expect(heldRow.getByTestId("declaration-held")).toContainText("Reclamație deschisă");
    const release = heldRow.getByTestId("declaration-hold-form");
    await release.locator("summary").click();
    await release.getByRole("textbox", { name: "Motivul", exact: true }).fill("Reclamație închisă");
    await release.getByRole("button", { name: "Scoate păstrarea" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=declarationReleased/);
    const actions = await withDatabase(async (client) =>
      (await client.query<{ action: string }>("SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'event.group_run_declaration_hold_%' ORDER BY created_at", [eventId])).rows,
    );
    expect(actions.map((row) => row.action)).toEqual(["event.group_run_declaration_hold_set", "event.group_run_declaration_hold_cleared"]);
    await openEditorBox(page, "Declarații semnate (alergare de grup)");

    const erase = rows.first().getByTestId("group-run-declaration-erase");
    await erase.getByRole("textbox", { name: "Motivul ștergerii" }).fill("A cerut ștergerea");
    await erase.getByRole("button", { name: "Șterge declarația" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=groupRunDeclarationErased/);
    await expect(page.getByTestId("group-run-declaration-erased")).toBeVisible();

    const left = await withDatabase(async (client) => (await client.query<{ email: string }>("SELECT email FROM group_run_declarations WHERE event_id = $1", [eventId])).rows);
    expect(left.map((row) => row.email)).toEqual([signers.en]);
    const trail = await withDatabase(async (client) =>
      (await client.query<{ metadata_json: { reason?: string } }>("SELECT metadata_json FROM audit_logs WHERE action = 'event.group_run_declaration_erased' AND entity_id = $1", [eventId])).rows,
    );
    expect(trail).toHaveLength(1);
    expect(trail[0].metadata_json.reason).toBe("A cerut ștergerea");
    expect(JSON.stringify(trail[0].metadata_json)).not.toContain("Ana");
  });

  test("the Tehnic role sees no fold and is refused the PDF", async ({ page }) => {
    const id = await withDatabase(async (client) => (await client.query<{ id: string }>("SELECT id FROM group_run_declarations WHERE event_id = $1", [eventId])).rows[0].id);
    await signIn(page, "Dev Technical");
    await page.goto(editorUrl);
    await hydrated(page);
    await expect(page.getByTestId("group-run-declarations")).toHaveCount(0);
    const refused = await page.request.get(`/api/admin/events/${eventId}/group-run-declarations/${id}`);
    expect(refused.status()).toBe(403);
  });

  test("the Administrator ticks the signatures left and erases them in one press, the dialog naming the count (§532)", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    const fold = await openEditorBox(page, "Declarații semnate (alergare de grup)");
    const rows = fold.getByTestId("group-run-declaration-row");
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("checkbox").check();
    const batch = page.getByTestId("group-run-declarations-batch");
    await batch.getByRole("textbox", { name: "Motivul ștergerii" }).fill("Au cerut ștergerea");
    await batch.getByRole("button", { name: "Șterge cele bifate" }).click();
    // The count ticked and the run, at the press.
    await expect(page.getByRole("dialog")).toContainText(`Ștergi 1 declarație semnată pentru «${title}»? Nu se poate recupera.`);
    await confirmDialog(page);
    await page.waitForURL(/saved=groupRunDeclarationsErased/);
    await expect(page.getByTestId("group-run-declarations-erased")).toContainText("1 declarație semnată a fost ștearsă");

    const left = await withDatabase(async (client) => (await client.query("SELECT id FROM group_run_declarations WHERE event_id = $1", [eventId])).rows);
    expect(left).toHaveLength(0);
    const trail = await withDatabase(async (client) =>
      (await client.query("SELECT id FROM audit_logs WHERE action = 'event.group_run_declaration_erased' AND entity_id = $1", [eventId])).rows,
    );
    // The single erase's row and this press's, one per signature.
    expect(trail).toHaveLength(2);
  });

  /*
    §769 — a minor signs, with a parent (the owner, 2026-10-14: «o bifă nouă și să semneze minorul +
    părintele»). The sample texts of the local seed carry the minor's paragraph, and the run's minimum is the
    default fourteen: the tick is on the page, the minor's boxes open with it, both names are required, a refusal
    brings the form back as it was, and the signature is one row on §330's columns.
  */
  test("a parent signs for a minor: the tick opens the minor's boxes, a refusal brings them back, and one row keeps both names", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}/declaratie`);
    await hydrated(page);
    const tick = page.getByRole("checkbox", { name: "Semnez pentru un minor (sub 18 ani)", exact: true });
    const minorBoxes = page.getByTestId("group-run-minor-fields");
    // Closed on arrival: an adult is asked nothing of a minor, and nothing of it is posted.
    await expect(tick).toBeVisible();
    await expect(tick).not.toBeChecked();
    await expect(minorBoxes).toBeHidden();
    expect((await tick.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The text itself carries both ways of signing, with blanks, before anybody has typed (what is read is what is signed).
    await expect(page.locator("#main")).toContainText(/Eu, …+, semnez această declarație personal, doar pentru mine\./);
    await expect(page.locator("#main")).toContainText(/Pentru un participant minor, declarația este semnată de minor, …+, pentru sine/);

    await tick.check();
    await expect(minorBoxes).toBeVisible();
    const minorName = page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" });
    const birthDate = page.getByRole("textbox", { name: "Data nașterii minorului" });
    const guardianTick = page.getByRole("checkbox", { name: "Sunt părintele sau tutorele legal și sunt de acord", exact: true });
    await expect(minorName).toBeVisible();
    await expect(birthDate).toBeVisible();
    await expect(guardianTick).toBeVisible();
    expect((await guardianTick.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);

    // The minor's name typed, the parent's tick and the date left: the refusal names those two, nothing is recorded,
    // and the form comes back as it was — the minor's name kept, the parent's tick still unticked.
    await minorName.fill("Ion Popescu");
    await page.getByRole("textbox", { name: "Adresa de email" }).fill(signers.parent);
    await page.getByRole("checkbox", { name: ACCEPT_ANY_RO }).check();
    await page.getByRole("textbox", { name: "Semnătura: numele tău complet" }).fill("Ana Popescu");
    await page.waitForTimeout(1_500);
    await page.getByTestId("group-run-declaration-submit").click();
    await page.waitForURL(/invalid=/);
    const errors = page.getByTestId("group-run-declaration-errors");
    await expect(errors).toContainText("Data nașterii minorului");
    await expect(errors).toContainText("Sunt părintele sau tutorele legal și sunt de acord");
    await expect(errors).not.toContainText("Semnătura minorului: numele lui complet");
    expect(await withDatabase(async (client) => (await client.query("SELECT 1 FROM group_run_declarations WHERE email = $1", [signers.parent])).rowCount)).toBe(0);
    await hydrated(page);
    await expect(page.getByRole("checkbox", { name: "Semnez pentru un minor (sub 18 ani)", exact: true })).toBeChecked();
    await expect(page.getByTestId("group-run-minor-fields")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" })).toHaveValue("Ion Popescu");
    await expect(page.getByRole("checkbox", { name: "Sunt părintele sau tutorele legal și sunt de acord", exact: true })).not.toBeChecked();
    await expect(page.getByRole("textbox", { name: "Adresa de email" })).toHaveValue(signers.parent);
    await expect(page.getByRole("textbox", { name: "Semnătura: numele tău complet" })).toHaveValue("Ana Popescu");

    // Both names, the parent's tick and the minor's birth date (counted against the run's minimum, never kept).
    await page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" }).fill("Ion Popescu");
    const date = page.getByRole("textbox", { name: "Data nașterii minorului" });
    await date.fill("01032012");
    await date.blur();
    await expect(date).toHaveValue("01.03.2012");
    await page.getByRole("checkbox", { name: "Sunt părintele sau tutorele legal și sunt de acord", exact: true }).check();
    await page.getByRole("checkbox", { name: ACCEPT_ANY_RO }).check();
    await page.waitForTimeout(1_500);
    await page.getByTestId("group-run-declaration-submit").click();
    await page.waitForURL(/done=1/);
    await expect(page.getByTestId("group-run-declaration-done")).toBeVisible();

    // One row on §330's columns — the parent's name, the minor's own signature — and no second table, no document.
    const row = await withDatabase(async (client) =>
      (await client.query<{ typed_name: string; minor_typed_name: string | null; id_document: string | null }>(
        "SELECT typed_name, minor_typed_name, id_document FROM group_run_declarations WHERE email = $1",
        [signers.parent],
      )).rows,
    );
    expect(row).toEqual([{ typed_name: "Ana Popescu", minor_typed_name: "Ion Popescu", id_document: null }]);
    expect(await outboxFor(signers.parent)).toEqual([
      { type: "GROUP_RUN_DECLARATION_ARCHIVE", to: archive },
      { type: "GROUP_RUN_DECLARATION_SIGNED", to: signers.parent },
    ]);
  });

  test("a minor under the run's minimum is refused on the date, with the number said", async ({ page }) => {
    await page.goto(`/en/events/${englishSlug}/declaration`);
    await hydrated(page);
    await page.getByRole("checkbox", { name: "I am signing for a minor (under 18)", exact: true }).check();
    const date = page.getByRole("textbox", { name: "The minor's date of birth" });
    // Thirteen on the run's day (14 April 2027), under the default fourteen.
    await date.fill("15.04.2013");
    const field = page.locator(".MuiFormControl-root", { has: date });
    await expect(field).toContainText("The minimum age for this run is 14 years");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await noSidewaysScroll(page);
  });

  // The tick says «under 18»: a date of eighteen or more is no minor's — said under the box as it is typed.
  test("a minor's date of eighteen or more is refused on the date, with its own words", async ({ page }) => {
    await page.goto(`/en/events/${englishSlug}/declaration`);
    await hydrated(page);
    await page.getByRole("checkbox", { name: "I am signing for a minor (under 18)", exact: true }).check();
    const date = page.getByRole("textbox", { name: "The minor's date of birth" });
    // Forty on the run's day (14 April 2027).
    await date.fill("01.01.1987");
    const field = page.locator(".MuiFormControl-root", { has: date });
    await expect(field).toContainText("The minor must be under 18 on the day of the run");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    // Seventeen on the run's day: no refusal.
    await date.fill("15.04.2009");
    await expect(field).not.toContainText("The minor must be under 18");
    await expect(date).toHaveAttribute("aria-invalid", "false");
    await noSidewaysScroll(page);
  });

  // The parent changes their mind after typing: un-ticked, the minor's block is closed and posts nothing, so the
  // adult's own declaration is signed as it is, with no minor's name on the row.
  test("a minor's name typed and then un-ticked is not posted: the adult's own declaration is signed", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}/declaratie`);
    await hydrated(page);
    const tick = page.getByRole("checkbox", { name: "Semnez pentru un minor (sub 18 ani)", exact: true });
    await tick.check();
    await page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" }).fill("Copil Schimbat");
    await page.getByRole("checkbox", { name: "Sunt părintele sau tutorele legal și sunt de acord", exact: true }).check();
    await tick.uncheck();
    await expect(page.getByTestId("group-run-minor-fields")).toBeHidden();
    await page.getByRole("textbox", { name: "Adresa de email" }).fill(signers.unticked);
    await page.getByRole("checkbox", { name: ACCEPT_ANY_RO }).check();
    await page.getByRole("textbox", { name: "Semnătura: numele tău complet" }).fill("Elena Schimbat");
    await page.waitForTimeout(1_500);
    await page.getByTestId("group-run-declaration-submit").click();
    await page.waitForURL(/done=1/);
    const rows = await withDatabase(async (client) =>
      (await client.query<{ typed_name: string; minor_typed_name: string | null }>("SELECT typed_name, minor_typed_name FROM group_run_declarations WHERE email = $1", [signers.unticked])).rows,
    );
    expect(rows).toEqual([{ typed_name: "Elena Schimbat", minor_typed_name: null }]);
  });

  test("the backoffice lists the minor's declaration under the minor's name, «minor · părinte: …»", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    const fold = await openEditorBox(page, "Declarații semnate (alergare de grup)");
    const row = fold.getByTestId("group-run-declaration-row").filter({ hasText: "Ion Popescu" });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("group-run-declaration-minor")).toHaveText("minor · părinte: Ana Popescu");
    // No address on the list, and the PDF is the Administrator's.
    await expect(fold).not.toContainText(signers.parent);
    const href = await row.getByRole("link", { name: "PDF" }).getAttribute("href");
    const pdf = await page.request.get(href ?? "");
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
  });

  // Nested in the serial run: it needs the run the first test made, and the signatures before it.
  test.describe("§769 the minor's boxes without scripts", () => {
  test.use({ javaScriptEnabled: false });

  test("are always on the page, and a box filled while the tick is not ticked is refused on the tick", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}/declaratie`);
    // No script to open them: the boxes are there, and the tick is beside them.
    await expect(page.getByTestId("group-run-minor-fields")).toBeVisible();
    await page.getByRole("textbox", { name: "Adresa de email" }).fill(signers.parentNoScript);
    await page.getByRole("checkbox", { name: ACCEPT_ANY_RO }).check();
    await page.getByRole("textbox", { name: "Semnătura: numele tău complet" }).fill("Maria Ionescu");
    await page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" }).fill("Radu Ionescu");
    await page.waitForTimeout(1_500);
    await page.getByTestId("group-run-declaration-submit").click();
    await page.waitForURL(/invalid=/);
    await expect(page.getByTestId("group-run-declaration-errors")).toContainText("Semnez pentru un minor (sub 18 ani)");
    expect(await withDatabase(async (client) => (await client.query("SELECT 1 FROM group_run_declarations WHERE email = $1", [signers.parentNoScript])).rowCount)).toBe(0);
  });

  test("a minor's date of eighteen or more is refused by the server, and the summary says why", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}/declaratie`);
    await page.getByRole("textbox", { name: "Adresa de email" }).fill(signers.tooOldNoScript);
    await page.getByRole("checkbox", { name: ACCEPT_ANY_RO }).check();
    await page.getByRole("checkbox", { name: "Semnez pentru un minor (sub 18 ani)", exact: true }).check();
    await page.getByRole("textbox", { name: "Semnătura: numele tău complet" }).fill("Maria Ionescu");
    await page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" }).fill("Radu Ionescu");
    await page.getByRole("textbox", { name: "Data nașterii minorului" }).fill("02.04.1985");
    await page.getByRole("checkbox", { name: "Sunt părintele sau tutorele legal și sunt de acord", exact: true }).check();
    await page.waitForTimeout(1_500);
    await page.getByTestId("group-run-declaration-submit").click();
    await page.waitForURL(/invalid=/);
    await expect(page.getByTestId("group-run-declaration-errors")).toContainText("Minorul trebuie să aibă sub 18 ani în ziua alergării");
    expect(await withDatabase(async (client) => (await client.query("SELECT 1 FROM group_run_declarations WHERE email = $1", [signers.tooOldNoScript])).rowCount)).toBe(0);
  });

  test("sign a minor's declaration once the tick, both names, the parent's tick and the date are given", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}/declaratie`);
    await page.getByRole("textbox", { name: "Adresa de email" }).fill(signers.parentNoScript);
    await page.getByRole("checkbox", { name: ACCEPT_ANY_RO }).check();
    await page.getByRole("checkbox", { name: "Semnez pentru un minor (sub 18 ani)", exact: true }).check();
    await page.getByRole("textbox", { name: "Semnătura: numele tău complet" }).fill("Maria Ionescu");
    await page.getByRole("textbox", { name: "Semnătura minorului: numele lui complet" }).fill("Radu Ionescu");
    await page.getByRole("textbox", { name: "Data nașterii minorului" }).fill("02.04.2011");
    await page.getByRole("checkbox", { name: "Sunt părintele sau tutorele legal și sunt de acord", exact: true }).check();
    await page.waitForTimeout(1_500);
    await page.getByTestId("group-run-declaration-submit").click();
    await page.waitForURL(/done=1/);
    const row = await withDatabase(async (client) =>
      (await client.query<{ typed_name: string; minor_typed_name: string | null }>("SELECT typed_name, minor_typed_name FROM group_run_declarations WHERE email = $1", [signers.parentNoScript])).rows,
    );
    expect(row).toEqual([{ typed_name: "Maria Ionescu", minor_typed_name: "Radu Ionescu" }]);
  });
  });
});
