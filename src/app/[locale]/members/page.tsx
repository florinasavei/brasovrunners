import LockOpenIcon from "@mui/icons-material/LockOpen";
import LoginIcon from "@mui/icons-material/Login";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import type { PublicMembersPage } from "@/modules/content/members/page-settings";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { teamMetaDescription } from "@/modules/content/team/meta-description";
import { cachedMembersPage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { canOpenMembersZone } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ButtonLink from "@/shared/ui/ButtonLink";
import ContactLink from "@/shared/ui/ContactLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/** Per request, like every public page; the page's state and words come from the public cache (§333). */
export const dynamic = "force-dynamic";

/** The club's words about membership: the page's lead, in the renderer's own type (§474's introduction). */
const TEXT_SX = { mb: { xs: DENSITY.sectionGap, sm: 3 }, "& > :last-child": { mb: 0 } } as const;

/**
 * The page's state and words, or null when the database cannot say — «Echipa»'s rule (§459, §281):
 * a page the database cannot answer for stands with the platform's sentence and the sign-in.
 */
async function pageOrNull(locale: Locale): Promise<PublicMembersPage | null> {
  try {
    return await cachedMembersPage(locale);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[members] the page did not answer; it stands with the platform's words", error);
    return null;
  }
}

/**
 * Whether the reader is signed in with an account that opens the members' zone — so the button
 * says «Intră în zona membrilor» rather than asking them to sign in again. Nobody, when the
 * database is away: the sign-in button is the safe answer, and the zone says the rest.
 */
async function signedInMember(): Promise<boolean> {
  try {
    const account = await getCurrentAccount();
    return account !== null && canOpenMembersZone(account.role);
  } catch (error) {
    unstable_rethrow(error);
    return false;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Members" });
  const page = await pageOrNull(locale);
  return {
    title: t("title"),
    // About 160 characters of the club's words, never the whole of them (§483's rule for «Echipa»).
    description: page?.benefitsText ? teamMetaDescription(page.benefitsText) : t("lead", { club: CLUB_NAME }),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/members")),
  };
}

/**
 * «Beneficiile membrilor» / "Members' benefits" (§NNN): what a member of the club gets, in the
 * club's words, and the door to the members' zone.
 *
 * A platform page, like «Echipa» (§459): its address and title are the platform's; the club writes
 * the words in both languages in `/admin/pages/members`, and an Administrator puts the page on the
 * site. A DRAFT page is a 404. Without the club's words the page reads the catalogue's sentence.
 *
 * The button is the sign-in with `?to=members` — the members' words on the sign-in page, and a
 * landing in the zone — or, for somebody already signed in, the zone itself. Where this deployment
 * has no sign-in at all (`STAFF_AUTH_MODE=disabled`) there is no button and a sentence says so,
 * rather than a door that opens on nothing. Accounts are made by the club, never here: a
 * participant never gets one (AGENTS.md §10.3), and a member is somebody the club added.
 *
 * A Server Component with no island of its own but the button.
 */
export default async function MembersPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Members");
  const page = await pageOrNull(locale);
  if (page && !page.published) notFound();
  const signInOpen = env.STAFF_AUTH_MODE !== "disabled";
  const signedIn = signInOpen && (await signedInMember());

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>

      {page?.benefits ? (
        // The club's words, through the renderer's allowlist, never markup the club did not type (§11.3).
        <Box sx={TEXT_SX} data-testid="members-benefits">
          <RichText body={page.benefits} />
        </Box>
      ) : (
        <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
          {t("lead", { club: CLUB_NAME })}
        </Typography>
      )}

      <Paper variant="outlined" component="section" aria-labelledby="members-door" sx={{ p: { xs: DENSITY.cardPadTop, sm: 2 } }} data-testid="members-door">
        <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <Typography id="members-door" variant="h2" sx={{ fontSize: { xs: "1.125rem", sm: "1.375rem" } }}>
            {t("doorTitle")}
          </Typography>
          {signInOpen ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {signedIn ? t("doorSignedIn") : t("doorHelp")}
              </Typography>
              {signedIn ? (
                <ButtonLink href="/members-area" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="members-open-zone">
                  <LockOpenIcon aria-hidden="true" sx={glyphSx("medium")} />
                  {t("openZone")}
                </ButtonLink>
              ) : (
                <ButtonLink
                  href={{ pathname: "/sign-in", query: { to: "members" } }}
                  variant="contained"
                  sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}
                  data-testid="members-sign-in"
                >
                  <LoginIcon aria-hidden="true" sx={glyphSx("medium")} />
                  {t("signIn")}
                </ButtonLink>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("signInUnavailable")}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {t.rich("noAccount", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
          </Typography>
        </Stack>
      </Paper>
    </Container>
  );
}
