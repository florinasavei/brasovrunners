import { expect, test } from "@playwright/test";
import { ensureRegistrationIsOpen, hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-038-01, `DECISIONS.md` §301 and §317 — the bib's footer is the club's to compose, and
 * the preview in the design panel follows every box before anything is saved.
 *
 * Nothing here saves: the panel's preview is a picture whose address carries the unsaved design,
 * so what is asserted is that address — the email switch turning `showEmail` off in it, the
 * club's line arriving in it — and that the route draws it. A read-only spec, so it cannot
 * disturb the featured event the registration specs configure.
 */
test.describe("§317 the footer, composed in the designer", () => {
  test("switching the email off redraws the preview without it, and the club's line joins it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    // Registration on the site, which is where race numbers exist (§NNN): converges, never saves
    // when another spec already did.
    await ensureRegistrationIsOpen(page);
    await page.reload();
    await hydrated(page);

    // The editor renders at all: the first version of this panel failed the whole page on the
    // client (a shared `sx` object, see `BibDesignPanel`), which no unit test could see. It is
    // a card inside a card now: Participare și înscrieri › Numere de concurs (BIB) › this.
    await openEditorBox(page, "Participare și înscrieri");
    await openEditorBox(page, "Numere de concurs (BIB)");
    const panel = page.getByTestId("bib-design");
    await openFold(panel);
    const preview = page.getByTestId("bib-design-preview").locator("img");
    await expect(preview).toHaveAttribute("src", /[?&]showEmail=1(&|$)/);

    const footer = page.getByTestId("bib-design-footer");
    const email = footer.getByRole("checkbox", { name: /Adresa de email a clubului/ });
    // A thumb's target, like every other box in the panel (BR-REQ-041-01 criterion 6).
    expect((await email.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await email.uncheck();
    await expect(preview).toHaveAttribute("src", /[?&]showEmail=0(&|$)/, { timeout: 10_000 });

    const line = footer.getByRole("textbox", { name: "Rândul clubului" });
    await line.fill("Cronometraj: StartTime");
    await expect(page.getByTestId("bib-footer-text-count")).toHaveText("22/120");
    await expect(preview).toHaveAttribute("src", /[?&]footerText=Cronometraj/, { timeout: 10_000 });

    // The address the panel built is one the route draws: the same renderer as the paper.
    const src = (await preview.getAttribute("src")) as string;
    const picture = await page.request.get(src);
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/png");
  });
});
