import { INSTAGRAM_HANDLE, STRAVA_URL } from "./fields";

/**
 * Where a registration's socials (§106) point, for the backoffice's registration page and the
 * public list (§500). One place, so the two cannot build the Instagram address two ways.
 */

/** A username's profile page. The handle is stored without the `@` (`fields.ts`). */
export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

/**
 * A profile on strava.com itself — with or without `www.`, over https only. Narrower than the
 * form's `STRAVA_URL`, which also takes the app's share links on `strava.app.link` for the club's
 * own use (§106): that host is a third party's deep-link and attribution redirector, and a public
 * page never prints a redirector beside a runner's name (§500).
 */
const PUBLIC_STRAVA_PROFILE = /^https:\/\/(?:www\.)?strava\.com\/(athletes|pros)\/([A-Za-z0-9_-]+)\/?$/;

/**
 * The Strava link a public page may print, or null. The form refused anything but Strava's own
 * addresses (§106); a public page checks again rather than trust the row, so a value written any
 * other way can never become a link to anywhere — and keeps only a strava.com profile, normalised
 * to `https://www.strava.com/<athletes|pros>/<id>`.
 */
export function publicStravaUrl(value: string | null | undefined): string | null {
  if (!value || !STRAVA_URL.test(value)) return null;
  const profile = PUBLIC_STRAVA_PROFILE.exec(value);
  return profile ? `https://www.strava.com/${profile[1]}/${profile[2]}` : null;
}

/** The Instagram profile a public page may link, or null — the username's shape checked again, as above. */
export function publicInstagramUrl(handle: string | null | undefined): string | null {
  return handle && INSTAGRAM_HANDLE.test(handle) ? instagramProfileUrl(handle) : null;
}
