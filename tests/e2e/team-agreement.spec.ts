import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { computeContentHash } from "../../src/modules/legal-documents/domain/content-hash";
import { teamAgreementEn, teamAgreementRo } from "../../src/modules/legal-documents/templates/team-agreement";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §1006, §NNN, BR-REQ-060-01, BR-REQ-053-01 — the team's undertaking at sign-in, end to end, on a production build and both
 * projects (the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în platformă»):
 *
 * 1. an Administrator finds the template under «Pornește de la șablon» and approves a version on `/admin/legal` — the draft is
 *    written here by SQL with the club's facts typed in, as `feedback.spec.ts` writes its notice, because the e2e server knows
 *    none of the four facts and the approval refuses a text that still holds a `<…>`;
 * 2. a «Voluntar» signing in lands on `/admin/acord`, cannot open the desk before accepting — a scanned number sends them back
 *    with the way kept —, accepts with a name and lands where they were going;
 * 3. «Echipa» says who accepted, which version, when and under which name;
 * 4. an Organizer is asked too; an Administrator never;
 * 5. **at every sign-in (§NNN)**, at 320 px in both projects: a «Voluntar» signs in through the development sign-in, lands on
 *    «Acord», accepts, reaches «Ziua cursei» and is not asked again in that session; signs out and in again and lands on «Acord»
 *    again — each acceptance kept with the sign-in it answers.
 *
 * **One gate on one database.** The seed never puts the undertaking in force (`NEVER_SEEDED_KEYS`), and every other spec signs in
 * below the Administrator: so this spec removes every version and acceptance of it before and after it runs, and its two
 * projects take turns on a PostgreSQL advisory lock. While a version is in force any other spec signing in as a volunteer, a
 * Redactor, an Organizer or a Tehnic would meet the undertaking — CI runs one worker per shard (§212); locally, run this file
 * on its own or with `--workers=1`.
 */

const GATE_LOCK = 9_420_220;
const FACTS: Record<string, string> = {
  "<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>": "Asociația Exemplu E2E",
  "<THE CLUB'S FULL LEGAL NAME>": "Asociația Exemplu E2E",
  "<ADRESA SEDIULUI>": "Strada Exemplu nr. 1",
  "<REGISTERED ADDRESS>": "Strada Exemplu nr. 1",
  "<NUMĂR DE ÎNREGISTRARE / CUI>": "CIF 00000000",
  "<REGISTRATION NUMBER>": "CIF 00000000",
  "<EMAIL DE CONTACT>": "contact@example.test",
  "<CONTACT EMAIL>": "contact@example.test",
};

async function connect(): Promise<pg.Client> {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** The two projects one after the other: a session-level advisory lock, released with its connection whatever happens. */
async function withGateLock<T>(work: () => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [GATE_LOCK]);
      if (rows[0].locked) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [GATE_LOCK]).catch(() => undefined);
    await client.end();
  }
}

/**
 * No version of the undertaking and no acceptance of one: the seeded database's own state, where nobody is asked. Both records of
 * acceptances first — §1006's, once per account, and §NNN's, one per sign-in — since both hold their version `RESTRICT`.
 */
async function removeUndertakings(client: pg.Client): Promise<void> {
  await client.query("DELETE FROM staff_team_agreement_acceptances");
  await client.query("DELETE FROM staff_team_agreement_sign_in_acceptances");
  await client.query("DELETE FROM legal_documents WHERE key = 'STAFF_DATA_AGREEMENT'");
  await client.query("DELETE FROM legal_document_numbering WHERE key = 'STAFF_DATA_AGREEMENT'");
}

/** A volunteer's acceptances at their sign-ins, oldest first: the name typed and the sign-in each answers. */
async function acceptancesOf(client: pg.Client, email: string): Promise<Array<{ typed_name: string; signed_in_at: Date | null }>> {
  const { rows } = await client.query<{ typed_name: string; signed_in_at: Date | null }>(
    `SELECT a.typed_name, a.signed_in_at FROM staff_team_agreement_sign_in_acceptances a JOIN staff_users s ON s.id = a.staff_user_id
      WHERE s.email = $1 ORDER BY a.accepted_at`,
    [email],
  );
  return rows;
}

