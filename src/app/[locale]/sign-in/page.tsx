import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { signIn } from "@/auth";
import { routing } from "@/i18n/routing";
import { DEV_IDENTITIES, isDevStaffSwitcherEnabled } from "@/modules/staff-identity/dev-switcher";
import { env } from "@/shared/config/env";
import { signInAsDevIdentityAction } from "../admin/actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Staff sign-in.
 *
 * `STAFF_AUTH_MODE=provider` renders the real thing: a single button that hands off to
 * Zitadel through Auth.js (AGENTS.md §13.1, DECISIONS.md §26). `dev-switcher` keeps the
 * synthetic, password-free identities for local and test. Anything else — the safe default
 * for an environment nobody has turned sign-in on for — says so plainly rather than showing a
 * form that cannot work.
 *
 * It sits outside `/admin` on purpose. Inside, the backoffice layout would redirect an
 * anonymous visitor here, and here would redirect them back.
 */
export default async function SignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { error } = await searchParams;
  const t = await getTranslations("Admin");

  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" sx={{ fontSize: { xs: "1.5rem", sm: "2rem" }, mb: 2 }}>
        {t("signIn.title")}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t(`errors.${error}`)}
        </Alert>
      )}

      {env.STAFF_AUTH_MODE === "provider" ? (
        <form
          action={async () => {
            "use server";
            await signIn("zitadel");
          }}
        >
          <Button type="submit" variant="contained" fullWidth>
            {t("signIn.withZitadel")}
          </Button>
        </form>
      ) : isDevStaffSwitcherEnabled() ? (
        <Stack spacing={2}>
          <Alert severity="warning">{t("signIn.developmentOnly")}</Alert>

          {DEV_IDENTITIES.map((identity) => (
            <form action={signInAsDevIdentityAction} key={identity.key}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="identity" value={identity.key} />
              <Button type="submit" variant="outlined" fullWidth>
                {identity.displayName} · {t(`roles.${identity.role}`)}
              </Button>
            </form>
          ))}
        </Stack>
      ) : (
        <Alert severity="info">{t("signIn.unavailable")}</Alert>
      )}
    </Container>
  );
}
