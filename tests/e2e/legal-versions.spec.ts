import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";

/**
 * The body is written in the editor (§279), so a spec types into it as a person does: `## ` at
 * the start of a line becomes a heading and a blank line starts a paragraph, exactly as they do
 * for whoever is writing the club's privacy notice. The hidden field beside it — the one the
 * Server Action reads — is what the assertions look at.
 */
async function writeBody(page: Page, index: number, text: string): Promise<void> {
  const editor = page.locator(".tiptap").nth(index);
  await editor.click();
  await page.keyboard.type(text);
}

/**
 * BR-REQ-053-02 — "editing" an approved legal version means starting the next version from it,
 * prefilled (DECISIONS.md §46, §53, §57). Every non-production database carries the approved
 * sample documents, so the list always has an approved version to start from.
 */
test.describe("legal documents: a Superadministrator can create the first version from the list", () => {
  /**
   * BR-REQ-053-02 — the create page was reachable only by typing its address, or from an
   * existing version's page. Production has no version, by design, so on production nobody
   * could create the first one ("I still can't create documents", 2026-09-17). The list now
   * offers it to the one role that may create.
   */
  test("offers New version on the list, and the form creates a draft", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin/legal");

    await page.getByRole("link", { name: "Versiune nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/new$/);

    // One document per viewport project, because the two run at once and a version number is
    // unique per document: both creating TERMS in the same instant collided on it.
    const wantsTerms = test.info().project.name === "desktop";
    await page.getByRole("combobox").first().click();
    await page
      .getByRole("option", {
        // The race's trail declaration, named by its course since §515.
        name: wantsTerms ? /Termeni|Terms/ : /— cursă trail|— trail race/,
      })
      .click();

    await page.locator('[name="roTitle"]').fill(`Document ${suffix}`);
    await writeBody(page, 0, "## Secțiunea 1\n\nUn paragraf de probă.");
    await page.locator('[name="enTitle"]').fill(`Document ${suffix}`);
    await writeBody(page, 1, "## Section 1\n\nA test paragraph.");
    await page.getByRole("button", { name: "Salvează ciorna" }).click();

    // Straight to the new draft, read-before-approve, with the version and the key named.
    await expect(page).toHaveURL(/\/admin\/legal\/[0-9a-f-]{36}\?saved=/);
    await expect(
      page.getByRole("heading", {
        name: wantsTerms ? /Termeni de concurs · v\d+/ : /Declarație pe propria răspundere — cursă trail · v\d+/,
      }),
    ).toBeVisible();
    await expect(page.getByText("Ciornă", { exact: false }).first()).toBeVisible();
  });

  test("does not offer New version to an Organizer, who may only read (§450)", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/legal");
    await expect(page.getByRole("link", { name: "Versiune nouă" })).toHaveCount(0);
  });

  test("offers New version to an Administrator, who runs the club's legal texts (§450)", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/legal");
    await expect(page.getByRole("link", { name: "Versiune nouă" }).first()).toBeVisible();
  });

  /**
   * BR-REQ-053-02 criterion 10 (DECISIONS.md §132) — the one-press box exists for a database
   * with no approved text, which is production alone; every other environment carries the
   * approved samples, so here the box must be absent rather than offering to replace them.
   * The act itself is covered by tests/integration/legal/platform-approve.test.ts.
   */
  test("does not offer the one-press approval while every text is in force", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin/legal");
    await expect(page.getByRole("link", { name: "Versiune nouă" })).toBeVisible();
    await expect(page.getByTestId("platform-approve")).toHaveCount(0);
  });
});

