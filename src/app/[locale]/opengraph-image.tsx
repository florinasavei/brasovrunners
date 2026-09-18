import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { env } from "@/shared/config/env";
import { COLOR } from "@/theme/brand";

/**
 * The site's own share picture (`DECISIONS.md` §90), for every page without one of its own:
 * the listing, a standing page, the gallery index. The club's name and what it does, in the
 * brand's blue. An event's page has its own, drawn from the event.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const known = routing.locales.find((candidate) => candidate === locale) ?? routing.defaultLocale;
  const site = await getTranslations({ locale: known, namespace: "Site" });
  const events = await getTranslations({ locale: known, namespace: "Events" });
  const host = new URL(env.APP_BASE_URL).host;
  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: `linear-gradient(135deg, ${COLOR.blueInk} 0%, ${COLOR.blue} 100%)`,
          color: "#ffffff",
          fontFamily: "Noto Sans, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 14, height: 44, background: COLOR.orange, borderRadius: 4 }} />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 6, textTransform: "uppercase" }}>{site("name")}</div>
        </div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 800, lineHeight: 1.15 }}>{events("intro")}</div>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 600, opacity: 0.9 }}>{host}</div>
      </div>
    ),
    size,
  );
}
