import { existsSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { computeContentHash } from "../../src/modules/legal-documents/domain/content-hash";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-039-01, `DECISIONS.md` §396 (amending §32 and §143) — the public participant list says
 * where each registration stands, and lists the pending and the waiting too, only while the
 * privacy notice in force describes it (it names `{{participantListStates}}`).
 *
 * Both faces, on a phone and on a desktop, against the production build:
 *
 * - **with the marker** (the platform's template, which the local seed approves): three groups —
 *   the confirmed, "Înscris, în așteptarea confirmării", "Pe lista de așteptare" — on `/ro` and on
 *   `/en`, and nobody cancelled, unconfirmed or unticked;
 * - **without it** (a notice version approved without the marker): the confirmed names alone, no
 *   words — exactly the list before §396 — and `/admin/legal` says what is missing.
 *
 * The notice is the club's text, so the switch is flipped the way the club flips it: a version
 * approved in `/admin/legal`, which expires the public pages' cached copy of the notice (§333). The
 * draft is written straight to the table — the setup, not the subject — and approved through the
 * page. The spec ends by approving the marker-carrying text again, so the database is left with a
 * notice that describes the states, whatever it found. **It is not a clean round trip:** every run
 * leaves two more approved PRIVACY_NOTICE versions behind (an approved version is never removed,
 * §46), so run it on a local or worktree database only; and it needs one seeded from the current
 * templates (a notice that has carried the marker) — on an older one it stops at the start and asks
 * for a reset.
 *
 * The notice is one row for the whole database, so the two projects must not flip it at once: a
 * PostgreSQL advisory lock, held for the test, makes the second wait for the first.
 *
 * The same notice carries `{{participantListSocials}}` (§500), so the same two faces prove the
 * socials beside a name: with both markers, a runner who ticked «Arată și Strava și Instagram»
 * carries the networks' marks — 44-pixel links, `nofollow ugc`, a new tab, on the name's line and
 * nothing wider than 320 pixels — and the form offers the tick under «Vreau să apar» once a social
 * is typed, never to a minor; without them, no link to Strava or Instagram anywhere on the list and
 * no tick on the form. Asserted here rather than in `registration-form.spec.ts` because the tick
 * exists only on an event with a list and under a notice that names the marker — this spec seeds
 * the one and holds the lock on the other; a form spec reading the notice while this one flips it
 * would flake.
 *
 * The notice the local seed approves from the current template also names
 * `{{participantListNumbers}}` (§613), which puts a «BIB» column on the list — but only when a listed
 * confirmed runner wears a race number. The runners seeded here are written straight to the table
 * with none, so the table must stay the three columns it was: one step says so, on both projects.
 * The column itself is proven by `tests/integration/registrations/start-list-numbers.test.ts`.
 */

const LOCK_KEY = 390_039_001;
const MARKER = "{{participantListStates}}";
/** The socials beside a name (§500): the platform's template carries it beside the states' marker. */
const SOCIALS_MARKER = "{{participantListSocials}}";
/** The race number beside a confirmed name (§613): the template carries it beside the other two. */
const NUMBERS_MARKER = "{{participantListNumbers}}";
const LINK_REL = "noopener noreferrer nofollow ugc";

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

type Translation = { locale: "ro" | "en"; title: string; body: unknown };

/** The privacy notice in force, both languages — the same three conditions the site reads it by. */
async function noticeInForce(client: pg.Client): Promise<{ version: number; translations: Translation[] }> {
  const { rows } = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM legal_documents
      WHERE key = 'PRIVACY_NOTICE' AND is_approved AND withdrawn_at IS NULL AND effective_at <= now()
      ORDER BY version DESC LIMIT 1`,
  );
  if (!rows[0]) throw new Error("no privacy notice in force: reset the database (yarn db:reset:local)");
  const { rows: translations } = await client.query<Translation>(
    "SELECT locale, title, body_json AS body FROM legal_document_translations WHERE legal_document_id = $1 ORDER BY locale",
    [rows[0].id],
  );
  return { version: rows[0].version, translations };
}

/** A draft of the next privacy-notice version, written to the table; returns its id. */
async function insertDraft(client: pg.Client, translations: Translation[]): Promise<string> {
  const { rows: last } = await client.query<{ version: number }>(
    "SELECT coalesce(max(version), 0) AS version FROM legal_documents WHERE key = 'PRIVACY_NOTICE'",
  );
  // A deleted version's number is retired (§151): the next one is above both.
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
    await client.query(
      "INSERT INTO legal_document_translations (legal_document_id, locale, title, body_json) VALUES ($1, $2, $3, $4)",
      [rows[0].id, translation.locale, translation.title, JSON.stringify(translation.body)],
    );
  }
  return rows[0].id;
}

/** Approve a draft the way the club does, which also expires the public pages' copy (§333). */
async function approve(page: Page, id: string): Promise<void> {
  await page.goto(`/ro/admin/legal/${id}`);
  // A tick that lands mid-hydration is lost (§420, the audit's flake): wait, as every other backoffice click does.
  await hydrated(page);
  const form = page.getByTestId("approve-version-form");
  await form.getByRole("checkbox").check();
  await expect(form.getByRole("checkbox")).toBeChecked();
  await form.getByRole("button", { name: "Aprobă și publică" }).click();
  await confirmDialog(page);
  await expect(page).toHaveURL(/\/admin\/legal/);
  await expect.poll(async () => withDatabase(async (client) => (await client.query("SELECT is_approved FROM legal_documents WHERE id = $1", [id])).rows[0]?.is_approved)).toBe(true);
}

type Seeded = { eventId: string; slug: string };

/**
 * A published race with its list switched on and somebody in every state. Names carry the
 * project's tag, so the two projects' events never share a word.
 */
async function seedEvent(tag: string, waitlistPublic = true): Promise<Seeded> {
  return withDatabase(async (client) => {
    const slug = `stari-${tag}`;
    const { rows } = await client.query<{ id: string }>(
      // «Lista de așteptare e publică» (§NNN): the waiting group below is on the list only with it on.
      `INSERT INTO events (type, starts_at, registration_mode, capacity, editorial_status, published_at, location_name, participant_list_visibility, waitlist_public)
       VALUES ('RACE', now() + interval '60 days', 'INTERNAL', 3, 'PUBLISHED', now() - interval '1 day', 'Parcul Tractorul', 'NAMES', $1)
       RETURNING id`,
      [waitlistPublic],
    );
    const eventId = rows[0].id;
    for (const locale of ["ro", "en"]) {
      await client.query("INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, $2, $3, $4, 'x')", [
        eventId,
        locale,
        `${slug}-${locale}`,
        `Stări ${tag}`,
      ]);
    }
    /*
      The socials (§500): Ana ticked «Arată și Strava și Instagram» and gave both; Carmen, pending,
      ticked it with Instagram alone; Bogdan gave both and did not tick it, and the hidden runner
      gave both and ticked it — neither may ever print a link.
    */
    type Socials = { strava: string | null; instagram: string | null; shown: boolean };
    const noSocials: Socials = { strava: null, instagram: null, shown: false };
    const people: Array<{ name: string; status: string; ticked: boolean; minutes: number; socials?: Socials }> = [
      {
        name: "Ana Confirmata",
        status: "CONFIRMED",
        ticked: true,
        minutes: 1,
        socials: { strava: "https://www.strava.com/athletes/39001", instagram: "ana.confirmata", shown: true },
      },
      {
        name: "Bogdan Confirmat",
        status: "CONFIRMED",
        ticked: true,
        minutes: 2,
        socials: { strava: "https://www.strava.com/athletes/39002", instagram: "bogdan.confirmat", shown: false },
      },
      {
        name: "Ascuns Confirmat",
        status: "CONFIRMED",
        ticked: false,
        minutes: 3,
        socials: { strava: "https://www.strava.com/athletes/39003", instagram: "ascuns.confirmat", shown: true },
      },
      {
        name: "Carmen Semneaza",
        status: "PENDING_DECLARATION",
        ticked: true,
        minutes: 4,
        socials: { strava: null, instagram: "carmen.semneaza", shown: true },
      },
      { name: "Elena Asteapta", status: "WAITLISTED", ticked: true, minutes: 6 },
      { name: "Florin Asteapta", status: "WAITLISTED", ticked: true, minutes: 5 },
      { name: "Ascuns Asteapta", status: "WAITLISTED", ticked: false, minutes: 7 },
      { name: "Retras Anulat", status: "CANCELLED", ticked: true, minutes: 8 },
      { name: "Adresa Nedovedita", status: "PENDING_EMAIL_CONFIRMATION", ticked: true, minutes: 9 },
    ];
    for (const [index, person] of people.entries()) {
      const email = `ls-${tag}-${index}@test.invalid`;
      const { rows: participant } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, person.name],
      );
      const moment = `now() - interval '${60 - person.minutes} minutes'`;
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
           email_confirmed_at, confirmed_at, waitlisted_at, strava_url, instagram_handle, list_socials)
         VALUES ($1, $2, $3::registration_status, 'ro', $4, $4,
           -- The newest approved notice, as a registration made now records (§421: the pending and
           -- waiting rows list only ticks given under a notice that described the states).
           (SELECT coalesce(max(version), 1) FROM legal_documents WHERE key = 'PRIVACY_NOTICE' AND is_approved AND withdrawn_at IS NULL),
           now(), false, 1, $5,
           CASE WHEN $3::text <> 'PENDING_EMAIL_CONFIRMATION' THEN ${moment} END,
           CASE WHEN $3::text = 'CONFIRMED' THEN ${moment} END,
           CASE WHEN $3::text = 'WAITLISTED' THEN ${moment} END,
           $6, $7, $8)`,
        [
          eventId,
          participant[0].id,
          person.status,
          `${person.name} ${tag}`,
          !person.ticked,
          (person.socials ?? noSocials).strava,
          (person.socials ?? noSocials).instagram,
          (person.socials ?? noSocials).shown,
        ],
      );
    }
    return { eventId, slug };
  });
}

