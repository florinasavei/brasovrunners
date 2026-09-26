/**
 * The public site's toasts (§427): the three flows a visitor finishes on a page of the site
 * rather than in the backoffice — the contact form sent (§149), a registration cancelled from
 * the participant's own link (§77, BR-REQ-036-01), and the declaration signed, which is the
 * participation confirmation (§86, §104) — say their outcome in a toast, through the same flash
 * the backoffice uses (§384).
 *
 * Pure: no React, no `next/headers`, so the list and the cookie test are unit-tested in Node and
 * both the actions (`flash.ts`), the server slot (`PublicFlash`) and the island (`FlashToast`)
 * import it.
 *
 * **Why a list of its own.** The backoffice's provider turns any `saved` code into a sentence in
 * the browser, from the whole `Feedback` namespace it carries (`STAFF_CLIENT_MESSAGES`). A public
 * page carries only its islands' words (§353), so its toast is translated on the server and the
 * island receives a sentence, never a key. The server translates only a key named here, and only
 * where the page's slot accepts it — a flash some other action left (a staff member's, in the same
 * browser) is not the public page's to show, and stays for the page it was written for.
 */
export const PUBLIC_TOAST_KEYS = ["contactSent", "unregistered", "declarationConfirmed", "declarationWaitlisted"] as const;

export type PublicToastKey = (typeof PUBLIC_TOAST_KEYS)[number];

/** A public key, checked — the cookie is the browser's to rewrite. */
export function isPublicToastKey(key: string): key is PublicToastKey {
  return (PUBLIC_TOAST_KEYS as readonly string[]).includes(key);
}

/**
 * Whether the browser still holds the flash cookie, from `document.cookie`.
 *
 * The island's "once" (§384: a refresh repeats nothing). The server read the cookie to render the
 * toast, and the island clears it as it shows it; a later render of the same page from the
 * router's cache — the back button, within the same visit — hands the island the same sentence
 * again, and the cookie being gone is what says it was already said. Without JavaScript nothing
 * runs and the page's own banner is the whole answer.
 */
export function flashCookiePresent(documentCookie: string, name: string): boolean {
  return documentCookie.split(";").some((part) => {
    const [key, ...value] = part.trim().split("=");
    return key === name && value.join("=") !== "";
  });
}