test.describe("legal documents: the next version starts from the current one", () => {
  test("an approved version offers the next version, prefilled from its text", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    // The texts in force, through the address (§539): each text's versions fold under its card and
    // a fold opens only for a reason — a filter that keeps rows in it is one.
    await page.goto("/ro/admin/legal?state=inForce");

    // The first version in the list. `/admin/legal/new` and the back link do not match the
    // trailing slash plus an id, so only version rows do — and only the visible copy: below
    // `md` the table is hidden and each row is a labelled block (BR-REQ-041-01).
    // …and not the "start from the platform's text" links either (`?template=`, §95).
    await page.locator('a[href*="/admin/legal/"]:not([href$="/new"]):not([href*="template="]):visible').first().click();
    await expect(page).toHaveURL(/\/admin\/legal\/[0-9a-f-]{36}$/);

    await page.getByRole("link", { name: "Pornește versiunea următoare din aceasta" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/new\?from=[0-9a-f-]{36}$/);
    await expect(page.getByText(/Precompletat din versiunea \d+/)).toBeVisible();

    // Prefilled: both bodies already carry the current text — the whole point of the button.
    await expect(page.locator('input[name="roBody"]')).not.toHaveValue("");
    await expect(page.locator('input[name="enBody"]')).not.toHaveValue("");
    // And it is a document on the screen, not a box of markup: the stored headings are headings.
    await expect(page.locator(".tiptap h2").first()).toBeVisible();
  });

  /**
   * §369 — the editor has its height before Tiptap mounts, so nothing under it moves. The first
   * paint is read with every script refused, which is the page as it stands until hydration; the
   * second with the editor mounted. The prefilled sample text measured 4,240 pixels on a desktop
   * and 16,987 on a 320-pixel phone (2026-09-24), so a stand-in that reserved only an empty box's
   * 280 would still move the English half by nearly all of that; the text drawn in the stand-in
   * measured the same to the pixel.
   */
  test("the Romanian text takes the room it needs before the editor mounts, so the English half does not move", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin/legal?state=inForce");
    await page.locator('a[href*="/admin/legal/"]:not([href$="/new"]):not([href*="template="]):visible').first().click();
    await page.getByRole("link", { name: "Pornește versiunea următoare din aceasta" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/new\?from=[0-9a-f-]{36}$/);
    const address = page.url();

    const scripts = /\/_next\/static\/.*\.js(\?.*)?$/;
    await page.route(scripts, (route) => route.abort());
    await page.goto(address);
    const standIn = page.getByTestId("legal-body-reserved").first();
    await expect(standIn).toBeVisible();
    // Nothing hydrated: no editor anywhere, so what is measured is the first paint.
    await expect(page.locator(".tiptap")).toHaveCount(0);
    const reserved = await standIn.boundingBox();
    const englishBefore = await page.locator('[name="enTitle"]').boundingBox();
    await page.unroute(scripts);

    await page.goto(address);
    const writingArea = page.locator(".tiptap").first();
    await expect(writingArea).toBeVisible();
    await expect(page.getByTestId("legal-body-reserved")).toHaveCount(0);
    const mounted = await writingArea.boundingBox();
    const englishAfter = await page.locator('[name="enTitle"]').boundingBox();

    // Hundreds of pixels of text, and the stand-in within a few of the editor that replaced it.
    expect(mounted!.height).toBeGreaterThan(400);
    expect(Math.abs(mounted!.height - reserved!.height)).toBeLessThanOrEqual(4);
    expect(Math.abs(englishAfter!.y - englishBefore!.y)).toBeLessThanOrEqual(4);
  });
});

/**
 * BR-REQ-053-03 — a version can be downloaded as a PDF, in each language it has.
 *
 * The file itself is checked by the unit test; what only a browser can show is that the button
 * on the version's page produces a download with the right name, that the response is a PDF,
 * and that somebody below Administrator gets nothing from the address.
 */
