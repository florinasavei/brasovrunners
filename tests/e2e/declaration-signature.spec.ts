import { expect, test, type Page } from "@playwright/test";
import { latestAcceptance, mintActionLink, mintProfileLink, registrationByEmail, registrationStatus, type RegistrationRow } from "./support/action-link";
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
      // A minor is fourteen to seventeen since the minimum age (§321): fifteen years before this
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
    await page.locator('[name="termsAccepted"]').check();
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
    // §NNN: the participation confirmation is said in a toast too, once.
    await expect(page.getByTestId("toast")).toHaveText("Declarație semnată: înscrierea ta e confirmată.");
    await page.reload();
    await expect(page.getByTestId("toast-live")).toHaveCount(0);

    /*
      §NNN: and cancelling it from the participant's own link says so in a toast — the third public
      flow. It also gives the place back, so a run of this spec leaves the sample race as it found it.
    */
    await page.goto(`/ro/inregistrari/gestionare/${await mintActionLink(registration, "MANAGE_REGISTRATION")}`);
    await page.getByRole("button", { name: "Anulează înscrierea" }).click();
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    await expect(page.getByTestId("toast")).toHaveText("Gata: înscrierea ta e anulată.");
    expect(await registrationStatus(registration.id)).toBe("CANCELLED");
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

    /*
      §NNN: cancelling from «Înscrierile mele» (§77, BR-REQ-036-04) says so in a toast too, once —
      and gives the place back, so this case leaves the sample race as it found it.
    */
    await page.goto(`/ro/inscrieri/ale-mele/${await mintProfileLink(registration.participantId)}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Renunț la această înscriere" }).click();
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    await expect(page.getByTestId("toast")).toHaveText("Gata: înscrierea ta e anulată.");
    expect(await registrationStatus(registration.id)).toBe("CANCELLED");
    await page.reload();
    await expect(page.getByTestId("toast-live")).toHaveCount(0);
  });

  /**
   * The minor's and the parent's documents (§330), always asked here, and filled without asking
   * whether the boxes exist (found in review: a conditional fill let the spec pass silently on a
   * text that asked for none, and never proved both documents are stored). Every non-production
   * database carries the approved sample declaration, which is the platform's text
   * (`db/seeds/sample-legal-documents.ts`) and names `{{participantIdDocument}}` and
   * `{{guardianIdDocument}}` — an older seed named `{{idDocument}}`, which asks just the same
   * (`asksForIdDocument`). A database whose declaration asks for no document fails here, loudly.
   */
  async function fillBothDocuments(page: Page) {
    await page.locator('[name="accepted"]').check();
    await expect(page.locator('[name="minorIdDocument"]')).toHaveCount(1);
    await expect(page.locator('[name="idDocument"]')).toHaveCount(1);
    await page.locator('[name="minorIdDocument"]').fill("MP 654321");
    await page.locator('[name="idDocument"]').fill("BV 123456");
  }

  /**
   * §330 — the owner: "I wanna have the ID document of the minor and the parent, and also 2
   * signatures!" A minor's declaration is signed by both at one press, each with their own name
   * and document; each box is checked against its own name, and each refused box says its own way
   * out: the club corrects a minor's registered name, and nobody corrects a parent's, so that one
   * is "cancel and register again" (§314).
   */
  test("a minor's declaration is signed by the minor and the parent, each name checked, each refusal its own", async ({ page, browser }) => {
    const registration = await awaitingDeclaration(page, "minor", { minor: true });
    const parent = registration.guardianName ?? "";
    const child = registration.registeredName;

    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
    try {
      const plain = await context.newPage();
      await plain.goto(registration.link);
      // Two boxes, each wanting its own name, in bold: the minor's registered name and the parent's.
      await expect(plain.locator("#minorTypedName-helper-text strong")).toHaveText(child);
      await expect(plain.locator("#typedName-helper-text strong")).toHaveText(parent);
      await expect(plain.getByLabel("Semnătura minorului")).toHaveAttribute("name", "minorTypedName");
      await expect(plain.getByLabel("Semnătura părintelui sau tutorelui")).toHaveAttribute("name", "typedName");

      // The child's own name in the parent's box — the mistake a parent is likeliest to make — is refused.
      await fillBothDocuments(plain);
      await plain.locator('[name="minorTypedName"]').fill(child);
      await plain.locator('[name="typedName"]').fill(child);
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();
      await expect(plain).toHaveURL(/[?&]invalid=name#declaration-errors$/, { timeout: 30_000 });
      let summary = plain.locator("#declaration-errors");
      // The parent's name, in bold, under the parent's box in its red state; the summary does not repeat it.
      await expect(plain.locator("#typedName-helper-text strong")).toHaveText(parent);
      await expect(plain.locator("#typedName-helper-text")).toContainText("numele părintelui sau tutorelui dat la înscriere");
      // The minor's box was right: it is not named, and it is not red.
      await expect(plain.locator("#minorTypedName-helper-text")).not.toContainText("trebuie să fie exact");
      await expect(summary.getByRole("link", { name: "Semnătura părintelui sau tutorelui" })).toHaveAttribute("href", "#typedName");
      await expect(summary.getByRole("link", { name: "Semnătura minorului" })).toHaveCount(0);
      await expect(summary).not.toContainText("Semnătura trebuie să fie exact");
      /*
        §314, found in review: the club can correct a participant's name but not a parent's, so
        the parent's sentence never promises that. It points at what works — "Înscrierile mele",
        to cancel and register again.
      */
      await expect(summary).not.toContainText("clubul îl corectează");
      await expect(summary.getByRole("link", { name: "Înscrierile mele" })).toHaveAttribute("href", "/ro/inscrieri/ale-mele");
      expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");
      // Everything typed came back: both documents and both signatures.
      await expect(plain.locator('[name="minorIdDocument"]')).toHaveValue("MP 654321");
      await expect(plain.locator('[name="idDocument"]')).toHaveValue("BV 123456");
      await expect(plain.locator('[name="minorTypedName"]')).toHaveValue(child);

      // Now the parent's box right and the minor's wrong: the minor's box is the one named.
      await plain.locator('[name="typedName"]').fill(parent.toLowerCase());
      await plain.locator('[name="minorTypedName"]').fill(parent);
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();
      await expect(plain).toHaveURL(/[?&]invalid=name#declaration-errors$/, { timeout: 30_000 });
      summary = plain.locator("#declaration-errors");
      await expect(plain.locator("#minorTypedName-helper-text")).toContainText("Semnătura minorului trebuie să fie exact numele cu care a fost înscris");
      await expect(plain.locator("#minorTypedName-helper-text strong")).toHaveText(child);
      await expect(summary.getByRole("link", { name: "Semnătura minorului" })).toHaveAttribute("href", "#minorTypedName");
      // A minor's registered name is one the club corrects, and the same link then signs.
      await expect(summary).toContainText("clubul îl corectează");
      expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

      // Both right, as a phone types them: signed, and both recorded, each with its document.
      await plain.locator('[name="minorTypedName"]').fill(child.toLowerCase());
      await plain.getByRole("button", { name: "Semnează și confirmă" }).click();
      await expect(plain).toHaveURL(/done=confirmed/, { timeout: 30_000 });
      expect(await registrationStatus(registration.id)).toBe("CONFIRMED");
      const acceptance = await latestAcceptance(registration.id);
      expect(acceptance?.typedName).toBe(parent.toLowerCase());
      expect(acceptance?.minorTypedName).toBe(child.toLowerCase());
      // Each document in its own column, as one line with its kind (§283): the parent's where the
      // declarant's always was, the minor's beside it.
      expect(acceptance?.idDocument).toBe("Carte de identitate BV 123456");
      expect(acceptance?.minorIdDocument).toBe("Carte de identitate MP 654321");
    } finally {
      await context.close();
    }
  });

  test("with JavaScript, the browser refuses a minor's box that is not the minor's name before the press", async ({ page }) => {
    const registration = await awaitingDeclaration(page, "minor-js", { minor: true });
    const parent = registration.guardianName ?? "";
    await page.goto(registration.link);
    await hydrated(page);

    await fillBothDocuments(page);
    const minorSignature = page.locator('[name="minorTypedName"]');
    await minorSignature.fill(parent);
    await page.locator('[name="typedName"]').fill(parent);
    await page.getByRole("button", { name: "Semnează și confirmă" }).click();

    // Refused where the press happened: the minor's box, with its own sentence and the child's name in bold.
    const hint = page.locator("#minorTypedName-helper-text");
    await expect(hint).toContainText("Semnătura minorului trebuie să fie exact");
    await expect(hint.locator("strong")).toHaveText(registration.registeredName);
    expect(await minorSignature.evaluate((input) => (input as HTMLInputElement).validity.customError)).toBe(true);
    expect(page.url()).not.toMatch(/[?&](done|invalid)=/);
    expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

    await minorSignature.fill(registration.registeredName);
    await page.getByRole("button", { name: "Semnează și confirmă" }).click();
    await expect(page).toHaveURL(/done=confirmed/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("CONFIRMED");
  });
});
