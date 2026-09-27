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

let title = "";
let englishTitle = "";
let slug = "";
let englishSlug = "";
let editorUrl = "";
let eventId = "";
/** A second date of the same run (§113, §NNN): the same titles a week later, another slug. */
let secondSlug = "";
const signers = { ro: "", en: "" };

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
      ? { document: "Act de identitate (seria și numărul)", email: "Adresa de email", accept: "Am cel puțin 18 ani împliniți, am citit declarația de mai sus și o semnez pe propria răspundere", signature: "Semnătura: numele tău complet", action: "Semnează declarația", adults: "Declar că am cel puțin 18 ani împliniți la data fiecărei alergări la care particip." }
      : { document: "Identity document (series and number)", email: "Email address", accept: "I am at least 18 years old, I have read the declaration above and sign it on my own responsibility", signature: "Signature: your full name", action: "Sign the declaration", adults: "I declare that I am at least 18 years old on the day of each run I take part in." };
  await hydrated(page);
  // The approved text, before anything is asked (§57): the sample's banner says what it is, and the
  // text states the run's age through {{minimumAge}} — never under eighteen, the declaration covers
  // no minor (§515).
  await expect(page.locator("#main")).toContainText(locale === "ro" ? "TEXT DE EXEMPLU" : "SAMPLE TEXT");
  await expect(page.locator("#main")).toContainText(words.adults);
  await expect(page.getByTestId("group-run-declaration-adults")).toBeVisible();
  // The text's version and the weekday it took effect, over it, as the PDF says it (§499).
  await expect(page.getByTestId("declaration-version")).toHaveText(
    locale === "ro" ? /^Versiunea \d+, în vigoare din \p{L}+, \d{1,2} .+ \d{4}$/u : /^Version \d+, in force since \p{L}+, \d{1,2} .+ \d{4}$/u,
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
  await expect(page.locator('input[name="birthDate"]')).toHaveCount(0);
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
    await expect(page.getByTestId("group-run-declaration-field")).toContainText("Doar pentru o alergare de grup pe asfalt sau pe trail");
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
    §NNN — a declaration covers the run's series: a second date of the same run, the same titles a
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
    // Once for the whole series of a run that repeats (§NNN).
    await expect(offer).toContainText(
      `Semnează declarația pe propria răspundere: o primești pe email. La o alergare care se repetă o semnezi o singură dată, pentru toată seria ${title}; clubul o păstrează cât timp vii la alergări și o șterge când îi ceri`,
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
      `Sign the self-declaration: you get it by email. For a run that repeats you sign it once, for the whole ${englishTitle} series; the club keeps it while you keep coming to the runs and deletes it when you ask`,
    );
    await expect(offer).not.toContainText("If you wish");
    await offer.getByRole("link", { name: "Sign the declaration", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/en/events/${englishSlug}/declaration$`));
    await sign(page, "en", "Ion Ionescu", signers.en);
    const locale = await withDatabase(async (client) => (await client.query("SELECT locale::text AS locale FROM group_run_declarations WHERE email = $1", [signers.en])).rows[0].locale);
    expect(locale).toBe("en");
  });

  /*
    §NNN — the signer's own link: their copy carries `?declaratie=<secret>` to the run's page, the row
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
    // Signed for the whole series (§NNN): the row says so.
    await expect(rows.first().getByTestId("group-run-declaration-series")).toHaveText("serie");
    // No address and no identity document on the list: they are in the PDF.
    await expect(fold).not.toContainText(signers.ro);
    await expect(fold).not.toContainText("123456");

    const href = await rows.first().getByRole("link", { name: "PDF" }).getAttribute("href");
    const pdf = await page.request.get(href ?? "");
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

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
});
