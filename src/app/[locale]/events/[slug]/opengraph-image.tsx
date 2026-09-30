import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { eventShareImage, SHARE_SHAPES } from "@/modules/events/share-image";
import { eventBySlugWithLastGood } from "@/modules/resilience/event-copy";

/**
 * The Open Graph picture of one event (`DECISIONS.md` §90): what Facebook, WhatsApp and a
 * link preview anywhere show under the address. Next writes the `og:image` tags from this
 * file; the picture itself is drawn in `modules/events/share-image.tsx`, shared with the
 * square one for Instagram.
 *
 * Drawn from the cached row (§333), once (§549, amending §333): static, made on its first request
 * and kept by the CDN, so every link preview a crawler fetches is neither a database wake nor a
 * function run; an event save expires the row and, through its tag, the picture. A literal, as Next
 * requires: `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const size = SHARE_SHAPES.og;
export const contentType = "image/png";
export const dynamic = "force-static";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Response> {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const event = known ? await eventBySlugWithLastGood(known, slug) : undefined;
  if (!known || !event) return new Response("Not found", { status: 404 });
  const t = await getTranslations({ locale: known, namespace: "Event" });
  return await eventShareImage(event, known, "og", {
    type: t(`type.${event.type}`),
    cancelled: t("cancelled"),
    locationToBeAnnounced: t("locationToBeAnnounced"),
    dateToBeAnnounced: t("dateToBeAnnounced"),
    timeToBeAnnounced: t("timeToBeAnnounced"),
    distanceKm: (km) => t("distanceKm", { km }),
    t: (key, values) => t(key, values),
  });
}
