import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BACKOFFICE_CLIENT_MESSAGES, pickMessages } from "@/i18n/client-messages";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import BackofficeShell from "@/modules/staff-identity/ui/BackofficeShell";
import { env } from "@/shared/config/env";
import { readFlash } from "@/shared/feedback/flash";
import ToastProvider from "@/shared/feedback/ToastProvider";
import PickerProvider from "@/shared/forms/pickers/PickerProvider";
import { SAVE_FALLBACK_COOKIE } from "@/shared/forms/save-fallback";
import SaveFallbackGuard from "@/shared/forms/SaveFallbackGuard";
import SaveFallbackNotice from "@/shared/forms/SaveFallbackNotice";
import { signOutAction } from "./actions";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/** Reads the session cookie, so it can never be prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // The backoffice is not public content. The proxy sets the same thing as a response header,
  // which is what covers the responses that never render metadata at all.
  robots: { index: false, follow: false },
};

/**
 * The backoffice shell, and the gate in front of it.
 *
 * BR-REQ-060-01 criterion 3: an unauthenticated request to any `/admin` route is refused. It
 * is refused here for the pages, and again inside every Server Action, because a page guard
 * says nothing about a POST that arrives without ever rendering one.
 *
 * Signed out, the answer depends on whether there is any way to sign in at all. Where there is
 * one — the development switcher locally, Zitadel in qa and production — the visitor is sent to
 * it, and signing in lands them back in the backoffice rather than on whatever page the provider
 * felt like. Where `STAFF_AUTH_MODE=disabled` there is no lock on the door at all, and the
 * answer is 404: announcing "sign in" on a site with no sign-in would be an invitation to look
 * for one.
 */
export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await getCurrentStaffUser();
  if (!staffUser) {
    if (env.STAFF_AUTH_MODE === "disabled") notFound();
    redirect(getPathname({ locale, href: "/sign-in" }));
  }

  const messages = await getMessages({ locale });
  // The toast the last redirect left, if any (`shared/feedback/flash.ts`, §384): shown once by
  // the provider below, which also clears the cookie, so a refresh shows nothing.
  const flash = await readFlash();
  // The simple way was tried for the last save, because the network blocked the scripted one
  // (§NNN): «Trimite pe calea simplă» set this cookie as the plain POST left, and the notice below
  // clears it. It says the path was tried, never that the save landed — the §384 toast says that.
  const savedTheSimpleWay = (await cookies()).get(SAVE_FALLBACK_COOKIE)?.value === "1";

  return (
    /*
      The staff islands' words on top of the public ones (§353). The root layout's provider carries
      only what a visitor's page needs, and a provider's messages replace its parent's rather than
      merging with them, so this subtree's whole list is named here. `/devs` nests the same.
    */
    <NextIntlClientProvider messages={pickMessages(messages, BACKOFFICE_CLIENT_MESSAGES)} formats={null}>
      <BackofficeShell locale={locale} staffUser={staffUser} signOut={signOutAction}>
        {/* Mounted once, for every date and time box in the backoffice (`shared/forms/pickers`,
            `DECISIONS.md` §345) — never on a public route, which never imports this shell. The
            toasts the same: one provider, every backoffice form's "it worked" (§384). */}
        <ToastProvider flash={flash}>
          {/* A save a network refused is offered the simple way, and the page it lands on says so (§NNN). */}
          <SaveFallbackGuard />
          <SaveFallbackNotice shown={savedTheSimpleWay} />
          <PickerProvider>{children}</PickerProvider>
        </ToastProvider>
      </BackofficeShell>
    </NextIntlClientProvider>
  );
}
