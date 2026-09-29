import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §392 (the owner, 2026-09-25: "la mailul de «Înscrierea este confirmată» am nevoie de mai multe
 * detalii, gen locație, program, etc.") — the preview of the confirmed email on `/admin/emails`
 * draws the event's facts block with the sample event's values, in both halves, each in its own
 * language, above the QR and below the club's text (§81's bold date/place line gives way to it,
 * drawn first so the eye finds it on a phone on race morning). It reads nothing but the page, so
 * both projects run it.
 */
test.describe("the event's facts in the confirmed email's preview", () => {
  test("every row, from the sample event, in both halves", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/settings/emails?lang=ro");
    const card = page.locator("#main").locator("#email-REGISTRATION_CONFIRMED");
    await openFold(card);

    const frame = card.frameLocator("iframe");
    const facts = frame.locator('[data-email-part="event-facts"]');
    await expect(facts).toHaveCount(2);

    const ro = facts.nth(0);
    for (const label of ["Când", "Unde", "Program", "Traseu", "Cost", "Linkuri"]) await expect(ro).toContainText(label);
    await expect(ro).toContainText("întâlnire la 09:00 · start la 09:30");
    await expect(ro).toContainText("Stația de telecabină Tâmpa");
    await expect(ro).toContainText("Aleea Tiberiu Brediceanu");
    await expect(ro).toContainText("Ridicarea numerelor");
    await expect(ro).toContainText("Trail · Mediu, treapta 2 din 3 · 12 km · 450 m D+");
    await expect(ro).toContainText("30 lei");
    await expect(ro.getByRole("link", { name: "Vezi pe hartă" })).toBeVisible();
    await expect(ro.getByRole("link", { name: "Traseul" })).toHaveAttribute("href", /\/ro\/EXAMPLE-event#route$/);
    // The Linkuri row names the event's own page first (fix round §392), and the list under the
    // button does not repeat it.
    await expect(ro.getByRole("link", { name: "Pagina evenimentului" })).toHaveAttribute("href", /\/ro\/EXAMPLE-event$/);

    const en = facts.nth(1);
    for (const label of ["When", "Where", "Programme", "Route", "Cost", "Links"]) await expect(en).toContainText(label);
    await expect(en).toContainText("Tâmpa cable-car station");
    await expect(en).toContainText("Number pickup");
    await expect(en).toContainText("Trail · Medium, step 2 of 3 · 12 km · 450 m climb");
    await expect(en.getByRole("link", { name: "The route" })).toHaveAttribute("href", /\/en\/EXAMPLE-event#route$/);
    await expect(en.getByRole("link", { name: "The event's page" })).toHaveAttribute("href", /\/en\/EXAMPLE-event$/);

    // Above the QR, below the club's text: the facts first, the confirmation's QR under them.
    const order = await frame.locator("body").evaluate((body) => {
      const html = body.innerHTML;
      return {
        qr: html.indexOf("/api/registrations/qr/"),
        facts: html.indexOf('data-email-part="event-facts"'),
        button: html.indexOf("Vezi înscrierea"),
      };
    });
    expect(order.qr).toBeGreaterThan(-1);
    expect(order.facts).toBeGreaterThan(-1);
    expect(order.qr).toBeGreaterThan(order.facts);
    expect(order.button).toBeGreaterThan(order.qr);

    // The phone keeps its width with the card open (BR-REQ-041-01 criterion 1).
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});

/**
 * §558 (the owner, 2026-09-29: «în fiecare mail trebuie să fie clar butonul de „Nu mai pot
 * ajunge”») — the preview of every message about a live registration shows «Nu mai pot ajunge»
 * under its button, in both halves, full width and a thumb's height, with its one sentence; a
 * message after the fact shows none. It reads nothing but the page, so both projects run it.
 */
test.describe("«Nu mai pot ajunge» in the emails' preview", () => {
  test("under the confirmation's button and as the reminder's one button, never on the cancellation", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/settings/emails?lang=ro");

    const confirmed = page.locator("#main").locator("#email-REGISTRATION_CONFIRMED");
    await openFold(confirmed);
    const buttons = confirmed.frameLocator("iframe").locator('[data-email-part="cannot-come"]');
    await expect(buttons).toHaveCount(2);
    const ro = buttons.nth(0).getByRole("link", { name: "Nu mai pot ajunge" });
    await expect(ro).toHaveAttribute("href", /#cancel$/);
    await expect(buttons.nth(0)).toContainText("Locul se eliberează pentru altcineva.");
    await expect(buttons.nth(1).getByRole("link", { name: "I can't make it any more" })).toHaveAttribute("href", /#cancel$/);
    await expect(buttons.nth(1)).toContainText("Your place goes to someone else.");
    // A thumb's target (BR-REQ-041-01 criterion 6), the card's whole width.
    const box = await ro.boundingBox();
    const card = await buttons.nth(0).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(Math.round(box?.width ?? 0)).toBe(Math.round(card?.width ?? -1));
    // Under the message's own button.
    const order = await confirmed.frameLocator("iframe").locator("body").evaluate((body) => ({
      button: body.innerHTML.indexOf("Vezi înscrierea"),
      cannotCome: body.innerHTML.indexOf('data-email-part="cannot-come"'),
    }));
    expect(order.cannotCome).toBeGreaterThan(order.button);

    const reminder = page.locator("#main").locator("#email-EVENT_REMINDER");
    await openFold(reminder);
    await expect(reminder.frameLocator("iframe").locator('[data-email-part="cannot-come"]')).toHaveCount(2);

    const cancelled = page.locator("#main").locator("#email-REGISTRATION_CANCELLED");
    await openFold(cancelled);
    await expect(cancelled.frameLocator("iframe").locator("body")).toContainText("a fost anulată");
    await expect(cancelled.frameLocator("iframe").locator('[data-email-part="cannot-come"]')).toHaveCount(0);
  });
});
