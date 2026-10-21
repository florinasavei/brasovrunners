import { expect, type Locator, type Page } from "@playwright/test";
import { hydrated } from "./featured-event";
import { openFold } from "./fold";

/**
 * The event editor's «Roluri» card as a person uses it (§791): one form for every role, a sub-card per category, a blank row at the end of each,
 * ONE «Salvează toate rolurile». The specs that define roles to test something else go through these, so a change of the card is one file's.
 */

/** A category's sub-card, by the words of its title («Traseu», «Alte roluri»). */
export function roleGroup(page: Page, title: string): Locator {
  return page.getByTestId("volunteer-role-group").filter({ has: page.locator("h4").filter({ hasText: title }) });
}

/** A saved role's row, by its Romanian name as saved. */
export function roleRow(page: Page, nameRo: string): Locator {
  return page.getByTestId("volunteer-role").filter({ has: page.locator(`input[name$=".nameRo"][value="${nameRo}"]`) });
}

/**
 * The blank row at the end of a category's sub-card — `undefined` for an event with no category, which lists its rows without sub-cards and has the
 * one blank row; `null` for «Alte roluri» (a card that exists only while a role is under none: from any other card, «Categoria» files a role there).
 */
export function blankRoleRow(page: Page, category?: string | null): Locator {
  if (category === undefined) return page.getByTestId("volunteer-role-new");
  return roleGroup(page, category ?? "Alte roluri").getByTestId("volunteer-role-new");
}

export type RoleBoxes = {
  nameRo?: string;
  nameEn?: string;
  needed?: string;
  /** The tick «Nelimitat»: `true` ticks it, `false` clears it. */
  unlimited?: boolean;
  /** The category's title in «Categoria», or «Alte roluri». */
  category?: string;
  position?: string;
};

/**
 * Opens a row's boxes the way a person does (§NNN): a saved role's line is a fold whose summary is the role in words, the blank row stands in its
 * category's «Adaugă un rol» fold — every fold around the row, outermost first, then the row's own.
 */
export async function openRoleRow(row: Locator): Promise<void> {
  const around = row.locator("xpath=ancestor::details");
  const count = await around.count();
  for (let index = 0; index < count; index += 1) await openFold(around.nth(index));
  const own = row.getByTestId("volunteer-role-edit");
  if (await own.count()) await openFold(own);
}

/** Types into the boxes of one row, the way a person does: only what is given. */
export async function fillRoleRow(row: Locator, boxes: RoleBoxes): Promise<void> {
  await openRoleRow(row);
  if (boxes.nameRo !== undefined) await row.getByLabel("Nume (RO)").fill(boxes.nameRo);
  if (boxes.nameEn !== undefined) await row.getByLabel("Nume (EN)").fill(boxes.nameEn);
  if (boxes.needed !== undefined) await row.getByLabel("Câte persoane", { exact: true }).fill(boxes.needed);
  if (boxes.unlimited !== undefined) {
    const tick = row.getByRole("checkbox", { name: "Nelimitat" });
    if (boxes.unlimited) await tick.check();
    else await tick.uncheck();
  }
  if (boxes.category !== undefined) await row.getByLabel("Categoria").selectOption({ label: boxes.category });
  if (boxes.position !== undefined) await row.getByLabel("Poziția").fill(boxes.position);
}

/**
 * «Descrierea rolului» of one row, typed in the house's editor: its «Mai multe» fold, the Română tab's editor, then the English tab's — each editor
 * mounts when its tab is in front (§96, §363), and a fold opened under one language is open under the other (the twin folds, §363). One paragraph per line.
 */
export async function describeRole(row: Locator, ro: readonly string[], en: readonly string[]): Promise<void> {
  await openRoleRow(row);
  const more = row.getByTestId("volunteer-role-more");
  await openFold(more);
  for (const [tab, box, lines] of [
    ["Română", "descriptionRoBody", ro],
    ["English", "descriptionEnBody", en],
  ] as const) {
    await more.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    const fold = more.locator(`details[data-rich-text-fold$=".${box}"]`);
    await openFold(fold);
    const editor = fold.locator(".ProseMirror");
    await editor.click();
    for (const [index, line] of lines.entries()) {
      if (index > 0) await row.page().keyboard.press("Enter");
      await row.page().keyboard.type(line);
    }
  }
}

/**
 * Puts away every toast on screen and every one queued behind it: the toast is one at a time, and dismissing the one showing brings the next. What a press
 * says is read from the toast, so the toasts of earlier presses must be gone first, or their words would be taken for this press's.
 */
async function clearToasts(page: Page): Promise<void> {
  const toast = page.getByTestId("toast");
  for (let quiet = 0; quiet < 2; ) {
    if (await toast.count()) {
      await toast.getByRole("button").first().click();
      quiet = 0;
    } else {
      await page.waitForTimeout(250);
      quiet += 1;
    }
  }
}

/**
 * The one press: «Salvează toate rolurile», then the toast that says how many roles it saved — or, with `toast`, the sentence the caller expects, such as
 * «Nimic de schimbat la roluri.» — and the card hydrated again. The toast is what is waited for: the address already ends in the card's anchor, so it says
 * nothing, and the server's answer comes before the page has taken it in.
 */
export async function saveAllRoles(page: Page, toast: string | RegExp = /Am salvat \d+ (de )?rol(uri)?\./): Promise<void> {
  await clearToasts(page);
  await page.getByRole("button", { name: "Salvează toate rolurile", exact: true }).click();
  await expect(page.getByTestId("toast")).toContainText(toast, { timeout: 30_000 });
  await hydrated(page);
}