/** The template with the club's four facts typed in, as a draft — the next version number — and its id. */
async function insertDraft(client: pg.Client): Promise<{ id: string; version: number }> {
  const typed = (text: string) => Object.entries(FACTS).reduce((out, [placeholder, value]) => out.split(placeholder).join(value), text);
  const body = (sections: typeof teamAgreementRo) => ({
    sections: sections.sections.map((section) => ({ ...section, heading: section.heading ? typed(section.heading) : undefined, paragraphs: section.paragraphs.map(typed) })),
  });
  const translations = [
    { locale: "ro" as const, title: "Angajament de confidențialitate și protecția datelor pentru echipă", body: body(teamAgreementRo) },
    { locale: "en" as const, title: "Team confidentiality and data protection undertaking", body: body(teamAgreementEn) },
  ];
  const { rows: last } = await client.query<{ version: number }>("SELECT coalesce(max(version), 0)::int AS version FROM legal_documents WHERE key = 'STAFF_DATA_AGREEMENT'");
  const version = Number(last[0].version) + 1;
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO legal_documents (key, version, effective_at, is_approved, content_sha256) VALUES ('STAFF_DATA_AGREEMENT', $1, now(), false, $2) RETURNING id",
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
  return { id: rows[0].id, version };
}

/** A sign-in as one of the development identities, where the gate sends it: `/admin/acord`, the way back kept. */
async function signInOnto(page: Page, identity: string, landing: RegExp): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/ro/autentificare");
  await page.getByRole("button", { name: new RegExp(identity) }).click();
  await expect(page).toHaveURL(landing, { timeout: 30_000 });
  await hydrated(page);
}

/**
 * The page's own targets a thumb must hit are 44 pixels (BR-REQ-041-01 criterion 6) — the name, the tick, «Accept și intru» —, no
 * sideways scroll at 320px, and the shell's «Ieși din cont» is there to press.
 */
