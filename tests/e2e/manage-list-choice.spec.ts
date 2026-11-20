import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { mintActionLink, mintProfileLink } from "./support/action-link";
import { hydrated } from "./support/featured-event";

/**
 * §NNN, BR-REQ-039-01, BR-REQ-041-01 — «Lista publică și clasamentul», the public-list choice in a block of its own (the owner,
 * 2026-11-20, of the manage page's list switch: «trebuie ca asta sa fie mai vizibila»), walked at 320 pixels and on a desktop
 * against the production build:
 *
 * - a confirmed runner who did not tick the list opens their manage link and finds the block above the fold, right under the QR:
 *   a heading, the state in bold — off the list, as the public list prints them, «Participant (nume ascuns)» — and one contained
 *   button at least 48 pixels tall, the full width of a phone;
 * - one press puts the name on («Am reținut alegerea ta.», the state now says the list and the results), a second takes it off,
 *   the same button in the same colour each way, the link read and never spent, and nothing ever scrolls sideways;
 * - «Înscrierile mele» draws the same block for the registration, and its press does the same.
 *
 * The race and the runner are written straight into the database — the setup, not the subject — one set per project and test,
 * and removed after. Never a real person.
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

type Seeded = { eventId: string; registrationId: string; participantId: string };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const deskCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/**
 * A published race a week away and one confirmed runner with a number and a desk code, OFF the public list, registered under the
 * privacy notice in force — the seed's sample from the template, which describes the results — so the name, once on the list,
 * is in the results too.
 */
async function seed(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const notice = await client.query<{ version: number }>(
      `SELECT version FROM legal_documents WHERE key = 'PRIVACY_NOTICE' AND is_approved AND withdrawn_at IS NULL AND effective_at <= now() ORDER BY version DESC LIMIT 1`,
    );
    if (!notice.rows[0]) throw new Error("no privacy notice in force: seed the database (yarn db:seed:legal)");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, location_name, editorial_status, published_at, bib_start_number)
       VALUES ('RACE', now() + interval '7 days', 'INTERNAL', 20, 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day', 1) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `lista-${tag}`,
      `Crosul listei ${tag}`,
      `list-${tag}`,
      `The list race ${tag}`,
    ]);
    const name = `Ana Lista ${tag}`;
    const email = `ana-lista-${tag}@test.invalid`;
    const { rows: participants } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows: registrations } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, first_name, last_name, privacy_notice_version,
         privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, confirmed_at, bib_number, checkin_code)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'Ana', $4, $5, now(), false, $5, true, now(), 7, $6) RETURNING id`,
      [eventId, participants[0].id, name, `Lista ${tag}`, notice.rows[0].version, deskCode()],
    );
    return { eventId, registrationId: registrations[0].id, participantId: participants[0].id };
  });
}

async function cleanup(seeded: Seeded): Promise<void> {
  await withDatabase(async (client) => {
    // The links go with the registration, the translations with the event (ON DELETE CASCADE).
    await client.query("DELETE FROM audit_logs WHERE entity_id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM registrations WHERE event_id = $1", [seeded.eventId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
    await client.query("DELETE FROM events WHERE id = $1", [seeded.eventId]);
  });
}

const listed = (registrationId: string) =>
  withDatabase(async (client) => !(await client.query<{ out: boolean }>("SELECT list_opt_out AS out FROM registrations WHERE id = $1", [registrationId])).rows[0].out);

const trail = (registrationId: string) =>
  withDatabase(
    async (client) =>
      (
        await client.query<{ metadata: { from: string; to: string; via: string } }>(
          `SELECT metadata_json AS metadata FROM audit_logs WHERE entity_id = $1 AND action = 'registration.list_consent_changed' ORDER BY created_at`,
          [registrationId],
        )
      ).rows.map((row) => row.metadata),
  );

const OFF = "Numele tău nu apare pe lista publică a participanților și nici în clasament: pe listă apari ca „Participant (nume ascuns)”.";
const ON = "Numele tău apare pe lista publică a participanților și în clasament.";
const OPT_IN = "Vreau să apar pe lista de participanți & rezultate";
const OPT_OUT = "Nu vreau să apar pe listă și în clasament";

async function fitsTheScreen(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

/**
 * Where the first screen ends, as production draws it: at the sticky footer's top (it sits over the page's bottom edge), and
 * without the environment's own banner (`EnvironmentNotice`), which a test or QA server draws above everything and production
 * never does — so its height is given back.
 */
async function firstScreenEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const banner = document.querySelector('aside[aria-label="Anunț despre această versiune a site-ului"]');
    const footer = document.querySelector("footer");
    const end = footer ? Math.min(window.innerHeight, footer.getBoundingClientRect().top) : window.innerHeight;
    return end + (banner ? banner.getBoundingClientRect().height : 0);
  });
}

/**
 * The block's one button, whichever answer it gives: a thumb's target and then some (48 pixels at least), the full width of a
 * phone, contained in the primary colour — and the classes that draw it, so the two states can be held to the same look.
 */
async function prominent(block: Locator, name: string): Promise<string> {
  const button = block.getByRole("button", { name });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const frame = await block.boundingBox();
  if (!box || !frame) throw new Error("the block or its button has no box");
  expect(box.height, `«${name}» is at least 48 pixels tall`).toBeGreaterThanOrEqual(48);
  if (test.info().project.name === "mobile") expect(box.width, `«${name}» takes the phone's width`).toBeGreaterThanOrEqual(frame.width - 40);
  const classes = await button.evaluate((element) => [...element.classList].filter((token) => token.startsWith("MuiButton")).sort().join(" "));
  expect(classes).toContain("MuiButton-contained");
  expect(classes).toContain("MuiButton-colorPrimary");
  return classes;
}

