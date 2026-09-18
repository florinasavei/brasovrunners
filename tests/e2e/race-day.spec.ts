import { expect, test } from "@playwright/test";
import { FEATURED, ensureRegistrationIsOpen, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-037-07, BR-REQ-037-08 — race morning, end to end, as a volunteer would live it.
 *
 * A Contributor — the lowest role, which is what a volunteer at the pickup table is given —
 * opens the desk, enters a walk-in who never registered, sees them confirmed on the spot,
 * types their number, marks them here, and then opens the page their QR would have opened and
 * takes the check-in back. The QR image itself is fetched as the email would fetch it.
 *
 * Runs against the seeded database; both Playwright projects share it, so every name, address
 * and race number carries the project's name.
 */
test.describe("BR-REQ-037-08 the race-day desk", () => {
  // One long story on one page, four server actions in a row: under the full suite's load a
  // round trip can take longer than the five seconds an expectation waits by default.
  test.describe.configure({ timeout: 60_000 });

  test("a volunteer enters a walk-in, gives a number, checks them in, and opens their QR page", async ({ page }) => {
    // An organizer opens registration on the featured event (the seed configures none).
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.getByRole("button", { name: "Ieși din cont" }).click();
    // Wait for the sign-out to land before signing in as somebody else: a `goto` fired while
    // the sign-out POST is still in flight aborts it, and the switcher then shows the
    // organizer's own session instead of the buttons.
    await expect(page).not.toHaveURL(/\/admin/, { timeout: 30_000 });

    // The volunteer.
    await signIn(page, "Dev Contributor");
    await page.getByRole("tab", { name: "Ziua cursei" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/checkin/);
    await expect(page.getByRole("heading", { name: "Masa de ridicare a numerelor" })).toBeVisible();
    // The steps are on the page, for whoever was handed the phone.
    await expect(page.getByText("Cum merge ziua cursei, pas cu pas")).toBeVisible();

    // The desk works the featured event. A native select, so this needs no hydration.
    const option = page.locator('select[name="eventId"] option', { hasText: FEATURED.title });
    await page.selectOption('select[name="eventId"]', (await option.getAttribute("value")) as string);
    await page.getByRole("button", { name: "Caută" }).click();

    // A walk-in: never registered, standing at the table.
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await page.getByRole("link", { name: "Adaugă pe cineva" }).click();
    await expect(page).toHaveURL(/\/admin\/registrations\/new\?eventId=.*back=desk/);
    await hydrated(page);
    await expect(page.getByRole("checkbox", { name: /Persoana este la masă/ })).toBeChecked();
    await page.locator('[name="firstName"]').fill("Walk-in");
    await page.locator('[name="lastName"]').fill(suffix);
    await page.locator('[name="email"]').fill(`walkin-${suffix}@test.invalid`);
    await page.getByRole("checkbox", { name: /a cerut/ }).check();
    await page.getByRole("button", { name: "Adaugă înscrierea" }).click();

    // Back at the desk, confirmed on the spot, with a code.
    await expect(page).toHaveURL(/\/ro\/admin\/checkin\?.*eventId=/);
    await expect(page.locator("#admin-alert")).toContainText("Persoana a fost adăugată", { timeout: 15_000 });
    await hydrated(page);
    await page.getByRole("textbox", { name: "Nume, număr sau cod" }).fill(suffix);
    await page.getByRole("button", { name: "Caută" }).click();
    await hydrated(page);
    const row = page.getByTestId("desk-row").filter({ hasText: suffix });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Confirmată", { exact: true })).toBeVisible();
    const code = (await row.locator("span, p").filter({ hasText: /^[A-HJ-NP-Z2-9]{10}$/ }).first().textContent()) as string;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);

    // A number by hand — distinct per project and per run, since both share the event and a
    // number once given stays with its registration.
    const bib = String((test.info().project.name === "mobile" ? 10_000 : 20_000) + (Date.now() % 9_000));
    await row.getByRole("spinbutton", { name: "Număr de concurs" }).fill(bib);
    await row.getByRole("button", { name: "Salvează" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Numărul a fost salvat", { timeout: 15_000 });
    await hydrated(page);

    // Here.
    const rowAgain = page.getByTestId("desk-row").filter({ hasText: suffix });
    await expect(rowAgain).toContainText(bib);
    await rowAgain.getByRole("button", { name: "Prezent", exact: true }).click();
    await expect(page.locator("#admin-alert")).toContainText("Marcat prezent", { timeout: 15_000 });
    await expect(page.getByTestId("desk-row").filter({ hasText: suffix })).toContainText("Prezent la");

    // The QR the email links to, and the page it opens.
    const qr = await page.request.get(`/api/registrations/qr/${code}.png`);
    expect(qr.status()).toBe(200);
    expect(qr.headers()["content-type"]).toBe("image/png");
    expect((await page.request.get("/api/registrations/qr/ZZZZZZZZZZ.png")).status()).toBe(404);

    await page.goto(`/ro/admin/checkin/${code}`);
    const scanned = page.getByTestId("desk-row");
    await expect(scanned).toContainText(suffix);
    await expect(scanned).toContainText(FEATURED.title);
    await scanned.getByRole("button", { name: "Anulează prezența" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Prezența a fost anulată", { timeout: 15_000 });
    await expect(page.getByTestId("desk-row")).not.toContainText("Prezent la");

    // Criterion: the desk fits a phone — never wider than the viewport.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});
