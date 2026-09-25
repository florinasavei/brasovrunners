import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * §NNN — a group run's optional self-declaration, end to end, on the phone and the desktop.
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
      ? { document: "Act de identitate (seria și numărul)", email: "Adresa de email", accept: "Am citit declarația de mai sus și o semnez pe propria răspundere", signature: "Semnătura: numele tău complet", action: "Semnează declarația" }
      : { document: "Identity document (series and number)", email: "Email address", accept: "I have read the declaration above and sign it on my own responsibility", signature: "Signature: your full name", action: "Sign the declaration" };
  await hydrated(page);
  // The approved text, before anything is asked (§57): the sample's banner says what it is.
  await expect(page.locator("#main")).toContainText(locale === "ro" ? "TEXT DE EXEMPLU" : "SAMPLE TEXT");
  await page.getByLabel(words.document, { exact: false }).first().fill("BV 123456");
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

async function outboxFor(email: string): Promise<string[]> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ message_type: string }>(
      `SELECT o.message_type FROM email_outbox o JOIN group_run_declarations d ON d.id::text = o.payload_json->>'groupRunDeclarationId'
        WHERE d.email = $1 ORDER BY o.message_type`,
      [email],
    );
    return rows.map((row) => row.message_type);
  });
}

test.describe.serial("§NNN a group run's optional self-declaration", () => {
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

    // "Traseul": the declaration box follows the surface — unticked while none is chosen.
    await openEditorBox(page, "Traseul");
    const box = page.getByRole("checkbox", { name: "Declarație opțională pe propria răspundere" });
    await expect(box).toBeDisabled();
    await expect(page.getByTestId("group-run-declaration-field")).toContainText("Doar pentru o alergare de grup pe asfalt sau pe trail");
    await page.getByRole("combobox", { name: "Suprafață" }).click();
    await page.getByRole("option", { name: "Trail" }).click();
    // On by default for a trail run (the mountain rescue asks for it), and a thumb's target.
    await expect(box).toBeEnabled();
    await expect(box).toBeChecked();
    expect((await box.locator("xpath=..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    await hydrated(page);
    await openEditorBox(page, "Traseul");
    await expect(page.getByRole("checkbox", { name: "Declarație opțională pe propria răspundere" })).toBeChecked();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("the run's page offers it under the route, and a runner signs it in Romanian", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    const offer = page.getByTestId("group-run-declaration-offer");
    await expect(offer).toBeVisible();
    await expect(offer).toContainText("o primești pe email, iar clubul o păstrează 7 zile după eveniment");
    const button = offer.getByRole("link", { name: "Semnează declarația pe propria răspundere" });
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
    await button.click();
    await expect(page).toHaveURL(new RegExp(`/ro/evenimente/${slug}/declaratie$`));
    await sign(page, "ro", "Ana Popescu", signers.ro);

    // One row, never a registration, and two messages: the signer's and, with an archive, the club's.
    const types = await outboxFor(signers.ro);
    expect(types).toContain("GROUP_RUN_DECLARATION_SIGNED");
    const registrations = await withDatabase(async (client) => (await client.query("SELECT count(*)::int AS n FROM registrations WHERE event_id = $1", [eventId])).rows[0].n);
    expect(registrations).toBe(0);
  });

  test("and in English, from the English page", async ({ page }) => {
    await page.goto(`/en/events/${englishSlug}`);
    const offer = page.getByTestId("group-run-declaration-offer");
    await expect(offer).toContainText("the club keeps it for 7 days after the event");
    await offer.getByRole("link", { name: "Sign the self-declaration" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/events/${englishSlug}/declaration$`));
    await sign(page, "en", "Ion Ionescu", signers.en);
    const locale = await withDatabase(async (client) => (await client.query("SELECT locale::text AS locale FROM group_run_declarations WHERE email = $1", [signers.en])).rows[0].locale);
    expect(locale).toBe("en");
  });

  test("the outbox holds both messages, and /admin/emails shows what each one says", async ({ page }) => {
    const archived = await withDatabase(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM email_outbox WHERE message_type = 'GROUP_RUN_DECLARATION_ARCHIVE' AND payload_json->>'groupRunDeclarationId' IN (SELECT id::text FROM group_run_declarations WHERE email = $1)",
        [signers.ro],
      );
      return rows[0].n;
    });
    const signed = await outboxFor(signers.ro);
    // The club's copy goes wherever the club named a declarations mailbox; the signer's always.
    expect(signed.filter((type) => type === "GROUP_RUN_DECLARATION_SIGNED")).toHaveLength(1);
    expect(archived).toBeLessThanOrEqual(1);

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
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