async function expectThumbFriendly(page: Page): Promise<void> {
  const form = page.getByTestId("team-agreement-form");
  for (const target of [form.getByRole("button", { name: "Accept și intru" }), form.locator("label").filter({ hasText: "Am citit și accept angajamentul" }), form.getByLabel("Numele tău complet")]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole("button", { name: "Ieși din cont" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("§1006 the team's undertaking at sign-in", () => {
  test("an Administrator approves it; a volunteer and an Organizer are asked, accept and go on; «Echipa» says who; an Administrator never", async ({ page }) => {
    test.setTimeout(240_000);
    await withGateLock(async () => {
      await withDatabase(removeUndertakings);
      try {
        // 1. The Administrator: never asked, the template offered under «Pornește de la șablon», a version approved on /admin/legal.
        await signIn(page, "Dev Administrator");
        await page.goto("/ro/admin/legal/new");
        await expect(page.locator('a[href$="template=STAFF_DATA_AGREEMENT"]').first()).toBeVisible();
        const draft = await withDatabase(insertDraft);
        await page.goto(`/ro/admin/legal/${draft.id}`);
        await hydrated(page);
        const approve = page.getByTestId("approve-version-form");
        await approve.getByRole("checkbox").check();
        await approve.getByRole("button", { name: "Aprobă și publică" }).click();
        await confirmDialog(page);
        await expect.poll(async () => withDatabase(async (client) => (await client.query("SELECT is_approved FROM legal_documents WHERE id = $1", [draft.id])).rows[0]?.is_approved)).toBe(true);
        await page.goto("/ro/admin/checkin");
        await expect(page).toHaveURL(/\/ro\/admin\/checkin$/);

        // 2. A volunteer signing in lands on the undertaking — the shell without its tabs, «Ieși din cont» kept.
        await signInOnto(page, "Dev Contributor", /\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin(%2Fcheckin)?$/);
        await expect(page.getByRole("heading", { name: "Angajamentul echipei" })).toBeVisible();
        await expect(page.getByTestId("team-agreement-text")).toContainText("Angajament de confidențialitate și protecția datelor pentru echipă");
        await expect(page.getByTestId("team-agreement-text")).toContainText("Asociația Exemplu E2E");
        await expect(page.getByTestId("team-agreement-version")).toContainText(`Versiunea ${draft.version}, în vigoare din`);
        await expect(page.getByRole("tab", { name: "Ziua cursei" })).toHaveCount(0);
        await expectThumbFriendly(page);

        // … and cannot open the desk before accepting: a scanned number sends them back, the way to it kept.
        await page.goto("/ro/admin/checkin/E2EGATE1");
        await expect(page).toHaveURL(/\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin%2Fcheckin%2FE2EGATE1$/);
        await page.goto("/ro/admin/checkin");
        await expect(page).toHaveURL(/\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin%2Fcheckin$/);
        await page.goto("/ro/admin/acord?returnTo=%2Fro%2Fadmin%2Fcheckin%2FE2EGATE1");
        await hydrated(page);

        // The tick is required: a press without it accepts nothing.
        const form = page.getByTestId("team-agreement-form");
        await form.getByLabel("Numele tău complet").fill("Vlad E2E Voluntar");
        await form.getByRole("button", { name: "Accept și intru" }).click();
        await expect(page).toHaveURL(/\/ro\/admin\/acord/);
        expect(await withDatabase(async (client) => (await client.query("SELECT count(*)::int AS n FROM staff_team_agreement_sign_in_acceptances")).rows[0].n)).toBe(0);

        // Accepted with a name: back where they were going — the scanned number's page —, the desk open from now on.
        await form.getByLabel("Am citit și accept angajamentul").check();
        await form.getByRole("button", { name: "Accept și intru" }).click();
        await expect(page).toHaveURL(/\/ro\/admin\/checkin\/E2EGATE1$/, { timeout: 30_000 });
        await expect(page.getByTestId("toast")).toContainText("Gata: angajamentul e acceptat.");
        await page.goto("/ro/admin/checkin");
        await expect(page).toHaveURL(/\/ro\/admin\/checkin$/);
        await expect(page.getByRole("tab", { name: "Ziua cursei" })).toBeVisible();
        // One acceptance, at this sign-in (§NNN): the record names the sign-in it answers; §1006's table is written no more.
        const stored = await withDatabase(
          async (client) => (await client.query("SELECT typed_name, document_version, locale, signed_in_at IS NOT NULL AS answers_a_sign_in FROM staff_team_agreement_sign_in_acceptances")).rows,
        );
        expect(stored).toEqual([{ typed_name: "Vlad E2E Voluntar", document_version: draft.version, locale: "ro", answers_a_sign_in: true }]);
        expect(await withDatabase(async (client) => (await client.query("SELECT count(*)::int AS n FROM staff_team_agreement_acceptances")).rows[0].n)).toBe(0);

        // 3. An Organizer is asked too.
        await signInOnto(page, "Dev Moderator", /\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin$/);
        await page.goto("/ro/admin/registrations");
        await expect(page).toHaveURL(/\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin%2Fregistrations$/);

        // 4. «Echipa», for the Administrator: who accepted, which version, when, under which name — and who was not asked.
        // Signed out first: the sign-in page sends a session it already has to that session's landing.
        await page.context().clearCookies();
        await signIn(page, "Dev Administrator");
        await page.goto("/ro/admin/staff");
        await hydrated(page);
        const rowOf = (name: string) => page.getByTestId("staff-row").filter({ has: page.getByTestId("staff-name").getByText(name, { exact: true }) });
        await expect(rowOf("Dev Contributor").getByTestId("staff-team-agreement")).toHaveText(
          new RegExp(`^Angajamentul echipei: Acceptat — versiunea ${draft.version}, \\d{1,2} \\p{L}+ \\d{4}, ca „Vlad E2E Voluntar”$`, "u"),
        );
        await expect(rowOf("Dev Moderator").getByTestId("staff-team-agreement")).toHaveText("Angajamentul echipei: Neacceptat");
        await expect(rowOf("Dev Administrator").getByTestId("staff-team-agreement")).toHaveText("Angajamentul echipei: Nu e cerut");
      } finally {
        await withDatabase(removeUndertakings);
      }
    });
  });
});

/** The development identity a «Voluntar» signs in as (`dev-switcher.ts`). */
const VOLUNTEER_EMAIL = "dev-contributor@dev.test";

/** A version of the undertaking in force at once — approved by SQL here: the journey above approves one through the screen. */
async function approvedVersion(client: pg.Client): Promise<number> {
  const draft = await insertDraft(client);
  await client.query("UPDATE legal_documents SET is_approved = true, effective_at = now() WHERE id = $1", [draft.id]);
  return draft.version;
}

/** «Acord» as a colleague meets it: says it is asked at every sign-in, the name empty, nothing ticked — then accepted. */
async function acceptOnAcord(page: Page, fullName: string): Promise<void> {
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "Angajamentul echipei" })).toBeVisible();
  await expect(page.getByTestId("team-agreement-intro")).toContainText("Îl accepți la fiecare intrare în cont.");
  await expect(page.getByRole("tab", { name: "Ziua cursei" })).toHaveCount(0);
  await expectThumbFriendly(page);
  const form = page.getByTestId("team-agreement-form");
  await expect(form.getByLabel("Numele tău complet")).toHaveValue("");
  await expect(form.getByLabel("Am citit și accept angajamentul")).not.toBeChecked();
  await form.getByLabel("Numele tău complet").fill(fullName);
  await form.getByLabel("Am citit și accept angajamentul").check();
  await form.getByRole("button", { name: "Accept și intru" }).click();
}

test.describe("§NNN the team's undertaking at every sign-in, at 320 px", () => {
  // The phone's width in both projects: the desk is worked from one.
  test.use({ viewport: { width: 320, height: 720 } });

  test("a «Voluntar» signs in, lands on «Acord», accepts and reaches «Ziua cursei»; signs out and in again and lands on «Acord» again", async ({ page }) => {
    test.setTimeout(240_000);
    await withGateLock(async () => {
      await withDatabase(removeUndertakings);
      try {
        await withDatabase(approvedVersion);

        // The first sign-in, through the development sign-in as `yarn dev` and CI have it: on «Acord», the way back kept.
        await signInOnto(page, "Dev Contributor", /\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin(%2Fcheckin)?$/);
        await acceptOnAcord(page, "Vlad E2E Voluntar");

        // On «Ziua cursei»: the desk, its tab, and not asked again in this session.
        await expect(page).toHaveURL(/\/ro\/admin\/checkin$/, { timeout: 30_000 });
        await expect(page.getByTestId("toast")).toContainText("Gata: angajamentul e acceptat.");
        await expect(page.getByRole("tab", { name: "Ziua cursei" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Masa de ridicare a numerelor" })).toBeVisible();
        await page.goto("/ro/admin/checkin");
        await expect(page).toHaveURL(/\/ro\/admin\/checkin$/);
        await page.goto("/ro/admin/guide");
        await expect(page).toHaveURL(/\/ro\/admin\/guide$/);
        expect((await withDatabase((client) => acceptancesOf(client, VOLUNTEER_EMAIL))).map((row) => row.typed_name)).toEqual(["Vlad E2E Voluntar"]);

        // Signed out with «Ieși din cont», and in again from the page the sign-out lands on: «Acord» again.
        await page.getByRole("button", { name: "Ieși din cont" }).click();
        await expect(page).not.toHaveURL(/\/admin/, { timeout: 30_000 });
        await hydrated(page);
        await page.getByRole("button", { name: /Dev Contributor/ }).click();
        await expect(page).toHaveURL(/\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin(%2Fcheckin)?$/, { timeout: 30_000 });
        // The desk stays shut until this sign-in accepts too.
        await page.goto("/ro/admin/checkin");
        await expect(page).toHaveURL(/\/ro\/admin\/acord\?returnTo=%2Fro%2Fadmin%2Fcheckin$/);
        await acceptOnAcord(page, "Vlad E2E Voluntar");
        await expect(page).toHaveURL(/\/ro\/admin\/checkin$/, { timeout: 30_000 });
        await expect(page.getByRole("tab", { name: "Ziua cursei" })).toBeVisible();

        // Each acceptance kept, each answering a sign-in of its own.
        const rows = await withDatabase((client) => acceptancesOf(client, VOLUNTEER_EMAIL));
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.signed_in_at !== null)).toBe(true);
        expect(rows[0].signed_in_at?.getTime()).toBeLessThan(rows[1].signed_in_at?.getTime() ?? 0);
      } finally {
        await withDatabase(removeUndertakings);
      }
    });
  });
});
