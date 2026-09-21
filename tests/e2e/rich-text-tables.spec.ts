import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-050-03, `DECISIONS.md` §263 — the organizer chooses how a table is drawn, and the page
 * draws it that way.
 *
 * The owner: "la tabele ar trebui să pot alege border and stuff, ca să pot folosi tabelele și ca
 * și layout, și să pot centra info în ele". Everything about this is CSS, which is exactly why it
 * is worth one end-to-end walk: the unit tests pin the description of each variant, and this
 * asserts that the description reaches a real page — the computed border width of a real cell —
 * after a real save through the allowlist.
 *
 * Desktop only: the toolbar is the same at every width, and this spec is about what the choice
 * does rather than where the button is.
 */
test.describe("§263 a table's borders", () => {
  // The toolbar is the same at every width; this spec is about what the choice does.
  test.skip(() => test.info().project.name !== "desktop", "one viewport is enough");

  test("are chosen in the editor and published as chosen", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `tabel-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("translations.ro.title").fill(`Tabel ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    // Both languages are required before the page can be created, and each is its own tab
    // since §259 — a `required` field inside a hidden panel refuses the submit silently.
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Table ${suffix}`);
    await field("translations.en.slug").fill(`table-${suffix}`);
    // Publication refuses an incomplete language (`AGENTS.md` §11.2), so the English body gets
    // a sentence; the table itself is written in Romanian, which is what this spec is about.
    await page.locator('[data-rich-text="translations.en.body"] [data-field]').click();
    await page.keyboard.type("The day's programme.");
    await page.getByRole("tab", { name: /Rom/ }).click();

    const editor = page.locator('[data-rich-text="translations.ro.body"]');
    await editor.locator("[data-field]").click();
    await page.keyboard.type("Programul zilei");

    // One press inserts a 3×3 with a header row; the rest of the verbs appear once the caret
    // is inside it (§196).
    await editor.getByRole("button", { name: "Tabel" }).click();
    await page.keyboard.type("Ora");

    // In the editor the table is drawn as the page draws it (§263) — before this, the page had
    // a grid and the form had nothing.
    const cellInEditor = editor.locator("table td, table th").first();
    await expect(cellInEditor).toBeVisible();
    const borderedInEditor = await cellInEditor.evaluate(
      (cell) => getComputedStyle(cell).borderBottomWidth,
    );
    expect(parseFloat(borderedInEditor)).toBeGreaterThan(0);

    // The control names the state it is in, so two presses walk grid → rows → none.
    await editor.getByRole("button", { name: /^Linii: toate/ }).click();
    await editor.getByRole("button", { name: /^Linii: doar orizontale/ }).click();
    await expect(editor.getByRole("button", { name: /^Linii: niciuna/ })).toBeVisible();

    // And the text in the middle of the cell, vertically.
    await editor.getByRole("button", { name: /mijlocul celulei/ }).click();

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);

    // The choice survived the save and the server's allowlist, which is the part a CSS test
    // cannot prove: an attribute the schema dropped would come back as a grid here. The verbs
    // only show while the caret is inside a table (§196), so the reloaded editor is asked the
    // way an organizer would ask it — click into a cell.
    const reloaded = page.locator('[data-rich-text="translations.ro.body"]');
    await reloaded.locator("table td").first().click();
    await expect(reloaded.getByRole("button", { name: /^Linii: niciuna/ })).toBeVisible();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);

    await page.goto(`/ro/pagini/${slug}`);
    const cell = page.locator("main table td").first();
    await expect(cell).toBeVisible();
    const style = await cell.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        top: computed.borderTopWidth,
        bottom: computed.borderBottomWidth,
        left: computed.borderLeftWidth,
        vertical: computed.verticalAlign,
      };
    });
    expect(parseFloat(style.top)).toBe(0);
    expect(parseFloat(style.bottom)).toBe(0);
    expect(parseFloat(style.left)).toBe(0);
    expect(style.vertical).toBe("middle");
  });
});
