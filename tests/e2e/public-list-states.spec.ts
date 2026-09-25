import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { computeContentHash } from "../../src/modules/legal-documents/domain/content-hash";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-039-01, `DECISIONS.md` §NNN (amending §32 and §143) — the public participant list says
 * where each registration stands, and lists the pending and the waiting too, only while the
 * privacy notice in force describes it (it names `{{participantListStates}}`).
 *
 * Both faces, on a phone and on a desktop, against the production build:
 *
 * - **with the marker** (the platform's template, which the local seed approves): three groups —
 *   the confirmed, "Înscris, în așteptarea confirmării", "Pe lista de așteptare" — on `/ro` and on
 *   `/en`, and nobody cancelled, unconfirmed or unticked;
 * - **without it** (a notice version approved without the marker): the confirmed names alone, no
 *   words — exactly the list before §NNN — and `/admin/legal` says what is missing.
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
 */

const LOCK_KEY = 390_039_001;
const MARKER = "{{participantListStates}}";

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
  const form = page.getByTestId("approve-version-form");
  await form.getByRole("checkbox").check();
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
async function seedEvent(tag: string): Promise<Seeded> {
  return withDatabase(async (client) => {
    const slug = `stari-${tag}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity, editorial_status, published_at, location_name, participant_list_visibility)
       VALUES ('RACE', now() + interval '60 days', 'INTERNAL', 3, 'PUBLISHED', now() - interval '1 day', 'Parcul Tractorul', 'NAMES')
       RETURNING id`,
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
    const people: Array<{ name: string; status: string; ticked: boolean; minutes: number }> = [
      { name: "Ana Confirmata", status: "CONFIRMED", ticked: true, minutes: 1 },
      { name: "Bogdan Confirmat", status: "CONFIRMED", ticked: true, minutes: 2 },
      { name: "Ascuns Confirmat", status: "CONFIRMED", ticked: false, minutes: 3 },
      { name: "Carmen Semneaza", status: "PENDING_DECLARATION", ticked: true, minutes: 4 },
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
           email_confirmed_at, confirmed_at, waitlisted_at)
         VALUES ($1, $2, $3::registration_status, 'ro', $4, $4, 1, now(), false, 1, $5,
           CASE WHEN $3::text <> 'PENDING_EMAIL_CONFIRMATION' THEN ${moment} END,
           CASE WHEN $3::text = 'CONFIRMED' THEN ${moment} END,
           CASE WHEN $3::text = 'WAITLISTED' THEN ${moment} END)`,
        [eventId, participant[0].id, person.status, `${person.name} ${tag}`, !person.ticked],
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


/** Signed in as the Superadministrator, whether or not this page already was. */
async function asSuperadmin(page: Page): Promise<void> {
  await page.goto("/ro/admin/legal");
  if (!/\/admin\/legal$/.test(new URL(page.url()).pathname)) await signIn(page, "Dev Superadministrator");
}

/**
 * The notice in force carries the marker again: the newest approved text that carried it,
 * approved once more as the next version. Nothing to do when it already does.
 */
async function restoreMarker(page: Page): Promise<void> {
  const current = await withDatabase(noticeInForce);
  if (JSON.stringify(current.translations).includes(MARKER)) return;
  const draft = await withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT d.id FROM legal_documents d
        WHERE d.key = 'PRIVACY_NOTICE' AND d.is_approved
          AND EXISTS (SELECT 1 FROM legal_document_translations t WHERE t.legal_document_id = d.id AND t.body_json::text LIKE $1)
        ORDER BY d.version DESC LIMIT 1`,
      [`%${MARKER}%`],
    );
    if (!rows[0]) throw new Error("no approved notice ever carried the marker: reset the database from the current templates");
    const { rows: translations } = await client.query<Translation>(
      "SELECT locale, title, body_json AS body FROM legal_document_translations WHERE legal_document_id = $1 ORDER BY locale",
      [rows[0].id],
    );
    return insertDraft(client, translations);
  });
  await asSuperadmin(page);
  await approve(page, draft);
  await expect.poll(async () => JSON.stringify((await withDatabase(noticeInForce)).translations).includes(MARKER)).toBe(true);
}

test.describe("BR-REQ-039-01 the public list's states, behind the privacy notice (§NNN)", () => {
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
    try {
      await test.step("the notice in force carries the marker", async () => {
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

      await test.step("with the marker: the same in English", async () => {
        const en = await readList(page, `/en/events/${event.slug}-en`, tag);
        expect(en.states).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING", "WAITLISTED", "WAITLISTED"]);
        await expect(en.list).toContainText("Registered, awaiting confirmation");
        await expect(en.list).toContainText("On the waiting list");
        await expect(en.list.getByTestId("start-list-others-summary")).toHaveText(
          "Also listed by name: 1 registered, awaiting confirmation · 2 on the waiting list",
        );
        for (const never of ["Ascuns", "Retras Anulat", "Adresa Nedovedita"]) await expect(en.list).not.toContainText(never);
      });

      await test.step("the form's «Vreau să apar» says what the list will show beside the name", async () => {
        await page.goto(`/ro/evenimente/${event.slug}-ro/inscriere`);
        await expect(page.getByTestId("list-opt-in-states")).toContainText("„Pe lista de așteptare”");
      });

      await test.step("the notice reads the three words where the marker stands", async () => {
        await page.goto("/ro/confidentialitate");
        await expect(page.locator("#main")).toContainText("„Confirmat”, „Înscris, în așteptarea confirmării” sau „Pe lista de așteptare”");
        await expect(page.locator("#main")).not.toContainText(MARKER);
      });

      await test.step("a notice approved without the marker switches the states off", async () => {
        const current = await withDatabase(noticeInForce);
        const withoutMarker = current.translations.map((translation) => ({
          ...translation,
          body: JSON.parse(JSON.stringify(translation.body).split(MARKER).join("")),
        }));
        await asSuperadmin(page);
        await approve(page, await withDatabase((client) => insertDraft(client, withoutMarker)));
        await page.goto("/ro/admin/legal");
        await expect(page.locator("#main").getByTestId("legal-list-states-missing")).toBeVisible();
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
        for (const never of ["Carmen", "Florin", "Elena", "Retras", "Adresa"]) await expect(off.list).not.toContainText(never);
        const offEn = await readList(page, `/en/events/${event.slug}-en`, tag);
        expect(offEn.states).toEqual([]);
        expect(offEn.names).toHaveLength(3);
        // …and the form's box reads as it always did.
        await page.goto(`/ro/evenimente/${event.slug}-ro/inscriere`);
        await expect(page.locator('input[name="listOptIn"]')).toHaveCount(1);
        await expect(page.getByTestId("list-opt-in-states")).toHaveCount(0);
      });
    } finally {
      // Leave the database as it was found: a notice in force that describes the states.
      try {
        await restoreMarker(page);
      } finally {
        await removeEvent(event.eventId);
        await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
        await lock.end();
      }
    }
  });
});
