import { expect, test } from "@playwright/test";
import { FOLD_LINE } from "../../src/shared/ui/footer-target";
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
    // The fold's links are one fold line each since §480 amended §385 (the compact fold,
    // `footer-target.ts`'s `FOLD_LINE`): 24 pixels on every phone width, 44 from `sm` as before.
    const width = page.viewportSize()?.width ?? 1280;
    const target = width >= 600 ? FOLD_LINE.sm : FOLD_LINE.xs;
    expect((await inFooter.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(target - 0.5);

    // And under the bar, in the club's identity block, always in sight at the page's end (§565).
    const block = page.getByTestId("club-identity-block");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(block.getByTestId("club-identity-write")).toHaveAttribute("href", "/ro/contact");
  });

  /**
   * §565 — the page names who is written to: «<legal name> (<site name>) · CIF <CIF>» under the form
   * (or the address), composed from the environment. The suite's server sets no legal fact (CI) —
   * a developer's `.env.local` may — so the line is checked when it is drawn and its absence when
   * it is not; its words are never compared with a value.
   */
  test("names the club by its legal name and CIF under the form, when the facts are set", async ({ page }) => {
    await page.goto("/ro/contact");
    const main = page.locator("main");
    const line = main.getByTestId("club-identity-line");
    if ((await line.count()) === 0) {
      await expect(main).not.toContainText("· CIF");
      return;
    }
    await expect(line).toBeVisible();
    await expect(line).toContainText("(");
    // The page's last line: under the contact form and under the newsletter's box alike.
    // One snapshot of the layout per try, polled: the form grows as it hydrates (the anti-bot box),
    // and a line measured before that growth and the form after it would lie. The newsletter's own
    // forms live in a pop-up (`<dialog>`), so its section is what the line must follow, not they.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const lineTop = document.querySelector('main [data-testid="club-identity-line"]')!.getBoundingClientRect().top;
            const above = [
              ...[...document.querySelectorAll("main form")].filter((form) => !form.closest("dialog, [data-testid='newsletter-section']")),
              ...document.querySelectorAll('main [data-testid="newsletter-section"]'),
            ];
            return lineTop - Math.max(-Infinity, ...above.map((element) => element.getBoundingClientRect().bottom));
          }),
        { message: "the line is under every form" },
      )
      .toBeGreaterThanOrEqual(0);
    const box = await line.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
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

    // §427: and in a toast, inside the live region, with a close button a thumb can hit.
    const toast = page.getByTestId("toast");
    await expect(toast).toHaveText("Mesaj trimis clubului.");
    await expect(page.getByTestId("toast-live")).toHaveAttribute("role", "status");
    const close = toast.getByRole("button", { name: "Închide" });
    // Measured once the Snackbar's grow has finished: mid-transition it is scaled below its size.
    await expect.poll(async () => Math.round(((await close.boundingBox())?.height ?? 0) * 10) / 10).toBeGreaterThanOrEqual(44);
    // Once: a refresh keeps the page's own sentence and repeats no toast.
    await page.reload();
    await expect(page.getByText("Mesajul a plecat.")).toBeVisible();
    await expect(page.getByTestId("toast-live")).toHaveCount(0);
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
