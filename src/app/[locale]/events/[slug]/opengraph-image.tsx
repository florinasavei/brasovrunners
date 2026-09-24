import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { eventShareImage, SHARE_SHAPES } from "@/modules/events/share-image";

/**
 * The Open Graph picture of one event (`DECISIONS.md` §90): what Facebook, WhatsApp and a
 * link preview anywhere show under the address. Next writes the `og:image` tags from this
 * file; the picture itself is drawn in `modules/events/share-image.tsx`, shared with the
 * square one for Instagram.
 */
export const size = SHARE_SHAPES.og;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Response> {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const event = known ? await findPublishedEventBySlug(getDb(), known, slug) : undefined;
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
