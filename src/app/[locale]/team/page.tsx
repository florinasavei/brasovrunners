import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { type PublicTeamMember, type PublicTeamPage, teamPageOnSite } from "@/modules/content/team/repository";
import { coverMagnification, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { cachedTeamPage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ContactLink from "@/shared/ui/ContactLink";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { riseIn } from "@/theme/motion";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/** Per request, like every public page; the page and its cards come from the public cache (§333). */
export const dynamic = "force-dynamic";

/** The card's smaller type on a phone, where two cards share a row. */
const SMALL_TEXT = { xs: "0.8125rem", sm: "0.875rem" } as const;

/**
 * The page's state and cards, or null when the database cannot say. A DRAFT page is a 404, as an
 * unpublished standing page is; a page the database cannot answer for stands with a sentence where
 * the cards would be — the contact page's rule for a read that may not answer (§281).
 */
async function teamOrNull(locale: Locale): Promise<PublicTeamPage | null> {
  try {
    return await cachedTeamPage(locale);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[team] the page did not answer; it stands without its cards", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Team" });
  const page = await teamOrNull(locale);
  return {
    title: t("title"),
    description: page?.intro ?? t("lead", { club: CLUB_NAME }),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/team")),
    // An address with nobody on it is not for a search engine; the sitemap leaves it out too.
    ...(page && teamPageOnSite(page) ? {} : { robots: { index: false, follow: true } }),
  };
}

/**
 * «Echipa» / "The team" (§NNN): the people who run the club, one card each — a photograph, the
 * name, what they do, a few words, and one link if they want it.
 *
 * A platform page, like the contact form: its address and title are the platform's. The club keeps
 * the cards, the page's switch and, if it wants one, its own introduction in both languages, in
 * `/admin/pages/team` — without one the page reads the catalogue's sentence. A DRAFT page is a 404.
 * Each card reads the page's own language alone — a pair written in one language only reads as
 * none on both pages (§352). A Server Component with no island: nothing here is interactive.
 */
export default async function TeamPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Team");
  const page = await teamOrNull(locale);
  if (page && !page.published) notFound();
  const members = page?.members ?? [];

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, whiteSpace: "pre-line" }}>
        {page?.intro ?? t("lead", { club: CLUB_NAME })}
      </Typography>

      {members.length === 0 ? (
        <Typography variant="body1">{t("empty")}</Typography>
      ) : (
        <Box
          component="ul"
          aria-label={t("listLabel")}
          data-testid="team-grid"
          sx={{
            listStyle: "none",
            m: 0,
            p: 0,
            display: "grid",
            // Two to a row on a phone from 320px, three from `sm`, four from `md` — the album
            // grid's columns, so `sizes` is the `tile` column's.
            gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
            gap: { xs: DENSITY.cardGridGap, sm: 2 },
          }}
        >
          {members.map((member, index) => (
            <Card key={member.id} component="li" variant="outlined" sx={riseIn(index)}>
              {member.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- our own WebP ladder, sized on upload (§414)
                <img
                  src={member.photo.thumbUrl}
                  {...photoWidths(member.photo)}
                  width={member.photo.width}
                  height={member.photo.height}
                  // The name is right under it; announcing it twice helps nobody.
                  alt=""
                  loading={index < 4 ? "eager" : "lazy"}
                  style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1", objectFit: "cover", objectPosition: "50% 25%" }}
                />
              )}
              <CardContent sx={{ p: { xs: DENSITY.cardPadTop, sm: 2 }, "&:last-child": { pb: { xs: DENSITY.cardPadTop, sm: 3 } } }}>
                <Typography variant="h2" sx={{ fontSize: { xs: "1rem", sm: "1.25rem" }, mb: 0.25, overflowWrap: "anywhere" }}>
                  {member.name}
                </Typography>
                {member.role && (
                  <Typography variant="body2" color="primary" sx={{ fontWeight: 600, mb: member.bio ? 1 : 0, fontSize: SMALL_TEXT }}>
                    {member.role}
                  </Typography>
                )}
                {member.bio && (
                  // Plain text with its line breaks, never markup the club did not type.
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere", fontSize: SMALL_TEXT }}>
                    {member.bio}
                  </Typography>
                )}
                {member.link && (
                  // The person's own link, checked `https://` at the save; a new tab, no referrer.
                  <MuiLink
                    href={member.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, overflowWrap: "anywhere", fontSize: SMALL_TEXT }}
                  >
                    {linkLabel(member.link)}
                  </MuiLink>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
        {t.rich("contact", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
    </Container>
  );
}

/** A link's words on the card: its host without `www.` — "strava.com", "instagram.com". */
function linkLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/**
 * The photo's `srcset` and `sizes` (§414), or neither: a card is a column of the grid — the album
 * grid's `tile` widths, two, three and four to a row — cut to a square, so a landscape photograph
 * is drawn wider than its card by its ratio. A picture from before the ladder keeps its thumbnail.
 */
function photoWidths(photo: NonNullable<PublicTeamMember["photo"]>): { srcSet?: string; sizes?: string } {
  const srcSet = pictureSrcSet(photo.webUrl, photo.width);
  if (!srcSet) return {};
  return { srcSet, sizes: pictureSizes("tile", 100, coverMagnification(photo.width, photo.height, 1)) };
}
