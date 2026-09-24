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
    await signIn(page, "Dev Administrator");
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

    /*
      The number came with the confirmation (§87) and is settled (§173): a confirmed runner has
      it in their inbox and it may be printed, so the desk offers no box to change it — a
      control that always refuses is worse than none, and this is the screen where being told
      "ceva nu este valid" in front of a queue is expensive.
    */
    const bib = (await row.locator("p, span").filter({ hasText: /^\d{1,5}$/ }).first().textContent()) as string;
    expect(bib).toMatch(/^\d{1,5}$/);
    await expect(row.getByRole("spinbutton", { name: "Număr de concurs" })).toHaveCount(0);

    // Here.
    const rowAgain = page.getByTestId("desk-row").filter({ hasText: suffix });
    await expect(rowAgain).toContainText(bib);
    await rowAgain.getByRole("button", { name: "Marchează prezent", exact: true }).click();
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

  /**
   * §324 — a walk-in of fifteen, entered with a birth date. The staff form asks for the parent
   * once the date says under eighteen (§108), as the public form does, and its date box stops at
   * the latest birth date still fourteen on the chosen event's day (§321).
   */
  test("a walk-in under eighteen is entered with the parent's name, and the date box stops at fourteen", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    await page.goto("/ro/admin/checkin");
    const option = page.locator('select[name="eventId"] option', { hasText: FEATURED.title });
    const eventId = (await option.getAttribute("value")) as string;
    await page.goto(`/ro/admin/registrations/new?eventId=${eventId}&back=desk`);
    await hydrated(page);

    // The seeded race is three weeks away: fourteen on its day is born a little after today,
    // fourteen years ago — never later than two months after that, never before it.
    const shift = (years: number, days = 0) => {
      const at = new Date();
      at.setUTCFullYear(at.getUTCFullYear() - years);
      at.setUTCDate(at.getUTCDate() + days);
      return at.toISOString().slice(0, 10);
    };
    const birthDate = page.locator('[name="birthDate"]');
    const max = (await birthDate.getAttribute("max")) as string;
    expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(max >= shift(14)).toBe(true);
    expect(max <= shift(14, 60)).toBe(true);

    // An adult: no parent asked. Fifteen: the box is there.
    const guardian = page.locator('[name="guardianName"]');
    await birthDate.fill("1990-05-17");
    await expect(guardian).toBeHidden();
    await birthDate.fill(shift(15));
    await expect(guardian).toBeVisible();

    const suffix = `${test.info().project.name}-minor-${Date.now().toString(36)}`;
    await page.locator('[name="firstName"]').fill("Minor");
    await page.locator('[name="lastName"]').fill(suffix);
    await guardian.fill(`Părinte ${suffix}`);
    await page.locator('[name="email"]').fill(`minor-${suffix}@test.invalid`);
    await page.getByRole("checkbox", { name: /a cerut/ }).check();
    await page.getByRole("button", { name: "Adaugă înscrierea" }).click();

    await expect(page).toHaveURL(/\/ro\/admin\/checkin\?.*eventId=/, { timeout: 30_000 });
    await expect(page.locator("#admin-alert")).toContainText("Persoana a fost adăugată", { timeout: 15_000 });
  });

  /**
   * §311 — a printed bib of a cancelled entry is void, and the desk is where that must not be a
   * surprise. The owner: "trebuie sa avem mare grija cu cele anulate, mai ales daca BID-ul a fost
   * deja printat!"
   *
   * One Administrator, one story: a walk-in is confirmed at the desk, given a settled number by
   * hand, marked printed from the list, then cancelled — and the cancel dialog names the printed
   * number before the press. Scanned afterwards, the desk answers in red with no button; the
   * registration's own page wears the chip; the list's bibs panel names the number as a link.
   */
  test("a cancelled registration's printed bib is void: the desk says so in red, the page and the list name it", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    // A walk-in at the desk, confirmed on the spot (§67).
    await page.goto("/ro/admin/checkin");
    const option = page.locator('select[name="eventId"] option', { hasText: FEATURED.title });
    const eventId = (await option.getAttribute("value")) as string;
    await page.selectOption('select[name="eventId"]', eventId);
    await page.getByRole("button", { name: "Caută" }).click();

    const suffix = `${test.info().project.name}-void-${Date.now().toString(36)}`;
    const name = `Anulat ${suffix}`;
    await page.getByRole("link", { name: "Adaugă pe cineva" }).click();
    await hydrated(page);
    await page.locator('[name="firstName"]').fill("Anulat");
    await page.locator('[name="lastName"]').fill(suffix);
    await page.locator('[name="email"]').fill(`void-${suffix}@test.invalid`);
    await page.getByRole("checkbox", { name: /a cerut/ }).check();
    await page.getByRole("button", { name: "Adaugă înscrierea" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Persoana a fost adăugată", { timeout: 15_000 });
    await hydrated(page);
    await page.getByRole("textbox", { name: "Nume, număr sau cod" }).fill(suffix);
    await page.getByRole("button", { name: "Caută" }).click();
    await hydrated(page);
    const deskRow = page.getByTestId("desk-row").filter({ hasText: suffix });
    await expect(deskRow).toHaveCount(1);
    const code = (await deskRow.locator("span, p").filter({ hasText: /^[A-HJ-NP-Z2-9]{10}$/ }).first().textContent()) as string;

    // The registration's own page. The window is open, so the number is provisional (§214);
    // saving it by hand settles it (§230) — which is what makes it printable.
    await page.goto(`/ro/admin/registrations?q=${encodeURIComponent(suffix)}`);
    await hydrated(page);
    await page.getByRole("link", { name: `Deschide înscrierea lui ${name}` }).click();
    await expect(page).toHaveURL(/\/admin\/registrations\/[0-9a-f-]{36}/);
    const detailUrl = page.url();
    await page.locator("summary", { hasText: "Schimbă numărul" }).click();
    await page.getByRole("button", { name: "Salvează nr." }).click();
    await page.waitForURL(/saved=bibSet/);
    const settled = (await page.getByText(/Numărul de concurs este \d+/).textContent()) as string;
    const bib = (settled.match(/Numărul de concurs este (\d+)/) as RegExpMatchArray)[1];

    // "This bib is on paper" from the list's ⋮ menu (§264).
    await page.goto(`/ro/admin/registrations?q=${encodeURIComponent(suffix)}`);
    await hydrated(page);
    await page.getByRole("button", { name: `Acțiuni pentru ${name}` }).click();
    await page.getByRole("menuitem", { name: "Marchează BID-ul ca printat" }).click();
    await page.waitForURL(/saved=bibsPrinted/);

    // The bulk cancel names the printed number among the rows it shows, before any press. (The
    // mark returns to the registration's own page, so back to the list for it.)
    await page.goto(`/ro/admin/registrations?q=${encodeURIComponent(suffix)}`);
    await hydrated(page);
    await page.locator("summary", { hasText: "Anulează înscrierile bifate" }).click();
    await expect(page.locator("#main").getByTestId("bulk-cancel-printed")).toContainText(`deja tipărite: ${bib}.`);

    // Cancel, and be told about the paper before the press.
    await page.goto(detailUrl);
    await hydrated(page);
    // The cancel's reason; the erase panel has a `reason` of its own, folded away.
    await page.getByRole("textbox", { name: "Motivul" }).fill("nu mai vine");
    await page.getByRole("button", { name: "Anulează înscrierea" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Numărul ${bib} e deja tipărit`);
    await dialog.getByRole("button", { name: "Anulează înscrierea" }).click();
    await page.waitForURL(/saved=registrationCancelled/);
    await expect(page.getByTestId("void-bib")).toContainText(`BID ${bib} tipărit`);
    await expect(page.getByText(/Anulată:/)).toContainText(`BID ${bib} tipărit`);

    // The desk, scanned: red first, and nothing to press.
    await page.goto(`/ro/admin/checkin/${code}`);
    const scanned = page.getByTestId("desk-row");
    await expect(scanned).toContainText(suffix);
    const red = page.getByTestId("desk-void");
    await expect(red).toContainText("Înscriere anulată pe");
    await expect(red).toContainText(`Numărul ${bib} a fost tipărit — nu se dă`);
    await expect(scanned.getByRole("button", { name: "Marchează prezent" })).toHaveCount(0);
    await expect(scanned.getByRole("button", { name: "Confirmă pe hârtie" })).toHaveCount(0);
    await expect(scanned.getByRole("spinbutton")).toHaveCount(0);

    // And by its number, typed at the desk: the same row, the same red line — never "nobody".
    await page.goto(`/ro/admin/checkin?eventId=${eventId}&q=${bib}`);
    await expect(page.getByTestId("desk-row").filter({ hasText: suffix })).toHaveCount(1);
    await expect(page.getByTestId("desk-void")).toContainText("Înscriere anulată pe");

    // The list's bibs panel names the number, whose it was and what happened, as one visible
    // link to the row — readable on a phone, not hidden in a tooltip.
    await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
    // The page is never wider than the screen (§313): an absolutely positioned descendant that
    // escaped the table's scroll area once stretched this list to ~600 px on a 320 px phone, the
    // browser zoomed out, and every tap below landed on something else.
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(widths.doc, "the registrations list overflows the viewport horizontally").toBeLessThanOrEqual(widths.view);
    const voidLine = page.locator("#main").getByTestId("registrations-void-bibs");
    await expect(voidLine).toContainText("de scos din teanc");
    await voidLine.getByRole("link", { name: `Numărul ${bib}: ${name}, înscriere anulată pe` }).click();
    await expect(page).toHaveURL(detailUrl.replace(/\?.*$/, ""));

    // The banner a bulk cancel returns to names the printed numbers it voided, as the action
    // writes them into the address — and only numbers, whatever else the address carries.
    await page.goto(`/ro/admin/registrations?eventId=${eventId}&saved=registrationsCancelled&cancelled=1&failed=0&voided=${bib},x`);
    await expect(page.locator("#main").getByTestId("registrations-cancelled-voided")).toHaveText(
      `Numere deja tipărite, retrase acum: ${bib}. Scoate-le din teanc — nu se dau altcuiva.`,
    );
  });
});
