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
import RichText from "@/modules/content/rich-text/ui/RichText";
import { buildCanvasRows, cardsOffCanvas } from "@/modules/content/team/domain/canvas";
import { teamMetaDescription } from "@/modules/content/team/meta-description";
import { type PublicTeamBox, type PublicTeamMember, type PublicTeamPage, teamPageOnSite } from "@/modules/content/team/repository";
import { teamLinkKindWords } from "@/modules/content/team/ui/kind-words";
import TeamCanvas from "@/modules/content/team/ui/TeamCanvas";
import type { TeamCanvasWords } from "@/modules/content/team/ui/TeamCanvasCard";
import TeamMemberLinks, { teamPhotoWidths } from "@/modules/content/team/ui/TeamMemberLinks";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import { cachedTeamPage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ClubIdentity from "@/shared/ui/ClubIdentity";
import ContactLink from "@/shared/ui/ContactLink";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { riseIn } from "@/theme/motion";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/**
 * Static, made on its first visit and kept by the CDN (§549, amending §333); a save of the page or
 * its cards expires it through the rows' own tag, and a day is the ceiling. A literal, as Next
 * requires: it equals `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

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
 * The grid of cards (§459): two to a row on a phone from 320px, three from `sm`, four from `md` —
 * the album grid's columns, so `sizes` is the `tile` column's.
 */
const GRID_SX = {
  listStyle: "none",
  m: 0,
  p: 0,
  display: "grid",
  gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
  gap: { xs: DENSITY.cardGridGap, sm: 2 },
} as const;

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
 *
 * Since §NNN (amending §691) a card may carry a level. While no shown card has one the page is the
 * grid it always was, with the page's boxes under it; otherwise it is the canvas the club's
 * president drew — the blue section with the levelled cards row by row, no lines, each card
 * opening in place, and the boxes at its bottom — and the cards without a level in the grid under
 * the canvas.
 */
export default async function TeamPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Team");
  const page = await teamOrNull(locale);
  if (page && !page.published) notFound();
  const members = page?.members ?? [];
  const boxes = page?.boxes ?? [];
  const words: TeamCanvasWords = {
    more: t("more"),
    moreAbout: (name) => t("moreAbout", { name }),
    linksLabel: (name) => t("linksLabel", { name }),
    responsibilities: t("responsibilities"),
    kinds: await teamLinkKindWords(),
  };
  const rows = buildCanvasRows(members);
  const onCanvas = rows.length > 0;
  const gridMembers = onCanvas ? cardsOffCanvas(members) : members;

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

      {members.length === 0 && <Typography variant="body1">{t("empty")}</Typography>}

      {onCanvas && (
        // The canvas (§NNN): the levelled cards row by row, the page's boxes at its bottom.
        <TeamCanvas rows={rows} boxes={boxes} words={words} label={t("listLabel")} boxesLabel={t("boxesLabel")} />
      )}

      {gridMembers.length > 0 && (
        <Box
          component="ul"
          // Under the canvas the grid is a second list, named as one («Alți membri ai echipei»):
          // two regions with one name are one list twice to a screen reader.
          aria-label={onCanvas ? t("othersLabel") : t("listLabel")}
          data-testid="team-grid"
          // Under the canvas, the cards with no level keep a section's room from it.
          sx={onCanvas ? { ...GRID_SX, mt: { xs: DENSITY.sectionGap, sm: 3 } } : GRID_SX}
        >
          {gridMembers.map((member, index) => (
            <TeamCard key={member.id} member={member} index={index} words={words} />
          ))}
        </Box>
      )}

      {!onCanvas && boxes.length > 0 && (
        // The page's boxes (§691) under the grid, in its order; on the canvas they are its bottom row.
        <Box component="section" aria-label={t("boxesLabel")} data-testid="team-boxes" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 }, display: "grid", gap: 2 }}>
          {boxes.map((box, index) => (
            <TeamBox key={box.id} box={box} index={index} />
          ))}
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
        {t.rich("contact", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
      {/* «Echipa» is an «about» page: the club's legal name and CIF at its end (§565). */}
      <ClubIdentity shape="line" />
    </Container>
  );
}

