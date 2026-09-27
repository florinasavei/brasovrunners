import { expect, test, type Page } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import {
  CLOUDFLARE_DUMMY_TOKEN,
  FAKE_TURNSTILE_SCRIPT,
  TURNSTILE_E2E_URL,
  TURNSTILE_SCRIPT_PATTERN,
} from "./support/turnstile-server";

/**
 * BR-REQ-031-01, BR-REQ-041-01 — the send button held for Cloudflare's token, with the widget on
 * the page; `DECISIONS.md` §285, §304 and §NNN.
 *
 * The owner, 2026-09-27, with the form showing «Verificăm o secundă că nu ești robot — trimitem noi
 * înscrierea imediat ce răspunde» under a widget that already said «Success!»: «Am rămas în acest
 * state! ce se întâmplă???» The press was held, the check answered, and nothing sent the form.
 *
 * Against the suite's second server (`playwright.config.ts`), the only one that runs the check —
 * with Cloudflare's own test keys, so the server really verifies the token it receives. Most cases
 * serve a stand-in for Cloudflare's script (`FAKE_TURNSTILE_SCRIPT`), because the real test widget
 * answers at once and the defect lived in *when* it answers; the last case is the real widget, and
 * runs only when asked (`E2E_REAL_TURNSTILE=1`): the suite never depends on a third party in CI.
 */
test.use({ baseURL: TURNSTILE_E2E_URL });

const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;
const sendButton = (page: Page) => page.getByRole("button", { name: "Trimite înscrierea", exact: true });
/** `Registration.botCheckWait`: the sentence a held press shows. */
const heldSentence = (page: Page) => page.getByText(/trimitem noi înscrierea imediat ce răspunde/);
const tokenField = (page: Page) => page.locator('[name="cf-turnstile-response"]');

const address = () => `e2e-turnstile-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;

async function fillRequired(page: Page, email: string, emailConfirm = email) {
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName: "Turnstile",
    email,
    emailConfirm,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
  // A fill that lands just before the form finishes hydrating can be wiped by it (the autofill
  // spec's note); one more pass puts back whatever went missing. Spaces aside: the telephone boxes
  // group the digits as they arrive (§337).
  for (const [name, value] of Object.entries(values)) {
    const box = page.locator(`[name="${name}"]`);
    if ((await box.inputValue()).replace(/\s/g, "") !== value.replace(/\s/g, "")) await box.fill(value);
  }
  for (const name of ["privacyAcknowledged", "rulesAcknowledged", "termsAccepted", "fitnessDeclared"]) {
    await page.locator(`[name="${name}"]`).check();
  }
}

/** The request the held press becomes, carrying the token the check answered with. */
const postWithToken = (page: Page) =>
  page.waitForRequest((request) => request.method() === "POST" && (request.postData() ?? "").includes(CLOUDFLARE_DUMMY_TOKEN));

async function openWithStandIn(page: Page) {
  await page.route(TURNSTILE_SCRIPT_PATTERN, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_TURNSTILE_SCRIPT }),
  );
  await signIn(page, "Dev Administrator");
  await ensureRegistrationIsOpen(page);
  await page.goto(registerPath);
  await hydrated(page);
  // The widget is drawn inside the form, and has not answered.
  await expect(tokenField(page)).toHaveCount(1);
  await expect(tokenField(page)).toHaveValue("");
  return Date.now();
}

test.describe("§NNN a press held for the anti-bot check is sent when the check answers", () => {
  test("after the page's first eight seconds, typing and then pressing: sent the moment the check answers", async ({ page }) => {
    test.setTimeout(90_000);
    const openedAt = await openWithStandIn(page);

    /*
      The owner's case. §285's valve fired eight seconds after the page was drawn and stopped
      watching the widget, while the form's `input` went on marking the token missing — so every
      box typed after that, with the check still thinking, left a press that nothing would send.
    */
    await page.waitForTimeout(Math.max(0, 8_500 - (Date.now() - openedAt)));
    const email = address();
    await fillRequired(page, email);

    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    // Held, not sent: no request, no confirmation page.
    await page.waitForTimeout(1_000);
    await expect(page).not.toHaveURL(/submitted=/);

    const posted = postWithToken(page);
    await page.evaluate(() => (window as unknown as { __answerTurnstile: () => void }).__answerTurnstile());
    await posted;
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });

  test("a refused attempt and then another held press: the second is sent as well", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page);

    // First attempt, refused by the server: the address typed differently the second time (§206).
    const email = address();
    await fillRequired(page, email, `other-${email}`);
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await page.evaluate(() => (window as unknown as { __answerTurnstile: () => void }).__answerTurnstile());
    await expect(page.locator("#registration-errors")).toBeVisible({ timeout: 20_000 });

    // The widget was reset for the new attempt (§185): its token is spent.
    await expect(tokenField(page)).toHaveValue("");

    // Corrected, pressed again before the check has answered: held again — §304's replay ran once
    // per mount, and the button outlives the redirect that shows the refusal.
    await fillRequired(page, email);
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    // Above the timing floor a real person would be (`HUMAN_PAUSE_MS`) before the answer sends it.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    const posted = postWithToken(page);
    await page.evaluate(() => (window as unknown as { __answerTurnstile: () => void }).__answerTurnstile());
    await posted;
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });

  test("a check that never answers: the held press is sent eight seconds after it, and accepted (§205)", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page);

    await fillRequired(page, address());
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    // Nobody answers. The valve opens eight seconds after the press, the form goes without a token,
    // and the server takes a missing token for the check not running, not for a robot (§216).
    await expect(page).toHaveURL(/submitted=/, { timeout: 30_000 });
    expect(Date.now() - pressedAt).toBeGreaterThanOrEqual(7_500);
  });

  test("Cloudflare's own test widget, arriving after the press: the press is sent with its token", async ({ page }) => {
    test.skip(process.env.E2E_REAL_TURNSTILE !== "1", "the real widget is a third party: E2E_REAL_TURNSTILE=1 to run it");
    test.setTimeout(90_000);
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    // Cloudflare's script, four seconds late — so the press comes before any widget exists.
    await page.route(TURNSTILE_SCRIPT_PATTERN, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue();
    });
    await page.goto(registerPath, { waitUntil: "domcontentloaded" });
    // `hydrated` waits for the network to settle, which the late script would hold up: the widget's
    // own script tag is the sign the page's islands are running.
    await page.locator("script[data-turnstile]").waitFor({ state: "attached" });
    await fillRequired(page, address());

    const posted = postWithToken(page);
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await posted;
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });
});
