import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §998, BR-REQ-050-02, BR-REQ-060-01 — «Contract semnat» (the owner, 2026-11-19: «trebuie pentru fiecare voluntar să pot atașa
 * „contract semnat”»), walked as the Organizer at 320 pixels and on a desktop, against the production build.
 *
 * What only a browser can see: the volunteer's card takes a file from the file box (44 pixels, like its press) and, once it is
 * attached, draws its name in place of «Niciun contract semnat atașat.»; the «Voluntari» list then has the chip on the person's
 * row and «Contracte semnate: 1 din 2» on its strip; «Descarcă» hands the very bytes back as an attachment under the file's
 * name; «Înlocuiește» takes a scan larger than one request carries, in pieces each under the host's 4.5 MB, and gives the same
 * bytes back; and «Încarcă contractele semnate» attaches a whole folder at once by the names — the matched one attached, the
 * other listed with its reason, in the page, and a file refused by its bytes leaving its person's next file its turn; pressed with
 * no file chosen, it says so in the plural. No horizontal scroll at any width. With scripts off the volunteer's card is walked; the
 * «Voluntari» list streams behind its loading skeleton, which a script reveals, so its plain form's refusal of an empty press is
 * the route's integration test (`signed-contract-routes.test.ts`).
 *
 * The race and its two volunteers are written straight into the database — the setup, not the subject — one set per project and
 * test, so the two projects never share a row, and removed after. Never a real person: every name and file is made up.
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

type Seeded = { eventId: string; anais: string; ion: string };

