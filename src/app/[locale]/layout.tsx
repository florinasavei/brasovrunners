import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata } from "next";
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
import { siteFontSizeStyle } from "@/modules/appearance/domain/site-font-size";
import { siteTintStyle } from "@/modules/appearance/domain/site-tint";
import { cachedSiteFontSize, cachedSiteTint } from "@/modules/public-cache/reads";
import AppTheme from "@/theme/AppTheme";
import { CLUB_NAME } from "@/theme/brand";

/**
 * Every face is a file in the repository, never a download at build (§460). `next/font/google`
 * fetched these from Google on every build without a warm cache, and a runner that could not
 * reach Google failed the build with "cannot resolve …/font/google/font" — nothing wrong with
 * the code, a red pull request all the same, again and again. The files in `src/theme/fonts/`
 * are Google's own WOFF2 for each weight, one file per weight covering `latin` and `latin-ext`
 * together (ș, ț, ă, â, î — `tests/unit/theme/fonts.test.ts` reads each file's `cmap`), under
 * the SIL Open Font License beside them (`<Family>-LICENSE.txt`).
 *
 * Roboto is the body and heading face and is preloaded on every page, as it was. The other
 * three are not: a browser fetches a face only when a rendered style names it, so declaring a
 * variable costs nothing, and a preload would make every visitor pay for a face they never see.
 */
const roboto = localFont({
  src: [
    { path: "../../theme/fonts/Roboto-300.woff2", weight: "300", style: "normal" },
    { path: "../../theme/fonts/Roboto-400.woff2", weight: "400", style: "normal" },
    { path: "../../theme/fonts/Roboto-500.woff2", weight: "500", style: "normal" },
    { path: "../../theme/fonts/Roboto-700.woff2", weight: "700", style: "normal" },
    { path: "../../theme/fonts/Roboto-900.woff2", weight: "900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-roboto",
});

/**
 * Two more faces for the theme lab (`theme/preview.ts`, BR-REQ-090-06), self-hosted like
 * Roboto; nothing names them until a preview says so.
 */
const inter = localFont({
  src: [
    { path: "../../theme/fonts/Inter-400.woff2", weight: "400", style: "normal" },
    { path: "../../theme/fonts/Inter-500.woff2", weight: "500", style: "normal" },
    { path: "../../theme/fonts/Inter-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-inter",
  preload: false,
});
/**
 * The hand the declaration is signed in (`DECISIONS.md` §86): a typed name shown as a
 * signature. Self-hosted like the rest; loaded only on the pages whose styles name it.
 */
const signature = localFont({
  src: "../../theme/fonts/Caveat-500.woff2",
  weight: "500",
  style: "normal",
  display: "swap",
  variable: "--font-signature",
  preload: false,
});
const nunito = localFont({
  src: [
    { path: "../../theme/fonts/Nunito-400.woff2", weight: "400", style: "normal" },
    { path: "../../theme/fonts/Nunito-500.woff2", weight: "500", style: "normal" },
    { path: "../../theme/fonts/Nunito-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-nunito",
  preload: false,
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

/**
 * No locale is prerendered at build (§543, amending §333): the public pages are static, and a page
 * made at build would be made from the build's database — CI has none — and filed under no cache
 * tag (`publicRead` reads straight through during `next build`), so no write could ever expire it.
 * An empty list is Next's own way of saying "make each page on its first visit, then keep it"
 * (ISR, `generateStaticParams` → "all paths at runtime"). The locale is still checked below: an
 * unknown one is a 404, and `/ro` and `/en` themselves are the proxy's 308 (§353).
 */
export function generateStaticParams(): { locale: string }[] {
  return [];
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
  // «Aspectul site-ului» (§488): the club's tint for the public pages, from the public cache, as
  // one rule on MUI's page-colour variable — nothing at all for the default.
  const tintStyle = siteTintStyle(await cachedSiteTint());
  // «Mărimea textului» (§530): the club's text size for the public pages, the same way — one rule
  // on the root font size, nothing at all for the default.
  const fontSizeStyle = siteFontSizeStyle(await cachedSiteFontSize());

  return (
    // suppressHydrationWarning: MUI's CSS-variable theme initialises on the client.
    <html lang={locale} suppressHydrationWarning>
      <body className={`${roboto.variable} ${facon.variable} ${inter.variable} ${nunito.variable} ${signature.variable}`}>
        {/* Drawn on the server, before the first paint; light scheme and public pages only
            (`modules/appearance/domain/site-tint.ts`). Its text is a preset or a checked #rrggbb, never raw typed text. */}
        {tintStyle && <style data-site-tint="">{tintStyle}</style>}
        {/* Public pages only, both schemes (`modules/appearance/domain/site-font-size.ts`); its text is a step's own number. */}
        {fontSizeStyle && <style data-site-font-size="">{fontSizeStyle}</style>}
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
                  {/* The build stamp is the fold's own line below `md`, and pinned to the bar's own
                      bottom-right corner from `md` (`SiteFooter`, §372), not a label of its own here. */}
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
