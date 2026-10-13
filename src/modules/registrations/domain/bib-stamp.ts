/**
 * A short, stable stamp of what a bib's picture is drawn from (§NNN, amending §735).
 *
 * The bibs page asks the preview route for each registration's picture, and the route lets the
 * browser keep an answer for an hour. The address named the registration and nothing else, so a
 * change of the event's design — «Cum arată numărul» from «1» to «001» above all — left the old
 * picture under the same address: the club printed the page and got the bare numbers. The stamp
 * goes into the address (`v=`), so a changed design, colour, title, date or partner is a new address
 * and a fresh picture, while an unchanged one is still served from the browser's cache.
 *
 * FNV-1a over the JSON: no secret, no security claim, only a change detector.
 */
export function bibPictureStamp(parts: unknown): string {
  const text = JSON.stringify(parts) ?? "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
