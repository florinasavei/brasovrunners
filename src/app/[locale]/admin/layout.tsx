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
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isDevStaffSwitcherEnabled } from "@/modules/staff-identity/dev-switcher";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
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
 * Signed out, the answer depends on whether there is any way to sign in at all. Where the
 * development switcher is available the visitor is sent to it; everywhere else — qa,
 * production, any deployment until the staff login lands — the backoffice answers 404, the
 * same as a route that does not exist. Announcing "sign in" on a site with no sign-in would be
 * an invitation to look for one.
 */
export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await getCurrentStaffUser();
  if (!staffUser) {
    if (isDevStaffSwitcherEnabled()) redirect(getPathname({ locale, href: "/sign-in" }));
    notFound();
  }

  const t = await getTranslations("Admin");

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 5 } }}>
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
            {t("signedInAs", { name: staffUser.displayName, role: t(`roles.${staffUser.role}`) })}
          </Typography>
        </Box>

        <form action={signOutAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <Button type="submit" size="small" variant="outlined">
            {t("signOut")}
          </Button>
        </form>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: "wrap", gap: 1 }}>
        <Link href="/admin">{t("nav.events")}</Link>
        {staffUser.role === "ADMIN" && <Link href="/admin/staff">{t("nav.staff")}</Link>}
      </Stack>

      {/* AGENTS.md §11.1: legal documents are not CMS content and have no editor screen. */}
      <Alert severity="info" sx={{ mb: 3 }}>
        {t("legalNotice")}
      </Alert>

      {children}
    </Container>
  );
}
