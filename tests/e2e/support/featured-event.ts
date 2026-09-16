import { expect, type Page } from "@playwright/test";

/**
 * Getting the seeded featured event into a state a registration journey can be walked against.
 *
 * Extracted from `registration-entry.spec.ts` when `registration-form.spec.ts` needed exactly
 * the same setup: the seed deliberately configures no registration at all (`DECISIONS.md` §28
 * — an event's registration block is an organizer's decision, not a seed's), so every spec that
 * wants a registrable event has to produce one the way an organizer would.
 *
 * Not a spec file, and Playwright's default `testMatch` only collects `*.spec.ts`, so it is
 * simply a module that lives beside them.
 */

export const FEATURED = {
  title: "Crosul aniversar Brașov Runners",
  slug: "crosul-aniversar-brasov-runners",
};

/** Above the 3-second floor `service.ts#looksLikeSpam` applies to a submission. */
export const HUMAN_PAUSE_MS = 3_500;

/**
 * The development staff switcher (`AGENTS.md` §13.1), and the one step every backoffice spec
 * begins with.
 *
 * The wait is explicit and generous on purpose. This is a click, a Server Action and a redirect,
 * racing sixteen other workers for one server — Playwright's 5-second default is a budget for a
 * UI-state assertion, and this is a navigation under load. Exactly the mistake `BR-V1.22` fixed
 * in `vitest.config.mts`, where `hookTimeout` was left at a default meant for cheaper work than
 * the hook actually did; it surfaced as three specs "failing" that were only ever slow.
 *
 * Raising it hides nothing: a sign-in that is genuinely broken never redirects at all, so this
 * still fails — it just fails for the right reason and after the right wait.
 */
export async function signIn(page: Page, identity: string) {
  await page.goto("/ro/autentificare");
  await page.getByRole("button", { name: new RegExp(identity) }).click();
  await expect(page).toHaveURL(/\/ro\/admin$/, { timeout: 30_000 });
}

const modeSelect = (page: Page) => page.getByRole("combobox", { name: "Modul de înscriere" });

/**
 * Put the featured event into "takes registrations here, open now, 50 places".
 *
 * Both Playwright projects work on the *same* event — there is only one featured event, the
 * database refuses a second — so this is written to converge rather than to assume it is
 * alone: both projects want the identical end state, so a save the other one won already made
 * it true.
 *
 * Both dates are left empty on purpose: an absent opening means publication and an absent
 * closing means the event start (BR-REQ-011-01 criteria 3 and 4), so the window needs no fixed
 * date that would rot.
 */
export async function ensureRegistrationIsOpen(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/ro/admin");
    await page.getByRole("link", { name: FEATURED.title }).first().click();
    await expect(page).toHaveURL(/\/admin\/events\//);

    if ((await modeSelect(page).textContent()) === "Înscriere aici") return;

    await modeSelect(page).click();
    await page.getByRole("option", { name: "Înscriere aici" }).click();
    await page.locator('[name="event.capacity"]').fill("50");

    // The approved declaration a participant signs. Chosen, never written: the first real
    // option after "Niciuna" is the sample version the legal seed approved.
    await page.getByRole("combobox", { name: "Declarația pe care o semnează participantul" }).click();
    await page.getByRole("option").nth(1).click();

    // The event is published, so the one save carries the live-edit acknowledgement for the
    // whole form (BR-REQ-051-01 criterion 4) — settings included, now that settings and content
    // are saved together. The service refuses the save without it.
    const acknowledge = page.locator('[name="acknowledgeLiveEdit"]');
    if (await acknowledge.count()) await acknowledge.check();

    await page.getByRole("button", { name: "Salvează", exact: true }).click();

    // The action redirects back with either `saved` or an error code, so the outcome is in the
    // URL rather than in a race with a rendered alert. A CONFLICT here means the other
    // Playwright project saved the same event first, which makes the next pass find it already
    // configured rather than having to save at all.
    await page.waitForURL(/[?&](saved|error)=/);
    if (page.url().includes("saved=")) return;
  }

  throw new Error("could not configure the featured event for registration");
}

