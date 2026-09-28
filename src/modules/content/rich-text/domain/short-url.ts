/**
 * Bare URLs as a listing card prints them (§366): the host, plus "/…" if the address goes
 * further. Same rule as §332 and §343. Trailing sentence punctuation stays after the host;
 * anything that does not parse as a URL is left as written.
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
    const further = url.pathname.replace(/\/+$/, "") !== "" || url.search !== "" || url.hash !== "";
    return `${host}${further ? "/…" : ""}${trailing}`;
  });
}
