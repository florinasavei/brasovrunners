import { expect, test } from "@playwright/test";
import { HUMAN_PAUSE_MS } from "./support/featured-event";

/**
 * BR-REQ-070-04 (`DECISIONS.md` §149) — "Scrie-ne", through the browser, at 320px and on a
 * desktop.
 *
 * What the unit and integration suites cannot see: the page as a phone renders it, the two
 * ways in (the header and the footer), and a real post through the Server Action landing on
 * "Mesajul a plecat". The end-to-end server runs with `APP_ENV=local`, so the message is
 * captured in memory and no socket is ever opened — which is the mode the form is in on every
 * laptop, and the one the test can rely on.
 */
test.describe("BR-REQ-070-04 the contact form", () => {
  test("renders on a phone without sideways scrolling, every control a thumb can hit", async ({ page }) => {
    await page.goto("/ro/contact");
    await expect(page.getByRole("heading", { level: 1, name: "Scrie-ne" })).toBeVisible();

    // BR-REQ-041-01 criterion 1: never wider than the viewport.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

    // Criterion 6: every link and button under main is at least 44px tall.
    const controls = page.locator("main a, main button");
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      expect.soft(box.height, `control ${i} height`).toBeGreaterThanOrEqual(44);
    }

    // The privacy line links the notice, from the form itself, named as a sentence names it.
    await expect(page.locator("main").getByRole("link", { name: "nota de confidențialitate" })).toBeVisible();
  });

  test("is reachable from the header and the footer", async ({ page }) => {
    await page.goto("/ro/evenimente", { waitUntil: "networkidle" });

    // In the header — on the row, or behind "Meniu" where the row is too narrow (SiteNav folds).
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    const onRow = nav.getByRole("link", { name: "Contact" });
    if (await onRow.isVisible()) {
      await onRow.click();
    } else {
      await nav.getByRole("button", { name: "Meniu" }).click();
      await page.getByRole("menuitem", { name: "Contact" }).click();
    }
    await expect(page).toHaveURL(/\/ro\/contact$/);

    // In the footer, beside the legal links, behind the summary that names them.
    const footer = page.getByRole("contentinfo");
    await footer.locator("summary").click();
    const inFooter = footer.getByRole("link", { name: "Scrie-ne" });
    await expect(inFooter).toBeVisible();
    expect((await inFooter.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("sends a message and says so, naming where the answer goes", async ({ page }) => {
    await page.goto("/ro/contact");
    const email = `e2e-contact-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
    await page.locator('[name="name"]').fill("Ana Popescu");
    await page.locator('[name="email"]').fill(email);
    await page.locator('[name="message"]').fill("La ce oră începe alergarea de duminică?");
    // Above the 3-second floor `looksLikeSpam` applies to every public form.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite" }).click();

    await expect(page).toHaveURL(/\/ro\/contact\?sent=1$/);
    await expect(page.getByText("Mesajul a plecat.")).toBeVisible();
    // The address is said back from the draft cookie, never from the URL (§14.5).
    await expect(page.getByText(`Îți răspundem pe ${email}.`)).toBeVisible();
  });

  test("lands a rejection on a focusable summary that names the box", async ({ page }) => {
    await page.goto("/ro/contact?error=VALIDATION_ERROR&fields=email,notAField#contact-errors");
    /*
      By id, not by role. Next renders its own route announcer as `role="alert"`, so
      `getByRole("alert")` matches two elements and fails strict mode — intermittently, because
      whether the announcer is in the DOM yet depends on how the page was reached. A locator
      that is flaky for a reason unrelated to what the test is about is the most expensive kind
      of red (§212): it teaches people to re-run rather than to read.
    */
    const summary = page.locator("#contact-errors");
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("link", { name: "Adresa de e-mail" })).toBeVisible();
    // The unknown name is dropped rather than echoed.
    await expect(summary).not.toContainText("notAField");
    await expect(page.locator('[name="email"]')).toHaveAttribute("aria-invalid", "true");

    // A whole-form answer is one sentence, and the boxes stay.
    await page.goto("/ro/contact?error=LIMITED");
    await expect(page.locator("#contact-errors")).toContainText("Prea multe mesaje");
    await expect(page.locator('[name="message"]')).toBeVisible();
  });
});
