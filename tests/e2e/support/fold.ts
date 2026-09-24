import { expect, type Locator } from "@playwright/test";

/**
 * Open a backoffice fold, the way a person does: activate its summary (`DECISIONS.md` §336 —
 * every backoffice fold starts closed and opens by itself only for what the reader must see).
 *
 * By keyboard (`press("Enter")`, which Playwright focuses the element for) rather than a raw
 * pointer click. The site's own footer is `position: sticky; bottom: 0` and stays pinned to the
 * bottom of the viewport for as long as the page has anything left to scroll (`DECISIONS.md`
 * §157 and others) — deliberately, so it is always in view. A page short enough for a closed
 * fold to be the last thing on it can put that fold's summary exactly where the footer is
 * pinned once a pointer click scrolls the summary flush with the viewport's bottom edge, and the
 * footer, sitting above it, takes the click instead. A `<summary>` is a native, focusable
 * control that a keyboard toggles the same way a pointer does, and focusing it is not a hit test
 * at a screen coordinate, so what happens to be drawn on top of it does not matter. Works with
 * JavaScript off: a `<details>` answers the keyboard natively.
 *
 * Idempotent, because whether a fold is already open is exactly what the page decides — after its
 * own save, with something waiting — and a second press would close it again. Its own summary
 * only (`:scope > summary`), so a card of cards is opened without touching the cards inside it.
 */
export async function openFold(fold: Locator) {
  if ((await fold.getAttribute("open")) === null) await fold.locator(":scope > summary").press("Enter");
  await expect(fold).toHaveAttribute("open", "");
}
