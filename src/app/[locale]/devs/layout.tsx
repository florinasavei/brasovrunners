import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { canSeeDiagnostics } from "@/modules/staff-identity/domain/roles";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import BackofficeShell from "@/modules/staff-identity/ui/BackofficeShell";
import { env } from "@/shared/config/env";
import { signOutAction } from "../admin/actions";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/** Reads the session cookie, so it can never be prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * `/devs` and its pages wear the backoffice's chrome (`DECISIONS.md` §119): the "Configurație"
 * tab led to a page with no tabs to come back by. The same gate as `/admin`'s layout — sent to
 * sign in, or 404 where there is no sign-in — and then the diagnostics threshold, which every
 * page below asserts again for itself (BR-REQ-060-01, BR-REQ-090-04).
 */
export default async function DevsLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await getCurrentStaffUser();
  if (!staffUser) {
    if (env.STAFF_AUTH_MODE === "disabled") notFound();
    redirect(getPathname({ locale, href: "/sign-in" }));
  }
  if (!canSeeDiagnostics(staffUser.role)) notFound();

  return (
    <BackofficeShell locale={locale} staffUser={staffUser} signOut={signOutAction}>
      {children}
    </BackofficeShell>
  );
}
