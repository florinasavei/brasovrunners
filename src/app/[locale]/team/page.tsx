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
import RichText from "@/modules/content/rich-text/ui/RichText";
import { teamLinkHost, type TeamLinkKind } from "@/modules/content/team/links";
import { teamMetaDescription } from "@/modules/content/team/meta-description";
import { type PublicTeamLink, type PublicTeamMember, type PublicTeamPage, teamPageOnSite } from "@/modules/content/team/repository";
import { teamLinkKindWords } from "@/modules/content/team/ui/kind-words";
import TeamLinkGlyph from "@/modules/content/team/ui/TeamLinkGlyph";
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
 * The words about a person (§474) drawn by the page's own renderer, at the card's size: the
 * paragraphs and lists in the card's small type, a heading one step above it, and every picture a
 * band across the card — a floated third of a column two to a row would be a thumbnail, so the
 * chosen width and side are overridden one class more specifically, as the listing card does (§417).
 */
const BIO_SX = {
  color: "text.secondary",
  overflowWrap: "anywhere",
  "& p, & li": { fontSize: SMALL_TEXT, lineHeight: 1.45 },
  "& p": { mb: 1 },
  "& p:last-child": { mb: 0 },
  "& h2, & h3": { fontSize: { xs: "0.875rem", sm: "0.9375rem" }, mt: 1.5, mb: 0.5 },
  "& ul, & ol": { pl: 2.5, mb: 1 },
  "& figure": { width: "100%", my: 1, float: "none", marginLeft: "auto", marginRight: "auto" },
  "& figcaption": { textAlign: "center" },
} as const;

/** The club's introduction (§474): the page's lead, in the renderer's own type, a little quieter. */
const INTRO_SX = { color: "text.secondary", mb: { xs: DENSITY.sectionGap, sm: 3 }, "& > :last-child": { mb: 0 } } as const;

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
    // About 160 characters of the introduction, never the whole of it (§483).
    description: page?.introText ? teamMetaDescription(page.introText) : t("lead", { club: CLUB_NAME }),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/team")),
    // An address with nobody on it is not for a search engine; the sitemap leaves it out too.
    ...(page && teamPageOnSite(page) ? {} : { robots: { index: false, follow: true } }),
  };
}

/**
 * «Echipa» / "The team" (§459): the people who run the club, one card each — a photograph, the
 * name, what they do, the words about them in the editor every page uses, and their links (§474).
 *
 * A platform page, like the contact form: its address and title are the platform's. The club keeps
 * the cards, the page's switch and, if it wants one, its own introduction in both languages, in
 * `/admin/pages/team` — without one the page reads the catalogue's sentence. A DRAFT page is a 404.
 * Each card reads the page's own language alone — a pair written in one language only reads as
 * none on both pages (§352). A Server Component with no island of its own; a film in a text brings the renderer's (§403).
 */
export default async function TeamPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Team");
  const page = await teamOrNull(locale);
  if (page && !page.published) notFound();
  const members = page?.members ?? [];
  const kindWords = await teamLinkKindWords();

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      {page?.intro ? (
        // The club's own introduction, written in the editor every page uses (§474).
        <Box sx={INTRO_SX} data-testid="team-intro">
          <RichText body={page.intro} />
        </Box>
      ) : (
        <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
          {t("lead", { club: CLUB_NAME })}
        </Typography>
      )}

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
                  // Through the renderer's allowlist, never markup the club did not type (§11.3).
                  <Box sx={BIO_SX} data-testid="team-bio">
                    <RichText body={member.bio} pictures="tile" />
                  </Box>
                )}
                {member.links.length > 0 && (
                  <MemberLinks links={member.links} label={t("linksLabel", { name: member.name })} kindWords={kindWords} />
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
        {t.rich("contact", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
    </Container>
  );
}

/**
 * A person's links (§474), one row each in the club's order: the network's mark (§90), the club's
 * label in this language — or, without one, the network's name, and for a site or anything else
 * its host ("ana-alearga.ro"), so nobody is surprised by what opens. Every row is at least 44
 * pixels tall (BR-REQ-041-01 criterion 6) and opens in a new tab with no referrer: the address is
 * whatever the club pasted, checked `https://` at the save.
 */
function MemberLinks({ links, label, kindWords: words }: { links: readonly PublicTeamLink[]; label: string; kindWords: Record<TeamLinkKind, string> }) {
  return (
    // `role="list"` restated for WebKit, which drops it from a list with no markers (§169).
    <Box component="ul" role="list" aria-label={label} data-testid="team-links" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0 }}>
      {links.map((link, index) => (
        <Box component="li" role="listitem" key={index}>
          <MuiLink
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            data-link-kind={link.kind}
            sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, overflowWrap: "anywhere", fontSize: SMALL_TEXT }}
          >
            <TeamLinkGlyph kind={link.kind} size={18} />
            <Box component="span" sx={{ minWidth: 0 }}>
              {link.label ?? (link.kind === "WEBSITE" || link.kind === "OTHER" ? teamLinkHost(link.url) : words[link.kind])}
            </Box>
          </MuiLink>
        </Box>
      ))}
    </Box>
  );
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
