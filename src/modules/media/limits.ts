/**
 * The numbers the upload path is bounded by — and **nothing else in this file** (§178).
 *
 * They lived in `images.ts`, which imports `sharp`. `browser-shrink.ts` runs in the browser and
 * needed one of them, and the import pulled `sharp` — a native module reaching for `node:fs`
 * through `detect-libc` — into the client bundle. The production build stopped there:
 * `Module not found: Can't resolve 'node:fs'`, traced from `PhotoUploader.tsx`. The server never
 * noticed, because on the server the import is fine; only `next build` sees it.
 *
 * So: a module with no imports at all, which both halves may read. Anything that needs `sharp`
 * imports `images.ts`; anything the browser touches imports this.
 */

/** The largest file the upload routes accept. A phone photo is 4–12 MB; the browser shrinks past this. */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/** Below this a "photo" is an icon; above the upper bound a phone did not take it. */
export const MIN_DIMENSION = 200;
export const MAX_DIMENSION = 12_000;

/**
 * The stored variants (§176). 2400 covers a full-width picture on a 2× screen — the editor and
 * the event page render one across roughly a thousand CSS pixels — and 640 is the card and the
 * gallery grid, which is what most pages actually load.
 */
export const WEB_MAX = 2400;
export const THUMB_MAX = 640;

/**
 * The master's long side at «Înaltă» (§414). Keeping 2400 for both choices made "high" a
 * different encoder on the same pixels, and a poster photographed at 4000 pixels lost the same
 * 40% of its lettering either way; the choice now keeps up to 4000, which is what a phone's
 * 12-megapixel camera writes, and the browser shrinks to it rather than to "normal"'s 3000.
 */
export const HIGH_WEB_MAX = 4000;

/**
 * The master's long side at «Minimă» (§437): a picture that only has to be seen — a map sketch,
 * a portrait beside a paragraph, a card's illustration — kept at 1280, which is still a phone's
 * full column at 3× and a laptop's half column at 2×, for about a third of «Medie»'s bytes.
 */
export const LOW_WEB_MAX = 1280;

/**
 * The master's long side at «Originală» (§437): the file's own pixels, up to 6000 — a 24-megapixel
 * camera's frame, beyond anything a screen draws. Not `MAX_DIMENSION`: 12 000 × 12 000 decoded is
 * 432 MB of raw pixels on a function with a gigabyte, and the browser's 4 MB send limit
 * (`BROWSER_SEND_BYTES`) keeps what arrives from a phone well under 6000 anyway.
 */
export const ORIGINAL_WEB_MAX = 6000;

/**
 * The most the browser sends in one upload (§414): under the platform's 4.5 MB request body
 * (§66), with room for the multipart envelope and the other fields. `MAX_UPLOAD_BYTES` is the
 * server's own refusal and stays 6 MB for a caller that is not a function behind that limit; a
 * browser that sent a 5 MB file untouched met the platform's refusal first, with no words of
 * ours around it — rare while «Normală» sent at most 3000 pixels, ordinary once «Înaltă» sends
 * a phone's 4000-pixel photograph as it is.
 */
export const BROWSER_SEND_BYTES = 4 * 1024 * 1024;
