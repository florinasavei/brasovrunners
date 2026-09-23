import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * The addresses an event is shared with (`DECISIONS.md` §90, §140), as pure functions of a
 * base URL and the event, so a test can hold them to a fixed base and read them back.
 *
 * Every one is an absolute URL under `APP_BASE_URL` (`AGENTS.md` §8, BR-REQ-101-02): Facebook's
 * scraper is handed the event's own page — never the site's root — and the card it draws is
 * the Open Graph one that page carries (§90). The networks' fixed addresses are theirs, not
 * ours, and `scripts/docs-check.mjs` lists both as provider hosts for that reason.
 *
 * They are anchors on the page, not scripts: iOS Safari refuses a `window.open` made after an
 * `await` and often one made inside a handler, and a plain `<a target="_blank">` is the one
 * thing every browser opens on a tap. The phone's own sheet (`ui/NativeShareButton.tsx`) is
 * the only share that needs JavaScript, and it calls `navigator.share` in the click itself.
 */

/**
 * `base + pathname`, with exactly one slash between them.
 *
 * `env.ts` drops a trailing slash from `APP_BASE_URL` at startup, so every `${base}${pathname}`
 * join in the application reads the same; this builder tolerates one regardless, because it is
 * pure and a test hands it whatever base it likes. The failure it was written for: a base typed
 * as `https://host/` made every share `https://host//ro/…`, which a scraper reads as a
 * different address from the page's own canonical one — and a card with no title is what it
 * draws for an address it cannot match.
 */
export function absoluteUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/** The event's own page in the given locale — the address every share carries. */
export function eventPageUrl(baseUrl: string, locale: Locale, slug: string): string {
  return absoluteUrl(baseUrl, getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } }));
}

/** Facebook's share dialog, handed the page as `u=`, encoded exactly once. */
export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

/** WhatsApp's "send" address: the title and the page as the message's text. */
export function whatsappShareUrl(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
}