async function removeEvent(id: string): Promise<void> {
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ participant_id: string }>("DELETE FROM registrations WHERE event_id = $1 RETURNING participant_id", [id]);
    await client.query("DELETE FROM participants WHERE id = ANY($1::uuid[])", [rows.map((row) => row.participant_id)]);
    await client.query("DELETE FROM event_translations WHERE event_id = $1", [id]);
    await client.query("DELETE FROM events WHERE id = $1", [id]);
  });
}

/** The list opened, and its rows' names and state words in the order they are printed. */
async function readList(page: Page, address: string, tag: string) {
  await page.goto(address);
  const list = page.getByTestId("start-list");
  await list.locator("summary").click();
  await expect(list.locator("table")).toBeVisible();
  const rows = list.locator("tbody tr");
  const names = (await rows.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  const states = await list.getByTestId("start-list-state").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-state")));
  // Nothing wider than the phone, with the longest state word under a name.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wide = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .slice(0, 8)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)} ${el.getAttribute("data-testid")} ${Math.round(el.getBoundingClientRect().right)}`);
  });
  expect(overflow, wide.join("\n")).toBeLessThanOrEqual(0);
  return { list, names: names.map((row) => row.replace(` ${tag}`, "")), states };
}


/**
 * The list's links to Strava and Instagram, wherever they are drawn — the socials' own marks and
 * anything else that would point there.
 */