/** A race a week away taking volunteers, one role, and two confirmed volunteers the club typed by hand. */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, accepts_volunteers) VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 10, 'Parcul Tractorul', true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `contract-${tag}`,
      `Crosul contractelor ${tag}`,
      `contracts-${tag}`,
      `The agreements race ${tag}`,
    ]);
    const { rows: roles } = await client.query<{ id: string }>(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ($1, 'Punct de apă', 'Water point', 5, 0) RETURNING id`, [eventId]);
    const volunteer = async (name: string) => {
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO event_volunteers (event_id, role_id, name, state, source) VALUES ($1, $2, $3, 'CONFIRMED', 'STAFF') RETURNING id`,
        [eventId, roles[0].id, name],
      );
      await client.query(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ($1, $2)`, [inserted[0].id, roles[0].id]);
      return inserted[0].id;
    };
    return { eventId, anais: await volunteer(`Anaïs Meyson ${tag}`), ion: await volunteer(`Ion Mușat ${tag}`) };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    // The volunteers, their signed agreements, the roles and the translations go with the event (ON DELETE CASCADE).
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.eventId]);
  });
}

const contractsOf = (eventId: string) =>
  withDatabase(async (client) => (await client.query<{ name: string; file_name: string }>("SELECT v.name, d.file_name FROM event_volunteer_documents d JOIN event_volunteers v ON v.id = d.volunteer_id WHERE v.event_id = $1 ORDER BY v.name", [eventId])).rows);

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

/** A made-up signed agreement: a small PDF, nobody's signature. */
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
/** A made-up Word file: the ZIP entries a DOCX is read by. */
const zipEntry = (name: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(22), Buffer.from([name.length, 0, 0, 0]), Buffer.from(name, "latin1")]);
const DOCX = Buffer.concat([zipEntry("[Content_Types].xml"), zipEntry("word/document.xml"), Buffer.from("<w:document/>", "latin1")]);
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** A made-up program, whatever its name says: none of the formats by its bytes. */
const PROGRAM = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(58), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(64), Buffer.from("PE\0\0", "latin1")]);

test.describe("§998 «Contract semnat» — attached on the volunteer's page, seen on the list, downloaded, and a folder at once", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the Organizer attaches a signed agreement, sees it on the list, downloads it, and uploads the others by name", async ({ page }) => {
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    const fileName = "Contract-voluntariat-Anais-Meyson.pdf";
    try {
      await signIn(page, "Dev Moderator");

      // ---- The volunteer's card: none yet, the file box and «Încarcă», 44 pixels each ------------------------------------------
      await page.goto(`/ro/admin/volunteers/${seeded.anais}`);
      await hydrated(page);
      const card = page.getByTestId("volunteer-contract-card");
      await expect(card.getByTestId("volunteer-contract-none")).toHaveText("Niciun contract semnat atașat.");
      const box = card.getByTestId("volunteer-contract-upload-input");
      const press = card.getByTestId("volunteer-contract-upload-submit");
      expect((await box.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((await press.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await fitsTheScreen(page);
      await box.setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: PDF });
      await press.click();

      // ---- Attached: the card draws its name, length, when and by whom; «Descarcă» stands --------------------------------------
      await expect(card.getByTestId("volunteer-contract-file")).toHaveText(fileName, { timeout: 30_000 });
      await expect(card.getByTestId("volunteer-contract-facts")).toContainText("Dev Moderator");
      expect(await contractsOf(seeded.eventId)).toEqual([{ name: `Anaïs Meyson ${tag}`, file_name: fileName }]);
      const download = card.getByTestId("volunteer-contract-download");
      expect((await download.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await fitsTheScreen(page);

      // ---- «Descarcă»: the very bytes, an attachment under the file's name -----------------------------------------------------
      const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
      expect(file.suggestedFilename()).toBe(fileName);
      const saved = await file.path();
      expect(Buffer.compare(readFileSync(saved), PDF)).toBe(0);

      // ---- «Înlocuiește» with a scan larger than one request carries: it goes up in pieces, each under the host's 4.5 MB --------
      const scanName = "Contract-voluntariat-Anais-Meyson-scan.pdf";
      const scan = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024, 0x20)]);
      const pieces: number[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith(`/volunteers/${seeded.anais}/signed-contract`)) pieces.push(request.postDataBuffer()?.length ?? 0);
      });
      await card.getByTestId("volunteer-contract-upload-input").setInputFiles({ name: scanName, mimeType: "application/pdf", buffer: scan });
      await card.getByTestId("volunteer-contract-upload-submit").click();
      await expect(card.getByTestId("volunteer-contract-file")).toHaveText(scanName, { timeout: 60_000 });
      expect(pieces.length).toBeGreaterThanOrEqual(2);
      for (const length of pieces) expect(length).toBeLessThan(4.5 * 1000 * 1000);
      const [whole] = await Promise.all([page.waitForEvent("download"), card.getByTestId("volunteer-contract-download").click()]);
      expect(whole.suggestedFilename()).toBe(scanName);
      expect(Buffer.compare(readFileSync(await whole.path()), scan)).toBe(0);

      // ---- The list: the chip on the person's row, «Contracte semnate: 1 din 2» on the strip -----------------------------------
      await page.goto(`/ro/admin/volunteers?eventId=${seeded.eventId}`);
      await hydrated(page);
      const strip = page.getByTestId("volunteers-summary");
      await expect(strip.getByRole("link", { name: "Contracte semnate: 1 din 2" })).toBeVisible();
      await expect(page.locator('#main [data-testid="volunteer-contract-chip"]:visible')).toHaveCount(1);
      await fitsTheScreen(page);

      // ---- «Încarcă contractele semnate»: Ion's file by his name, a stranger's left with its reason -----------------------------
      // The file names are ASCII, as the owner's are: «Mușat» is «Musat» there; the run's tag is part of each made-up name. Ion's
      // first file is a program named .pdf, refused by its bytes, so his second takes its turn instead of being «twice».
      const ionFile = `Contract-voluntariat-Ion-Musat-${tag}.docx`;
      const ionProgram = `Contract-voluntariat-Ion-Musat-${tag}.pdf`;
      const fold = page.locator("#volunteers-contracts");
      await openFold(fold);
      const bulkStatus = fold.getByTestId("volunteers-contracts-upload-status");
      // Pressed with nothing chosen: said in the plural, nothing sent.
      await fold.getByTestId("volunteers-contracts-upload-submit").click();
      await expect(bulkStatus).toHaveText("Alege întâi fișierele contractelor semnate, apoi încarcă-le.");
      await fold.getByTestId("volunteers-contracts-upload-input").setInputFiles([
        { name: ionProgram, mimeType: "application/pdf", buffer: PROGRAM },
        { name: ionFile, mimeType: DOCX_TYPE, buffer: DOCX },
        { name: "Contract-voluntariat-Maria-Nimeni.docx", mimeType: DOCX_TYPE, buffer: DOCX },
      ]);
      await fold.getByTestId("volunteers-contracts-upload-submit").click();
      await expect(bulkStatus).toContainText("Am atașat 1 contract semnat.", { timeout: 30_000 });
      const leftOver = fold.getByTestId("volunteers-contracts-upload-left");
      await expect(leftOver).toContainText("Contract-voluntariat-Maria-Nimeni.docx: niciun voluntar al evenimentului nu are acest nume");
      await expect(leftOver).toContainText(`${ionProgram}: nu e PDF, Word, JPEG, PNG sau HEIC`);
      await expect(leftOver.locator("li")).toHaveCount(2);
      // The page is drawn again under the island's lines: the strip counts both now.
      await expect(strip.getByRole("link", { name: "Contracte semnate: 2 din 2" })).toBeVisible({ timeout: 30_000 });
      expect((await contractsOf(seeded.eventId)).map((row) => row.file_name)).toEqual(["Contract-voluntariat-Anais-Meyson-scan.pdf", ionFile]);
      await fitsTheScreen(page);
      expect(hydrationWarnings, hydrationWarnings.join("\n")).toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });

  test.describe("with scripts off", () => {
    test.use({ javaScriptEnabled: false });

    test("the card's plain form attaches the file and comes back to the person's page with it", async ({ page }) => {
      const tag = `${test.info().project.name}-nojs-${Date.now().toString(36)}`;
      const seeded = await seed(tag);
      try {
        await page.goto("/ro/autentificare");
        await page.getByRole("button", { name: /Dev Moderator/ }).click();
        await expect(page).toHaveURL(/\/ro\/admin$/, { timeout: 30_000 });
        await page.goto(`/ro/admin/volunteers/${seeded.ion}`);
        const card = page.getByTestId("volunteer-contract-card");
        await card.getByTestId("volunteer-contract-upload-input").setInputFiles({ name: "Contract-voluntariat-Ion-Musat.pdf", mimeType: "application/pdf", buffer: PDF });
        await card.getByTestId("volunteer-contract-upload-submit").click();
        await expect(page).toHaveURL(new RegExp(`/ro/admin/volunteers/${seeded.ion}#contract-semnat$`), { timeout: 30_000 });
        await expect(page.getByTestId("volunteer-contract-file")).toHaveText("Contract-voluntariat-Ion-Musat.pdf");
        expect(await contractsOf(seeded.eventId)).toEqual([{ name: `Ion Mușat ${tag}`, file_name: "Contract-voluntariat-Ion-Musat.pdf" }]);
      } finally {
        await cleanup(seeded);
      }
    });
  });
});
