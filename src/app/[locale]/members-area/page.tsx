import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import LogoutIcon from "@mui/icons-material/Logout";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { readMembersZone } from "@/modules/content/members/page-settings";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { canOpenMembersZone, isBackofficeRole } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ButtonLink from "@/shared/ui/ButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";
import { signOutAction } from "../admin/actions";

type Props = { params: Promise<{ locale: string }> };

/** Reads the session, so it is never prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Behind the sign-in: never indexed. The proxy says so as a header too (`private-paths.ts`).
  robots: { index: false, follow: false },
};

/** The zone's words, or `"away"` while the database is (§447) — the page then says so, and keeps the sign-out. */
async function zoneOrAway(locale: Locale): Promise<RichTextDoc | null | "away"> {
  try {
    return await readMembersZone(getDb(), locale);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    console.error("[members-area] the database is away; the zone rests", error);
    return "away";
  }
}

/** How many of the next runs the zone lists; the listing, one press away, has the rest. */
const UPCOMING_SHOWN = 5;

/**
 * «Următoarele alergări» (§NNN): the next published events, soonest first — the public listing's own
 * cached read (§333), so the zone costs the database nothing the listing has not already paid, and
 * shows nothing a stranger could not see. Empty while the database is away.
 */
async function upcomingOrNone(locale: Locale, now: Date) {
  try {
    const events = await cachedUpcomingEvents(locale, now);
    return [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, UPCOMING_SHOWN);
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return [];
  }
}

/**
 * The members' zone (§NNN): one page of the club's words for its members alone, behind the sign-in.
 *
 * The door is the account, never the staff session: a member (`MEMBER`) and every colleague open it
 * (`canOpenMembersZone`). Signed out, the visitor is sent to the sign-in in the members' words
 * (`?to=members`), which lands back here; where this deployment has no sign-in at all, the answer
 * is 404, the backoffice's rule — announcing a door with no lock invites looking for one.
 *
 * The words are read here, per request, from the members' setting — never through the public cache,
 * which is shared by everybody (`page-settings.ts`). Both languages or neither (§352): a zone written
 * in one language shows the catalogue's sentence on both pages rather than the other language's text.
 *
 * A colleague sees the way to the backoffice as well; a member sees only the zone and the sign-out,
 * which lands on «Beneficiile membrilor».
 *
 * **Why here and not under `/admin` (§NNN).** The zone is a public-tree route with the site's own
 * header and footer, not a page inside the backoffice's shell: everything under `/admin` sits
 * behind `requireStaff` in its layout, loads the backoffice's client islands and words, and is the
 * area a member must never be let into — putting the member's page there would mean a hole in the
 * one line `getCurrentStaffUser` draws. Here the door is the account (`getCurrentAccount`), the
 * page is `force-dynamic`, `noindex`, listed in `private-paths.ts` (a `no-store`, `noindex` header)
 * and `robots.txt`. A member who types `/admin` is redirected here by the backoffice's layout.
 *
 * Under the club's words, «Următoarele alergări»: the next published events, from the listing's
 * own cached read (§333) — nothing a stranger could not see, and no query of its own.
 */
export default async function MembersAreaPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  if (env.STAFF_AUTH_MODE === "disabled") notFound();
  let account: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    unstable_rethrow(error);
    if (!isDatabaseAwayError(error)) throw error;
    return <Resting locale={locale} />;
  }
  if (!account) redirect(getPathname({ locale, href: { pathname: "/sign-in", query: { to: "members" } } }));
  if (!canOpenMembersZone(account.role)) notFound();

  const t = await getTranslations("Members");
  const [zone, upcoming] = await Promise.all([zoneOrAway(locale), upcomingOrNone(locale, new Date())]);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("zoneTitle")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-greeting">
        {t("zoneGreeting", { name: account.displayName })}
      </Typography>

      {zone === "away" ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("zoneAway")}
        </Alert>
      ) : zone ? (
        // The club's words, through the renderer's allowlist, never markup the club did not type (§11.3).
        <Box sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 }, "& > :last-child": { mb: 0 } }} data-testid="members-zone">
          <RichText body={zone} />
        </Box>
      ) : (
        <Typography variant="body1" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-zone-empty">
          {t("zoneEmpty")}
        </Typography>
      )}

      <Box component="section" aria-labelledby="members-upcoming-title" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }} data-testid="members-upcoming">
        <Typography id="members-upcoming-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("upcomingTitle")}
        </Typography>
        {upcoming.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("upcomingEmpty")}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {upcoming.map((event) => (
              <Box component="li" key={event.id} sx={{ mb: 0.5 }}>
                <MuiLink
                  href={getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}
                  sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 600 }}
                >
                  {event.title}
                </MuiLink>
                <Typography component="span" variant="body2" color="text.secondary">
                  {" · "}
                  {formatDay(event.startsAt, { locale, timeZone: event.timezone, withTime: true })}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        <MuiLink href={getPathname({ locale, href: "/events" })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("upcomingAll")}
        </MuiLink>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        {/* A colleague is a member too, and their backoffice is one press away (§NNN). */}
        {isBackofficeRole(account.role) && (
          <ButtonLink href="/admin" variant="outlined" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="members-backoffice">
            <AdminPanelSettingsIcon aria-hidden="true" sx={glyphSx("medium")} />
            {t("openBackoffice")}
          </ButtonLink>
        )}
        <SignOut locale={locale} label={t("signOut")} />
      </Stack>
    </Container>
  );
}

/** The sign-out, landing on «Beneficiile membrilor» rather than the team's door (§NNN). */
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
