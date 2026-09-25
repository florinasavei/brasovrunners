import { expect, test, type Page } from "@playwright/test";
import {
  expireEmailConfirmationLink,
  mintActionLink,
  registrationByEmail,
  registrationStatus,
  setRegistrationStatus,
  type RegistrationRow,
} from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";

/**
 * §NNN (the registration audit) — two browser-rendered checks the integration tests
 * (`tests/integration/registrations/link-actions-audit.test.ts`) cannot stand in for: what the
 * *page* shows, not merely what the server action redirects to.
 *
 * - Finding (7): a `PENDING_EMAIL_CONFIRMATION` row whose link has lapsed must land on the
 *   generic "this link is no longer valid" notice, not on "confirmed, now sign".
 * - Finding (8): a live `COMPLETE_DECLARATION` link on a registration that has moved on (here,
 *   cancelled) must show the moved-on notice, not the signing form.
 */
test.describe("§NNN a lapsed or moved-on registration link never shows the wrong page", () => {
  test.describe.configure({ timeout: 90_000 });

  const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

  /** A registration through the public form, its email left unconfirmed. */
  async function submitRegistration(page: Page, tag: string): Promise<RegistrationRow> {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const suffix = `${tag}-${test.info().project.name}-${Date.now().toString(36)}`;
    const email = `e2e-linkstatus-${suffix}@test.invalid`;
    const values: Record<string, string> = {
      firstName: "Florin",
      lastName: `Munca ${suffix}`,
      email,
      birthDate: "1990-05-17",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('[name="emailConfirm"]').fill(email);
    await page.locator('[name="privacyAcknowledged"]').check();
    await page.locator('[name="rulesAcknowledged"]').check();
    // The club's terms, their own required tick since §NNN.
    await page.locator('[name="termsAccepted"]').check();
    await page.locator('[name="fitnessDeclared"]').check();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page).toHaveURL(/submitted=/, { timeout: 30_000 });

    return registrationByEmail(email);
  }

  /**
   * Finding (7): the verify link is opened past its own deadline. `ConfirmOnArrival` presses the
   * button itself once the page hydrates (§238), which is what actually exercises
   * `confirmEmailAction`'s lapse path — a `goto` alone would only ever prove the GET.
   */
  test("an expired verification link says it is no longer valid, not that email is confirmed", async ({ page }) => {
    const registration = await submitRegistration(page, "verify-lapsed");
    await expireEmailConfirmationLink(registration.id);
    const token = await mintActionLink(registration, "VERIFY_REGISTRATION_EMAIL");

    await page.goto(`/ro/inregistrari/confirmare/${token}`);
    await hydrated(page);
    // The press happens on the client; wait for it to settle rather than a fixed pause. The
    // lapse is a genuine outcome of the press — the token is spent, not merely refused — so the
    // page lands on the specific "no longer active" notice (`spent.LAPSED`) rather than the
    // generic "invalid or expired" one: found only once the actual page was read, better than
    // the sentence this spec first assumed.
    await expect(page.getByText("Înscrierea nu mai este activă")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/înscrierea a expirat/)).toBeVisible();
    // Never the success text a live confirmation would show.
    await expect(page.getByText("Adresa de email a fost confirmată.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Confirmă adresa de email" })).toBeVisible();
    expect(await registrationStatus(registration.id)).toBe("EXPIRED");
  });

  /**
   * Finding (8): the declaration link is still live — never spent, never expired — but the
   * registration it names has moved on (cancelled from "Înscrierile mele", say). The token
   * context reads `ok`, so this is not the generic "invalid or expired" notice; it is the
   * moved-on one, naming the state.
   */
  test("a live declaration link on a cancelled registration shows the cancellation notice, not the form", async ({
    page,
  }) => {
    const registration = await submitRegistration(page, "declare-movedon");
    await page.goto(`/ro/inregistrari/confirmare/${await mintActionLink(registration, "VERIFY_REGISTRATION_EMAIL")}`);
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

    const token = await mintActionLink(registration, "COMPLETE_DECLARATION");
    await setRegistrationStatus(registration.id, "CANCELLED");

    await page.goto(`/ro/inregistrari/declaratie/${token}`);
    await expect(page.getByText("Înscrierea a fost anulată")).toBeVisible();
    // Never the signing form: no tick box, no "type your name" field.
    await expect(page.locator('[name="accepted"]')).toHaveCount(0);
    await expect(page.locator('[name="typedName"]')).toHaveCount(0);
  });
});
