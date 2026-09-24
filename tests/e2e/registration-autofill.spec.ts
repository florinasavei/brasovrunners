import { expect, test, type Page } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §282 — what a password manager does to this form, and what a person refused by
 * the anti-bot check is shown.
 *
 * The owner, 2026-09-22: "we need to test with auto-fill properly", "I want clear visual feedback
 * when people are not let through", and "I also want to give real people the option to fix it."
 * The three are one journey, and only a browser can prove it.
 *
 * Playwright cannot ask Chrome to run its own autofill, so these do what autofill does: put a
 * value into every input the page has, including the offscreen trap the person never sees. That
 * is the whole of the behaviour under test — a browser filling a field the form hid.
 */
const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

async function fillRequired(page: Page, email: string, lastName = "Popescu") {
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName,
    email,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`[name="${name}"]`).fill(value);
  }
  // A fill that lands just before the form finishes hydrating can be wiped by it — seen on the
  // first box, under load, as "Prenume" empty and the press refused by the browser. One more
  // pass puts back whatever went missing, and changes nothing that did not.
  for (const [name, value] of Object.entries(values)) {
    const box = page.locator(`[name="${name}"]`);
    // Spaces aside: the telephone boxes group the digits as they arrive (§337), which is not a wipe.
    if ((await box.inputValue()).replace(/\s/g, "") !== value.replace(/\s/g, "")) await box.fill(value);
  }
  await page.locator('[name="emailConfirm"]').fill(email);
  await page.locator('[name="privacyAcknowledged"]').check();
  await page.locator('[name="rulesAcknowledged"]').check();
  await page.locator('[name="fitnessDeclared"]').check();
}

/** What a password manager does: write into the hidden field as if it were a real one. */
async function autofillTheTrap(page: Page, value: string) {
  await page.locator('[name="honeypot"]').evaluate((element, text) => {
    (element as HTMLInputElement).value = text as string;
  }, value);
}

const address = () => `e2e-autofill-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;

test.describe("§282 a browser that fills the hidden field does not cost the club an entrant", () => {
  test("accepts a registration whose trap the browser filled with the runner's own address", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const email = address();
    await fillRequired(page, email);
    // Exactly what Chrome does with a saved identity: the address goes into every field it
    // believes is an address field, and the trap is one of them.
    await autofillTheTrap(page, email);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    // Through, first time: the value in the trap is the person's own, which no bot would put
    // there. No refusal, and the confirmation page rather than the form again.
    await expect(page).toHaveURL(/submitted=/);
    await expect(page.getByText(/Mai încearcă o dată/)).toHaveCount(0);
  });

  test("refuses a trap filled with somebody else's spam, says so, and lets the second press through", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const email = address();
    await fillRequired(page, email);
    await autofillTheTrap(page, "https://cheap-seo.example");
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    /*
      The visual feedback (§282). Everything a person needs at this moment, where the browser
      lands them: that they were taken for a robot, that nothing was registered, that no email is
      coming — the promise §217 forbids making falsely — and a button right there.
    */
    const summary = page.locator("#registration-errors");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Mai încearcă o dată");
    await expect(summary).toContainText(/nu ți-am trimis niciun email/i);
    // The button lives inside the form, not in the alert: a submitter outside the form does
    // not drive a Server Action, which is what the first version of this got wrong (§282).
    const again = page.getByRole("button", { name: "Trimite din nou înscrierea" });
    await expect(again).toBeVisible();

    /*
      And the way out, in **one press** (§286; the owner: "gen vreau ca dani sa mai apese inca o
      data submit si atat!").

      Nothing is re-typed and nothing is re-ticked: the answers and the three consents come back
      with the form. The trap is still filled, as a password manager would refill it on every
      render, and the submission is accepted because a second attempt is not refused by a guess.
    */
    await expect(page.locator('[name="privacyAcknowledged"]')).toBeChecked();
    await expect(page.locator('[name="rulesAcknowledged"]')).toBeChecked();
    await expect(page.locator('[name="fitnessDeclared"]')).toBeChecked();
    await autofillTheTrap(page, "https://cheap-seo.example");
    await again.click();
    await expect(page).toHaveURL(/submitted=/);
  });

  /**
   * §312 — Amalia's report, end to end: the same person, autofilled, sends the form twice.
   *
   * The visitor sees the same screen both times (§19.4: nothing public says whether an address
   * was already registered). The club, which saw nothing before, finds her by name from the
   * list without having chosen an event, sees the row marked, and reads on her timeline that
   * she came back while still waiting for the email link — and what was re-sent.
   */
  test("a second submission is the same screen for the visitor, and the club can see it", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    const email = address();
    const lastName = `Reinscris${test.info().project.name}${Date.now().toString(36)}`;
    const screens: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto(registerPath);
      await hydrated(page);
      await fillRequired(page, email, lastName);
      // Exactly what autofill does, both times.
      await autofillTheTrap(page, email);
      await page.getByRole("button", { name: "Trimite înscrierea" }).click();
      await expect(page).toHaveURL(/submitted=/);
      screens.push(await page.locator("#main").innerText());
    }
    // Word for word the same: the screen is not where "already registered" may be said.
    expect(screens[1]).toBe(screens[0]);

    // The list, searched by name with no event chosen: every event, and it says so.
    await page.goto(`/ro/admin/registrations?q=${encodeURIComponent(lastName)}`);
    await hydrated(page);
    await expect(page.locator("#main").getByTestId("registrations-search-everywhere")).toContainText(
      "Caut în toate evenimentele",
    );
    await expect(page.getByRole("combobox", { name: "Evenimente" })).toHaveText("Toate evenimentele, pentru căutarea după nume");
    // The row is marked, in words a phone shows (the table on a laptop, the card on a phone).
    await expect(page.locator('#main [data-testid="resubmitted-chip"]:visible')).toContainText("Reînscriere ×1");

    // The export is the set on screen (§15.10): it names the scope the screen used — every
    // event — and the file holds her. `all` used to reach the query as an event id and fail.
    const csvHref = (await page.getByRole("link", { name: "Exportă CSV" }).getAttribute("href")) as string;
    expect(csvHref).toContain("eventId=all");
    const csv = await page.request.get(csvHref);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain(lastName);

    await page.getByRole("link", { name: `Deschide înscrierea lui Ana ${lastName}` }).click();
    await expect(page).toHaveURL(/\/admin\/registrations\/[0-9a-f-]{36}/);
    const line = page.getByTestId("timeline-resubmitted");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("S-a înscris din nou cu aceeași adresă");
    await expect(line).toContainText("(Așteaptă confirmarea emailului)");
    await expect(line).toContainText("i-am retrimis „Confirmă adresa de email”");
    // It is what the person did, so it is not in the team's own trail.
    await expect(page.getByRole("heading", { name: "Ce a făcut echipa" })).toHaveCount(0);
  });

  test("the way out is a real target on a phone", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page, address());
    await autofillTheTrap(page, "https://cheap-seo.example");
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    const again = page.getByRole("button", { name: "Trimite din nou înscrierea" });
    const box = await again.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
