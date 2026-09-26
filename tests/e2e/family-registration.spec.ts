import { expect, test, type Page } from "@playwright/test";
import {
  familyFlowOpen,
  mintActionLink,
  mintProfileLink,
  queuedPayloads,
  registrationsByEmail,
  registrationStatus,
} from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import { confirmDialog } from "./support/confirm";
import { openFold } from "./support/fold";

/**
 * §389, amended by §NNN — a family on one address, confirmed from the inbox (BR-REQ-032-03,
 * BR-REQ-031-01 criterion 3, BR-REQ-036-02). The owner, 2026-09-26: "în mail să îți afișez
 * înscrierile și să zic «confirm că înscriu altă persoană», dar trebuie să verific că numele e
 * diferit (ignorând whitespace) și data nașterii e complet diferită".
 *
 * The public form sent again from a registered address for a different person answers exactly as
 * any submission does and registers nobody; the address receives «Înscrii încă o persoană?» — who
 * it holds, the person the form named, one button; the button's page registers that person, who
 * goes straight to their declaration; "Înscrierile mele" lists both. The same name with another
 * birth date is a slip: nothing registered, the existing registration's email re-sent with one
 * sentence on how to register somebody else.
 *
 * The emails are read where the server captured them, on `/devs` → «Emailuri» (local and test
 * only): its real link, its real words. The whole journey needs the contract release
 * (`family-gate.ts`); before it, the first case holds as the older behaviour and the rest skip.
 */
