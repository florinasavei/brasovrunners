import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import { env } from "@/shared/config/env";
import { routing } from "@/i18n/routing";
import BuildBadge from "@/shared/ui/BuildBadge";
import EnvironmentNotice from "@/shared/ui/EnvironmentNotice";
import SiteFooter from "@/shared/ui/SiteFooter";
import SiteHeader from "@/shared/ui/SiteHeader";
import AppTheme from "@/theme/AppTheme";

const roboto = Roboto({
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-roboto",
});

/**
 * Facón, the face on the club's kit. Self-hosted from `src/theme/fonts/`, unmodified — the
 * designer's licence forbids altering the file, and a TTF is served to browsers perfectly
 * well, so no WOFF2 conversion is performed. See `src/theme/fonts/Facon-LICENSE.txt` and
 * `docs/brand/README.md`.
 *
 * `adjustFontFallback` is off: Next's automatic fallback metric matching assumes the fallback
 * covers the same characters, and this font covers only ASCII. Roboto 900 italic is named
 * explicitly instead — the read-me identifies it as the base font Facón was drawn from.
 */
const facon = localFont({
  src: "../../theme/fonts/Facon.ttf",
  weight: "900",
  style: "italic",
  display: "swap",
  variable: "--font-facon",
  adjustFontFallback: false,
  fallback: ["Roboto", "Segoe UI", "Arial", "sans-serif"],
});

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Site" });
  return {
    // BR-REQ-101-02: every absolute URL derives from APP_BASE_URL.
    metadataBase: new URL(env.APP_BASE_URL),
    title: { default: t("name"), template: `%s · ${t("name")}` },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  // BR-REQ-040-02: an unknown locale is a 404, never a fallback to Romanian.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const site = await getTranslations({ locale, namespace: "Site" });

  return (
    // suppressHydrationWarning: MUI's CSS-variable theme initialises on the client.
    <html lang={locale} suppressHydrationWarning>
      <body className={`${roboto.variable} ${facon.variable}`}>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <AppTheme>
            <NextIntlClientProvider>
              {/* Not a <main>: every page already renders its own via `id="main" component="main"` on
                  its root Container, and a document may have only one. */}
              <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
                {/* Above the header, because it has to be read before anything below it is
                    mistaken for the club's real website. */}
                <EnvironmentNotice />
                {/*
                  Skip to the content. Every page renders its own `id="main" component="main"`,
                  so `#main` is a stable target, and a keyboard reader no longer has to
                  tab through the lockup, the sections and the language switcher on
                  every single page before reaching what they came for.

                  Visually hidden until focused: the standard pattern, and it must not
                  be `display: none`, which would take it out of the tab order and
                  defeat the whole point.
                */}
                <Box
                  component="a"
                  href="#main"
                  sx={{
                    position: "absolute",
                    left: -10000,
                    top: 0,
                    // A literal, not a theme callback: this is a Server Component, and a
                    // function in `sx` cannot cross into a Client Component. Above MUI's
                    // tooltip layer (1500), which is the highest thing this site renders.
                    zIndex: 1600,
                    "&:focus": {
                      left: 8,
                      top: 8,
                      px: 2,
                      py: 1,
                      bgcolor: "background.paper",
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                    },
                  }}
                >
                  {site("skipToContent")}
                </Box>
                <SiteHeader />
                <Box sx={{ flex: 1 }}>{children}</Box>
                <SiteFooter />
                <BuildBadge />
              </Box>
            </NextIntlClientProvider>
          </AppTheme>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
