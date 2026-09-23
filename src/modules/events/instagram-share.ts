/**
 * Sharing the square card to Instagram (`DECISIONS.md` §90, §140): the rules, with no browser
 * in them.
 *
 * Instagram has no share address that takes a link, and §140 rejected a deep link because
 * none takes a picture. What it does take is a picture handed over by the phone's own share
 * sheet — `navigator.share({ files })`, which iOS Safari (15+) and Android Chrome offer, and
 * which lands in Instagram's story or post composer with the card already in it. Where a
 * browser cannot share a file, the card stays a download and the button says so.
 *
 * The decisions live here as pure functions, so they are tested without a device; the island
 * (`ui/InstagramShareButton.tsx`) owns the click, the fetch and the DOM.
 */

/** What the island asks of the browser: the two Web Share methods, both optional. */
export type ShareCapableNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

/** What `share-image/route.ts` draws. The response's own type wins when it names one. */
export const INSTAGRAM_IMAGE_TYPE = "image/png";

/**
 * Whether this browser can hand a picture to the share sheet.
 *
 * `canShare` alone is not the answer: a browser may have it and say yes to a link while
 * saying no to a file, and Firefox has neither method. So the question carries a probe file
 * of the type the route serves, and the answer is the browser's own. No `File` constructor —
 * an old WebView — is a no, and a `canShare` that throws on `files` is a no.
 */
export function canShareFiles(
  nav: ShareCapableNavigator | undefined,
  // `null` for "this browser has no File": a default fills in `undefined`, so it cannot mean that.
  FileCtor: typeof File | null = globalThis.File ?? null,
): boolean {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  if (typeof FileCtor !== "function") return false;
  try {
    return nav.canShare({ files: [new FileCtor([], "probe.png", { type: INSTAGRAM_IMAGE_TYPE })] }) === true;
  } catch {
    return false;
  }
}

/**
 * Whether the button shares or downloads.
 *
 * A share where a finger is the pointer, a download where a mouse is. A phone's sheet has
 * Instagram in it, which is the whole point; a desktop's sheet — Windows offers Mail and
 * nearby devices, macOS AirDrop and Messages — does not, and a person posting from a desktop
 * uploads a file, so the file is what they are given. `(pointer: coarse)` is the browser's
 * own word for the first.
 */
export function offersInstagramShare(nav: ShareCapableNavigator | undefined, coarsePointer: boolean): boolean {
  return coarsePointer && canShareFiles(nav);
}

/** The file's name in the sheet and on the phone: the event's slug, so a saved card says which run it is. */
export function instagramFileName(slug: string): string {
  return `${slug}-instagram.png`;
}

/**
 * The share sheet's payload: the picture as a `File` — the type from the response when it
 * names one, PNG otherwise — with the event's title and its address as the text, so an app
 * that takes text (a story's caption, a message) gets the where-to as well as the picture.
 */
export function instagramShareData(
  picture: Blob,
  { fileName, title, url }: { fileName: string; title: string; url: string },
): ShareData {
  const type = picture.type || INSTAGRAM_IMAGE_TYPE;
  const file = new File([picture], fileName, { type });
  return { files: [file], title, text: `${title} ${url}` };
}

/**
 * When a refused share becomes a download.
 *
 * The person closing the sheet is an `AbortError`, and it means "no" — a download after it
 * would be the site insisting. Everything else — iOS deciding the tap is too old to count
 * (`NotAllowedError`), a browser that said yes to `canShare` and then refused (`TypeError`),
 * the picture failing to load — is the site's problem, and the card as a file is the honest
 * fallback.
 */
export function fallsBackToDownload(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return true;
  return (error as { name?: unknown }).name !== "AbortError";
}
