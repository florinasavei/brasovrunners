import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { permanentRedirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

/**
 * The site root is the events landing page.
 *
 * This site exists so that people can find and enter the club's races; a separate welcome page
 * in front of that is a page nobody needs to read. Rather than rendering the listing at two
 * URLs — which would be duplicate content, and would force a canonical decision between them —
 * the root redirects and `/events` stays the one address the listing lives at.
 *
 * Redirecting rather than rendering also keeps every link, `hreflang` alternate and sitemap
 * entry pointing at one URL per locale, which is what BR-REQ-040-01 asks for.
 *
 * Permanent (308) rather than temporary: this is a standing decision about where the site
 * lives, so crawlers should consolidate the root's ranking signals onto the listing instead of
 * keeping two URLs alive. Change it back to `redirect` if a real home page is ever added.
 *
 * The helper comes from the next-intl navigation module, not from `next/navigation`: the raw
 * one would drop the locale prefix and send a Romanian visitor to an unprefixed path.
 */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  // BR-REQ-040-02: an unknown locale is a 404, not a redirect into the default language.
  if (!hasLocale(routing.locales, locale)) notFound();

  permanentRedirect({ href: "/events", locale });
}
