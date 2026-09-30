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
import { chooseSex } from "./support/sex-choice";
import { confirmDialog } from "./support/confirm";
import { openFold } from "./support/fold";

/**
 * §389, amended by §446 — a family on one address, confirmed from the inbox (BR-REQ-032-03,
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
test.describe("§389 §446 a family on one address", () => {
  test.describe.configure({ timeout: 180_000 });

  const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

  type Person = { firstName: string; lastName: string; birthDate: string; sex?: "FEMALE" | "MALE" };

  /**
   * One form, sent. `email` null is a family sitting's next form (§519): the address is fixed and not
   * asked. Nothing is pressed after it: a first form's email is never held (§536), it leaves at once;
   * the sitting's case below presses «Gata» itself.
   */
  async function fillPerson(page: Page, person: Person, email: string | null) {
    const values: Record<string, string> = {
      firstName: person.firstName,
      lastName: person.lastName,
      birthDate: person.birthDate,
      city: "Brașov",
      ...(email ? { email } : {}),
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    // «Sex» starts empty (§510): the form is refused without an answer.
    await chooseSex(page, person.sex);
    if (email) await page.locator('[name="emailConfirm"]').fill(email);
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
    /*
      These cases are one person per sitting — the email of §446 for each (§519): each form starts
      as a new visit would, without this browser's sitting. The sitting of several people is its own
      case below.
    */
    await page.context().clearCookies({ name: "br_family_sitting" });
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
      // The entry's link starts with this message, so it carries the mark (§513).
      { atCap: false, registrationsPerAddress: expect.any(Number), familyEntryId: expect.any(String), startsDeadline: true },
    ]);

    // The captured email: who the address holds, the person the form named, one button.
    const offer = await capturedEmail(page, email, "Înscriși deja cu această adresă");
    expect(offer.text).toContain("Înscriși deja cu această adresă: Ana P.");
    expect(offer.text).toContain(`Persoana din formular: Maria ${lastName}`);
    expect(offer.text).toContain("Data nașterii: 11 iulie 1990");
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
    await page.getByRole("button", { name: "Semnează", exact: true }).click();
    await expect(page).toHaveURL(/done=confirmed/, { timeout: 30_000 });
    expect(await registrationStatus(second.id)).toBe("CONFIRMED");

    // "Înscrierile mele" lists both, each by name (§77).
    await page.goto(`/ro/inscrieri/ale-mele/${await mintProfileLink(first.participantId)}`);
    const names = page.getByTestId("my-registration-name");
    await expect(names).toHaveCount(2);
    await expect(names.filter({ hasText: `Ana ${lastName}` })).toHaveCount(1);
    await expect(names.filter({ hasText: `Maria ${lastName}` })).toHaveCount(1);
    // Under each, how many this address has at the event, out of the limit (§NNN).
    await expect(page.getByTestId("my-registration-per-address").first()).toHaveText(/^Cu această adresă, la acest eveniment: 2 din cel mult \d+ persoane\.$/);
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
    // The first form's email starts the link and is never marked held — no «Da» took it in (§536, the review's nit F1); the re-send for the slip does neither.
    expect(await queuedPayloads(rows[0].id, "VERIFY_REGISTRATION_EMAIL")).toEqual([{ startsDeadline: true }, { anotherPersonHint: true }]);

    // The re-sent email, as captured: the sentence, in both halves.
    const resent = await capturedEmail(page, email, "Dacă vrei să înscrii pe altcineva, trimite formularul cu numele complet și data de naștere a acelei persoane.");
    expect(resent.text).toContain("If you want to register someone else, send the form with that person's full name and birth date.");
  });

  test("§NNN another name and the other sex on a registered person's birth date, typed day first, is another person — never «deja înscris»", async ({ page }) => {
    test.skip(!(await familyFlowOpen()), "the family flow opens with the contract release that drops registrations_event_participant_unique (§389)");
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-family-sibling-${suffix}@test.invalid`;
    const lastName = `Pop ${suffix}`;

    // The box's own shape (§561): day first, as a person types it — and the same day for both.
    await publicSubmission(page, { firstName: "Ana", lastName, birthDate: "02.03.1985", sex: "FEMALE" }, email);
    await publicSubmission(page, { firstName: "Andrei", lastName, birthDate: "02.03.1985", sex: "MALE" }, email);

    const rows = await registrationsByEmail(email);
    expect(rows.map((row) => row.registeredName)).toEqual([`Ana ${lastName}`]);
    // Not a slip of Ana's: the address is asked to confirm Andrei, and Ana's email is not re-sent with the twins' sentence.
    expect(await queuedPayloads(rows[0].id, "REGISTER_ANOTHER_PERSON")).toEqual([
      { atCap: false, registrationsPerAddress: expect.any(Number), familyEntryId: expect.any(String), startsDeadline: true },
    ]);
    expect(await queuedPayloads(rows[0].id, "VERIFY_REGISTRATION_EMAIL")).toEqual([{ startsDeadline: true }]);
    const offer = await capturedEmail(page, email, `Persoana din formular: Andrei ${lastName}`);
    expect(offer.text).toContain("Data nașterii: 2 martie 1985");
  });

  test("§519 one sitting: the first email leaves at once, «Da» opens the sitting with the address kept, every form reserves its place (§543), «Gata» sends one family message naming three, one press confirms everybody and opens the wizard", async ({ page }) => {
    test.skip(!(await familyFlowOpen()), "the family flow opens with the contract release that drops registrations_event_participant_unique (§389)");
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-family-sitting-${suffix}@test.invalid`;
    const lastName = `Pop ${suffix}`;

    /*
      The first form (§536): the short screen — whose form is in, when its email leaves (the e2e server
      sends on the request, so «acum»), one question with one answer, and the one sentence that is true
      of an email already gone. No «Gata»: nothing waits for a press.
    */
    await page.context().clearCookies({ name: "br_family_sitting" });
    await page.goto(registerPath);
    await hydrated(page);
    // The club's limit per address, under the address box (§NNN): the number is the setting's, whatever it is now.
    await expect(page.getByTestId("address-cap-rule")).toHaveText(/^Cu aceeași adresă de email se pot înscrie cel mult \d+ persoane la un eveniment, de exemplu o familie\./);
    await fillPerson(page, { firstName: "Ana", lastName, birthDate: "1985-03-02" }, email);
    // The name once, in the line under the plain heading (the review of 2026-09-28).
    await expect(page.getByRole("heading", { name: "Aproape gata!", exact: true })).toBeVisible();
    await expect(page.getByTestId("check-email-form-in")).toHaveText("Formularul pentru Ana a ajuns.");
    await expect(page.getByTestId("check-email-leaves")).toHaveText(`Emailul către ${email} pleacă acum.`);
    // §547: no bold question and no primary button — one quiet line after the email's, «Înscriu încă o persoană cu această adresă».
    await expect(page.getByRole("heading", { name: "Mai înscrii pe cineva cu aceeași adresă?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Da, încă o persoană" })).toHaveCount(0);
    await expect(page.getByTestId("family-sitting-offer-hint")).toHaveText(/^Dacă înscrii încă o persoană, următorul email așteaptă cel mult .+ după ultimul formular și îi cuprinde pe toți\.$/);
    await expect(page.getByRole("heading", { name: "Ce urmează" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nu, gata — trimite-mi emailul" })).toHaveCount(0);
    // The first person's email left without any press.
    const own = await capturedEmail(page, email, "Am primit o înscriere la");
    expect(own.text).toContain(`Ana ${lastName}`);
    await page.goto(`${registerPath}?submitted=1`);
    await hydrated(page);
    const add = page.getByTestId("family-sitting-add");
    expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // «Înscriu încă o persoană cu această adresă» (§547): the press that opens the sitting, then the same form, the address said back and not asked.
    await add.getByRole("button", { name: "Înscriu încă o persoană cu această adresă" }).click();
    await expect(page).toHaveURL(/family=1/);
    await hydrated(page);
    await expect(page.getByTestId("family-sitting-address")).toContainText(email);
    // This form is the second person, out of the limit (§NNN).
    await expect(page.getByTestId("address-cap-count")).toHaveText(/^2 din \d+ persoane cu această adresă$/);
    await expect(page.locator('[name="emailConfirm"]')).toHaveCount(0);
    // How long is left, said on the form itself, with the way back to «Gata».
    await expect(page.getByTestId("family-sitting-intro")).toContainText("pleacă singur peste");
    await expect(page.getByTestId("family-sitting-intro").getByRole("link", { name: "Nu mai înscriu pe nimeni — înapoi la „Gata”" })).toBeVisible();
    // The boxes a family shares start as the first form left them; the person's own start empty.
    await expect(page.locator('[name="city"]')).toHaveValue("Brașov");
    await expect(page.locator('[name="emergencyContactName"]')).toHaveValue("Ion Popescu");
    await expect(page.locator('[name="firstName"]')).toHaveValue("");
    await fillPerson(page, { firstName: "Maria", lastName, birthDate: "1990-07-11" }, null);

    // After «Da», the sitting's own screen (§519): the people so far, the minutes left, «Gata».
    await expect(page.getByTestId("family-sitting-names")).toContainText(`Ana ${lastName}`);
    await expect(page.getByTestId("family-sitting-names")).toContainText(`Maria ${lastName}`);
    // «N din 4» (§NNN): the people sent so far, out of the limit.
    await expect(page.getByTestId("family-sitting-count")).toHaveText(/^2 din \d+ persoane cu această adresă$/);
    await expect(page.getByTestId("family-sitting-when")).toContainText("Emailul pleacă când apeși „Gata” sau singur după");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A third person (§543; the owner: «să rezerv 3 locuri și așa să se calculeze pe site»): «Da» again, then the form.
    await page.getByTestId("family-sitting-add").getByRole("button", { name: "Da, încă o persoană" }).click();
    await expect(page).toHaveURL(/family=1/);
    await hydrated(page);
    await fillPerson(page, { firstName: "Ion", lastName, birthDate: "1987-02-14" }, null);
    // The family marker: everybody by first name, three places reserved until the hour, and each name's place.
    await expect(page.getByTestId("family-sitting-marker")).toHaveText(/^Înscriere de familie: Ana, Maria, Ion — 3 locuri rezervate până (la \d{2}:\d{2}|.+)\.$/);
    await expect(page.getByTestId("family-sitting-names")).toContainText(`Ion ${lastName} — loc rezervat`);
    // Stored as a single registration is, each with its place, before any email: a refresh or the backoffice sees three.
    expect((await registrationsByEmail(email)).map((row) => row.status)).toEqual(["PENDING_EMAIL_CONFIRMATION", "PENDING_EMAIL_CONFIRMATION", "PENDING_EMAIL_CONFIRMATION"]);

    // «Gata»: one email for the three.
    await page.getByRole("button", { name: "Nu, gata — trimite-mi emailul" }).click();
    await expect(page).toHaveURL(/sent=1/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Aproape gata!" })).toBeVisible();
    await expect(page.getByTestId("check-email-family")).toContainText(`Ana ${lastName}, Maria ${lastName}, Ion ${lastName}`);
    await expect(page.getByTestId("family-sitting-offer")).toHaveCount(0);

    // «Înscriere de familie: 3 persoane la …» is the subject; the captured words are the body's.
    const family = await capturedEmail(page, email, "Confirm și semnez declarațiile (3)");
    expect(family.text).toMatch(/Înscriere de familie: Ana, Maria și Ion — 3 locuri rezervate până/);
    expect(family.text).toContain(`Persoana 1 din 3: Ana ${lastName}`);
    expect(family.text).toContain(`Persoana 2 din 3: Maria ${lastName}, data nașterii 11 iulie 1990 — loc rezervat`);
    expect(family.text).toContain(`Persoana 3 din 3: Ion ${lastName}, data nașterii 14 februarie 1987 — loc rezervat`);
    expect(family.text).toContain("Confirm și semnez declarațiile (3)");
    // The first line says the one button does everything (§536); Ana's own email left before «Da», so one line says this one covers her too.
    expect(family.text).toContain("Un singur buton: confirmi adresa și cele 3 înscrieri, apoi semnezi pe rând declarațiile celor care mai au loc.");
    expect(family.text).toContain("Acest email îi cuprinde pe toți: butonul de mai jos confirmă și înscrierea din emailul anterior.");
    expect(family.links.some((href) => href.includes("/inscrieri/ale-mele/"))).toBe(true);
    const link = family.links.find((href) => href.includes("/inregistrari/familie/"));
    expect(link).toBeTruthy();

    // The page lists the three; nothing is confirmed by opening it (GET never mutates).
    await page.goto(link!);
    await hydrated(page);
    await expect(page.getByTestId("family-sitting-people")).toContainText(`Maria ${lastName}`);
    await expect(page.getByTestId("family-sitting-people")).toContainText(`Ion ${lastName}`);
    expect((await registrationsByEmail(email)).map((row) => row.status)).toEqual(["PENDING_EMAIL_CONFIRMATION", "PENDING_EMAIL_CONFIRMATION", "PENDING_EMAIL_CONFIRMATION"]);

    // One press: the address and the three confirmed, straight into «Declarația 1 din 3».
    await page.locator('[name="fitnessAcknowledged"]').check();
    const confirm = page.getByTestId("family-sitting-confirm-button").getByRole("button");
    expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await confirm.click();
    await expect(page).toHaveURL(/\/inregistrari\/declaratie\//, { timeout: 30_000 });
    await expect(page.getByText(`Declarația 1 din 3 — Ana ${lastName}`)).toBeVisible();
    expect((await registrationsByEmail(email)).map((row) => row.status).sort()).toEqual(["PENDING_DECLARATION", "PENDING_DECLARATION", "PENDING_DECLARATION"]);

    /*
      §547: the button says «… și treci la următoarea persoană» while another person follows, and
      «Renunț la înscrierea pentru <nume>» withdraws one person, asking first; the last one just signs.
    */
    await hydrated(page);
    const signStep = async (name: string) => {
      await page.locator('[name="accepted"]').check();
      const idDocument = page.locator('[name="idDocument"]');
      if (await idDocument.count()) await idDocument.fill("BV 123456");
      await page.locator('[name="typedName"]').fill(name);
    };
    await expect(page.getByTestId("declaration-sign")).toHaveText("Semnează și treci la următoarea persoană");
    await signStep(`Ana ${lastName}`);
    await page.getByTestId("declaration-sign").click();
    await expect(page.getByText(`Declarația 2 din 3 — Maria ${lastName}`)).toBeVisible({ timeout: 30_000 });
    await hydrated(page);
    const withdraw = page.getByTestId("family-signing-withdraw").getByRole("button", { name: `Renunț la înscrierea pentru Maria ${lastName}` });
    expect((await withdraw.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Why, first (§558): the browser names the empty box and asks nothing until a reason is chosen.
    await withdraw.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("family-signing-withdraw").getByLabel("De ce anulezi?").selectOption("INJURY_OR_ILLNESS");
    await withdraw.click();
    await confirmDialog(page, `Renunți la înscrierea pentru Maria ${lastName}?`);
    await expect(page.getByText(`Declarația 3 din 3 — Ion ${lastName}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("toast")).toHaveText("Gata: înscrierea e anulată, iar adresa primește un email de confirmare.");
    await expect(page.getByTestId("family-signing-steps")).toContainText(`Maria ${lastName} · înscriere anulată`);
    // The last person: just «Semnează».
    await expect(page.getByTestId("declaration-sign")).toHaveText("Semnează");
    expect((await registrationsByEmail(email)).map((row) => row.status).sort()).toEqual(["CANCELLED", "CONFIRMED", "PENDING_DECLARATION"]);
    // One email for Maria, naming her, the place released and who the address still holds.
    const cancelled = await capturedEmail(page, email, `Înscrierea pentru Maria ${lastName} la`);
    expect(cancelled.text).toContain("Locul a fost eliberat.");
    expect(cancelled.text).toContain("Pe această adresă rămân înscriși:");
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
    await page.goto("/ro/admin/settings/deadlines");
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
    // The message that states it, in its when-line — one tab over, on «Emailuri» (§516).
    await page.goto("/ro/admin/settings/emails");
    await expect(main.locator("#email-REGISTER_ANOTHER_PERSON > summary")).toContainText("când formularul e trimis din nou cu altă persoană");

    await page.goto("/ro/admin/guide");
    // The section by its own summary: other sections name it in their steps, and its jobs are
    // folds of their own inside it (§441).
    const summary = page.locator("summary", { hasText: "O familie pe o singură adresă" });
    const section = summary.locator("xpath=..");
    await summary.click();
    await expect(section).toContainText("Pe o adresă se pot înscrie cel mult 3 persoane la un eveniment.");
    await expect(section).toContainText("câte un cod QR pentru fiecare persoană confirmată");

    // Back to the default, through the panel.
    await page.goto("/ro/admin/settings/deadlines");
    const again = page.locator("#main").getByTestId("deadlines");
    await openFold(again);
    await again.getByTestId("address-cap").locator('input[name="registrationsPerAddress"]').fill("4");
    await again.getByTestId("address-cap").getByRole("button", { name: "Salvează maximul" }).click();
    await confirmDialog(page, "Salvezi limita pe adresă?");
    await expect(page.locator("#main").getByText("Maximul de înscrieri pe o adresă a fost salvat", { exact: false })).toBeVisible();
  });

  test("an Organizer reads the limit and is offered no form", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/settings/deadlines");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.getByTestId("address-cap-value")).toHaveText("Pe o adresă se pot înscrie cel mult 4 persoane la un eveniment.");
    await expect(panel.getByTestId("address-cap").locator("input")).toHaveCount(0);
  });
});
