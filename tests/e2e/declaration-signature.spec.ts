import { expect, test, type Page } from "@playwright/test";
import { mintActionLink, registrationByEmail, registrationStatus, type RegistrationRow } from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-033-02 criterion 15, §314 — the signature on the declaration is the registered name.
 *
 * The owner, looking at the signing form with "Florin Munca2" typed under "You registered as
 * Florin Munca — type the same name": "can I also have this validation here? So I have to type
 * the exact name? and this name should be bolded!"
 *
 * Two journeys: with JavaScript, where the browser itself refuses the press and points at the
 * box; and without it, where the server refuses, says why beside the box, and brings back what
 * was typed. In both the right name — typed in lower case, as a phone types it — then signs.
 *
 * The links the emails would carry are minted in the database (`support/action-link.ts`): the
 * captured emails that hold the real ones live in the server's memory, on purpose.
 */
test.describe("BR-REQ-033-02 §314 the signature is the registered name", () => {
  // A registration, an email confirmation and a signature: several round trips under load.
  test.describe.configure({ timeout: 90_000 });

  const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

  /**
   * A registration through the public form, confirmed by its link: waiting for its declaration.
   * `minor` registers a child, entered by a parent whose name the declaration then wants (§108).
   */
  async function awaitingDeclaration(
    page: Page,
    tag: string,
    { minor = false }: { minor?: boolean } = {},
  ): Promise<RegistrationRow & { link: string; guardianName: string | null }> {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const suffix = `${tag}-${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-sign-${suffix}@test.invalid`;
    const guardianName = minor ? `Maria Munca ${suffix}` : null;
    const values: Record<string, string> = {
      firstName: "Florin",
      lastName: `Munca ${suffix}`,
      email,
      // A minor is fourteen to seventeen since the minimum age (§NNN): fifteen years before this
      // year is fourteen or fifteen today and on any race day the seed can hold, and still under
      // eighteen, whatever year the suite runs in.
      birthDate: minor ? `${new Date().getFullYear() - 15}-05-17` : "1990-05-17",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    // The parent's box opens once the birth date says the runner is a minor (§188).
    if (guardianName) await page.locator('[name="guardianName"]').fill(guardianName);
    await page.locator('[name="emailConfirm"]').fill(email);
    await page.locator('[name="privacyAcknowledged"]').check();
    await page.locator('[name="rulesAcknowledged"]').check();
    await page.locator('[name="fitnessDeclared"]').check();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page).toHaveURL(/submitted=/, { timeout: 30_000 });

    const registration = await registrationByEmail(email);
    // The email link, pressed: the confirmation page presses its own button once hydrated (§238).
    await page.goto(`/ro/inregistrari/confirmare/${await mintActionLink(registration, "VERIFY_REGISTRATION_EMAIL")}`);
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

    return {
      ...registration,
      guardianName,
      link: `/ro/inregistrari/declaratie/${await mintActionLink(registration, "COMPLETE_DECLARATION")}`,
    };
  }

  /** The tick and, when the club's text names one, the identity document. */
  async function fillTheRest(page: Page) {
    await page.locator('[name="accepted"]').check();
    const idDocument = page.locator('[name="idDocument"]');
    if (await idDocument.count()) await idDocument.fill("BV 123456");
  }

  test("the browser refuses a name that is not the registered one, and the right one in lower case signs", async ({ page }) => {
    const registration = await awaitingDeclaration(page, "js");
    await page.goto(registration.link);
    await hydrated(page);

    // The hint names the registered name, in bold.
    const hint = page.locator("#typedName-helper-text");
    await expect(hint.locator("strong")).toHaveText(registration.registeredName);

    await fillTheRest(page);
    const signature = page.locator('[name="typedName"]');
    await signature.fill(`${registration.registeredName}2`);
    await page.getByRole("button", { name: "Semnează și confirmă" }).click();

    /*
      Refused before the press reached the server: the box carries a custom validity naming the
      name it wants — the browser's own bubble — and the same sentence is under it. The page did
      not go anywhere, and nothing was recorded.
    */
    await expect(hint).toContainText("Semnătura trebuie să fie exact numele cu care te-ai înscris");
    // Red, and the name still in bold: the moment somebody looks for it is the moment it matters.
    await expect(hint.locator("strong")).toHaveText(registration.registeredName);
    // No summary above the form on this path, so what to do about a wrong registered name is here.
    await expect(hint).toContainText("Dacă numele de la înscriere este greșit");
    expect(await signature.evaluate((input) => (input as HTMLInputElement).validity.customError)).toBe(true);
    expect(await signature.evaluate((input) => (input as HTMLInputElement).validationMessage)).toContain(registration.registeredName);
    expect(page.url()).not.toMatch(/[?&](done|invalid)=/);
    expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

    // The right name as a phone types it: lower case. The refusal clears, and it signs.
    await signature.fill(registration.registeredName.toLowerCase());
    expect(await signature.evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(true);
    await page.getByRole("button", { name: "Semnează și confirmă" }).click();
    await expect(page).toHaveURL(/done=confirmed/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("CONFIRMED");
  });

  test("without JavaScript the server refuses it, says which name beside the box, and keeps what was typed", async ({ page, browser }) => {
    const registration = await awaitingDeclaration(page, "nojs");

    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    try {
      const plain = await context.newPage();
      await plain.goto(registration.link);
      await fillTheRest(plain);
      await plain.locator('[name="typedName"]').fill("Munca Florin");
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();

      // Its own refusal — never "the link is no longer valid" — and what to do about it.
      await expect(plain).toHaveURL(/[?&]invalid=name#declaration-errors$/, { timeout: 30_000 });
      const summary = plain.locator("#declaration-errors");
      await expect(summary).toBeVisible();
      await expect(summary).toContainText("linkul tău este în regulă");
      await expect(summary).toContainText("Dacă numele de la înscriere este greșit");
      await expect(summary.getByRole("link", { name: "Scrie numele complet ca semnătură" })).toHaveAttribute("href", "#typedName");
      /*
        The name it wants is said once, under the box, in bold, in the red state — and neither
        sentence twice: the summary does not repeat the mismatch, the box does not repeat what to
        do about a wrong registered name (§314, found in review).
      */
      const underBox = plain.locator("#typedName-helper-text");
      await expect(underBox).toContainText("Semnătura trebuie să fie exact numele cu care te-ai înscris");
      await expect(underBox.locator("strong")).toHaveText(registration.registeredName);
      await expect(underBox).not.toContainText("Dacă numele de la înscriere este greșit");
      await expect(summary).not.toContainText("Semnătura trebuie să fie exact");
      // Nothing about the person in the address: the code, and only the code.
      expect(plain.url()).not.toContain("Munca");
      expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

      // What was typed came back: one thing left to correct.
      await expect(plain.locator('[name="accepted"]')).toBeChecked();
      if (await plain.locator('[name="idDocument"]').count()) {
        await expect(plain.locator('[name="idDocument"]')).toHaveValue("BV 123456");
      }
      await expect(plain.locator('[name="typedName"]')).toHaveValue("Munca Florin");

      await plain.locator('[name="typedName"]').fill(registration.registeredName.toLowerCase());
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();
      await expect(plain).toHaveURL(/done=confirmed/, { timeout: 30_000 });
      expect(await registrationStatus(registration.id)).toBe("CONFIRMED");
    } finally {
      await context.close();
    }
  });

  test("a minor's declaration wants the parent's name, and a wrong parent name is sent to cancel and register again", async ({ page, browser }) => {
    const registration = await awaitingDeclaration(page, "minor", { minor: true });
    const parent = registration.guardianName ?? "";

    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    try {
      const plain = await context.newPage();
      await plain.goto(registration.link);
      // The parent signs (§108): the hint names the child and wants the parent's name, in bold.
      await expect(plain.locator("#typedName-helper-text strong")).toHaveText(parent);

      // The child's own name — the mistake a parent is likeliest to make — is refused.
      await fillTheRest(plain);
      await plain.locator('[name="typedName"]').fill(registration.registeredName);
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();
      await expect(plain).toHaveURL(/[?&]invalid=name#declaration-errors$/, { timeout: 30_000 });
      const summary = plain.locator("#declaration-errors");
      // The parent's name, in bold, under the box in its red state; the summary does not repeat it.
      await expect(plain.locator("#typedName-helper-text strong")).toHaveText(parent);
      await expect(plain.locator("#typedName-helper-text")).toContainText("numele părintelui sau tutorelui dat la înscriere");
      await expect(summary).not.toContainText("Semnătura trebuie să fie exact");
      /*
        §314, found in review: the club can correct a participant's name but not a parent's, so
        the minor's sentence never promises that. It points at what works — "Înscrierile mele",
        to cancel and register again.
      */
      await expect(summary).not.toContainText("clubul îl corectează");
      await expect(summary.getByRole("link", { name: "Înscrierile mele" })).toHaveAttribute("href", "/ro/inscrieri/ale-mele");
      expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

      await plain.locator('[name="typedName"]').fill(parent.toLowerCase());
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();
      await expect(plain).toHaveURL(/done=confirmed/, { timeout: 30_000 });
      expect(await registrationStatus(registration.id)).toBe("CONFIRMED");
    } finally {
      await context.close();
    }
  });
});
