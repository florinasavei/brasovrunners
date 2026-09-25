import { expect, test, type Page } from "@playwright/test";
import {
  familyFlowOpen,
  mintActionLink,
  mintProfileLink,
  queuedPayloads,
  registrationsByEmail,
  registrationStatus,
  type RegistrationRow,
} from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import { confirmDialog } from "./support/confirm";
import { openFold } from "./support/fold";

/**
 * §389 — a family on one address, through the inbox (BR-REQ-032-03, BR-REQ-031-01 criterion 3,
 * BR-REQ-036-02). The owner, 2026-09-25: "people must have this in the flow via email, like 'you are
 * already registered, register for another person?'".
 *
 * The public form sent again with a registered address and another name answers exactly as any
 * submission does, and creates nothing; the address receives the message with a single-use link to
 * the form for the other person, the address fixed; that form registers the second person, who then
 * confirms and signs alone; "Înscrierile mele" lists both.
 *
 * The links the emails would carry are minted in the database (`support/action-link.ts`): captured
 * messages live in the server's memory, on purpose. The whole journey needs the contract release
 * (`family-gate.ts`); before it, the first case below holds as today's behaviour and the second is
 * skipped, saying why.
 */
test.describe("§389 a family on one address", () => {
  test.describe.configure({ timeout: 150_000 });

  const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

  async function fillPerson(page: Page, person: { firstName: string; lastName: string; birthDate: string }, email?: string) {
    const values: Record<string, string> = {
      firstName: person.firstName,
      lastName: person.lastName,
      birthDate: person.birthDate,
      city: "Brașov",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    if (email) {
      values.email = email;
      values.phone = "+40711111111";
    }
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    if (email) await page.locator('[name="emailConfirm"]').fill(email);
    await page.locator('[name="privacyAcknowledged"]').check();
    await page.locator('[name="rulesAcknowledged"]').check();
    await page.locator('[name="fitnessDeclared"]').check();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page).toHaveURL(/submitted=1/, { timeout: 30_000 });
  }

  async function publicSubmission(page: Page, firstName: string, lastName: string, email: string): Promise<string> {
    await page.goto(registerPath);
    await hydrated(page);
    await fillPerson(page, { firstName, lastName, birthDate: "1985-03-02" }, email);
    // What the browser is shown: the one screen every submission gets (§39).
    return (await page.locator("main").innerText()).replaceAll(firstName, "<name>");
  }

  async function confirmAndSign(page: Page, registration: RegistrationRow) {
    await page.goto(`/ro/inregistrari/confirmare/${await mintActionLink(registration, "VERIFY_REGISTRATION_EMAIL")}`);
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");
    await page.goto(`/ro/inregistrari/declaratie/${await mintActionLink(registration, "COMPLETE_DECLARATION")}`);
    await hydrated(page);
    await page.locator('[name="accepted"]').check();
    const idDocument = page.locator('[name="idDocument"]');
    if (await idDocument.count()) await idDocument.fill("BV 123456");
    await page.locator('[name="typedName"]').fill(registration.registeredName);
    await page.getByRole("button", { name: "Semnează și confirmă" }).click();
    await expect(page).toHaveURL(/done=confirmed/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("CONFIRMED");
  }

  test("the form sent again with another name answers as any submission does, and creates nothing", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const registered = `e2e-family-a-${suffix}@test.invalid`;
    const fresh = `e2e-family-b-${suffix}@test.invalid`;

    await publicSubmission(page, "Ana", `Pop ${suffix}`, registered);
    const again = await publicSubmission(page, "Maria", `Pop ${suffix}`, registered);
    const first = await publicSubmission(page, "Maria", `Pop ${suffix}`, fresh);

    // The same screen, word for word, but for the address it names — which is the one just typed.
    expect(again.replaceAll(registered, "<address>")).toBe(first.replaceAll(fresh, "<address>"));
    const rows = await registrationsByEmail(registered);
    expect(rows.map((row) => row.registeredName)).toEqual([`Ana Pop ${suffix}`]);
    // Only the inbox learns which case it was — once the flow is open.
    const offers = await queuedPayloads(rows[0].id, "REGISTER_ANOTHER_PERSON");
    expect(offers).toHaveLength((await familyFlowOpen()) ? 1 : 0);
  });

  test("the emailed link registers the other person on the same address; each confirms and signs alone", async ({ page }) => {
    test.skip(!(await familyFlowOpen()), "the family flow opens with the contract release that drops registrations_event_participant_unique (§389)");
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-family-${suffix}@test.invalid`;
    const lastName = `Pop ${suffix}`;

    await publicSubmission(page, "Ana", lastName, email);
    await publicSubmission(page, "Maria", lastName, email);
    const [ana] = await registrationsByEmail(email);
    expect(await queuedPayloads(ana.id, "REGISTER_ANOTHER_PERSON")).toEqual([{ atCap: false, registrationsPerAddress: expect.any(Number) }]);

    // The link in the email: the event's own form, the address fixed and read-only, no second box.
    const secret = await mintActionLink(ana, "REGISTER_ANOTHER_PERSON");
    await page.goto(`${registerPath}?another=${secret}`);
    await hydrated(page);
    await expect(page.getByTestId("another-person-notice")).toContainText(email);
    const fixed = page.getByTestId("another-person-email");
    await expect(fixed).toHaveValue(email);
    await expect(fixed).toHaveAttribute("readonly", /.*/);
    await expect(page.locator('[name="email"]')).toHaveCount(0);
    await expect(page.locator('[name="emailConfirm"]')).toHaveCount(0);
    // The runner's own telephone is optional here — a child often has none.
    await expect(page.locator('[name="phone"]')).not.toHaveAttribute("required", /.*/);
    // The page never scrolls sideways at 320 pixels, in its family shape too.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await fillPerson(page, { firstName: "Maria", lastName, birthDate: "1990-07-11" });
    await expect(page.getByRole("heading", { name: "Aproape gata, Maria!" })).toBeVisible();

    const [first, second] = await registrationsByEmail(email);
    expect([first.registeredName, second.registeredName]).toEqual([`Ana ${lastName}`, `Maria ${lastName}`]);
    expect(second.participantId).toBe(first.participantId);
    expect(second.status).toBe("PENDING_EMAIL_CONFIRMATION");

    // Spent: the same link again is the plain form, with one sentence saying the link is gone.
    await page.goto(`${registerPath}?another=${secret}`);
    await expect(page.getByTestId("another-person-link-gone")).toBeVisible();
    await expect(page.locator('[name="emailConfirm"]')).toHaveCount(1);

    // Everybody signs alone.
    await confirmAndSign(page, first);
    await confirmAndSign(page, second);

    // "Înscrierile mele" lists both, each by name (§77).
    await page.goto(`/ro/inscrieri/ale-mele/${await mintProfileLink(first.participantId)}`);
    const names = page.getByTestId("my-registration-name");
    await expect(names).toHaveCount(2);
    await expect(names.filter({ hasText: `Ana ${lastName}` })).toHaveCount(1);
    await expect(names.filter({ hasText: `Maria ${lastName}` })).toHaveCount(1);
  });
});

/**
 * §389 — "Maxim de înscrieri pe o adresă (pe eveniment)" in the "Termene" fold, the Administrator's,
 * and the staff guide's section that states it. Desktop only, like the deadlines beside it: one
 * `platform_settings` row, two projects, one database — and the default comes back at the end.
 */
test.describe("§389 the limit per address, set and stated", () => {
  // One after the other: the Organizer reads the row the Administrator's test changes and restores.
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("an Administrator changes the limit, the guide says the new number, and it goes back to four", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");
    const panel = main.getByTestId("deadlines");
    await openFold(panel);
    const cap = panel.getByTestId("address-cap");
    await expect(cap).toContainText("Maxim de înscrieri pe o adresă (pe eveniment)");
    const box = cap.locator('input[name="registrationsPerAddress"]');
    await expect(box).toHaveValue("4");

    const save = cap.getByRole("button", { name: "Salvează maximul" });
    // A thumb's target (BR-REQ-041-01 criterion 6).
    expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(36);
    await box.fill("3");
    await save.click();
    // Asks first (§384): a limit every public submission meets from now on.
    await confirmDialog(page, "Salvezi limita pe adresă?");
    await expect(main.getByText("Maximul de înscrieri pe o adresă a fost salvat", { exact: false })).toBeVisible();
    await expect(page.locator("#main").getByTestId("address-cap").locator('input[name="registrationsPerAddress"]')).toHaveValue("3");
    // The message that states it, in its when-line.
    await expect(main.locator("#email-REGISTER_ANOTHER_PERSON > summary")).toContainText("când formularul e trimis din nou cu altă persoană");

    await page.goto("/ro/admin/guide");
    const section = page.locator("details", { hasText: "O familie pe o singură adresă" });
    await section.locator("summary").click();
    await expect(section).toContainText("Pe o adresă se pot înscrie cel mult 3 persoane la un eveniment.");
    await expect(section).toContainText("câte un cod QR pentru fiecare persoană confirmată");

    // Back to the default, through the panel.
    await page.goto("/ro/admin/emails");
    const again = page.locator("#main").getByTestId("deadlines");
    await openFold(again);
    await again.getByTestId("address-cap").locator('input[name="registrationsPerAddress"]').fill("4");
    await again.getByTestId("address-cap").getByRole("button", { name: "Salvează maximul" }).click();
    await confirmDialog(page, "Salvezi limita pe adresă?");
    await expect(page.locator("#main").getByText("Maximul de înscrieri pe o adresă a fost salvat", { exact: false })).toBeVisible();
  });

  test("an Organizer reads the limit and is offered no form", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/emails");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.getByTestId("address-cap-value")).toHaveText("Pe o adresă se pot înscrie cel mult 4 persoane la un eveniment.");
    await expect(panel.getByTestId("address-cap").locator("input")).toHaveCount(0);
  });
});
