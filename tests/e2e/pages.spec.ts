import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-050-03 — an organizer writes "About Brașov Runners" and a visitor can read it.
 *
 * Walked through the rendered editor, so a field added to the schema without being added to the
 * form fails here. Creates its own page rather than borrowing a seeded one — there are none, and
 * a page created by an earlier run is left published on purpose: the nav assertion below is
 * stronger for having more than one.
 */

let slug = "";
let englishSlug = "";
let editorUrl = "";
let title = "";

/**
 * Write a body the way an organizer does: click into the editor, optionally turn the first line
 * into a heading with the toolbar, then type. Scoped by `data-rich-text` because the form holds
 * one editor per language and their controls are otherwise identical.
 */
async function writeBody(
  page: import("@playwright/test").Page,
  locale: "ro" | "en",
  heading: string | null,
  paragraph: string,
) {
  const editor = page.locator(`[data-rich-text="translations.${locale}.body"]`);
  await editor.locator("[data-field]").click();

  if (heading !== null) {
    // `## ` at the start of a line becomes a heading as it is typed — the editor's own input
    // rule, and the shortcut a writer reaches for. Typing it also proves the toolbar reads the
    // document correctly, which is asserted below.
    await page.keyboard.type(`## ${heading}`);
    await expect(editor.getByRole("button", { name: /^(Titlu|Heading)$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Enter leaves a heading for a paragraph, which is what a writer expects.
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type(paragraph);
}

/* Serial: all four tests act on the one page the first creates. */
test.describe.serial("BR-REQ-050-03 standing pages", () => {
  test("is created, published, and reachable in both languages", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `despre-${suffix}`;
    englishSlug = `about-${suffix}`;
    title = `Despre clubul ${suffix}`;

    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/pages/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("navOrder").fill("5");
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);
    await field("translations.en.title").fill(`About the club ${suffix}`);
    await field("translations.en.slug").fill(englishSlug);

    // The body is written in the editor, so the test writes it the way an organizer does:
    // press the heading control, type, press Enter, type the paragraph (BR-REQ-050-03, §11.3).
    await writeBody(page, "ro", "Cine suntem", "Un club de alergare din Brașov.");
    await writeBody(page, "en", "Who we are", "A running club in Brașov.");

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);
    editorUrl = page.url();

    // A draft is not on the public site, whatever its address.
    expect((await page.goto(`/ro/pagini/${slug}`))?.status()).toBe(404);

    await page.goto(editorUrl);
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);

    // Both languages go live together (`AGENTS.md` §11.2), each at its own address.
    await page.goto(`/ro/pagini/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    // What the organizer marked as a heading is a heading on the page, and the paragraph
    // beneath it is text — the editor's output rendered through the §11.3 allowlist.
    await expect(page.getByRole("heading", { name: "Cine suntem" })).toBeVisible();
    await expect(page.getByText("Un club de alergare din Brașov.")).toBeVisible();

    expect((await page.goto(`/en/pages/${englishSlug}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Who we are" })).toBeVisible();

    // BR-REQ-040-02: the other locale's address is a 404, never a fallback to this text.
    expect((await page.goto(`/en/pages/${slug}`))?.status()).toBe(404);
  });

  test("appears in the site menu, and the language switcher follows it", async ({ page }) => {
    await page.goto(`/ro/pagini/${slug}`);

    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: title })).toBeVisible();

    // Criterion 4: the switcher lands on the same page's English address, not on a 404 and not
    // on the listing.
    await page.getByRole("link", { name: /English/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/en/pages/${englishSlug}$`));
  });

  test("refuses to publish a page whose other language is empty", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;

    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/pages/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("translations.ro.title").fill(`Pe jumătate ${suffix}`);
    await field("translations.ro.slug").fill(`pe-jumatate-${suffix}`);
    await writeBody(page, "ro", null, "Un paragraf.");
    await field("translations.en.title").fill(`Half done ${suffix}`);
    await field("translations.en.slug").fill(`half-done-${suffix}`);
    // The English body is left empty on purpose.

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);

    // Said before the button is pressed, naming the language and the field.
    await expect(page.getByText(/EN: body/)).toBeVisible();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/error=VALIDATION_ERROR/);
  });

  test("fits a 320px screen with no sideways scroll", async ({ page }) => {
    await page.goto(`/ro/pagini/${slug}`);

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});
