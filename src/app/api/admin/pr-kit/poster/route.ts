import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { posterFileName } from "@/modules/pr-kit/domain/kit";
import { kitDownload, refusePrKit } from "@/modules/pr-kit/http";
import { renderYoutubePoster } from "@/modules/pr-kit/poster-pdf";
import { env } from "@/shared/config/env";
import { CLUB_HASHTAGS } from "@/theme/brand";

/**
 * «PR Kit» → «Afiș YouTube» (§1015): the A4 poster as a PDF, drawn on request — `GET /api/admin/pr-kit/poster?locale=ro` — its
 * code to the club's channel, `CLUB_YOUTUBE_URL`, its words in `locale`'s language, the club's hashtags at its foot. While the
 * variable is not set there is no poster: not found here, and one line on the page saying where it is set.
 *
 * Every backoffice role, the volunteers included (`refusePrKit`); a GET that writes nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = await refusePrKit();
  if (refused) return refused;
  const url = env.CLUB_YOUTUBE_URL;
  if (!url) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const locale = new URL(request.url).searchParams.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const t = await getTranslations({ locale, namespace: "Admin" });
  const pdf = await renderYoutubePoster({
    url,
    words: { kicker: t("prKit.poster.kicker"), brand: t("prKit.poster.brand"), lead: t("prKit.poster.lead"), tab: t("prKit.poster.tab"), scan: t("prKit.poster.scan") },
    hashtags: CLUB_HASHTAGS,
    generatedAt: new Date(),
  });
  return kitDownload(pdf, "application/pdf", posterFileName(locale));
}
