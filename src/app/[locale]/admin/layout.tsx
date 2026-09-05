import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import AdminTabs, { type AdminTab } from "@/modules/staff-identity/ui/AdminTabs";
import { env } from "@/shared/config/env";
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

  const tabs: AdminTab[] = [
    { href: getPathname({ locale, href: "/admin" }), label: t("nav.events") },
    ...(staffUser.role === "ADMIN"
      ? [
          {
            href: getPathname({ locale, href: "/admin/registrations" }),
            label: t("nav.registrations"),
          },
          { href: getPathname({ locale, href: "/admin/legal" }), label: t("nav.legal") },
          { href: getPathname({ locale, href: "/admin/staff" }), label: t("nav.staff") },
          // What this deployment is configured to do (BR-REQ-090-04). Its own route rather
          // than a backoffice page: it is read by whoever is holding the hosting dashboard.
          { href: getPathname({ locale, href: "/devs" }), label: t("nav.devs") },
        ]
      : []),
  ];

  return (
    /*
      Wider than the public site, and only here. `md` is right for an event page a person reads
      and wrong for a list of registrations with a status, a date, an address and an event title
      on every row — at `md` those wrap into four lines each and the list stops being scannable.
    */
    <Container id="main" component="main" maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ mb: 3, alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Box>
          <Typography variant="h1" sx={{ fontSize: { xs: "1.5rem", sm: "2rem" } }}>
            {t("title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("signedInAs", {
              name: staffUser.displayName,
              role: STAFF_ROLE_LABEL[staffUser.role],
            })}
          </Typography>
        </Box>

        <form action={signOutAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <Button type="submit" size="small" variant="outlined">
            {t("signOut")}
          </Button>
        </form>
      </Stack>

      {/*
        The same role gating as the three bare links this replaces: a section an Administrator
        alone may open is not offered to anybody else, and the page behind it answers 404 to a
        typed URL regardless (BR-REQ-060-01).

        The hrefs are resolved here, on the server, because `getPathname` is a server function —
        the island only decides which of them is the current one.
      */}
      <AdminTabs items={tabs} />

      {/* AGENTS.md §11.1: legal documents are not CMS content and have no editor screen. */}
      <Alert severity="info" sx={{ mb: 3 }}>
        {t("legalNotice")}
      </Alert>

      {children}
    </Container>
  );
}