test.describe("§NNN the public-list choice stands out: its own block, under the QR, one button both ways", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a runner off the list finds the block under the QR above the fold, puts the name on and takes it off again", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const seeded = await seed(tag);
    try {
      const secret = await mintActionLink({ id: seeded.registrationId, participantId: seeded.participantId }, "MANAGE_REGISTRATION");
      await page.goto(`/ro/inregistrari/gestionare/${secret}`);
      await hydrated(page);

      const block = page.getByTestId("manage-list-choice");
      let offClasses = "";
      await test.step("on arrival: the block is in view, under the QR, tinted and framed, off the list in bold", async () => {
        // Above the fold: its heading is on the first screen production shows, without a scroll.
        const heading = await block.getByRole("heading", { name: "Lista publică și clasamentul" }).boundingBox();
        const qr = await page.getByTestId("qr-with-name").boundingBox();
        const frame = await block.boundingBox();
        if (!heading || !qr || !frame) throw new Error("the heading, the QR or the block has no box");
        const end = await firstScreenEnd(page);
        test.info().annotations.push({ type: "the block's heading ends", description: `${Math.round(heading.y + heading.height)} px; the first screen, as production draws it, ends at ${Math.round(end)} px` });
        expect(heading.y + heading.height, "the block's heading is on the first screen").toBeLessThanOrEqual(end);
        expect(frame.y, "the block is under the QR").toBeGreaterThan(qr.y + qr.height);
        const look = await block.evaluate((element) => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, border: style.borderTopWidth };
        });
        expect(look.background, "a tinted box").not.toBe("rgba(0, 0, 0, 0)");
        expect(look.border).toBe("1px");
        const state = block.getByTestId("manage-list-choice-state");
        await expect(state).toHaveText(OFF);
        expect(await state.evaluate((element) => Number(getComputedStyle(element).fontWeight))).toBeGreaterThanOrEqual(700);
        await expect(block).toHaveAttribute("data-listed", "false");
        offClasses = await prominent(block, OPT_IN);
        await fitsTheScreen(page);
        await page.screenshot({ path: test.info().outputPath("manage-arrival.png") });
        await block.scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath("manage-off-the-list.png") });
      });

      await test.step("one press puts the name on: «Am reținut alegerea ta.», the list and the results — the same button", async () => {
        await block.getByRole("button", { name: OPT_IN }).click();
        await expect(page.getByTestId("manage-list-choice-changed")).toHaveText("Am reținut alegerea ta.", { timeout: 30_000 });
        await expect(page).toHaveURL(/[?&]list=1/);
        await hydrated(page);
        await expect(block).toHaveAttribute("data-listed", "true");
        await expect(block.getByTestId("manage-list-choice-state")).toHaveText(ON);
        // No colour that shames either answer: the way out is drawn exactly as the way in.
        expect(await prominent(block, OPT_OUT)).toBe(offClasses);
        expect(await listed(seeded.registrationId)).toBe(true);
        await fitsTheScreen(page);
        await page.mouse.move(0, 0);
        await block.scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath("manage-on-the-list.png") });
      });

      await test.step("a second press takes it off, back where it started", async () => {
        await block.getByRole("button", { name: OPT_OUT }).click();
        await expect(block).toHaveAttribute("data-listed", "false", { timeout: 30_000 });
        await expect(page.getByTestId("manage-list-choice-changed")).toHaveText("Am reținut alegerea ta.");
        await expect(block.getByTestId("manage-list-choice-state")).toHaveText(OFF);
        expect(await prominent(block, OPT_IN)).toBe(offClasses);
        expect(await listed(seeded.registrationId)).toBe(false);
        await fitsTheScreen(page);
      });

      // The participant's own act, twice, through this door; the link was read and never spent, so cancel still works.
      expect(await trail(seeded.registrationId)).toEqual([
        { from: "NOT_LISTED", to: "LISTED", via: "MANAGE_LINK" },
        { from: "LISTED", to: "NOT_LISTED", via: "MANAGE_LINK" },
      ]);
      const spent = await withDatabase(
        async (client) =>
          (await client.query<{ used: Date | null }>("SELECT used_at AS used FROM email_action_tokens WHERE registration_id = $1 AND purpose = 'MANAGE_REGISTRATION' AND invalidated_at IS NULL", [seeded.registrationId])).rows,
      );
      expect(spent).toEqual([{ used: null }]);
    } finally {
      await cleanup(seeded);
    }
  });

  test("«Înscrierile mele» draws the same block for the registration, and its press does the same", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-mine`;
    const seeded = await seed(tag);
    try {
      const secret = await mintProfileLink(seeded.participantId);
      await page.goto(`/ro/inscrieri/ale-mele/${secret}`);
      await hydrated(page);
      const block = page.getByTestId("my-list-choice");
      await expect(block.getByRole("heading", { name: "Lista publică și clasamentul" })).toBeVisible();
      const qr = await page.getByTestId("qr-with-name").boundingBox();
      const frame = await block.boundingBox();
      if (!qr || !frame) throw new Error("the QR or the block has no box");
      expect(frame.y, "the block is under the QR").toBeGreaterThan(qr.y + qr.height);
      await expect(block.getByTestId("my-list-choice-state")).toHaveText(OFF);
      await expect(block).toContainText("Poți schimba oricând, de aici sau din pagina înscrierii.");
      const offClasses = await prominent(block, OPT_IN);
      await fitsTheScreen(page);
      await block.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath("mine-off-the-list.png") });

      await block.getByRole("button", { name: OPT_IN }).click();
      await expect(page.getByTestId("my-list-choice-changed")).toHaveText("Am reținut alegerea ta.", { timeout: 30_000 });
      await hydrated(page);
      await expect(block.getByTestId("my-list-choice-state")).toHaveText(ON);
      expect(await prominent(block, OPT_OUT)).toBe(offClasses);
      expect(await listed(seeded.registrationId)).toBe(true);
      await fitsTheScreen(page);

      await block.getByRole("button", { name: OPT_OUT }).click();
      await expect(block).toHaveAttribute("data-listed", "false", { timeout: 30_000 });
      await expect(block.getByTestId("my-list-choice-state")).toHaveText(OFF);
      expect(await listed(seeded.registrationId)).toBe(false);
      expect(await trail(seeded.registrationId)).toEqual([
        { from: "NOT_LISTED", to: "LISTED", via: "MY_REGISTRATIONS" },
        { from: "LISTED", to: "NOT_LISTED", via: "MY_REGISTRATIONS" },
      ]);
      await fitsTheScreen(page);
    } finally {
      await cleanup(seeded);
    }
  });
});
