import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { eventShareImage, SHARE_SHAPES } from "@/modules/events/share-image";
import { cachedPublishedEventBySlug } from "@/modules/public-cache/reads";

/**
 * The Open Graph picture of one event (`DECISIONS.md` §90): what Facebook, WhatsApp and a
 * link preview anywhere show under the address. Next writes the `og:image` tags from this
 * file; the picture itself is drawn in `modules/events/share-image.tsx`, shared with the
 * square one for Instagram.
 *
 * Drawn per request from the cached row (§333): every link preview a crawler fetches is a
 * visitor that must not wake the database, and an event save expires the row.
 */
export const size = SHARE_SHAPES.og;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Response> {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const event = known ? await cachedPublishedEventBySlug(known, slug) : undefined;
  if (!known || !event) return new Response("Not found", { status: 404 });
  const t = await getTranslations({ locale: known, namespace: "Event" });
  return await eventShareImage(event, known, "og", {
    type: t(`type.${event.type}`),
    cancelled: t("cancelled"),
    locationToBeAnnounced: t("locationToBeAnnounced"),
    distanceKm: (km) => t("distanceKm", { km }),
    elevationM: (m) => t("elevationM", { m }),
  });
}
