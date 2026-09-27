import { INSTAGRAM_HANDLE, STRAVA_URL } from "./fields";

/**
 * Where a registration's socials (§106) point, for the backoffice's registration page and the
 * public list (§NNN). One place, so the two cannot build the Instagram address two ways.
 */

/** A username's profile page. The handle is stored without the `@` (`fields.ts`). */
export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

/**
 * The Strava link a public page may print, or null. The form refused anything but Strava's own
 * addresses (§106); a public page checks again rather than trust the row, so a value written any
 * other way can never become a link to anywhere.
 */
export function publicStravaUrl(value: string | null | undefined): string | null {
  return value && STRAVA_URL.test(value) ? value : null;
}

/** The Instagram profile a public page may link, or null — the username's shape checked again, as above. */
export function publicInstagramUrl(handle: string | null | undefined): string | null {
  return handle && INSTAGRAM_HANDLE.test(handle) ? instagramProfileUrl(handle) : null;
}
