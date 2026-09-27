import { expect, test, type Page } from "@playwright/test";
import { cancelRegistrationsByEmailPrefix } from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import {
  BLIND_FIELD_FLAG,
  CLOUDFLARE_DUMMY_TOKEN,
  FAKE_TURNSTILE_SCRIPT,
  TURNSTILE_E2E_URL,
  TURNSTILE_SCRIPT_PATTERN,
  type TurnstileAnswerOrder,
} from "./support/turnstile-server";

/**
 * BR-REQ-031-01, BR-REQ-041-01 — the send button held for Cloudflare's token, with the widget on
 * the page; `DECISIONS.md` §285, §304 and §502.
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
 *
 * A held press is also sent by its eight-second valve, token or not — so "a POST carried the token"
 * alone proves nothing about the answer: by the valve the field holds it anyway. Every case that
 * says "sent when the check answers" times the request against the answer and against the valve.
 * The button has two fast signals, and each is proved alone: the hidden field's `value` attribute
 * (Cloudflare's `.value =` on a `type="hidden"` field *is* that attribute), answered with no
 * callback; and the success callback, with a field the observer cannot see — where, as the control,
 * the same write with no callback must wait for the valve.
 */
test.use({ baseURL: TURNSTILE_E2E_URL });

const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;
const sendButton = (page: Page) => page.getByRole("button", { name: "Trimite înscrierea", exact: true });
/** `Registration.botCheckWait`: the sentence a held press shows. */
const heldSentence = (page: Page) => page.getByText(/trimitem noi înscrierea imediat ce răspunde/);
const tokenField = (page: Page) => page.locator('[name="cf-turnstile-response"]');

/** `SubmitButton`'s `RELEASE_AFTER_MS`: a held press is sent this long after it, whatever happens. */
const RELEASE_AFTER_MS = 8_000;
/** How soon after the answer a held press must be on the wire — far inside the valve. */
const PROMPTLY_MS = 3_000;

/** Every address this spec registers starts so, per project — what `afterAll` gives the places back by. */
const addressPrefix = (project: string) => `e2e-turnstile-${project}-`;
const address = () => `${addressPrefix(test.info().project.name)}${Date.now().toString(36)}@test.invalid`;

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

/** The stand-in answers; see `FAKE_TURNSTILE_SCRIPT` for the orders. */
const answer = (page: Page, order: TurnstileAnswerOrder = "write-then-call") =>
  page.evaluate((how) => (window as unknown as { __answerTurnstile: (order: string) => void }).__answerTurnstile(how), order);

/** Every POST that carries the token, from now on: a held press must become exactly one (§502). */
function tokenPosts(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && (request.postData() ?? "").includes(CLOUDFLARE_DUMMY_TOKEN)) sent.push(request.url());
  });
  return sent;
}

/**
 * Answer a held press and prove the answer is what sent it: the request carries the token and is
 * on the wire within `PROMPTLY_MS` of the answer, and before the valve counted from the press —
 * and it is the only one: the confirmation arrives, and past the moment a second, replayed send
 * would have gone, one POST carried the token.
 */
async function answerAndExpectOnePromptSend(page: Page, pressedAt: number, order: TurnstileAnswerOrder = "write-then-call") {
  const sent = tokenPosts(page);
  const posted = postWithToken(page);
  const answeredAt = Date.now();
  await answer(page, order);
  await posted;
  const postedAt = Date.now();
  expect(postedAt - answeredAt, "sent by the answer, not by the valve").toBeLessThan(PROMPTLY_MS);
  expect(postedAt - pressedAt, "before the valve could have sent it").toBeLessThan(RELEASE_AFTER_MS - 500);
  await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  expect(sent, "exactly one request carried the token").toHaveLength(1);
}

/**
 * The form, with the stand-in in place of Cloudflare's script. `blindField` draws the token field
 * as a box the held button's observer cannot see (`BLIND_FIELD_FLAG`), leaving it the callback.
 */
