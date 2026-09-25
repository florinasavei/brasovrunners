import { expect, type Locator, type Page } from "@playwright/test";

/** The language strips of the event editor, by the box that holds each (§350, `idPrefix`). */
export type EditorStrip = "title" | "description" | "programme" | "rules" | "address" | "course" | "discount-note";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A box (or card) of the event editor by its title (§350): the `<details>` whose own summary's
 * heading begins with it. "Begins", because the heading carries the box's closed line after the
 * title — "Locul Parcul Titulescu · hartă".
 *
 * A card that writes a section of the public page carries the section's number before its title
 * (§NNN: "4 · Data și ora — apare pe pagină"), so the title may follow "N · " and nothing else: a
 * spec names the card, and the number is `events/domain/page-sections.ts`'s to move.
 *
 * Found whether or not it can be seen: a card inside a closed box — a card of "Participare și
 * înscrieri" — has its heading out of the accessibility tree until the box opens, and the card is
 * still the thing a spec means.
 */
export function editorBox(scope: Page | Locator, title: string): Locator {
  const page = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  return scope
    .locator("summary")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^(?:\\d+ · )?${escaped(title)}`), includeHidden: true }) })
    .first()
    .locator("xpath=..");
}

/**
 * Open a box of the event editor by its title, the way a person does (`openFold`), and return it.
 *
 * Every box around it first, outermost first — a card inside a closed box cannot be pressed until
 * the box is open (the cards of "Participare și înscrieri"; §358's cards inside "Ce fel de
 * eveniment" are boxes of their own since §NNN).
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

/**
 * A card on the public events listing, found by its own heading, with the "other events" fold
 * around it (§89, `[data-testid="other-events"]`) opened first if it is closed.
 *
 * That fold starts open only when there are four or fewer other events (`app/[locale]/events/
 * page.tsx`, `open={cards.length <= 4}`) and closed on a phone otherwise — a seeded database
 * that has grown past four leaves it closed, and a spec that looked for a card by text alone
 * (§375's own family) found nothing there and failed, flakily, only once enough sample events
 * had accumulated. `difficulty-scale.spec.ts`, `event-cost-external-discount.spec.ts`, `night-
 * event.spec.ts` and `partner-marker.spec.ts` each grew their own copy of the fix; this is the
 * one helper for all four, called after the caller's own `page.goto` to the listing (§NNN).
 *
 * Waits for the list to have streamed in past the shell first (§166) — the fold and the cards
 * inside it are attached only once it has — then opens the fold, then filters by heading, the
 * card's own `<h2>`, rather than by text anywhere in the `<li>`: a card with another card's
 * title in its own description text (an "excerpt" quoting a related run, say) would otherwise
 * match the wrong one.
 *
 * A listing with no featured event has no fold at all — every card sits in a plain `<ul>` — so
 * opening it is a no-op there.
 *
 * `.first()`, not the bare testid locator: the listing streams in behind a Suspense boundary
 * (§166) and a read caught between the fallback leaving and the real content settling can find
 * two elements answering to the same testid for one tick, which turned a plain `getByTestId`
 * into a strict-mode violation under load. `openFold` on the first of them is what a reader's
 * own eye would land on regardless.
 */
export async function cardOnListing(page: Page, heading: string | RegExp): Promise<Locator> {
  await expect(page.locator("#main ul > li h2").first()).toBeAttached();
  const fold = page.getByTestId("other-events").first();
  if ((await fold.count()) > 0) await openFold(fold);
  return page.locator("li").filter({ has: page.getByRole("heading", { name: heading }) });
}