test.describe("§389 §NNN a family on one address", () => {
  test.describe.configure({ timeout: 180_000 });

  const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

  type Person = { firstName: string; lastName: string; birthDate: string };

  async function fillPerson(page: Page, person: Person, email: string) {
    const values: Record<string, string> = {
      firstName: person.firstName,
      lastName: person.lastName,
      birthDate: person.birthDate,
      city: "Brașov",
      email,
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('[name="emailConfirm"]').fill(email);
    await page.locator('[name="privacyAcknowledged"]').check();
    await page.locator('[name="rulesAcknowledged"]').check();
    // The club's terms, accepted expressly (§421).
    await page.locator('[name="termsAccepted"]').check();
    await page.locator('[name="fitnessDeclared"]').check();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page).toHaveURL(/submitted=1/, { timeout: 30_000 });
  }

  async function publicSubmission(page: Page, person: Person, email: string): Promise<string> {
    await page.goto(registerPath);
    await hydrated(page);
    await fillPerson(page, person, email);
    // What the browser is shown: the one screen every submission gets (§39).
    return (await page.locator("main").innerText()).replaceAll(person.firstName, "<name>");
  }

  /**
   * The newest message the server captured for this address whose words contain `needle`, as
   * `/devs` → «Emailuri» shows it: its words and its links. The outbox drains after the response
   * that queued it, so it is waited for.
   */
  async function capturedEmail(page: Page, email: string, needle: string): Promise<{ text: string; links: string[] }> {
    let found: { text: string; links: string[] } | undefined;
    await expect(async () => {
      await page.goto("/ro/devs?panel=email");
      const boxes = page.getByTestId("captured-email").filter({ hasText: email });
      const all = await boxes.evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.querySelector('[data-testid="captured-text"]')?.textContent ?? "",
          links: Array.from(element.querySelectorAll("a")).map((anchor) => anchor.href),
        })),
      );
      found = all.find((message) => message.text.includes(needle));
      expect(found).toBeTruthy();
    }).toPass({ timeout: 45_000 });
    return found!;
  }

  test("the form sent again for a different person answers as any submission does, and registers nobody", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const registered = `e2e-family-a-${suffix}@test.invalid`;
    const fresh = `e2e-family-b-${suffix}@test.invalid`;
    const lastName = `Pop ${suffix}`;

    await publicSubmission(page, { firstName: "Ana", lastName, birthDate: "1985-03-02" }, registered);
    const again = await publicSubmission(page, { firstName: "Maria", lastName, birthDate: "1990-07-11" }, registered);
    const first = await publicSubmission(page, { firstName: "Maria", lastName, birthDate: "1990-07-11" }, fresh);

    // The same screen, word for word, but for the address it names — which is the one just typed.
    expect(again.replaceAll(registered, "<address>")).toBe(first.replaceAll(fresh, "<address>"));
    const rows = await registrationsByEmail(registered);
    expect(rows.map((row) => row.registeredName)).toEqual([`Ana ${lastName}`]);
    // Only the inbox learns which case it was — once the flow is open.
    const offers = await queuedPayloads(rows[0].id, "REGISTER_ANOTHER_PERSON");
    expect(offers).toHaveLength((await familyFlowOpen()) ? 1 : 0);
  });

  test("the email lists the address and names the person; one confirmation registers them, straight to the declaration", async ({ page }) => {
    test.skip(!(await familyFlowOpen()), "the family flow opens with the contract release that drops registrations_event_participant_unique (§389)");
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-family-${suffix}@test.invalid`;
    const lastName = `Pop ${suffix}`;

    await publicSubmission(page, { firstName: "Ana", lastName, birthDate: "1985-03-02" }, email);
    await publicSubmission(page, { firstName: "Maria", lastName, birthDate: "1990-07-11" }, email);
    const [ana] = await registrationsByEmail(email);
    expect(await queuedPayloads(ana.id, "REGISTER_ANOTHER_PERSON")).toEqual([
      { atCap: false, registrationsPerAddress: expect.any(Number), familyEntryId: expect.any(String) },
    ]);

    // The captured email: who the address holds, the person the form named, one button.
    const offer = await capturedEmail(page, email, "Înscriși deja cu această adresă");
    expect(offer.text).toContain("Înscriși deja cu această adresă: Ana P.");
    expect(offer.text).toContain(`Persoana din formular: Maria ${lastName}, data nașterii 11.07.1990.`);
    expect(offer.text).toContain("Confirm că înscriu altă persoană");
    const link = offer.links.find((href) => href.includes("/inregistrari/familie/"));
    expect(link).toBeTruthy();

    // The page the button opens: the same facts, and nothing registered by opening it (GET never mutates).
    await page.goto(link!);
    await hydrated(page);
    await expect(page.getByTestId("family-registered")).toContainText("Ana P.");
    await expect(page.getByTestId("family-person")).toContainText(`Maria ${lastName}`);
    await expect(page.getByTestId("family-person")).toContainText("11.07.1990");
    expect(await registrationsByEmail(email)).toHaveLength(1);
    // The page never scrolls sideways at 320 pixels, and the button is a thumb's target.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The shared send button inside its wrapper (§371): the press is held while the first is in flight.
    const confirm = page.getByTestId("family-confirm").getByRole("button");
    expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Another adult: the address holder acknowledges that the person declares their own fitness (§421).
    await page.locator('[name="fitnessAcknowledged"]').check();
    await confirm.click();
    await expect(page).toHaveURL(/done=declare/, { timeout: 30_000 });
    await expect(page.getByTestId("family-confirmed")).toBeVisible();

    const [first, second] = await registrationsByEmail(email);
    expect([first.registeredName, second.registeredName]).toEqual([`Ana ${lastName}`, `Maria ${lastName}`]);
    expect(second.participantId).toBe(first.participantId);
    // Confirmed from the inbox: no second confirmation link, straight to the declaration.
    expect(await registrationStatus(second.id)).toBe("PENDING_DECLARATION");

    // Spent: the same link again is the one generic notice.
    await page.goto(link!);
    await expect(page.getByTestId("family-confirm")).toHaveCount(0);

    // She signs her own declaration, alone.
    await page.goto(`/ro/inregistrari/declaratie/${await mintActionLink(second, "COMPLETE_DECLARATION")}`);
    await hydrated(page);
    await page.locator('[name="accepted"]').check();
    const idDocument = page.locator('[name="idDocument"]');
    if (await idDocument.count()) await idDocument.fill("BV 123456");
    await page.locator('[name="typedName"]').fill(second.registeredName);
    await page.getByRole("button", { name: "Semnează și confirmă" }).click();
    await expect(page).toHaveURL(/done=confirmed/, { timeout: 30_000 });
    expect(await registrationStatus(second.id)).toBe("CONFIRMED");

    // "Înscrierile mele" lists both, each by name (§77).
    await page.goto(`/ro/inscrieri/ale-mele/${await mintProfileLink(first.participantId)}`);
    const names = page.getByTestId("my-registration-name");
    await expect(names).toHaveCount(2);
    await expect(names.filter({ hasText: `Ana ${lastName}` })).toHaveCount(1);
    await expect(names.filter({ hasText: `Maria ${lastName}` })).toHaveCount(1);
  });

  test("the registered name with another birth date registers nobody, and the re-send says how to register somebody else", async ({ page }) => {
    test.skip(!(await familyFlowOpen()), "the family flow opens with the contract release that drops registrations_event_participant_unique (§389)");
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-family-slip-${suffix}@test.invalid`;
    const lastName = `Pop ${suffix}`;

    await publicSubmission(page, { firstName: "Ana", lastName, birthDate: "1985-03-02" }, email);
    await publicSubmission(page, { firstName: "Ana", lastName, birthDate: "1999-01-01" }, email);

    const rows = await registrationsByEmail(email);
    expect(rows).toHaveLength(1);
    expect(await queuedPayloads(rows[0].id, "REGISTER_ANOTHER_PERSON")).toEqual([]);
    expect(await queuedPayloads(rows[0].id, "VERIFY_REGISTRATION_EMAIL")).toEqual([{}, { anotherPersonHint: true }]);

    // The re-sent email, as captured: the sentence, in both halves.
    const resent = await capturedEmail(page, email, "Dacă vrei să înscrii pe altcineva, trimite formularul cu numele complet și data de naștere a acelei persoane.");
    expect(resent.text).toContain("If you want to register someone else, send the form with that person's full name and birth date.");
  });

  test("a link from an older email that opened the form for another person says it is no longer used", async ({ page }) => {
    await page.goto(`${registerPath}?another=an-older-emails-link`);
    await expect(page.getByTestId("another-person-link-gone")).toBeVisible();
    // The ordinary form, the address asked twice as always.
    await expect(page.locator('[name="emailConfirm"]')).toHaveCount(1);
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
    // The section by its own summary: other sections name it in their steps, and its jobs are
    // folds of their own inside it (§NNN).
    const summary = page.locator("summary", { hasText: "O familie pe o singură adresă" });
    const section = summary.locator("xpath=..");
    await summary.click();
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
