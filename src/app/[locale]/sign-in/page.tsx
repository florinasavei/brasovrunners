import LoginIcon from "@mui/icons-material/Login";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DEV_IDENTITIES, isDevStaffSwitcherEnabled } from "@/modules/staff-identity/dev-switcher";
import { landingFor, signInTargetOf } from "@/modules/staff-identity/domain/landing";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { signInAsDevIdentityAction } from "../admin/actions";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; to?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Sign-in — for the team, and since §524 for the club's members.
 *
 * `STAFF_AUTH_MODE=provider` renders the real thing: a single button that hands off to
 * Zitadel through Auth.js (AGENTS.md §13.1, DECISIONS.md §26). `dev-switcher` keeps the
 * synthetic, password-free identities for local and test. Anything else — the safe default
 * for an environment nobody has turned sign-in on for — says so plainly rather than showing a
 * form that cannot work.
 *
 * It sits outside `/admin` on purpose. Inside, the backoffice layout would redirect an
 * anonymous visitor here, and here would redirect them back.
 *
 * One page for both, with the members' words when «Beneficiile membrilor» sent the visitor
 * (`?to=members`, a closed set: `domain/landing.ts`). Where the sign-in lands is the same rule for
 * both mechanisms: the page the person came from, and a member always the members' zone.
 */
export default async function SignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { error, to } = await searchParams;
  const target = signInTargetOf(to);

  // Already signed in: there is nothing to do here, and a sign-in button shown to somebody who
  // is signed in is how a redirect loop starts. A member asks the account, not the staff session
  // (§524): the backoffice would send them back here, and here back to it.
  const account = await getCurrentAccount();
  if (account) redirect(getPathname({ locale, href: landingFor(account.role, target) }));

  const t = await getTranslations("Admin");
  const forMembers = target === "members";

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" sx={{ fontSize: { xs: "1.5rem", sm: "2rem" }, mb: 2 }}>
        {forMembers ? t("signIn.membersTitle") : t("signIn.title")}
      </Typography>
      {forMembers && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {t("signIn.membersLead")}
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t(`errors.${error}`)}
        </Alert>
      )}

      {env.STAFF_AUTH_MODE === "provider" ? (
        <form
          action={async () => {
            "use server";
            // Back where the person came from, in the language the sign-in page was opened in.
            // Without `redirectTo`, Auth.js returns the visitor to this page, which then sends them
            // to Zitadel again — a signed-in visitor looking at a sign-in button. A member sent to
            // `/admin` is passed on to the members' zone by its layout (§524).
            await signIn("zitadel", { redirectTo: getPathname({ locale, href: target === "members" ? "/members-area" : "/admin" }) });
          }}
        >
          <Button type="submit" variant="contained" fullWidth sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
            <LoginIcon aria-hidden="true" sx={glyphSx("medium")} />
            {t("signIn.action")}
          </Button>
        </form>
      ) : isDevStaffSwitcherEnabled() ? (
        <Stack spacing={2}>
          <Alert severity="warning">{t("signIn.developmentOnly")}</Alert>

          {DEV_IDENTITIES.map((identity) => (
            <form action={signInAsDevIdentityAction} key={identity.key}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="identity" value={identity.key} />
              <input type="hidden" name="to" value={target} />
              <Button type="submit" variant="outlined" fullWidth sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
                <LoginIcon aria-hidden="true" sx={glyphSx("medium")} />
                {identity.displayName} · {STAFF_ROLE_LABEL[identity.role]}
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
