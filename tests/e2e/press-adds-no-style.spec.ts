import { expect, type Page, type Route, test } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-041-01 (§NNN) — pressing a form's send or save button adds no CSS rule to the page.
 *
 * MUI's styles sit in cascade layers here, and Chromium answers a layered rule added to a live
 * page by recomputing every element's style and every line's layout: on the email wording page, a
 * phone's press of "Salvează textul" was 0.4–0.9 s of it (`tests/e2e/perf/inp.spec.ts`). The
 * pending runner is drawn with the page and the submit buttons mount no touch ripple, so the press
 * writes nothing — which this counts, deterministically, rather than timing anything.
 *
 * Nothing is saved: the Server Action's POST is held unanswered until the pending label has
 * painted, then abandoned.
 */

/** Count every rule the page inserts into a stylesheet, from before its first script. */
function countInsertedRules() {
  const counter = { rules: [] as string[] };
  (window as unknown as { __insertedRules: typeof counter }).__insertedRules = counter;
  const insertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function counted(this: CSSStyleSheet, rule: string, index?: number) {
    counter.rules.push(rule.slice(0, 120));
    return insertRule.call(this, rule, index);
  };
}

const insertedSince = (page: Page) => page.evaluate(() => (window as unknown as { __insertedRules: { rules: string[] } }).__insertedRules.rules.slice());
const resetInserted = (page: Page) => page.evaluate(() => void ((window as unknown as { __insertedRules: { rules: string[] } }).__insertedRules.rules.length = 0));

async function holdServerActions(page: Page): Promise<() => Promise<void>> {
  const held: Route[] = [];
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      held.push(route);
      return;
    }
    await route.fallback();
  });
  return async () => {
    for (const route of held.splice(0)) await route.abort().catch(() => undefined);
  };
}

test("BR-REQ-041-01 the email wording's Salvează textul, the page's first press, adds no style", async ({ page }) => {
  await page.addInitScript(countInsertedRules);
  await signIn(page, "Dev Administrator");
  const abandon = await holdServerActions(page);
  await page.goto("/ro/admin/emails");
  await hydrated(page);
  const editor = page.locator('[data-testid^="email-copy-"]').first();
  // Its folds opened by the keyboard, as a person would: no pointer press before the one measured.
  const around = editor.locator("xpath=ancestor::details");
  for (let index = 0; index < (await around.count()); index += 1) {
    const fold = around.nth(index);
    if ((await fold.getAttribute("open")) === null) await fold.locator(":scope > summary").press("Enter");
  }
  await editor.locator("[name=subject]").fill("Te-ai înscris — mulțumim");
  await editor.locator(".tiptap").first().click();
  await page.keyboard.type(" Ne vedem la start.");

  await resetInserted(page);
  await editor.getByRole("button", { name: "Salvează textul" }).click({ noWaitAfter: true });
  await expect(editor.getByRole("button", { name: "Se salvează…" })).toBeVisible();
  expect(await insertedSince(page)).toEqual([]);
  await abandon();
});

test("BR-REQ-041-01 the registration form's Trimite înscrierea adds no style", async ({ page }) => {
  await page.addInitScript(countInsertedRules);
  await signIn(page, "Dev Administrator");
  await ensureRegistrationIsOpen(page);
  const abandon = await holdServerActions(page);
  await page.goto(`/ro/evenimente/${FEATURED.slug}/inscriere`);
  await hydrated(page);
  const email = `press-style-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName: "Popescu",
    email,
    emailConfirm: email,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
  for (const name of ["privacyAcknowledged", "rulesAcknowledged", "fitnessDeclared"]) {
    const box = page.locator(`[name="${name}"]`);
    if ((await box.count()) && (await box.isEditable())) await box.check();
  }

  await resetInserted(page);
  await page.getByRole("button", { name: "Trimite înscrierea" }).click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Se trimite…" })).toBeVisible();
  expect(await insertedSince(page)).toEqual([]);
  await abandon();
});
