import { expect, type Locator, type Page, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §1018 — «Ziua cursei» → «Declarații» (BR-REQ-060-01, BR-REQ-037-08, BR-REQ-033-02, BR-REQ-041-01), walked at 320 pixels and on a
 * desk against a production build: the Organizer's row of «Ziua cursei» reaches «Declarații», its last tab, and the row brings it into
 * view; the page lists the race's two signed declarations — one by the email link, one recorded on paper by the Organizer — with the
 * number, the signature, the version and the fingerprint, and no identity document though one was typed; «Declarația (PDF)» answers
 * 200 with a PDF, and the download is written to the registration's trail; the search finds a runner by number. The desk Volunteer is
 * drawn no such tab, and the address is the 404 an unknown page gets. Nothing scrolls sideways.
 *
 * The race, its two runners and their acceptances are written straight into the database — the setup, not the subject — one per
 * project and run, so the two projects never meet. The declaration's text is the seed's sample version, as a signature would take it.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** One query on the server's database: the setup and the trail read, not the subject. */
async function query<T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** The identity document Ana typed when she signed: in the database, in her PDF — never on the page. */
const ID_DOCUMENT = "QZ 517293";

type Seeded = { eventId: string; ana: string; ion: string; anaName: string; ionName: string };

/**
 * A race tomorrow with two confirmed runners: Ana, number 7, who signed by the email link and typed her identity document; Ion,
 * number 8, whose paper declaration the Organizer recorded at the desk. Both against the approved race declaration the seed holds.
 */
async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: documents } = await client.query<{ id: string; version: number; content_sha256: string }>(
      `SELECT id, version, content_sha256 FROM legal_documents WHERE key = 'EVENT_DECLARATION' AND is_approved ORDER BY version DESC LIMIT 1`,
    );
    if (documents.length === 0) throw new Error("no approved race declaration in the database: run yarn db:seed");
    const [document] = documents;
    const { rows: organizers } = await client.query<{ id: string }>(`SELECT id FROM staff_users WHERE email = 'dev-moderator@dev.test'`);
    if (organizers.length === 0) throw new Error("no «Dev Moderator» account yet: sign in as the Organizer before seeding");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name) VALUES ('RACE', now() + interval '1 day', 'INTERNAL', 'Parcul Tractorul') RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `declaratii-${tag}`,
      `Cursa declarațiilor ${tag}`,
      `declarations-${tag}`,
      `The declarations race ${tag}`,
    ]);
    const runner = async (name: string, bib: number) => {
      const email = `declaratii-${bib}-${tag}@test.invalid`;
      const { rows: person } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, name],
      );
      const { rows: registration } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
           email_confirmed_at, confirmed_at, bib_number, sex, birth_date)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
           now() - interval '5 days', now() - interval '5 days', $4, 'FEMALE', '1990-01-01') RETURNING id`,
        [eventId, person[0].id, name, bib],
      );
      return registration[0].id;
    };
    const anaName = `Ana Semnată ${tag}`;
    const ionName = `Ion Hârtie ${tag}`;
    const ana = await runner(anaName, 7);
    const ion = await runner(ionName, 8);
    const accept = (registrationId: string, typedName: string, more: { method: "EMAIL_LINK" | "PAPER"; idDocument: string | null; attestedBy: string | null }) =>
      client.query(
        `INSERT INTO declaration_acceptances (registration_id, legal_document_id, declaration_version, content_sha256, locale, typed_name, id_document, method, attested_by_staff_user_id, accepted_at, text_hash)
         VALUES ($1, $2, $3, $4, 'ro', $5, $6, $7, $8, now() - interval '2 days', $9)`,
        [registrationId, document.id, document.version, document.content_sha256, typedName, more.idDocument, more.method, more.attestedBy, createHash("sha256").update(`${registrationId}-${typedName}`).digest("hex")],
      );
    await accept(ana, anaName, { method: "EMAIL_LINK", idDocument: ID_DOCUMENT, attestedBy: null });
    await accept(ion, ionName, { method: "PAPER", idDocument: null, attestedBy: organizers[0].id });
    return { eventId, ana, ion, anaName, ionName };
  } finally {
    await client.end();
  }
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** A thumb's target (BR-REQ-041-01 criterion 6): 44 pixels tall at least. */
async function tall(target: Locator, what: string) {
  const box = await target.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.height, what).toBeGreaterThanOrEqual(44);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Ieși din cont" }).click();
  await expect(page).not.toHaveURL(/\/admin/, { timeout: 30_000 });
}

test.describe("§1018 «Ziua cursei» → «Declarații»", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the Organizer's row reaches «Declarații»; the page lists the race's declarations with no identity document; the PDF answers and is recorded", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    // Signed in first: the Organizer's own account then exists, and records the paper declaration below.
    await signIn(page, "Dev Moderator");
    const seeded = await seed(tag);

    await test.step("from the desk, the row of «Ziua cursei» holds «Declarații» last, and leads there", async () => {
      await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}`);
      await hydrated(page);
      const tabs = page.getByTestId("race-day-tabs");
      await expect(tabs.getByRole("link")).toHaveText([/Prezența/, /Clasament/, /Cronometrare|Sosiri/, /Lucruri/, /Jurnal/, /Declarații/], { useInnerText: true });
      const declarations = tabs.getByRole("link", { name: "Declarații" });
      await declarations.click();
      await expect(page).toHaveURL(new RegExp(`/ro/admin/checkin/declaratii\\?eventId=${seeded.eventId}$`), { timeout: 30_000 });
      await hydrated(page);
      await expect(tabs.locator('[aria-current="page"]')).toHaveText("Declarații");
      await tall(tabs.getByRole("link", { name: "Declarații" }), "the «Declarații» tab");
      // The last of six is past a phone's edge: the row brings it wholly into view (`SubNavCurrent`, §731), scrolling inside itself.
      await expect
        .poll(async () =>
          tabs.locator("nav").evaluate((nav) => {
            const entry = nav.querySelector('[aria-current="page"]');
            if (!entry) return "no current entry";
            const bar = nav.getBoundingClientRect();
            const box = entry.getBoundingClientRect();
            return box.left >= bar.left - 1 && box.right <= bar.right + 1 ? "in view" : `${Math.round(box.left - bar.left)}–${Math.round(box.right - bar.left)} px of a ${Math.round(bar.width)} px row`;
          }),
        )
        .toBe("in view");
      await noHorizontalScroll(page);
    });

    await test.step("the page: the count, the confirmed fold open, each row's number, signature, version, paper line and fingerprint", async () => {
      await expect(page.getByTestId("race-day-declarations-title")).toHaveText("Declarațiile semnate");
      await expect(page.getByTestId("race-day-declarations-count")).toHaveText("2 declarații semnate");
      const confirmed = page.getByTestId("race-day-declarations-section-confirmed");
      await expect(confirmed).toHaveAttribute("open", "");
      await expect(confirmed.locator("summary")).toContainText("Confirmați (2)");
      const rows = confirmed.getByTestId("race-day-declaration");
      await expect(rows).toHaveCount(2);
      // By race number, lowest first.
      await expect(rows.getByTestId("race-day-declaration-number")).toHaveText(["7", "8"]);
      const ana = rows.filter({ hasText: seeded.anaName });
      await expect(ana.getByTestId("race-day-declaration-hand")).toHaveText(seeded.anaName);
      await expect(ana.getByTestId("race-day-declaration-facts")).toContainText(/versiunea \d+/);
      await expect(ana.getByTestId("declaration-text-hash")).toHaveText(/^Amprenta: [0-9a-f]{12}…$/);
      await expect(ana.getByTestId("race-day-declaration-paper")).toHaveCount(0);
      const ion = rows.filter({ hasText: seeded.ionName });
      await expect(ion.getByTestId("race-day-declaration-paper")).toHaveText(/pe hârtie, înregistrată de Dev Moderator/);
      // The identity document Ana typed is nowhere on the page — not in its words, not in its markup.
      await expect(page.locator("body")).not.toContainText(ID_DOCUMENT);
      expect(await page.content()).not.toContain(ID_DOCUMENT);
      await noHorizontalScroll(page);
    });

    await test.step("«Declarația (PDF)» answers 200 with a PDF, and the download is on the registration's trail", async () => {
      const ana = page.getByTestId("race-day-declaration").filter({ hasText: seeded.anaName });
      const pdfLink = ana.getByTestId("race-day-declaration-pdf");
      await expect(pdfLink).toHaveText(/Declarația \(PDF\)/);
      await tall(pdfLink, "«Declarația (PDF)»");
      await tall(ana.getByTestId("race-day-declaration-registration"), "«Pagina înscrierii»");
      const href = await pdfLink.getAttribute("href");
      expect(href).toBe(`/api/admin/registrations/${seeded.ana}/declaration`);
      const response = await page.request.get(href ?? "");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      const trail = await query<{ count: string }>(`SELECT count(*) FROM audit_logs WHERE entity_id = $1 AND action = 'registration.declaration_downloaded'`, [seeded.ana]);
      expect(Number(trail[0].count)).toBe(1);
      // «Pagina înscrierii» is the registration's own page.
      await expect(ana.getByTestId("race-day-declaration-registration")).toHaveAttribute("href", `/ro/admin/registrations/${seeded.ana}`);
    });

    await test.step("the search: a race number finds its runner, the fold open", async () => {
      const form = page.getByTestId("race-day-declarations-filters");
      await form.getByLabel("Nume sau număr").fill("8");
      await form.getByRole("button", { name: "Caută" }).click();
      await expect(page).toHaveURL(/[?&]q=8(&|$)/, { timeout: 30_000 });
      const rows = page.getByTestId("race-day-declaration");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(seeded.ionName);
      // The count is the race's, whatever the search.
      await expect(page.getByTestId("race-day-declarations-count")).toHaveText("2 declarații semnate");
    });
  });

  test("the desk Volunteer is drawn no «Declarații», and its address is the 404 of an unknown page", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-vol`;
    await signIn(page, "Dev Moderator");
    const seeded = await seed(tag);
    await signOut(page);
    await signIn(page, "Dev Contributor");
    await page.goto(`/ro/admin/checkin?eventId=${seeded.eventId}`);
    await hydrated(page);
    const tabs = page.getByTestId("race-day-tabs");
    await expect(tabs.getByRole("link", { name: "Prezența" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Declarații" })).toHaveCount(0);
    expect((await page.goto(`/ro/admin/checkin/declaratii?eventId=${seeded.eventId}`))?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText(seeded.anaName);
  });
});