test.describe("legal documents: a version downloads as a PDF", () => {
  test("offers one download per language on the version page, and the file is a PDF", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/legal?state=inForce");
    await page.locator('a[href*="/admin/legal/"]:not([href$="/new"]):not([href*="template="]):visible').first().click();
    await expect(page).toHaveURL(/\/admin\/legal\/[0-9a-f-]{36}$/);

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Descarcă PDF (RO)" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^[a-z_]+-v\d+-ro\.pdf$/);

    // The same address, fetched: a PDF, and never cached by anything between here and there.
    const id = page.url().match(/[0-9a-f-]{36}$/)?.[0];
    const response = await page.request.get(`/api/admin/legal/${id}/pdf?locale=en`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["content-disposition"]).toMatch(/-en\.pdf"$/);
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("refuses a Moderator the PDF of a version, which is the text itself (§208)", async ({ page }) => {
    /*
      Since §208 an Organizer *may* open the legal list — they must be able to see what the club
      published in order to say which line is wrong. The document itself is another matter: the
      PDF route is the text, and writing, approving, withdrawing and deleting are the
      Administrator's. So the list opens and this route refuses, which is the whole point of
      separating the two questions.
    */
    await signIn(page, "Dev Moderator");
    // Any well-formed id: the role is checked before the row is looked for (BR-REQ-060-01).
    const response = await page.request.get(
      "/api/admin/legal/00000000-0000-4000-8000-000000000000/pdf?locale=ro",
    );
    expect(response.status()).toBe(403);
  });
});

/**
 * BR-REQ-053-02 (§532) — every text at once: «Regenerează din șabloane» makes the drafts,
 * «Aprobă ciornele» names them before anything is in force, and «Șterge versiunile bifate» takes
 * the ticked rows — the ticks belong to a GET form by `form=` — to `/admin/legal/delete`, which
 * lists them and deletes them behind the §384 dialog, the toast saying how many went.
 *
 * On a reset database: the samples in force carry the not-approved banner (§29), so every template
 * says something they do not and the press has drafts to make. The approval is opened and declined
 * rather than pressed: it would put the platform's texts in force for every other spec of the same
 * run, which reads the samples; the act is `tests/integration/legal/batch.test.ts`'s. The drafts
 * this spec made are the ones it deletes — found as the ticks that were not there before the press —
 * so the list is left as it was. Desktop only: one database, and the phone renders the same rows as
 * labelled blocks.
 *
 * §539 — the list is one card per text now, each text's versions folded under it, and one text is
 * regenerated from its own card first: «Regenerează din șablon», a dialog naming the text and the
 * version it makes, a toast, and the list landing on «Ciorne», where every draft's fold is open.
 * The ticks are read on that filter, before and after, so a fold's state never changes the count.
 */
/**
 * The terms' waiting drafts, gone: the first test in this file saves a TERMS draft on desktop,
 * and an interrupted run leaves more, so without this the card would say «O ciornă așteaptă
 * deja» and the per-card press would never be exercised. Drafts only — never an approved row —
 * and none that anything references. It does what the app's own draft delete does
 * (`deleteDraftVersion`): the translations go with the row by the `ON DELETE CASCADE`, and no
 * number is retired, just as the app retires none for a draft — §151's retirement applies to
 * approved versions only.
 */
async function deleteWaitingTermsDrafts(): Promise<void> {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM legal_documents d
        WHERE d.key = 'TERMS' AND NOT d.is_approved
          AND NOT EXISTS (SELECT 1 FROM declaration_acceptances a WHERE a.legal_document_id = d.id)`,
    );
  } finally {
    await client.end();
  }
}

test.describe("legal documents: every text at once", () => {
  test("regenerates drafts from the templates, names them for approval, and deletes the ticked ones", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "one database: the drafts are made and deleted once");
    test.setTimeout(120_000);
    await deleteWaitingTermsDrafts();
    await signIn(page, "Dev Administrator");

    const tools = page.getByTestId("legal-batch-tools");
    const ticks = page.locator('[data-testid="legal-batch-tick"]:visible input[type="checkbox"]');
    const labelsOf = async () => Promise.all((await ticks.all()).map(async (tick) => (await tick.getAttribute("aria-label")) ?? ""));
    // The drafts already there, on «Ciorne»: the list streams in behind «Se încarcă…», so the
    // ticks are read once the tools are on the page.
    await page.goto("/ro/admin/legal?state=drafts");
    await hydrated(page);
    await expect(tools).toBeVisible();
    const before = new Set(await labelsOf());

    // One text from its card: the terms, whose sample in force is not the template's words.
    await page.goto("/ro/admin/legal");
    await hydrated(page);
    const terms = page.getByTestId("legal-kind-TERMS");
    await expect(terms.getByTestId("legal-kind-state").first()).toHaveText(/^(În vigoare: versiunea \d+ din .+|Nicio versiune în vigoare)$/);
    // The card must offer the press: no terms draft waits (deleted above) and the sample terms in
    // force are not the template's words. Fail rather than pass without the per-card path.
    await expect(terms.getByTestId("legal-kind-regenerate-none")).toHaveCount(0);
    const regenerateOne = terms.getByRole("button", { name: "Regenerează din șablon" });
    await expect(regenerateOne).toBeVisible();
    await regenerateOne.click();
    const dialog = page.getByRole("dialog", { name: "Faci o ciornă nouă pentru Termeni de concurs?" });
    await expect(dialog).toContainText(/O ciornă nouă pentru Termeni de concurs, din șablon, versiunea \d+/);
    await confirmDialog(page, "Faci o ciornă nouă pentru Termeni de concurs?");
    await expect(page.getByTestId("toast")).toContainText("1 ciornă creată din șablon.", { timeout: 30_000 });
    // Landed on «Ciorne», the new draft's text named as waiting, its versions open.
    await expect(page).toHaveURL(/\/admin\/legal\?state=drafts/);
    await hydrated(page);
    await expect(page.getByTestId("legal-kind-TERMS")).toContainText(/O ciornă așteaptă aprobarea: versiunea \d+/);
    await expect(page.getByTestId("legal-versions-TERMS")).toHaveAttribute("open", "");

    // Regenerate the rest: the dialog names the texts, nothing is in force, the toast counts the drafts.
    const regenerateRest = tools.getByRole("button", { name: /^Regenerează din șabloane \(\d+ din 6\)$/ });
    if ((await regenerateRest.count()) > 0) {
      // «N din 6» and the rule beside it (§NNN): only the texts wearing «Șablon nou» are regenerated.
      await expect(tools.getByTestId("legal-regenerate-rule")).toHaveText(
        "Doar textele cu «Șablon nou» se regenerează; celelalte au deja cuvintele șablonului.",
      );
      await regenerateRest.click();
      await confirmDialog(page, /^Faci ciorne noi din șabloane \(\d+\)\?$/);
      await expect(page.getByTestId("toast")).toContainText(/ciorn(ă creată din șablon|e create din șabloane)/, { timeout: 30_000 });
      await expect(page).toHaveURL(/\/admin\/legal\?state=drafts/);
      await hydrated(page);
    }
    await expect(tools.getByTestId("legal-regenerate-uptodate")).toBeVisible();

    // Approve: every new draft is either offered (named in the dialog) or held with its reason.
    await expect(tools.getByTestId("legal-approve-drafts-form").or(tools.getByTestId("legal-drafts-held")).first()).toBeVisible();
    const approve = tools.getByRole("button", { name: /^Aprobă ciornele \(\d+\)$/ });
    if ((await approve.count()) > 0) {
      await approve.click();
      await expect(page.getByRole("dialog", { name: /^Aprobi ciornele \(\d+\)\?$/ })).toContainText("Se aprobă:");
      await cancelDialog(page, /^Aprobi ciornele/);
    }

    // Delete: tick the drafts this press made, through the GET form, to the batch screen.
    const made = (await labelsOf()).filter((label) => !before.has(label));
    expect(made.length).toBeGreaterThanOrEqual(2);
    for (const label of made) await page.getByRole("checkbox", { name: label, exact: true }).check();
    await tools.getByRole("button", { name: "Șterge versiunile bifate" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/delete\?(id=[0-9a-f-]{36}&?){2,}/);
    await expect(page.getByTestId("legal-batch-goes")).toContainText(`Se șterg (${made.length}):`);
    await expect(page.getByTestId("legal-batch-stays")).toHaveCount(0);

    // Drafts only: no typed phrase, one press behind the dialog, and the toast says how many went.
    await expect(page.locator('input[name="typedConfirmation"]')).toHaveCount(0);
    await hydrated(page);
    await page.getByRole("button", { name: `Șterge ciornele (${made.length})` }).click();
    await confirmDialog(page, `Ștergi ciornele (${made.length})?`);
    await expect(page).toHaveURL(/\/admin\/legal(\?|#|$)/);
    await expect(page.getByTestId("toast")).toContainText(`${made.length} ${made.length === 1 ? "versiune ștearsă" : made.length < 20 ? "versiuni șterse" : "de versiuni șterse"}.`, {
      timeout: 30_000,
    });
    // Back on «Ciorne»: the drafts that were there before, and no other. Polled, not read once
    // while the list still streams in.
    await page.goto("/ro/admin/legal?state=drafts");
    await hydrated(page);
    await expect(tools).toBeVisible();
    await expect.poll(async () => new Set(await labelsOf())).toEqual(before);
  });
});

/**
 * §539 — the list grouped and filtered, and «Versiune nouă» as the place to regenerate: read only,
 * both projects. Every text has its card with its state in words; the chips filter through the
 * address, without a script; «Versiune nouă» shows the templates in three labelled rows, each with
 * its text's state under it, and «Regenerează toate» (or the sentence saying nothing is due).
 */
test.describe("legal documents: one card per text, filtered, and the templates' page", () => {
  test("says each text's state, filters by state and text, and groups the templates", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/legal");
    // Scoped to the page's own content: on a phone the shell may hold a second copy while it streams.
    const main = page.locator("#main");

    // The page's three steps, and one card per text in the catalogue's order.
    await expect(main.getByTestId("legal-steps")).toContainText("1. Regenerează (ciornă din șablon)");
    const keys = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION", "EVENT_DECLARATION_ROAD", "GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"];
    for (const key of keys) {
      await expect(main.getByTestId(`legal-kind-${key}`).getByTestId("legal-kind-state").first()).toHaveText(
        /^(În vigoare: versiunea \d+ din .+|Nicio versiune în vigoare)$/,
      );
    }
    await expect(main.getByTestId("legal-filter-count")).toHaveText(/^\d+ (de )?versiun(e|i) din \d+$/);

    // A chip is a link: «În vigoare» narrows the address and opens the folds it keeps rows in.
    await main.getByTestId("legal-filter").getByRole("link", { name: "În vigoare", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/legal\?state=inForce$/);
    await expect(main.getByTestId("legal-filter").getByRole("link", { name: "În vigoare", exact: true })).toHaveAttribute("aria-current", "page");
    // And one text alone: only its card stays.
    await main.getByTestId("legal-filter").getByRole("link", { name: "Termeni", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/legal\?state=inForce&kind=TERMS$/);
    await expect(main.getByTestId("legal-kind-TERMS")).toBeVisible();
    await expect(main.getByTestId("legal-kind-PRIVACY_NOTICE")).toHaveCount(0);

    // «Versiune nouă»: three labelled rows, a state line under every template's button.
    await page.goto("/ro/admin/legal/new");
    await expect(main.getByTestId("legal-start-from-help")).toHaveText(
      "1. Alege șablonul (sau Regenerează toate) · 2. Citește, completează și «Salvează ciorna» · 3. Aprobă — abia atunci intră în vigoare.",
    );
    for (const [group, label] of [
      ["general", "Documente generale"],
      ["race", "Declarații de cursă"],
      ["groupRun", "Declarații pentru alergările de grup"],
    ] as const) {
      await expect(main.getByTestId(`legal-group-${group}`).getByRole("heading", { name: label })).toBeVisible();
    }
    for (const key of keys) {
      await expect(main.getByTestId(`legal-template-${key}`).getByTestId("legal-template-state")).toHaveText(
        /^(În vigoare: versiunea \d+ din .+|Nicio versiune în vigoare)( · Ciornă în așteptare: versiunea \d+)?$/,
      );
    }
    await expect(
      main.getByRole("button", { name: /^Regenerează toate \(\d+\)$/ }).or(main.getByTestId("legal-regenerate-all-none")),
    ).toBeVisible();
    // A template's button keeps its meaning: the form below, prefilled with that template.
    await main.getByTestId("legal-template-TERMS").getByRole("link", { name: "Termeni de concurs" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/new\?template=TERMS$/);
    await expect(page.locator('[name="roTitle"]')).not.toHaveValue("");
  });
});
