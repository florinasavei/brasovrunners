import { expect, type Locator } from "@playwright/test";

/**
 * Open a backoffice fold, the way a person does: press its summary (`DECISIONS.md` §NNN — every
 * backoffice fold starts closed and opens by itself only for what the reader must see).
 *
 * Idempotent, because whether a fold is already open is exactly what the page decides — after its
 * own save, with something waiting — and a second press would close it again. Its own summary
 * only (`:scope > summary`), so a card of cards is opened without touching the cards inside it.
 * Works with JavaScript off: a `<details>` opens natively.
 */
export async function openFold(fold: Locator) {
  if ((await fold.getAttribute("open")) === null) await fold.locator(":scope > summary").click();
  await expect(fold).toHaveAttribute("open", "");
}
