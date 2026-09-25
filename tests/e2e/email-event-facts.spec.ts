import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN (the owner, 2026-09-25: "la mailul de «Înscrierea este confirmată» am nevoie de mai multe
 * detalii, gen locație, program, etc.") — the preview of the confirmed email on `/admin/emails`
 * draws the event's facts block with the sample event's values, in both halves, each in its own
 * language, under the QR and above the button. It reads nothing but the page, so both projects run it.
 */
test.describe("the event's facts in the confirmed email's preview", () => {
  test("every row, from the sample event, in both halves", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/emails?lang=ro");
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
    await expect(ro).toContainText("Trail · Mediu · 12 km · 450 m D+");
    await expect(ro).toContainText("30 lei");
    await expect(ro.getByRole("link", { name: "Vezi pe hartă" })).toBeVisible();
    await expect(ro.getByRole("link", { name: "Traseul" })).toHaveAttribute("href", /\/ro\/EXAMPLE-event#route$/);

    const en = facts.nth(1);
    for (const label of ["When", "Where", "Programme", "Route", "Cost", "Links"]) await expect(en).toContainText(label);
    await expect(en).toContainText("Tâmpa cable-car station");
    await expect(en).toContainText("Number pickup");
    await expect(en).toContainText("Trail · Moderate · 12 km · 450 m climb");
    await expect(en.getByRole("link", { name: "The route" })).toHaveAttribute("href", /\/en\/EXAMPLE-event#route$/);

    // Under the QR, above the button: the confirmation first, the facts under it.
    const order = await frame.locator("body").evaluate((body) => {
      const html = body.innerHTML;
      return {
        qr: html.indexOf("/api/registrations/qr/"),
        facts: html.indexOf('data-email-part="event-facts"'),
        button: html.indexOf("Vezi înscrierea"),
      };
    });
    expect(order.qr).toBeGreaterThan(-1);
    expect(order.facts).toBeGreaterThan(order.qr);
    expect(order.button).toBeGreaterThan(order.facts);

    // The phone keeps its width with the card open (BR-REQ-041-01 criterion 1).
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});
