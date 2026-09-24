/**
 * A web address as a listing card prints it (§NNN): the host a runner recognises, and "/…" when
 * the address went further than that — "register.hakuapp.com/…", never the ninety characters of
 * the registration address, scheme, query and all, wrapped over two lines of a card.
 *
 * The owner, 2026-09-24, with a screenshot of the listing: "There is too much whitespace on these
 * cards". One of the holes was a summary that carried the registration address as text, and a card
 * is a summary of a page, not the place to read an address: the event page keeps the whole text,
 * the link included. The same rule the event's other links follow — "Linkuri și fișiere" (§332)
 * and the cost's "plata pe {host}" (§343) name the host, never the raw URL.
 *
 * Pure and dependency-free, so a Server Component and a test call the same code. A trailing
 * sentence mark is not part of the address (an address that ends a sentence keeps the sentence's
 * full stop after its host), and anything that does not parse as a URL is left exactly as it was
 * written.
 */
const BARE_URL = /\bhttps?:\/\/[^\s<>"]+/gi;

/** The characters a sentence ends an address with, which the address itself almost never does. */
const TRAILING = /[.,;:!?)\]}'»”]+$/;

export function shortenUrls(text: string): string {
  return text.replace(BARE_URL, (match) => {
    const trailing = TRAILING.exec(match)?.[0] ?? "";
    const address = trailing ? match.slice(0, -trailing.length) : match;
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return match;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return match;
    // Anything past the bare host — a path, a query, a fragment — is "/…": the host says where
    // it goes, and the page carries the rest.
    const further = url.pathname.replace(/\/+$/, "") !== "" || url.search !== "" || url.hash !== "";
    return `${host}${further ? "/…" : ""}${trailing}`;
  });
}