function socialLinks(list: Locator): Locator {
  return list.locator('a[href*="strava.com"], a[href*="strava.app.link"], a[href*="instagram.com"]');
}

/** A notice's text carries both markers, the states' and the socials'. */
function carriesBothMarkers(translations: Translation[]): boolean {
  const text = JSON.stringify(translations);
  return text.includes(MARKER) && text.includes(SOCIALS_MARKER);
}

/** Signed in as the Superadministrator, whether or not this page already was. */
async function asSuperadmin(page: Page): Promise<void> {
  await page.goto("/ro/admin/legal");
  if (!/\/admin\/legal$/.test(new URL(page.url()).pathname)) await signIn(page, "Dev Superadministrator");
}

/**
 * The notice in force carries both markers again: the newest approved text that carried them,
 * approved once more as the next version. Nothing to do when it already does.
 */
async function restoreMarker(page: Page): Promise<void> {
  const current = await withDatabase(noticeInForce);
  if (carriesBothMarkers(current.translations)) return;
  const draft = await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT d.id FROM legal_documents d
        WHERE d.key = 'PRIVACY_NOTICE' AND d.is_approved
          AND EXISTS (SELECT 1 FROM legal_document_translations t WHERE t.legal_document_id = d.id AND t.body_json::text LIKE $1)
          AND EXISTS (SELECT 1 FROM legal_document_translations t WHERE t.legal_document_id = d.id AND t.body_json::text LIKE $2)
        ORDER BY d.version DESC LIMIT 1`,
      [`%${MARKER}%`, `%${SOCIALS_MARKER}%`],
    );
    if (!rows[0]) throw new Error("no approved notice ever carried both markers: reset the database from the current templates");
    const { rows: translations } = await client.query<Translation>(
      "SELECT locale, title, body_json AS body FROM legal_document_translations WHERE legal_document_id = $1 ORDER BY locale",
      [rows[0].id],
    );
    return insertDraft(client, translations);
  });
  await asSuperadmin(page);
  await approve(page, draft);
  await expect.poll(async () => carriesBothMarkers((await withDatabase(noticeInForce)).translations)).toBe(true);
}

test.describe("BR-REQ-039-01 the public list's states, behind the privacy notice (§396)", () => {
  // A click that cannot happen fails in seconds and names itself, rather than at the test's end.
  test.use({ actionTimeout: 20_000, navigationTimeout: 60_000 });

  test("three groups with their words while the notice describes them; confirmed names alone while it does not", async ({ page }) => {
    // Long, because the second project waits on the lock for the first.
    test.setTimeout(420_000);
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const lock = new pg.Client({ connectionString: databaseUrl() });
    await lock.connect();
    await lock.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    const event = await seedEvent(tag);
    // The same list with «Lista de așteptare e publică» left at its default, off (§NNN).
    const privateWaitlistTag = `${tag}-np`;
    const privateWaitlist = await seedEvent(privateWaitlistTag, false);
    try {
      await test.step("the notice in force carries both markers", async () => {
        await restoreMarker(page);
      });

      await test.step("with the marker: three groups with their words, in Romanian", async () => {
        const ro = await readList(page, `/ro/evenimente/${event.slug}-ro`, tag);
        expect(ro.states).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING", "WAITLISTED", "WAITLISTED"]);
        expect(ro.names).toEqual([
          expect.stringContaining("Ana Confirmata"),
          expect.stringContaining("Bogdan Confirmat"),
          expect.stringContaining("Participant (nume ascuns)"),
          expect.stringContaining("Carmen Semneaza"),
          expect.stringContaining("Florin Asteapta"),
          expect.stringContaining("Elena Asteapta"),
        ]);
        await expect(ro.list).toContainText("Înscris, în așteptarea confirmării");
        await expect(ro.list).toContainText("Pe lista de așteptare");
        await expect(ro.list).toContainText("Confirmat");
        await expect(ro.list.getByTestId("start-list-others-summary")).toHaveText(
          "Apar cu numele și: 1 înscris în așteptarea confirmării · 2 pe lista de așteptare",
        );
        for (const never of ["Ascuns", "Retras Anulat", "Adresa Nedovedita"]) await expect(ro.list).not.toContainText(never);
      });

      await test.step("with the marker: a legend says what each word means, and each word says it behind a «?» (§556)", async () => {
        const ro = await readList(page, `/ro/evenimente/${event.slug}-ro`, tag);
        const legend = ro.list.getByTestId("start-list-legend");
        await expect(legend).toContainText("Ce înseamnă stadiile de pe listă");
        const lines = legend.getByTestId("start-list-legend-line");
        expect(await lines.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-state")))).toEqual(["CONFIRMED", "PENDING", "WAITLISTED"]);
        // The seeded race is 60 days away, before its window opens, so the pending sentence says the window
        // (the column defaults: asked a week before, owed two days before); inside it, the club's hold (unit test).
        const pending = lines.filter({ hasText: "Înscris, în așteptarea confirmării" });
        await expect(pending).toContainText("la înscriere și cu o săptămână înainte");
        await expect(pending).toContainText("până cu 2 zile înainte de start");
        // One «?» per state word, its name the legend's own sentence.
        await expect(ro.list.getByTestId("start-list-state-help")).toHaveCount(6);
        const carmenHelp = ro.list.locator("tbody tr").filter({ hasText: "Carmen Semneaza" }).getByTestId("start-list-state-help");
        await expect(carmenHelp).toHaveAccessibleName((await pending.innerText()).trim());
      });

      await test.step("with the marker: the socials of the runners who ticked them, beside the name, and nobody else's (§500)", async () => {
        // `readList` holds the page to the phone's width with the marks drawn (no sideways scroll).
        const ro = await readList(page, `/ro/evenimente/${event.slug}-ro`, tag);
        // Ana's two and Carmen's one: never Bogdan's (not ticked), never the hidden runner's.
        await expect(ro.list.getByTestId("start-list-socials")).toHaveCount(2);
        await expect(socialLinks(ro.list)).toHaveCount(3);
        for (const never of ["39002", "39003", "bogdan.confirmat", "ascuns.confirmat"]) {
          await expect(ro.list.locator(`a[href*="${never}"]`)).toHaveCount(0);
        }
        const anaRow = ro.list.locator("tbody tr").filter({ hasText: "Ana Confirmata" });
        const ana = anaRow.locator('[data-testid="start-list-socials"] a');
        await expect(ana).toHaveCount(2);
        await expect(ana.nth(0)).toHaveAttribute("href", "https://www.strava.com/athletes/39001");
        await expect(ana.nth(1)).toHaveAttribute("href", "https://www.instagram.com/ana.confirmata/");
        await expect(ana.nth(0)).toHaveAccessibleName(`Ana Confirmata ${tag} pe Strava`);
        for (const link of await ana.all()) {
          await expect(link).toHaveAttribute("rel", LINK_REL);
          await expect(link).toHaveAttribute("target", "_blank");
          // A thumb's target (BR-REQ-041-01 criterion 6), rounded to a tenth of a pixel (§388's CI flake).
          const box = await link.boundingBox();
          expect(box, "a drawn link").not.toBeNull();
          expect(Math.round(box!.width * 10) / 10).toBeGreaterThanOrEqual(44);
          expect(Math.round(box!.height * 10) / 10).toBeGreaterThanOrEqual(44);
        }
        // On the name's own line: the marks' middle falls inside the line the name's words end on. Asserted from
        // `sm` up: a phone's cell is too narrow to promise a long name's last word plus two 44-px marks one line,
        // so there the marks may follow on the next line inside the cell (the 44-px targets above still hold).
        const onNameLine = await anaRow.locator("td").nth(1).evaluate((cell) => {
          const text = [...cell.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
          const marks = cell.querySelector('[data-testid="start-list-socials"]');
          if (!text || !marks) return false;
          const range = document.createRange();
          range.selectNodeContents(text);
          const lines = range.getClientRects();
          const line = lines[lines.length - 1];
          if (!line) return false;
          const box = marks.getBoundingClientRect();
          const middle = box.top + box.height / 2;
          return middle >= line.top && middle <= line.bottom;
        });
        if (test.info().project.name !== "mobile") expect(onNameLine).toBe(true);
        // A pending runner's, behind §396's gate: Instagram alone, as typed.
        const carmen = ro.list.locator("tbody tr").filter({ hasText: "Carmen Semneaza" }).locator('[data-testid="start-list-socials"] a');
        await expect(carmen).toHaveCount(1);
        await expect(carmen).toHaveAttribute("href", "https://www.instagram.com/carmen.semneaza/");
      });

      await test.step("with the marker: the same in English", async () => {
        const en = await readList(page, `/en/events/${event.slug}-en`, tag);
        expect(en.states).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING", "WAITLISTED", "WAITLISTED"]);
        await expect(en.list).toContainText("Registered, awaiting confirmation");
        await expect(en.list).toContainText("On the waiting list");
        await expect(en.list.getByTestId("start-list-legend")).toContainText("What the states on the list mean");
        await expect(en.list.getByTestId("start-list-legend-line").filter({ hasText: "Registered, awaiting confirmation" })).toContainText(
          "due by 2 days before the start",
        );
        await expect(en.list.getByTestId("start-list-others-summary")).toHaveText(
          "Also listed by name: 1 registered, awaiting confirmation · 2 on the waiting list",
        );
        for (const never of ["Ascuns", "Retras Anulat", "Adresa Nedovedita"]) await expect(en.list).not.toContainText(never);
        await expect(socialLinks(en.list)).toHaveCount(3);
        await expect(
          en.list.locator("tbody tr").filter({ hasText: "Ana Confirmata" }).locator('[data-testid="start-list-socials"] a').first(),
        ).toHaveAccessibleName(`Ana Confirmata ${tag} on Strava`);
      });

      await test.step("with the marker but the waiting list private (the default): the pending still listed, no waiting row, count, legend line or word (§NNN)", async () => {
        const ro = await readList(page, `/ro/evenimente/${privateWaitlist.slug}-ro`, privateWaitlistTag);
        expect(ro.states).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING"]);
        await expect(ro.list).toContainText("Carmen Semneaza");
        await expect(ro.list).toContainText("Înscris, în așteptarea confirmării");
        await expect(ro.list).not.toContainText("Pe lista de așteptare");
        for (const never of ["Florin", "Elena"]) await expect(ro.list).not.toContainText(never);
        await expect(ro.list.getByTestId("start-list-others-summary")).toHaveText("Apar cu numele și: 1 înscris în așteptarea confirmării");
        const lines = ro.list.getByTestId("start-list-legend-line");
        expect(await lines.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-state")))).toEqual(["CONFIRMED", "PENDING"]);
        const en = await readList(page, `/en/events/${privateWaitlist.slug}-en`, privateWaitlistTag);
        expect(en.states).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING"]);
        await expect(en.list).not.toContainText("On the waiting list");
        await expect(en.list.getByTestId("start-list-others-summary")).toHaveText("Also listed by name: 1 registered, awaiting confirmation");
        // The form's caption names no waiting-list stage either.
        await page.goto(`/ro/evenimente/${privateWaitlist.slug}-ro/inscriere`);
        await expect(page.getByTestId("list-opt-in-states")).toContainText("„Înscris, în așteptarea confirmării”");
        await expect(page.getByTestId("list-opt-in-states")).not.toContainText("„Pe lista de așteptare”");
        await expect(page.getByTestId("list-opt-in-states")).toContainText("nu apari pe lista publică");
      });

      await test.step("nobody listed wears a race number: no «BIB» column, whatever the notice names (§613)", async () => {
        const ro = await readList(page, `/ro/evenimente/${event.slug}-ro`, tag);
        await expect(ro.list.getByRole("columnheader")).toHaveText(["#", "Nume", "Club"]);
        await expect(ro.list.locator('[data-col="number"]')).toHaveCount(0);
        const en = await readList(page, `/en/events/${event.slug}-en`, tag);
        await expect(en.list.getByRole("columnheader")).toHaveText(["#", "Name", "Club"]);
      });

      await test.step("the form's «Vreau să apar» says what the list will show beside the name", async () => {
        await page.goto(`/ro/evenimente/${event.slug}-ro/inscriere`);
        // The tick names the list and the results as one disclosure (§570).
        await expect(page.getByLabel("Vreau să apar pe lista de participanți & rezultate — opțional")).toHaveCount(1);
        await expect(page.getByTestId("list-opt-in-states")).toContainText("„Pe lista de așteptare”");
      });

      await test.step("the form offers the socials tick under «Vreau să apar» once a social is typed, never to a minor (§500)", async () => {
        await page.goto(`/ro/evenimente/${event.slug}-ro/inscriere`);
        await hydrated(page);
        const listSocials = page.locator('[name="listSocials"]');
        // In the markup, after the list's own box — asked under it, never folded.
        await expect(listSocials).toHaveCount(1);
        expect(
          await page
            .locator('[name="listOptIn"]')
            .evaluate((optIn) => !!(optIn.compareDocumentPosition(document.querySelector('[name="listSocials"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)),
        ).toBe(true);
        // Nothing typed in the socials fold: nothing to show, so nothing asked.
        await expect(listSocials).toBeHidden();
        await expect(listSocials).toBeDisabled();
        await page.getByText("Rețele sociale — opțional").click();
        await page.locator('[name="instagramHandle"]').fill("ana.confirmata");
        await expect(listSocials).toBeVisible();
        await expect(listSocials).toBeEnabled();
        await expect(listSocials).not.toBeChecked();
        // A birth date of somebody sixteen today: a minor, whose socials are never kept (§323).
        const sixteen = new Date();
        sixteen.setUTCFullYear(sixteen.getUTCFullYear() - 16);
        await page.locator('[name="birthDate"]').fill(sixteen.toISOString().slice(0, 10));
        await expect(listSocials).toBeHidden();
        await expect(listSocials).toBeDisabled();
        // An adult again: offered again.
        await page.locator('[name="birthDate"]').fill("1990-05-17");
        await expect(listSocials).toBeVisible();
        await expect(listSocials).toBeEnabled();
      });

      await test.step("the notice reads the three words where the marker stands", async () => {
        await page.goto("/ro/confidentialitate");
        await expect(page.locator("#main")).toContainText("„Confirmat”, „Înscris, în așteptarea confirmării” sau „Pe lista de așteptare”");
        await expect(page.locator("#main")).not.toContainText(MARKER);
      });

      await test.step("a notice approved without the markers switches the states and the socials off", async () => {
        const current = await withDatabase(noticeInForce);
        const withoutMarker = current.translations.map((translation) => ({
          ...translation,
          // The race number's marker too (§613), so `/admin/legal` names all three missing.
          body: JSON.parse(
            JSON.stringify(translation.body).split(MARKER).join("").split(SOCIALS_MARKER).join("").split(NUMBERS_MARKER).join(""),
          ),
        }));
        await asSuperadmin(page);
        await approve(page, await withDatabase((client) => insertDraft(client, withoutMarker)));
        await page.goto("/ro/admin/legal");
        await expect(page.locator("#main").getByTestId("legal-list-states-missing")).toBeVisible();
        await expect(page.locator("#main").getByTestId("legal-list-socials-missing")).toBeVisible();
        await expect(page.locator("#main").getByTestId("legal-list-numbers-missing")).toBeVisible();
      });

      await test.step("without the marker: confirmed names alone, no words, in both languages", async () => {
        const off = await readList(page, `/ro/evenimente/${event.slug}-ro`, tag);
        expect(off.states).toEqual([]);
        expect(off.names).toEqual([
          expect.stringContaining("Ana Confirmata"),
          expect.stringContaining("Bogdan Confirmat"),
          expect.stringContaining("Participant (nume ascuns)"),
        ]);
        await expect(off.list).not.toContainText("Pe lista de așteptare");
        // No state words, so nothing to explain (§556).
        await expect(off.list.getByTestId("start-list-legend")).toHaveCount(0);
        await expect(off.list.getByTestId("start-list-state-help")).toHaveCount(0);
        for (const never of ["Carmen", "Florin", "Elena", "Retras", "Adresa"]) await expect(off.list).not.toContainText(never);
        // Ana's tick stands, but no notice in force describes it: no link to Strava or Instagram at all.
        await expect(off.list.getByTestId("start-list-socials")).toHaveCount(0);
        await expect(socialLinks(off.list)).toHaveCount(0);
        const offEn = await readList(page, `/en/events/${event.slug}-en`, tag);
        expect(offEn.states).toEqual([]);
        expect(offEn.names).toHaveLength(3);
        await expect(socialLinks(offEn.list)).toHaveCount(0);
        // …and the form's box reads as it always did.
        await page.goto(`/ro/evenimente/${event.slug}-ro/inscriere`);
        await expect(page.locator('input[name="listOptIn"]')).toHaveCount(1);
        await expect(page.getByTestId("list-opt-in-states")).toHaveCount(0);
        await expect(page.locator('[name="listSocials"]')).toHaveCount(0);
      });
    } finally {
      // Leave the database as it was found: a notice in force that describes the states and the socials.
      try {
        await restoreMarker(page);
      } finally {
        await removeEvent(event.eventId);
        await removeEvent(privateWaitlist.eventId);
        await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
        await lock.end();
      }
    }
  });
});
