/**
 * The numbers the upload path is bounded by, and nothing else: no imports, so the browser can
 * read it without pulling `sharp` into the client bundle (§178).
 */

/** The largest file the upload routes accept. A phone photo is 4–12 MB; the browser shrinks past this. */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/** Below this a "photo" is an icon; above the upper bound a phone did not take it. */
export const MIN_DIMENSION = 200;
export const MAX_DIMENSION = 12_000;

/** The stored variants (§176): 2400 is a full-width picture on a 2× screen, 640 a card or tile. */
export const WEB_MAX = 2400;
export const THUMB_MAX = 640;

/** The master's long side at «Mare» (§414): a 12-megapixel phone frame, so lettering survives. */
export const HIGH_WEB_MAX = 4000;

/** The master's long side at «Minimă» (§437): a phone's column at 3×, about a third of the bytes. */
export const LOW_WEB_MAX = 1280;

/**
 * The master's long side at «Originală» (§437). Not `MAX_DIMENSION`: 12 000² decoded is 432 MB
 * of raw pixels on a function with a gigabyte.
 */
export const ORIGINAL_WEB_MAX = 6000;

/**
 * The most the browser sends (§414): under the platform's 4.5 MB request body (§66), with room
 * for the multipart envelope; otherwise the platform refuses first, without our words.
 */
export const BROWSER_SEND_BYTES = 4 * 1024 * 1024;