async function openWithStandIn(page: Page, { blindField = false } = {}) {
  if (blindField) await page.addInitScript((flag) => ((window as unknown as Record<string, boolean>)[flag] = true), BLIND_FIELD_FLAG);
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

test.describe("§502 a press held for the anti-bot check is sent when the check answers", () => {
  // Every case registers on the sample race (50 places): give the places back, or two local runs
  // fill it for the specs after them.
  test.afterAll(async ({}, testInfo) => cancelRegistrationsByEmailPrefix(addressPrefix(testInfo.project.name)));

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

    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    // The button carries the check's state (§NNN): «Se verifică…», and busy while held.
    await expect(page.getByTestId("held-press-hint")).toHaveText(/^Se verifică…/);
    await expect(sendButton(page)).toHaveAttribute("aria-busy", "true");
    // Held, not sent: no request, no confirmation page.
    await page.waitForTimeout(1_000);
    await expect(page).not.toHaveURL(/submitted=/);

    await answerAndExpectOnePromptSend(page, pressedAt);
  });

  test("the check answered before the press: the press goes straight through, once, never held", async ({ page }) => {
    test.setTimeout(90_000);
    const openedAt = await openWithStandIn(page);
    await fillRequired(page, address());
    // Above the timing floor a real person would be (`HUMAN_PAUSE_MS`), so the server takes it.
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));
    await answer(page);
    await expect(tokenField(page)).toHaveValue(CLOUDFLARE_DUMMY_TOKEN);

    // The sentence of a held press, watched from the page itself: a hold that lasted one task and
    // was sent by the next would be gone before any locator looked. `exposeFunction` outlives the
    // navigation to the confirmation.
    let heldSeen = false;
    await page.exposeFunction("__e2eHeldSeen", () => {
      heldSeen = true;
    });
    await page.evaluate(() => {
      const report = () => {
        if (document.body.innerText.includes("trimitem noi înscrierea imediat ce răspunde")) {
          (window as unknown as { __e2eHeldSeen: () => void }).__e2eHeldSeen();
        }
      };
      report();
      new MutationObserver(report).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const sent = tokenPosts(page);

    const posted = postWithToken(page);
    const pressedAt = Date.now();
    await sendButton(page).click();
    await posted;
    expect(Date.now() - pressedAt, "sent by the press, not held until the valve").toBeLessThan(PROMPTLY_MS);
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
    // Past the moment a second, replayed send would have gone.
    await page.waitForTimeout(1_000);
    expect(heldSeen, "the press was never held").toBe(false);
    expect(sent, "exactly one request carried the token").toHaveLength(1);
  });

  test("Cloudflare's hidden field written with no callback: the field's own watcher sends it at once", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page);
    await fillRequired(page, address());
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await page.waitForTimeout(HUMAN_PAUSE_MS);

    // On `type="hidden"`, `.value =` is the `value` attribute, which the button's observer sees:
    // the second signal, on its own.
    await answerAndExpectOnePromptSend(page, pressedAt, "write-only");
  });

  test("a field only the callback reveals, called back before it is written: sent the moment it answers", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page, { blindField: true });
    await fillRequired(page, address());
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await page.waitForTimeout(HUMAN_PAUSE_MS);

    // Nothing but the success callback can tell the button here, and it comes before the field is
    // written: the button reads the field on the task after the callback, not inside it.
    await answerAndExpectOnePromptSend(page, pressedAt, "call-then-write");
  });

  test("the same field written with no callback: only the valve sends it — the callback was the fast path", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page, { blindField: true });
    await fillRequired(page, address());
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();

    // The same pause as the case above, and it matters: the observer re-reads the field on any
    // change inside the form, and the held press's own sentence being drawn is one — a token
    // written before the form has settled goes with that render.
    await page.waitForTimeout(HUMAN_PAUSE_MS);

    // The control for the case above: the token is in the field, but with no callback nothing the
    // button watches has moved. The press waits for its valve, and then goes with the token.
    const sent = tokenPosts(page);
    const posted = postWithToken(page);
    await answer(page, "write-only");
    await posted;
    expect(Date.now() - pressedAt, "nothing but the valve could have sent it").toBeGreaterThanOrEqual(RELEASE_AFTER_MS - 500);
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    expect(sent, "exactly one request carried the token").toHaveLength(1);
  });

  test("a refused attempt and then another held press: the second is sent as well", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page);

    // First attempt, refused by the server: the address typed differently the second time (§206).
    const email = address();
    await fillRequired(page, email, `other-${email}`);
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await answer(page);
    await expect(page.locator("#registration-errors")).toBeVisible({ timeout: 20_000 });

    // The widget was reset for the new attempt (§185): its token is spent.
    await expect(tokenField(page)).toHaveValue("");

    // Corrected, pressed again before the check has answered: held again — §304's replay ran once
    // per mount, and the button outlives the redirect that shows the refusal.
    await fillRequired(page, email);
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    // Above the timing floor a real person would be (`HUMAN_PAUSE_MS`) before the answer sends it.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await answerAndExpectOnePromptSend(page, pressedAt);
  });

  test("a check that never answers: the held press is sent eight seconds after it, and accepted (§205)", async ({ page }) => {
    test.setTimeout(90_000);
    await openWithStandIn(page);

    await fillRequired(page, address());
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    // Nobody answers. Before the valve sends, the button says so (§NNN) — and the sentence is on
    // screen before the request leaves, so it can be read.
    const posted = formPost(page);
    await expect(page.getByTestId("held-press-hint")).toHaveText("Trimitem fără verificare automată…", { timeout: 10_000 });
    const saidAt = Date.now();
    // The valve opens eight seconds after the press, the form goes without a token, and the server
    // takes a missing token for the check not running, not for a robot (§216).
    const request = await posted;
    expect(Date.now() - saidAt, "said a beat before it went").toBeGreaterThanOrEqual(500);
    // The valve's send names itself with the form (§NNN), as the submitter's word.
    expect(request.postData() ?? "").toContain("held-press-valve");
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
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await posted;
    // The widget arrives a few seconds after the press and answers at once; the valve, eight
    // seconds after the press, would post its token too — so the answer must have come first.
    expect(Date.now() - pressedAt, "sent by the widget's answer, not by the valve").toBeLessThan(RELEASE_AFTER_MS - 1_000);
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });
});

