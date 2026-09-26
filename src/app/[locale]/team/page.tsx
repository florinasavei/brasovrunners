import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import type { PublicTeamMember } from "@/modules/content/team/repository";
import { coverMagnification, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { cachedVisibleTeam } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ContactLink from "@/shared/ui/ContactLink";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { riseIn } from "@/theme/motion";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/** Per request, like every public page; the cards come from the public cache (§333). */
export const dynamic = "force-dynamic";

/**
 * The cards, or none when the database cannot say. The page stands either way — a sentence where
 * the cards would be — the contact page's rule for a read that may not answer (§281).
 */
async function teamOrEmpty(locale: Locale): Promise<PublicTeamMember[]> {
  try {
    return await cachedVisibleTeam(locale);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[team] the cards did not answer; the page stands without them", error);
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Team" });
  const members = await teamOrEmpty(locale);
  return {
    title: t("title"),
    description: t("lead", { club: CLUB_NAME }),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/team")),
    // An address with nothing on it is not for a search engine; the sitemap leaves it out too.
    ...(members.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * «Echipa» / "The team" (§NNN): the people who run the club, one card each — a photograph, the
 * name, what they do, a few words.
 *
 * A platform page, like the contact form: its title and its introduction are the catalogue's, and
 * the club keeps only the cards, in `/admin/pages/team`. Each card reads the page's own language
 * alone — a pair written in one language only reads as none on both pages (§352). A Server
 * Component with no island: nothing here is interactive.
 */
export default async function TeamPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Team");
  const members = await teamOrEmpty(locale);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {t("lead", { club: CLUB_NAME })}
      </Typography>

      {members.length === 0 ? (
        <Typography variant="body1">{t("empty")}</Typography>
      ) : (
        <Box
          component="ul"
          aria-label={t("listLabel")}
          sx={{
            listStyle: "none",
            m: 0,
            p: 0,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
            gap: 2,
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
                  loading={index < 3 ? "eager" : "lazy"}
                  style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1", objectFit: "cover", objectPosition: "50% 25%" }}
                />
              )}
              <CardContent>
                <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 0.25 }}>
                  {member.name}
                </Typography>
                {member.role && (
                  <Typography variant="body2" color="primary" sx={{ fontWeight: 600, mb: member.bio ? 1 : 0 }}>
                    {member.role}
                  </Typography>
                )}
                {member.bio && (
                  // Plain text with its line breaks, never markup the club did not type.
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line" }}>
                    {member.bio}
                  </Typography>
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

/**
 * The photo's `srcset` and `sizes` (§414), or neither: a card is a column of the grid — the
 * albums' `cover` widths — cut to a square, so a landscape photograph is drawn wider than its
 * card by its ratio. A picture from before the ladder keeps its thumbnail alone.
 */
function photoWidths(photo: NonNullable<PublicTeamMember["photo"]>): { srcSet?: string; sizes?: string } {
  const srcSet = pictureSrcSet(photo.webUrl, photo.width);
  if (!srcSet) return {};
  return { srcSet, sizes: pictureSizes("cover", 100, coverMagnification(photo.width, photo.height, 1)) };
}
