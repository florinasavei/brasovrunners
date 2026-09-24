import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { eventShareImage, type ShareShape } from "@/modules/events/share-image";
import { cachedPublishedEventBySlug } from "@/modules/public-cache/reads";

/**
 * The same picture as the Open Graph one, as a file to save (`DECISIONS.md` §90): square by
 * default, because Instagram takes no link and a post there is a picture somebody uploads by
 * hand; `?shape=og` for the wide one. Public, like the event: it shows nothing the page does
 * not, and reads the same cached row (§NNN).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const event = known ? await cachedPublishedEventBySlug(known, slug) : undefined;
  if (!known || !event) return new Response("Not found", { status: 404 });
  const shape: ShareShape = new URL(request.url).searchParams.get("shape") === "og" ? "og" : "square";
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const image = await eventShareImage(event, known, shape, {
    type: t(`type.${event.type}`),
    cancelled: t("cancelled"),
    distanceKm: (km) => t("distanceKm", { km }),
    elevationM: (m) => t("elevationM", { m }),
  });
  image.headers.set("Content-Disposition", `attachment; filename="${slug}-${shape}.png"`);
  image.headers.set("Cache-Control", "public, max-age=3600");
  return image;
}