/**
 * §NNN — every state of the check said under the widget and on the send button, and a way out of
 * each one a person can be stuck in. The widget's line is `BotCheck.<state>`; «Reîncearcă
 * verificarea» is its retry; the button's held sentence (`held-press-hint`) says the same state.
 */
const botCheckLine = (page: Page) => page.getByTestId("bot-check-status");
const heldHint = (page: Page) => page.getByTestId("held-press-hint");
const retryButton = (page: Page) => page.getByRole("button", { name: "Reîncearcă verificarea", exact: true });
/** The owner's fail-open sentence, wherever the check gave up. */
const GAVE_UP = /Nu am putut verifica automat; trimitem oricum, iar clubul confirmă/;
/** The stand-in's failure, its box to tick, its lapse and its timeout (`FAKE_TURNSTILE_SCRIPT`). */
const standIn = (page: Page, name: "__failTurnstile" | "__askTurnstile" | "__expireTurnstile" | "__timeoutTurnstile") =>
  page.evaluate((fn) => (window as unknown as Record<string, () => void>)[fn](), name);
const fail = (page: Page) => standIn(page, "__failTurnstile");
const askForTick = (page: Page) => standIn(page, "__askTurnstile");
/** The form's own POST, token or not: the Server Action posts to the page it is on. */
const formPost = (page: Page) =>
  page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === registerPath);

