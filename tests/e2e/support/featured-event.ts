import { expect, type Locator, type Page } from "@playwright/test";
import { openEditorBox } from "./fold";

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
  // A volunteer lands on the desk (`DECISIONS.md` §103); everyone else on the events list.
  await expect(page).toHaveURL(/\/ro\/admin(\/checkin)?$/, { timeout: 30_000 });
  await hydrated(page);
}

/**
 * Wait for the client to have taken over the page before clicking anything that needs it.
 *
 * A MUI select opens only once hydrated; a `Link` clicked mid-hydration is prevented by the
 * router and not replayed; a form submitted mid-hydration is queued by React and sometimes
 * lost. The backoffice pages grew heavier on 2026-09-18 (four editors on an event, §73), so
 * the window a fast test can land in grew with them. Network idle is the cheapest reliable
 * signal that the chunks have loaded and run.
 */
export async function hydrated(page: Page) {
  await page.waitForLoadState("networkidle");
}

/**
 * A backoffice date box, on MUI's picker since `DECISIONS.md` §345 — day, month, year in one
 * segmented field rather than the single `<input type="date">` a page could once `.fill()`
 * directly. What the field actually posts is a *hidden* input under the box's real name (never
 * visible, so `.fill()` on it times out); this drives the picker itself, the way a person would:
 * click the field's own group by the label passed to `DateField`/`WallTimeField`, then type the
 * digits, which MUI's field advances between day, month and year on its own.
 *
 * Found by the field's `<label>` text rather than by a section's own name ("Ziua", "Luna"),
 * because every date picker on the page shares those — MUI's own Romanian locale, not this
 * repository's translation, names the sections. The label is not always unique on a page either:
 * "Ora" is the event's own time of day and every programme row's time, and "Data" is every row's
 * date. A caller that means a row's box passes the row (`programmeRow`) as `scope`, so the lookup
 * cannot reach outside it; with the page as `scope`, the first box of that name is the one filled
 * — the event's own, which sits above the programme.
 */
export async function fillDateField(scope: Page | Locator, label: string, value: string /* YYYY-MM-DD */) {
  const [year, month, day] = value.split("-");
  const group = pickerGroup(scope, label);
  await group.getByRole("spinbutton").first().click();
  await group.page().keyboard.type(`${day}${month}${year}`);
}

/**
 * The time half, the platform's own `<input type="time">` since §345 was amended, 2026-09-25 —
 * MUI's picker before that, which `fillDateField` above still drives (the date half of §345 is
 * untouched). `.fill()` on a native time box takes `HH:mm` directly and posts exactly that,
 * always on the 24-hour clock (`type="time"`'s own value has no AM/PM to disagree about).
 *
 * Found by its accessible label, `.first()` for the same reason `fillDateField` reads the first
 * `spinbutton` group: "Ora" is not unique on a page carrying the event's own start time and a
 * programme row's, so a caller scopes to the row (`programmeRow`) when it means one.
 */
export async function fillTimeField(scope: Page | Locator, label: string, value: string /* HH:mm */) {
  await scope.getByLabel(label, { exact: true }).first().fill(value);
}

/**
 * A picker box by its label: the element MUI gives `role="group"`, named by the `<label>`, whose
 * `spinbutton` children are the sections — `["30", "09", "2027"]`, `["19", "00"]`. Its own
 * text is *not* the value: the outlined box's notch repeats the label inside it (a `<legend>`,
 * hidden from the accessibility tree but not from `textContent`), so a spec reads the sections.
 */
export function pickerGroup(scope: Page | Locator, label: string): Locator {
  return scope.getByRole("group", { name: label, exact: true }).first();
}

/**
 * Row `index` (from 0) of the programme in the event editor (`DECISIONS.md` §117): the box that
 * holds the row's date and its two times. Found by the row's own posted name — the hidden input
 * `DateField` writes `event.schedule[<index>].date` into — so no label the row shares with the
 * rest of the form ("Data", "Ora") can pick a box outside it. The innermost `div` holding that
 * input is the row's own box: every other `div` that holds it is one of its ancestors, and
 * ancestors come first in document order.
 */
export function programmeRow(page: Page, index: number): Locator {
  return page
    .locator("div")
    .filter({ has: page.locator(`input[name="event.schedule[${index}].date"]`) })
    .last();
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
    await hydrated(page);

    // Everything about registration is one box of the editor now (§350), shut on arrival.
    await openEditorBox(page, "Participare și înscrieri");
    if ((await modeSelect(page).textContent()) === "Înscrieri pe site") return;

    await modeSelect(page).click();
    await page.getByRole("option", { name: "Înscrieri pe site" }).click();
    await page.locator('[name="event.capacity"]').fill("50");

    // The approved declaration a participant signs, in its own card. Chosen, never written: the
    // first real option after "Niciuna" is the sample version the legal seed approved.
    await openEditorBox(page, "Condiții de participare și declarația");
    await page.getByRole("combobox", { name: "Declarația pe care o semnează participantul" }).click();
    await page.getByRole("option").nth(1).click();

    // The event is published, so the one save carries the live-edit acknowledgement for the
    // whole form (BR-REQ-051-01 criterion 4) — settings included, now that settings and content
    // are saved together. The service refuses the save without it.
    const acknowledge = page.locator('[name="acknowledgeLiveEdit"]');
    if (await acknowledge.count()) await acknowledge.check();

    await page.getByRole("button", { name: "Salvează", exact: true }).click();

    // A save that went through redirects back with `saved` in the URL. A refusal comes back as
    // the form's own state since §315 — a CONFLICT means the other Playwright project saved the
    // same event first, and its summary is rendered in place with no navigation at all — so both
    // outcomes are waited for, and the next pass finds the event already configured.
    const refusal = page.getByTestId("event-save-form").getByTestId("form-refusal");
    await Promise.race([page.waitForURL(/[?&]saved=/), refusal.waitFor({ state: "visible" })]);
    if (page.url().includes("saved=")) return;
  }

  throw new Error("could not configure the featured event for registration");
}

