import { mayCountNow, type PageAttention } from "@/modules/rsvp/domain/auto-confirm";

/**
 * When the manage page presses «Da, vin la cursă» by itself (the decision «Cere reconfirmarea»; one press counts), as pure
 * rules outside the client file so a test reads them without a browser. The pattern is the «Da, vin» link page's (the
 * decision «The «Vii?» card and «Cine vine» are closed folds, and the «Da, vin» link counts you when it opens»; the owner,
 * 2026-10-19: «Asta ar trebui să se auto-bifeze când deschid»): the email's «Vin» opens the page at `#reconfirm`, and the
 * page submits its own form once — the same POST the button makes. The GET still writes nothing (AGENTS.md §12.8,
 * BR-REQ-036-02 criterion 4): a scanner that fetches the link without running its scripts counts nobody, and without
 * JavaScript the button stays and works.
 */

/** Where the email's «Vin» lands, and the only anchor that presses: `#cancel` and a bare link press nothing. */
export const RECONFIRM_ANCHOR = "reconfirm";

/**
 * Whether the server draws the island around a person's form. Only the link's OWN registration (never another person of
 * the same address), only while its question is open and the event ahead, and never when the address already carries an
 * answer (`?reconfirm=1`) or a refusal (`?reconfirm=0`) — so a refusal is shown once and never retried, and an answered
 * question has no form to press.
 */
export function reconfirmPressesItself(person: { own: boolean; questionOpen: boolean; outcome: string | undefined }): boolean {
  return person.own && person.questionOpen && person.outcome === undefined;
}

/** Whether the browser may press now: the page opened at `#reconfirm`, shown and not merely prerendered (`mayCountNow`). */
export function mayReconfirmNow(page: PageAttention & { hash: string }): boolean {
  return page.hash === `#${RECONFIRM_ANCHOR}` && mayCountNow(page);
}
