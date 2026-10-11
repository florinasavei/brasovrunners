import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import LogoutIcon from "@mui/icons-material/Logout";
import StorefrontIcon from "@mui/icons-material/Storefront";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { canOpenMembersZone } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { env } from "@/shared/config/env";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import SubNav from "@/shared/ui/SubNav";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";
import { signOutAction } from "../admin/actions";

/**
 * The members' zone's three parts (§709), in the owner's order: the partners' codes, the club's shop,
 * the runs. Each is a page of its own under `/members-area` — the zone drew all of it on one long page,
 * and a member after the shop scrolled past the codes and the runs. «Alergări» keeps the zone's own
 * address (`/members-area`): every link made before the tabs — the sign-in's landing, the members'
 * page's button — still arrives at a part that always has something on it.
 */
export const ZONE_TABS = ["codes", "shop", "runs"] as const;
export type ZoneTab = (typeof ZONE_TABS)[number];

const TAB_ROUTE = {
  codes: "/members-area/codes",
  shop: "/members-area/shop",
  runs: "/members-area",
} as const satisfies Record<ZoneTab, string>;

/** The «Members» words, read by the page that draws the frame, which needs them too. */
type MembersWords = Awaited<ReturnType<typeof getTranslations<"Members">>>;

type Account = NonNullable<Awaited<ReturnType<typeof getCurrentAccount>>>;

/**
 * The door, asserted by every one of the three pages and never by the frame around them (§524,
 * BR-REQ-060-01): a layout is not re-run when a member moves between tabs, so each page asks for the
 * account itself. Signed out, the visitor goes to the sign-in in the members' words, which lands
 * back on the zone; a deployment with no sign-in at all answers 404; an account that may not open
 * the zone, 404. While the database is away (§447) the answer is `{ resting }`, a page to return as
 * it is: the zone cannot say who is signed in, so it says that, and keeps the sign-out.
 */
export async function openZone(rawLocale: string): Promise<{ locale: Locale; account: Account } | { locale: Locale; resting: ReactNode }> {
  if (!hasLocale(routing.locales, rawLocale)) notFound();
  const locale: Locale = rawLocale;
  setRequestLocale(locale);
  if (env.STAFF_AUTH_MODE === "disabled") notFound();
  let account: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return { locale, resting: <Resting locale={locale} /> };
  }
  if (!account) redirect(getPathname({ locale, href: { pathname: "/sign-in", query: { to: "members" } } }));
  if (!canOpenMembersZone(account.role)) notFound();
  return { locale, account };
}

/** The zone's title, the greeting, the three tabs, then the part, then the sign-out. */
export default function ZoneFrame({ t, locale, account, active, children }: { t: MembersWords; locale: Locale; account: Account; active: ZoneTab; children: ReactNode }) {
  const glyphs = { codes: <LocalOfferIcon />, shop: <StorefrontIcon />, runs: <DirectionsRunIcon /> } as const;
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("zoneTitle")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }} data-testid="members-greeting">
        {t("zoneGreeting", { name: account.displayName })}
      </Typography>
      <Box sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-tabs">
        <SubNav
          label={t("tabsLabel")}
          items={ZONE_TABS.map((tab) => ({
            href: getPathname({ locale, href: TAB_ROUTE[tab] }),
            label: t(`tabs.${tab}`),
            active: tab === active,
            glyph: glyphs[tab],
          }))}
        />
      </Box>
      {children}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <SignOut locale={locale} label={t("signOut")} />
      </Stack>
    </Container>
  );
}

/** The sign-out, landing on «Beneficiile membrilor» rather than the team's door (§524). */
function SignOut({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="from" value="members" />
      <Button type="submit" variant="text" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="members-sign-out">
        <LogoutIcon aria-hidden="true" sx={glyphSx("medium")} />
        {label}
      </Button>
    </form>
  );
}

/** The database is away (§447): the zone cannot say who is signed in, so it says that, and offers the sign-out. */
async function Resting({ locale }: { locale: Locale }) {
  const t = await getTranslations("Members");
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("zoneTitle")}
      </Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        {t("zoneAway")}
      </Alert>
      <SignOut locale={locale} label={t("signOut")} />
    </Container>
  );
}
