import Alert from "@mui/material/Alert";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import BackofficeShell from "@/modules/staff-identity/ui/BackofficeShell";
import { env } from "@/shared/config/env";
import PickerProvider from "@/shared/forms/pickers/PickerProvider";
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

  const t = await getTranslations("Admin");

  return (
    <BackofficeShell
      locale={locale}
      staffUser={staffUser}
      signOut={signOutAction}
      notice={
        /*
          The club writes its own legal text now (`DECISIONS.md` §46), so this no longer says it
          cannot. What it says instead is the rule that is still true and still easy to trip over:
          an approved version is never rewritten.
        */
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("legalNotice")}
        </Alert>
      }
    >
      {/* Mounted once, for every date and time box in the backoffice (`shared/forms/pickers`,
          `DECISIONS.md` §345) — never on a public route, which never imports this shell. */}
      <PickerProvider>{children}</PickerProvider>
    </BackofficeShell>
  );
}
