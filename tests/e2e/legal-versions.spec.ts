import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/featured-event";

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
        // The race's declaration, named as the owner named the three since §NNN.
        name: wantsTerms ? /Termeni|Terms/ : /\(concurs\)|\(race\)/,
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
        name: wantsTerms ? /Termeni de concurs · v\d+/ : /Declarație pe propria răspundere \(concurs\) · v\d+/,
      }),
    ).toBeVisible();
    await expect(page.getByText("Ciornă", { exact: false }).first()).toBeVisible();
  });

  test("does not offer New version to an Administrator, who may only read", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/legal");
    await expect(page.getByRole("link", { name: "Versiune nouă" })).toHaveCount(0);
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
    await page.goto("/ro/admin/legal");

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
    await page.goto("/ro/admin/legal");
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
    await page.goto("/ro/admin/legal");
    await page.locator('a[href*="/admin/legal/"]:not([href$="/new"]):visible').first().click();
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
