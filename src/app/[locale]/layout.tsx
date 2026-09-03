import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { env } from "@/shared/config/env";
import { routing } from "@/i18n/routing";
import SiteHeader from "@/shared/ui/SiteHeader";
import AppTheme from "@/theme/AppTheme";

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-roboto",
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

  return (
    // suppressHydrationWarning: MUI's CSS-variable theme initialises on the client.
    <html lang={locale} suppressHydrationWarning>
      <body className={roboto.variable}>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <AppTheme>
            <NextIntlClientProvider>
              <SiteHeader />
              {children}
            </NextIntlClientProvider>
          </AppTheme>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
