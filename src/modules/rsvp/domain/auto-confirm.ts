/**
 * When the «Da, vin» page may press its own button (§812, amending §811; the owner, 2026-10-19, of the link page: «Asta ar trebui să se
 * auto-bifeze când deschid»), as a pure rule outside the client file so a test reads it without a browser.
 *
 * **The GET still writes nothing** (AGENTS.md §12.8, BR-REQ-036-02 criterion 4). Mail scanners fetch the link; they do not run the page's
 * scripts. The island that presses the button runs only in a browser that has hydrated the page, and — one step further — only once the
 * page is one a person is looking at: not while the browser is merely *prerendering* it (a speculative load nobody has opened, which does
 * run scripts) and not while its tab is in the background. The press is the same POST the button makes; without JavaScript the button stays.
 */
export type PageAttention = {
  /** `document.prerendering`: true while the browser loads the page speculatively; undefined where the browser has no such thing. */
  prerendering?: boolean;
  /** `document.visibilityState`. */
  visibilityState: string;
};

/** Whether the page may count the person now. */
export function mayCountNow(page: PageAttention): boolean {
  return page.prerendering !== true && page.visibilityState === "visible";
}