/**
 * One person's card in the grid: the photograph in the crop the club drew (§541), the name, the
 * role title in the accent colour, the sub-role line, «Responsabilități» as bullets (§691), then
 * the words about them and their links (§474). The canvas's cards are `TeamCanvasCard` (§NNN).
 */
function TeamCard({ member, index, words }: { member: PublicTeamMember; index: number; words: TeamCanvasWords }) {
  const hasMore = member.bio !== null || member.links.length > 0 || member.responsibilities.length > 0 || member.subtitle !== null;
  return (
    <Card component="li" variant="outlined" data-testid="team-card" sx={{ ...riseIn(index), position: "relative" }}>
      {member.photo && (
        // Our own WebP ladder, sized on upload (§414), in the crop the club drew — or, with
        // none, the square it always was (§541). The name is right under it: `alt` is empty.
        <TeamPhotoImage
          src={member.photo.thumbUrl}
          {...teamPhotoWidths(member.photo, "tile")}
          photo={member.photo}
          loading={index < 4 ? "eager" : "lazy"}
          testId="team-photo"
        />
      )}
      <CardContent sx={{ p: { xs: DENSITY.cardPadTop, sm: 2 }, "&:last-child": { pb: { xs: DENSITY.cardPadTop, sm: 3 } } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: "1rem", sm: "1.25rem" }, mb: 0.25, overflowWrap: "anywhere" }}>
          {member.name}
        </Typography>
        {member.role && (
          <Typography variant="body2" color="primary" sx={{ fontWeight: 600, mb: hasMore ? 0.5 : 0, fontSize: SMALL_TEXT }}>
            {member.role}
          </Typography>
        )}
        {member.subtitle && (
          <Typography variant="body2" color="text.secondary" data-testid="team-subtitle" sx={{ mb: 1, fontSize: SMALL_TEXT, overflowWrap: "anywhere" }}>
            {member.subtitle}
          </Typography>
        )}
        {member.responsibilities.length > 0 && (
          <Box data-testid="team-responsibilities" sx={{ mb: member.bio || member.links.length > 0 ? 1 : 0 }}>
            <Typography component="h3" variant="subtitle2" sx={{ fontSize: SMALL_TEXT, fontWeight: 700, mt: 0.5 }}>
              {words.responsibilities}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, color: "text.secondary", "& li": { fontSize: SMALL_TEXT, lineHeight: 1.45, overflowWrap: "anywhere" } }}>
              {member.responsibilities.map((line, lineIndex) => (
                <li key={lineIndex}>{line}</li>
              ))}
            </Box>
          </Box>
        )}
        {member.bio && (
          // Through the renderer's allowlist, never markup the club did not type (§11.3).
          <Box sx={BIO_SX} data-testid="team-bio">
            <RichText body={member.bio} pictures="tile" />
          </Box>
        )}
        {member.links.length > 0 && <TeamMemberLinks links={member.links} label={words.linksLabel(member.name)} kindWords={words.kinds} fontSize={SMALL_TEXT} />}
      </CardContent>
    </Card>
  );
}

/** One box under the grid (§691): its heading and the club's text through the page's renderer. */
function TeamBox({ box, index }: { box: PublicTeamBox; index: number }) {
  return (
    <Card component="article" variant="outlined" data-testid="team-box" sx={riseIn(index)}>
      <CardContent sx={{ p: { xs: DENSITY.cardPadTop, sm: 2 }, "&:last-child": { pb: { xs: DENSITY.cardPadTop, sm: 3 } } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.125rem", sm: "1.375rem" }, mb: 1, overflowWrap: "anywhere" }}>
          {box.title}
        </Typography>
        <Box sx={{ "& > :last-child": { mb: 0 }, overflowWrap: "anywhere" }}>
          <RichText body={box.body} />
        </Box>
      </CardContent>
    </Card>
  );
}
