import { expect, test, type Page } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-031-01, BR-REQ-031-04, BR-REQ-031-05, BR-REQ-031-06, BR-REQ-041-01 — the shape of the
 * first stage of the registration journey, at 320px and on a desktop.
 *
 * `registration-entry.spec.ts` proves a runner can get from the landing page to a submitted
 * form. This proves the three things that were decided about *how* that form is arranged
 * (`DECISIONS.md` §47): the optional questions are collapsed so the default page is the
 * required set, a rejected submission arrives at a summary that names and reaches the field
 * rather than at the top of a long page, and every control a thumb has to hit is big enough
 * to hit.
 *
 * Needs the seeded database and the development staff switcher, like every spec here.
 */

const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

/** Everything the schema insists on, minus whichever field a test wants to be missing. */
async function fillRequired(page: Page, omit?: string) {
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName: "Popescu",
    email: `e2e-form-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) {
    if (name === omit) continue;
    await page.locator(`[name="${name}"]`).fill(value);
  }
  await page.locator('[name="privacyAcknowledged"]').check();
}

test.describe("BR-REQ-041-01 the optional half of the form is open, and foldable", () => {
  test("shows the required questions, the consents, and the optional groups open", async ({
    page,
  }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);

    // Everything a registration cannot be accepted without is on the page as it loads.
    for (const name of [
      "firstName",
      "lastName",
      "birthDate",
      "city",
      "email",
      "phone",
      "emergencyContactName",
      "emergencyContactPhone",
      "privacyAcknowledged",
    ]) {
      await expect(page.locator(`[name="${name}"]`), `${name} is asked up front`).toBeVisible();
    }

    // BR-REQ-072-01 criterion 1 and BR-REQ-039-01: these two are optional and still *presented*
    // — a consent behind a summary somebody never opens has not been put to them.
    await expect(page.locator('[name="resultsNameConsent"]')).toBeVisible();
    // "I want to appear on the participant list" is asked only on an event whose list is switched
    // on (`DECISIONS.md` §85, §143); the seeded events publish none, so the box is absent.
    await expect(page.locator('[name="listOptIn"]')).toHaveCount(0);

    // The optional groups are open as the page loads (the owner's instruction of 2026-09-17,
    // reversing DECISIONS.md §47): a runner's own club was the field people missed when it sat
    // behind a summary, and a field nobody sees is a field nobody fills.
    await expect(page.locator('[name="healthNotes"]')).toBeVisible();
    await expect(page.locator('[name="clubName"]')).toBeVisible();
    // The public display name is behind `FEATURE_DISPLAY_NAME`, off by default (§95): absent.
    await expect(page.locator('[name="displayName"]')).toHaveCount(0);
    // BR-REQ-031-05 criterion 1: the health question keeps its own consent beside it.
    await expect(page.locator('[name="healthConsent"]')).toBeVisible();
    // BR-REQ-031-06: the club's own people say so here.
    await expect(page.locator('[name="clubMemberDeclared"]')).toBeVisible();

    // Still a disclosure: anybody who wants the page shorter can fold a group, and the summary
    // names what it hides — the health one on its own, so the question is never buried.
    await page.getByText("Informații medicale — opțional").click();
    await expect(page.locator('[name="healthNotes"]')).toBeHidden();
    await page.getByText("Informații medicale — opțional").click();
    await expect(page.locator('[name="healthNotes"]')).toBeVisible();
  });

  test("accepts a registration from somebody who says they are in the club", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);

    await fillRequired(page);
    // The group is open as the page loads; the tick is reachable without opening anything.
    await page.locator('[name="clubMemberDeclared"]').check();

    // The timing check answers a too-fast form with the same generic success it gives a real
    // one, so submitting immediately would pass without creating anything.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    await expect(page.getByText("Verifică-ți emailul")).toBeVisible();
  });

  test("never scrolls sideways, at either viewport", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);

    // Criterion 1, with every disclosure open — the widest the page can be made. They open by
    // default now, so nothing needs clicking; assert that rather than assume it.
    for (const name of ["healthNotes", "clubName", "preferredLocale"]) {
      await expect(page.locator(`[name="${name}"]`)).toBeVisible();
    }
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});

test.describe("BR-REQ-041-01 criterion 6 the controls are big enough for a thumb", () => {
  test("gives the submit button and the required consent at least 44 pixels", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);

    const submit = page.getByRole("button", { name: "Trimite înscrierea" });
    const submitBox = await submit.boundingBox();
    expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // MUI's default checkbox is 42 by 42 — under the rule by two pixels, which is exactly the
    // kind of miss that survives a review and fails on a phone.
    const consentBox = await page
      .locator('[name="privacyAcknowledged"]')
      .locator("..")
      .boundingBox();
    expect(consentBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(consentBox?.width ?? 0).toBeGreaterThanOrEqual(44);

    // BR-REQ-031-01 criterion 5 (`DECISIONS.md` §102): what is being signed up for, on the
    // form — the event's page, the terms and the privacy notice as links, each a tap target.
    for (const name of ["Detaliile evenimentului", "Termeni de concurs", "GDPR"]) {
      const link = page.locator("#main").getByRole("link", { name, exact: true }).first();
      await expect(link).toBeVisible();
      expect((await link.boundingBox())?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("BR-REQ-031-04 a rejected submission says what to fix, and goes there", () => {
  test("lands on the error summary and links to the field it names", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);

    await fillRequired(page, "firstName");

    // The browser would refuse this submission itself and focus the empty field, which is the
    // path a person actually takes. Turning native validation off is how the *server's* answer
    // gets exercised — the round trip that has to work for a form posted without JavaScript,
    // by an older browser, or by a bot.
    await page.locator("form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    // The redirect carries the code, the field names and the fragment that puts somebody at
    // the summary instead of at the top of the page.
    await page.waitForURL(/error=VALIDATION_ERROR/);
    expect(page.url()).toContain("fields=firstName");
    expect(page.url()).toContain("#registration-errors");

    const summary = page.locator("#registration-errors");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Verifică aceste câmpuri");

    // The field is named in the summary and marked at the field itself, not only in red.
    const link = summary.getByRole("link", { name: "Prenume" });
    await expect(link).toBeVisible();
    await expect(page.locator('[name="firstName"]')).toHaveAttribute("aria-invalid", "true");

    // Following it moves focus to the input, which is what makes the summary a route back to
    // the form rather than a label on it.
    await link.click();
    await expect(page.locator('[name="firstName"]')).toBeFocused();

    // What was typed is still there (`DECISIONS.md` §142) — and not in the address.
    await expect(page.locator('[name="lastName"]')).toHaveValue("Popescu");
    await expect(page.locator('[name="city"]')).toHaveValue("Brașov");
    await expect(page.locator('[name="phone"]')).toHaveValue("+40711111111");
    await expect(page.locator('[name="emergencyContactName"]')).toHaveValue("Ion Popescu");
    expect(page.url()).not.toContain("Popescu");
  });

  test("keeps a chosen option and says a phone number is not valid", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page);
    await page.locator('[name="phone"]').fill("12");
    // A MUI select: the choice lives in React state, which is exactly what a redirect loses (§142).
    await page.locator("#f-sex").click();
    await page.getByRole("option", { name: "Feminin" }).click();
    await page.locator('[name="healthNotes"]').fill("Astm");
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    await page.waitForURL(/error=VALIDATION_ERROR/);
    expect(page.url()).toContain("fields=phone");
    await expect(page.locator("#f-sex")).toHaveText("Feminin");
    await expect(page.locator('[name="phone"]')).toHaveValue("12");
    await expect(page.locator('[name="healthNotes"]')).toHaveValue("Astm");
    await expect(page.locator("#main")).toContainText("Numărul nu e valid");
    expect(page.url()).not.toContain("Astm");
  });

  test("does not render a field name it does not recognize", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);

    // Anybody can type this parameter. Unknown names are dropped rather than looked up, so the
    // summary falls back to the generic sentence instead of echoing the parameter back.
    await page.goto(`${registerPath}?error=VALIDATION_ERROR&fields=notAField`);

    const summary = page.locator("#registration-errors");
    await expect(summary).toBeVisible();
    await expect(summary).not.toContainText("notAField");
    await expect(summary).toContainText("Verifică datele completate");
  });
});
