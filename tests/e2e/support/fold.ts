import { expect, type Locator, type Page } from "@playwright/test";

/** The language strips of the event editor, by the box that holds each (§350, `idPrefix`). */
export type EditorStrip = "title" | "description" | "place" | "programme" | "rules" | "address";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A box (or card) of the event editor by its title (§350): the `<details>` whose own summary's
 * heading begins with it. "Begins", because the heading carries the box's closed line after the
 * title — "Locul Parcul Titulescu · hartă" — and its "23 înscriși" chip.
 *
 * Found whether or not it can be seen: a card inside a closed box — "Traseul" inside "Ce fel de
 * eveniment" (§NNN) — has its heading out of the accessibility tree until the box opens, and the
 * card is still the thing a spec means.
 */
export function editorBox(scope: Page | Locator, title: string): Locator {
  const page = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  return scope
    .locator("summary")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^${escaped(title)}`), includeHidden: true }) })
    .first()
    .locator("xpath=..");
}

/**
 * Open a box of the event editor by its title, the way a person does (`openFold`), and return it.
 *
 * Every box around it first, outermost first — a card inside a closed box cannot be pressed until
 * the box is open (§NNN: the status, the course and the links sit inside "Ce fel de eveniment").
 */
export async function openEditorBox(scope: Page | Locator, title: string): Promise<Locator> {
  const box = editorBox(scope, title);
  await box.waitFor({ state: "attached" });
  // Document order, which for ancestors is outermost first.
  const around = box.locator("xpath=ancestor::details");
  const count = await around.count();
  for (let index = 0; index < count; index += 1) await openFold(around.nth(index));
  await openFold(box);
  return box;
}

/** One language's tab of one box's strip: `#title-tab-en`, `#address-tab-ro`. */
export function languageTab(page: Page, strip: EditorStrip, locale: "ro" | "en"): Locator {
  return page.locator(`#${strip}-tab-${locale}`);
}

/** The panel under that tab. */
export function languagePanel(page: Page, strip: EditorStrip, locale: "ro" | "en"): Locator {
  return page.locator(`#${strip}-panel-${locale}`);
}

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
