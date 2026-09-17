import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

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
        name: wantsTerms ? /Termeni|Terms/ : /Declarația|Declaration/,
      })
      .click();

    await page.locator('[name="roTitle"]').fill(`Document ${suffix}`);
    await page.locator('[name="roBody"]').fill("## Secțiunea 1\n\nUn paragraf de probă.");
    await page.locator('[name="enTitle"]').fill(`Document ${suffix}`);
    await page.locator('[name="enBody"]').fill("## Section 1\n\nA test paragraph.");
    await page.getByRole("button", { name: "Salvează ciorna" }).click();

    // Straight to the new draft, read-before-approve, with the version and the key named.
    await expect(page).toHaveURL(/\/admin\/legal\/[0-9a-f-]{36}\?saved=/);
    await expect(
      page.getByRole("heading", {
        name: wantsTerms ? /Termeni și condiții · v\d+/ : /Declarația participantului · v\d+/,
      }),
    ).toBeVisible();
    await expect(page.getByText("Ciornă", { exact: false }).first()).toBeVisible();
  });

  test("does not offer New version to an Administrator, who may only read", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/legal");
    await expect(page.getByRole("link", { name: "Versiune nouă" })).toHaveCount(0);
  });
});

test.describe("legal documents: the next version starts from the current one", () => {
  test("an approved version offers the next version, prefilled from its text", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin/legal");

    // The first version in the list. `/admin/legal/new` and the back link do not match the
    // trailing slash plus an id, so only version rows do — and only the visible copy: below
    // `md` the table is hidden and each row is a labelled block (BR-REQ-041-01).
    await page.locator('a[href*="/admin/legal/"]:not([href$="/new"]):visible').first().click();
    await expect(page).toHaveURL(/\/admin\/legal\/[0-9a-f-]{36}$/);

    await page.getByRole("link", { name: "Pornește versiunea următoare din aceasta" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/new\?from=[0-9a-f-]{36}$/);
    await expect(page.getByText(/Precompletat din versiunea \d+/)).toBeVisible();

    // Prefilled: both bodies already carry the current text — the whole point of the button.
    await expect(page.locator('textarea[name="roBody"]')).not.toHaveValue("");
    await expect(page.locator('textarea[name="enBody"]')).not.toHaveValue("");
  });
});