test.describe("§NNN the anti-bot check says every state and never strands a press", () => {
  test.afterAll(async ({}, testInfo) => cancelRegistrationsByEmailPrefix(addressPrefix(testInfo.project.name)));

  test("thinking, a box to tick, and a pass: each said under the widget and on the held button", async ({ page }) => {
    test.setTimeout(60_000);
    const openedAt = await openWithStandIn(page);
    await expect(botCheckLine(page)).toHaveText(/^Se verifică…/);
    await expect(retryButton(page)).toHaveCount(0);
    await fillRequired(page, address());
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));

    // A press while it thinks: held, and the button says so.
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldHint(page)).toHaveText(/^Se verifică…/);

    // A box to tick: said under the widget, and the button's sentence follows.
    await askForTick(page);
    await expect(botCheckLine(page)).toHaveText(/Bifează căsuța de mai sus/);
    await expect(heldHint(page)).toHaveText(/^Bifează căsuța de mai sus/);

    await answerAndExpectOnePromptSend(page, pressedAt);
  });

  test("one failure: said with «Reîncearcă verificarea», a press is held; the second failure sends it at once (§216)", async ({ page }) => {
    test.setTimeout(60_000);
    const openedAt = await openWithStandIn(page);
    await fillRequired(page, address());
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));

    await fail(page);
    await expect(botCheckLine(page)).toHaveText(/nu a mers; se reface singură/);
    await expect(retryButton(page)).toBeVisible();
    // A thumb's target (BR-REQ-041-01 criterion 6).
    expect((await retryButton(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.9);

    // Cloudflare is still retrying: the press is held, not spent on a refusal.
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();

    // The second failure gives up: the owner's sentence, and the held press goes now, not at the valve.
    const posted = formPost(page);
    await fail(page);
    await expect(botCheckLine(page)).toHaveText(GAVE_UP);
    await posted;
    expect(Date.now() - pressedAt, "sent by the second failure, before the valve").toBeLessThan(RELEASE_AFTER_MS - 1_000);
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });

  test("two failures before the press: the press goes straight through and is accepted (§216)", async ({ page }) => {
    test.setTimeout(60_000);
    const openedAt = await openWithStandIn(page);
    await fillRequired(page, address());
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));
    await fail(page);
    await fail(page);
    await expect(botCheckLine(page)).toHaveText(GAVE_UP);

    const posted = formPost(page);
    const pressedAt = Date.now();
    await sendButton(page).click();
    await posted;
    expect(Date.now() - pressedAt, "sent by the press, not held for a check that gave up").toBeLessThan(PROMPTLY_MS);
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });

  test("«Reîncearcă verificarea» after a failure: a fresh check, and a held press is sent when it answers", async ({ page }) => {
    test.setTimeout(60_000);
    await openWithStandIn(page);
    await fillRequired(page, address());
    await fail(page);
    await expect(retryButton(page)).toBeVisible();

    await retryButton(page).click();
    await expect(botCheckLine(page)).toHaveText(/^Se verifică…/);
    await expect(retryButton(page)).toHaveCount(0);

    // Thinking again: a press is held, as before any failure, and sent by the answer.
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldSentence(page)).toBeVisible();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await answerAndExpectOnePromptSend(page, pressedAt);
  });

  test("a token that lapsed: said, the stale token never sent, the press held and sent on the new answer", async ({ page }) => {
    test.setTimeout(60_000);
    const openedAt = await openWithStandIn(page);
    await fillRequired(page, address());
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));
    await answer(page);
    await expect(botCheckLine(page)).toHaveText(/Verificare reușită/);

    // Five minutes later, in Cloudflare's time: the token lapses, and stays in the field.
    await standIn(page, "__expireTurnstile");
    await expect(botCheckLine(page)).toHaveText(/Verificarea a expirat — se reface/);
    await expect(retryButton(page)).toBeVisible();
    await expect(tokenField(page)).toHaveValue(CLOUDFLARE_DUMMY_TOKEN);

    // A press now is held — the lapsed token would buy a refusal — and says why.
    const sent = tokenPosts(page);
    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldHint(page)).toHaveText(/^Verificarea a expirat — se reface/);
    await page.waitForTimeout(1_000);
    expect(sent, "the lapsed token was not sent").toHaveLength(0);
    await expect(page).not.toHaveURL(/submitted=/);

    // The refresh answers (Cloudflare's `refresh-expired: auto`): the held press goes with it, once.
    await answerAndExpectOnePromptSend(page, pressedAt);
  });

  test("a box that waited too long: said, a press held with «Bifează», sent when it is ticked", async ({ page }) => {
    test.setTimeout(60_000);
    const openedAt = await openWithStandIn(page);
    await fillRequired(page, address());
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));
    await askForTick(page);
    await standIn(page, "__timeoutTurnstile");
    await expect(botCheckLine(page)).toHaveText(/s-a redesenat/);
    await expect(retryButton(page)).toBeVisible();

    const pressedAt = Date.now();
    await sendButton(page).click();
    await expect(heldHint(page)).toHaveText(/^Bifează căsuța de mai sus/);
    await answerAndExpectOnePromptSend(page, pressedAt);
  });

  test("after a refused attempt the widget still says its state: the callbacks reach the new attempt (review blocker)", async ({ page }) => {
    test.setTimeout(90_000);
    // A field no observer sees: the callbacks are the only way the widget and the button can know.
    const openedAt = await openWithStandIn(page, { blindField: true });
    const widgetElement = page.locator("[data-bot-check]");
    const email = address();
    await fillRequired(page, email, `other-${email}`);
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));

    // First attempt, answered and refused by the server (§206): the form re-renders with a new attempt.
    await answer(page);
    await expect(widgetElement).toHaveAttribute("data-bot-check", "passed");
    await sendButton(page).click();
    await expect(page.locator("#registration-errors")).toBeVisible({ timeout: 20_000 });
    await expect(widgetElement).toHaveAttribute("data-bot-check", "checking");
    await expect(botCheckLine(page)).toHaveText(/^Se verifică…/);

    // Cloudflare calls back through the callbacks it was given at the first draw.
    await askForTick(page);
    await expect(widgetElement).toHaveAttribute("data-bot-check", "interactive");
    await expect(botCheckLine(page)).toHaveText(/Bifează căsuța de mai sus/);
    await answer(page, "call-then-write");
    await expect(widgetElement).toHaveAttribute("data-bot-check", "passed");
    await expect(botCheckLine(page)).toHaveText(/^Verificare reușită/);
  });

  test("Cloudflare's script blocked: said with the owner's sentence and «Reîncearcă verificarea», and a press goes straight through", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route(TURNSTILE_SCRIPT_PATTERN, (route) => route.abort("blockedbyclient"));
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);
    const openedAt = Date.now();

    await expect(botCheckLine(page)).toHaveText(/nu s-a încărcat/);
    await expect(botCheckLine(page)).toHaveText(GAVE_UP);
    await expect(retryButton(page)).toBeVisible();
    await expect(tokenField(page)).toHaveCount(0);

    await fillRequired(page, address());
    await page.waitForTimeout(Math.max(0, HUMAN_PAUSE_MS - (Date.now() - openedAt)));
    const posted = formPost(page);
    const pressedAt = Date.now();
    await sendButton(page).click();
    const request = await posted;
    expect(Date.now() - pressedAt, "not held for a script that will not come").toBeLessThan(PROMPTLY_MS);
    // The failure rides with the form, for the register action to count (§NNN): no request of its own.
    expect(request.postData() ?? "").toContain("widget-failed");
    expect(request.postData() ?? "").not.toContain("held-press-valve");
    await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  });
});
