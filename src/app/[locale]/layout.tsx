import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata } from "next";
import { Caveat, Inter, Nunito, Roboto } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import { env } from "@/shared/config/env";
import { PUBLIC_CLIENT_MESSAGES, pickMessages } from "@/i18n/client-messages";
import { missingMessagesAreLoud } from "@/i18n/errors";
import IntlErrorHandling from "@/i18n/IntlErrorHandling";
import { routing } from "@/i18n/routing";
import EnvironmentNotice from "@/shared/ui/EnvironmentNotice";
import SiteFooter from "@/shared/ui/SiteFooter";
import SiteHeader from "@/shared/ui/SiteHeader";
import AppTheme from "@/theme/AppTheme";
import { CLUB_NAME } from "@/theme/brand";

const roboto = Roboto({
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-roboto",
});

/**
 * Two more faces for the theme lab (`theme/preview.ts`, BR-REQ-090-06), self-hosted like
 * Roboto. Declaring a variable costs nothing at load: a browser fetches a font file only when
 * a rendered style names it, and nothing does until a preview says so.
 */
const inter = Inter({
  weight: ["400", "500", "700"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-inter",
});
/**
 * The hand the declaration is signed in (`DECISIONS.md` §86): a typed name shown as a
 * signature. Self-hosted like the rest; loaded only on the pages whose styles name it.
 */
const signature = Caveat({
  weight: ["500"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-signature",
});
const nunito = Nunito({
  weight: ["400", "500", "700"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-nunito",
});

/**
 * Facón, the face on the club's kit, for the wordmark beside the logo. Self-hosted from
 * `src/theme/fonts/`, unmodified — the designer's licence forbids altering the file, and a TTF
 * serves perfectly well, so no WOFF2 conversion is performed. See `docs/brand/README.md`.
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

export async function generateMetadata(): Promise<Metadata> {
  return {
    // BR-REQ-101-02: every absolute URL derives from APP_BASE_URL.
    metadataBase: new URL(env.APP_BASE_URL),
    // The club's name from its one constant (§369): a proper name, the same in both languages.
    title: { default: CLUB_NAME, template: `%s · ${CLUB_NAME}` },
    // The large card on X and everywhere that reads Twitter tags; Facebook reads `og:*`, which
    // the `opengraph-image.tsx` files write (`DECISIONS.md` §90).
    twitter: { card: "summary_large_image" },
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
  const messages = await getMessages({ locale });

  return (
    // suppressHydrationWarning: MUI's CSS-variable theme initialises on the client.
    <html lang={locale} suppressHydrationWarning>
      <body className={`${roboto.variable} ${facon.variable} ${inter.variable} ${nunito.variable} ${signature.variable}`}>
        {/* Sets data-light / data-dark on <html> before paint, so a dark page never flashes light
            (§93). Light unless the visitor pressed the switch — the owner: "by default we are on
            white, ignore browser settings; dark is enabled only by the button". */}
        <InitColorSchemeScript attribute="data" defaultMode="light" />
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <AppTheme>
            {/*
              Only the words the public islands read (§353). Left bare, next-intl 4 hands the
              client every message and format of the request — the whole catalogue, backoffice
              included, in the payload of every page. The backoffice's layouts nest a provider of
              their own with the staff islands' words added. No `formats`: no island formats a
              date by name (the server does, and passes the string, §324).
            */}
            <NextIntlClientProvider messages={pickMessages(messages, PUBLIC_CLIENT_MESSAGES)} formats={null}>
              <IntlErrorHandling loud={missingMessagesAreLoud(env.APP_ENV)}>
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

                    Visually hidden until focused *from the keyboard*: the standard pattern,
                    and it must not be `display: none`, which would take it out of the tab
                    order and defeat the whole point. `:focus-visible`, not `:focus`, since
                    2026-09-18: a tap that happened to land focus on it (the back gesture on a
                    phone, a tap on the page edge) made a "Skip to content" box pop out of the
                    corner of a site whose visitors have no idea what it is for, and pressing
                    it on a short page moved nothing. Keyboard users still get it; nobody else
                    ever sees it.
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
                      "&:focus-visible": {
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
                  {/* The build stamp is the last line of the footer's fold (§365), not a label of its own. */}
                  <SiteFooter />
                </Box>
              </IntlErrorHandling>
            </NextIntlClientProvider>
          </AppTheme>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
