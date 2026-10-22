import type { Locator } from "@playwright/test";
import { openFold } from "./fold";

/**
 * Opens one person's row on the event's «Voluntari» card the way a person does (§842): the row is the house's row fold — the
 * name, the state and the roles given on its line — and its verbs («Dă-i rolul …», «Confirmă», the agreement's) are inside, out
 * of reach until it opens. Every fold around the row first, outermost first (the card itself, closed when nobody waits), then
 * the row's own. Idempotent, like `openFold`: a row a press left open stays open. On the person's own page the block is drawn
 * open and there is nothing to press. Returns the row, for the presses that follow.
 */
export async function openVolunteerRow(row: Locator): Promise<Locator> {
  await row.waitFor({ state: "attached" });
  const around = row.locator("xpath=ancestor::details");
  const count = await around.count();
  for (let index = 0; index < count; index += 1) await openFold(around.nth(index));
  const own = row.getByTestId("volunteer-edit");
  if (await own.count()) await openFold(own);
  return row;
}
